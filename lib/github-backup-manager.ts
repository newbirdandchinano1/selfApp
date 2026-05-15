/**
 * GitHub REST「仓库文件内容」API：创建或覆盖单文件。
 * 新文件直接 PUT；已存在文件必须先 GET 拿到 `sha`，再在 PUT 请求体里带上 `sha` 才能覆盖。
 *
 * Token 必须由调用方注入（如 SecureStore / 用户输入 / 构建期 env），切勿提交到仓库。
 */

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
};

export type GitHubBackupUploadResult = GitHubBackupUploadOk | GitHubBackupUploadFail;

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
    options?: { message?: string },
  ): Promise<GitHubBackupUploadResult> {
    if (!this.token || !this.owner || !this.repo || !this.path) {
      const msg = 'GitHub 配置不完整：token / owner / repo / path 均不能为空';
      return { ok: false, message: msg, diagnosticText: msg };
    }

    const url = this.contentsUrl();
    let existingSha: string | null = null;

    // —— GET：取 sha（完整记录响应，便于排查）——
    let getRes: Response;
    try {
      getRes = await fetch(url, {
        method: 'GET',
        headers: this.authHeaders(),
      });
    } catch (e) {
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

    let putRes: Response;
    try {
      putRes = await fetch(url, {
        method: 'PUT',
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(putJsonBody),
      });
    } catch (e) {
      const diagnosticText = [
        formatFetchThrownDiagnostic('PUT', url, e),
        '',
        '（PUT 前 GET 已成功；若需对照，GET 判定为「' + (existingSha ? `已有文件 sha=${existingSha.slice(0, 7)}…` : '新文件无 sha') + '」）',
      ].join('\n');
      return {
        ok: false,
        message: '上传备份失败（网络层）',
        diagnosticText,
      };
    }

    const putBodyText = await putRes.text().catch(() => '(读取响应正文失败)');

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
}
