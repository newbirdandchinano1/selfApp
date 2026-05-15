/**
 * GitHub REST「仓库文件内容」API：创建或覆盖单文件。
 * 新文件直接 PUT；已存在文件必须先 GET 拿到 `sha`，再在 PUT 请求体里带上 `sha` 才能覆盖。
 *
 * Token 必须由调用方注入（如 SecureStore / 用户输入 / 构建期 env），切勿提交到仓库。
 */

import { fetchWithTimeoutAndRetry, isAbortError } from '@/lib/github-fetch-retry';

const GITHUB_API = 'https://api.github.com';
const DEFAULT_API_VERSION = '2022-11-28';

export type GitHubBackupConfig = {
  token: string;
  owner: string;
  repo: string;
  /** 仓库内路径，如 `backups/user_data.json` */
  path: string;
  /** 默认 `2022-11-28`，与官方示例一致 */
  apiVersion?: string;
};

export type GitHubBackupUploadOk = {
  ok: true;
  status: number;
  commitUrl?: string;
};

export type GitHubBackupUploadFail = {
  ok: false;
  status?: number;
  message: string;
  bodyText?: string;
  /** 含 URL、HTTP 状态、响应正文、原生网络错误等，供界面完整展示 */
  diagnosticText: string;
  /** 用户进入后台中止或 AbortSignal */
  aborted?: boolean;
};

export type GitHubBackupUploadResult = GitHubBackupUploadOk | GitHubBackupUploadFail;

export type GitHubDownloadOk = { ok: true; text: string };

export type GitHubDownloadFail = {
  ok: false;
  status?: number;
  message: string;
  diagnosticText: string;
  aborted?: boolean;
};

export type GitHubDownloadResult = GitHubDownloadOk | GitHubDownloadFail;

function decodeBase64Utf8GithubField(b64: string): string {
  const clean = b64.replace(/\s/g, '');
  if (typeof globalThis.atob !== 'function') {
    throw new Error('globalThis.atob 不可用，无法解码 GitHub 文件内容');
  }
  const bin = globalThis.atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return new TextDecoder('utf-8').decode(bytes);
}

const DEFAULT_BACKUP_PATH = 'backups/user_data.json';

/** 全量备份时每个 SQLite 表、kv 快照、manifest 写入的目录前缀（下含 `sqlite/`、`kv/`）。 */
const DEFAULT_FULL_BACKUP_ROOT = 'backups/selfapp';

/**
 * 多文件全量备份根路径。可通过 `EXPO_PUBLIC_GITHUB_BACKUP_ROOT` 覆盖，默认 `backups/selfapp`。
 * 与 `EXPO_PUBLIC_GITHUB_BACKUP_PATH`（单文件账单自动同步）相互独立。
 */
export function getGitHubFullBackupRootFromEnv(): string {
  const raw = process.env.EXPO_PUBLIC_GITHUB_BACKUP_ROOT?.trim();
  const s = (raw || DEFAULT_FULL_BACKUP_ROOT).replace(/^\/+/, '').replace(/\/+$/, '');
  return s;
}

/**
 * 从 Expo 环境变量组装配置（需在项目根目录 `.env` / `.env.local` 中设置 `EXPO_PUBLIC_*`，且重启 Metro）。
 * 未配置完整时返回 `null`。勿将含 Token 的文件提交到 Git。
 */
export function getGitHubBackupConfigFromEnv(): GitHubBackupConfig | null {
  const token = process.env.EXPO_PUBLIC_GITHUB_TOKEN?.trim();
  const owner = process.env.EXPO_PUBLIC_GITHUB_OWNER?.trim();
  const repo = process.env.EXPO_PUBLIC_GITHUB_REPO?.trim();
  if (!token || !owner || !repo) return null;
  const pathRaw = process.env.EXPO_PUBLIC_GITHUB_BACKUP_PATH?.trim();
  const path = pathRaw || DEFAULT_BACKUP_PATH;
  return { token, owner, repo, path };
}

function encodeRepoContentsPath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function payloadToBase64(payload: string | Uint8Array): string {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('globalThis.btoa 不可用，无法做 Base64 编码');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(binary);
}

function readJsonSha(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null;
  const sha = (data as { sha?: unknown }).sha;
  return typeof sha === 'string' && sha.length > 0 ? sha : null;
}

function serializeUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { cause?: unknown; code?: unknown };
    const lines = [`${anyErr.name}: ${anyErr.message}`];
    if (anyErr.code != null && anyErr.code !== '') lines.push(`code: ${String(anyErr.code)}`);
    if (anyErr.cause != null) lines.push(`cause: ${serializeUnknownError(anyErr.cause)}`);
    if (typeof anyErr.stack === 'string' && anyErr.stack.trim()) lines.push(`stack:\n${anyErr.stack}`);
    return lines.join('\n');
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

function formatFetchThrownDiagnostic(method: string, url: string, err: unknown): string {
  return [
    `=== ${method} 请求在到达服务器前失败（常见于 DNS、TLS、无网络、被代理拦截）===`,
    `URL: ${url}`,
    '',
    serializeUnknownError(err),
  ].join('\n');
}

function formatHttpDiagnostic(
  phase: string,
  method: string,
  url: string,
  status: number,
  responseBody: string,
  extraHeaders?: Record<string, string>,
): string {
  const headerLines = extraHeaders
    ? Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`)
    : [];
  return [
    `=== ${phase} ===`,
    `${method} ${url}`,
    `HTTP ${status}`,
    ...headerLines,
    '',
    '----- 响应正文（完整）-----',
    responseBody || '(空)',
  ].join('\n');
}

export class GitHubBackupManager {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly path: string;
  private readonly apiVersion: string;

  constructor(config: GitHubBackupConfig) {
    this.token = config.token.trim();
    this.owner = config.owner.trim();
    this.repo = config.repo.trim();
    this.path = config.path.replace(/^\/+/, '').trim();
    this.apiVersion = (config.apiVersion ?? DEFAULT_API_VERSION).trim();
  }

  private contentsUrl(): string {
    const encoded = encodeRepoContentsPath(this.path);
    return `${GITHUB_API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${encoded}`;
  }

  private authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': this.apiVersion,
    };
  }

  /**
   * 若文件存在返回其 `sha`；不存在（404）返回 `null`；其它状态视为失败并抛出说明。
   * @deprecated 内部改用 {@link GitHubBackupManager.uploadBackup} 内联请求以收集完整诊断；保留供外部直接 GET 时使用。
   */
  async fetchCurrentFileSha(): Promise<string | null> {
    const url = this.contentsUrl();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: this.authHeaders(),
      });
    } catch (e) {
      throw new Error(formatFetchThrownDiagnostic('GET', url, e));
    }

    const text = await res.text().catch(() => '');

    if (res.status === 200) {
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return readJsonSha(json);
    }

    if (res.status === 404) {
      return null;
    }

    throw new Error(formatHttpDiagnostic('获取文件 sha（GET）', 'GET', url, res.status, text));
  }

  /**
   * 上传或覆盖备份：自动处理「无 sha / 有 sha」两种 PUT 体。
   *
   * @param payload 通常为 `JSON.stringify(...)` 的字符串，或原始 UTF-8 字节
   * @param options.message 自定义 commit message，默认带时间戳
   */
  async uploadBackup(
    payload: string | Uint8Array,
    options?: { message?: string; signal?: AbortSignal },
  ): Promise<GitHubBackupUploadResult> {
    if (!this.token || !this.owner || !this.repo || !this.path) {
      const msg = 'GitHub 配置不完整：token / owner / repo / path 均不能为空';
      return { ok: false, message: msg, diagnosticText: msg };
    }

    if (options?.signal?.aborted) {
      const msg = '操作已中止（例如应用进入后台）';
      return { ok: false, message: msg, diagnosticText: msg, aborted: true };
    }

    const url = this.contentsUrl();
    let existingSha: string | null = null;

    // —— GET：取 sha（完整记录响应，便于排查）——
    let getRes: Response;
    try {
      getRes = await fetchWithTimeoutAndRetry(
        url,
        { method: 'GET', headers: this.authHeaders() },
        { signal: options?.signal },
      );
    } catch (e) {
      if (isAbortError(e) || options?.signal?.aborted) {
        const msg = '已中止：获取云端文件信息（常见于切到后台或主动取消）';
        return { ok: false, message: msg, diagnosticText: formatFetchThrownDiagnostic('GET', url, e), aborted: true };
      }
      const diagnosticText = formatFetchThrownDiagnostic('GET', url, e);
      return {
        ok: false,
        message: '获取云端文件信息失败（网络层）',
        diagnosticText,
      };
    }

    const getBodyText = await getRes.text().catch(() => '(读取响应正文失败)');
    if (getRes.status === 200) {
      let parsed: unknown = null;
      try {
        parsed = getBodyText ? JSON.parse(getBodyText) : null;
      } catch {
        parsed = null;
      }
      existingSha = readJsonSha(parsed);
    } else if (getRes.status === 404) {
      existingSha = null;
    } else {
      const diagnosticText = formatHttpDiagnostic(
        '获取文件 sha（GET）',
        'GET',
        url,
        getRes.status,
        getBodyText,
      );
      return {
        ok: false,
        status: getRes.status,
        message: `获取文件 sha 失败：HTTP ${getRes.status}`,
        bodyText: getBodyText,
        diagnosticText,
      };
    }

    let base64Content: string;
    try {
      base64Content = payloadToBase64(payload);
    } catch (e) {
      const diagnosticText = ['Base64 编码失败', serializeUnknownError(e)].join('\n\n');
      return {
        ok: false,
        message: '本地数据编码失败',
        diagnosticText,
      };
    }

    const defaultMsg = `APP 数据自动备份 — ${new Date().toISOString()}`;
    const putJsonBody: Record<string, string> = {
      message: (options?.message ?? defaultMsg).trim() || defaultMsg,
      content: base64Content,
    };
    if (existingSha) {
      putJsonBody.sha = existingSha;
    }

    let putRes!: Response;
    let putBodyText = '';
    let conflictRetryDone = false;

    for (;;) {
      try {
        putRes = await fetchWithTimeoutAndRetry(
          url,
          {
            method: 'PUT',
            headers: {
              ...this.authHeaders(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(putJsonBody),
          },
          { signal: options?.signal },
        );
      } catch (e) {
        if (isAbortError(e) || options?.signal?.aborted) {
          const msg = '已中止：上传备份（常见于切到后台或网络多次超时）';
          return {
            ok: false,
            message: msg,
            diagnosticText: [
              formatFetchThrownDiagnostic('PUT', url, e),
              '',
              '（PUT 前 GET 已成功；若需对照，GET 判定为「' +
                (existingSha ? `已有文件 sha=${existingSha.slice(0, 7)}…` : '新文件无 sha') +
                '」）',
            ].join('\n'),
            aborted: true,
          };
        }
        const diagnosticText = [
          formatFetchThrownDiagnostic('PUT', url, e),
          '',
          '（PUT 前 GET 已成功；若需对照，GET 判定为「' +
            (existingSha ? `已有文件 sha=${existingSha.slice(0, 7)}…` : '新文件无 sha') +
            '」）',
        ].join('\n');
        return {
          ok: false,
          message: '上传备份失败（网络层）',
          diagnosticText,
        };
      }

      putBodyText = await putRes.text().catch(() => '(读取响应正文失败)');

      if (putRes.status === 200 || putRes.status === 201) {
        let commitUrl: string | undefined;
        try {
          const json = putBodyText ? JSON.parse(putBodyText) : null;
          if (json && typeof json === 'object' && json !== null) {
            const commit = (json as { commit?: { html_url?: string } }).commit;
            if (commit && typeof commit.html_url === 'string') {
              commitUrl = commit.html_url;
            }
          }
        } catch {
          /* ignore */
        }
        return { ok: true, status: putRes.status, commitUrl };
      }

      if (putRes.status === 409 && !conflictRetryDone) {
        conflictRetryDone = true;
        let get2: Response;
        try {
          get2 = await fetchWithTimeoutAndRetry(
            url,
            { method: 'GET', headers: this.authHeaders() },
            { signal: options?.signal },
          );
        } catch {
          break;
        }
        const get2Text = await get2.text().catch(() => '');
        if (get2.status === 200) {
          let parsed2: unknown = null;
          try {
            parsed2 = get2Text ? JSON.parse(get2Text) : null;
          } catch {
            parsed2 = null;
          }
          const freshSha = readJsonSha(parsed2);
          if (freshSha) {
            putJsonBody.sha = freshSha;
          } else {
            delete putJsonBody.sha;
          }
          try {
            base64Content = payloadToBase64(payload);
            putJsonBody.content = base64Content;
          } catch {
            break;
          }
          continue;
        }
      }

      break;
    }

    const diagnosticText = [
      formatHttpDiagnostic('上传文件（PUT）', 'PUT', url, putRes.status, putBodyText),
      '',
      '----- PUT 请求体摘要（不含完整 base64）-----',
      JSON.stringify(
        {
          message: putJsonBody.message,
          hasSha: Boolean(putJsonBody.sha),
          contentLengthChars: putJsonBody.content?.length ?? 0,
        },
        null,
        2,
      ),
    ].join('\n');

    return {
      ok: false,
      status: putRes.status,
      message: `备份失败：HTTP ${putRes.status}`,
      bodyText: putBodyText || undefined,
      diagnosticText,
    };
  }

  /**
   * 下载仓库内单个文件 UTF-8 文本（Contents API，适用于 JSON 等文本备份）。
   */
  async downloadUtf8Text(options?: { signal?: AbortSignal }): Promise<GitHubDownloadResult> {
    if (!this.token || !this.owner || !this.repo || !this.path) {
      const msg = 'GitHub 配置不完整：token / owner / repo / path 均不能为空';
      return { ok: false, message: msg, diagnosticText: msg };
    }

    if (options?.signal?.aborted) {
      const msg = '操作已中止（例如应用进入后台）';
      return { ok: false, message: msg, diagnosticText: msg, aborted: true };
    }

    const url = this.contentsUrl();
    let res: Response;
    try {
      res = await fetchWithTimeoutAndRetry(
        url,
        { method: 'GET', headers: this.authHeaders() },
        { signal: options?.signal },
      );
    } catch (e) {
      if (isAbortError(e) || options?.signal?.aborted) {
        return {
          ok: false,
          message: '下载已中止（常见于切到后台）',
          diagnosticText: formatFetchThrownDiagnostic('GET', url, e),
          aborted: true,
        };
      }
      return {
        ok: false,
        message: '下载失败（网络层）',
        diagnosticText: formatFetchThrownDiagnostic('GET', url, e),
      };
    }

    const text = await res.text().catch(() => '(读取响应正文失败)');

    if (res.status === 404) {
      return {
        ok: false,
        status: 404,
        message: '仓库中不存在该路径文件',
        diagnosticText: formatHttpDiagnostic('下载文件（GET）', 'GET', url, res.status, text),
      };
    }

    if (res.status !== 200) {
      return {
        ok: false,
        status: res.status,
        message: `下载失败：HTTP ${res.status}`,
        diagnosticText: formatHttpDiagnostic('下载文件（GET）', 'GET', url, res.status, text),
      };
    }

    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return {
        ok: false,
        message: '响应不是合法 JSON',
        diagnosticText: formatHttpDiagnostic('解析 GitHub 响应 JSON', 'GET', url, res.status, text),
      };
    }

    if (parsed === null || typeof parsed !== 'object') {
      return {
        ok: false,
        message: 'GitHub 响应 JSON 格式异常',
        diagnosticText: text.slice(0, 4000),
      };
    }

    const encoding = (parsed as { encoding?: unknown }).encoding;
    const content = (parsed as { content?: unknown }).content;
    if (encoding !== 'base64' || typeof content !== 'string' || !content.trim()) {
      const downloadUrl = (parsed as { download_url?: unknown }).download_url;
      if (typeof downloadUrl === 'string' && downloadUrl.startsWith('http')) {
        try {
          const rawRes = await fetchWithTimeoutAndRetry(
            downloadUrl,
            { method: 'GET' },
            { signal: options?.signal },
          );
          const rawText = await rawRes.text();
          if (!rawRes.ok) {
            return {
              ok: false,
              status: rawRes.status,
              message: `download_url 拉取失败：HTTP ${rawRes.status}`,
              diagnosticText: rawText.slice(0, 4000),
            };
          }
          return { ok: true, text: rawText };
        } catch (e) {
          if (isAbortError(e) || options?.signal?.aborted) {
            return {
              ok: false,
              message: 'download_url 拉取已中止',
              diagnosticText: serializeUnknownError(e),
              aborted: true,
            };
          }
          return {
            ok: false,
            message: 'download_url 拉取失败（网络层）',
            diagnosticText: serializeUnknownError(e),
          };
        }
      }
      return {
        ok: false,
        message: '不是单文件内容响应（可能为目录 listing 或 LFS）',
        diagnosticText: JSON.stringify(parsed, null, 2).slice(0, 4000),
      };
    }

    try {
      return { ok: true, text: decodeBase64Utf8GithubField(content) };
    } catch (e) {
      return {
        ok: false,
        message: 'Base64 解码失败',
        diagnosticText: serializeUnknownError(e),
      };
    }
  }
}
