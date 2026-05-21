/**
 * Cloudflare KV Worker API：按 key 读写 JSON 备份。
 * GET `?key=` 读取；POST `?key=` + JSON body 写入（覆盖）。
 *
 * Token 可由调用方注入（AsyncStorage / 内置默认值 / 构建期 env），切勿提交敏感密钥到公开仓库。
 */

import { fetchWithTimeoutAndRetry, isAbortError } from '@/lib/github-fetch-retry';
import { getGitHubFullBackupRoot } from '@/lib/github-backup-user-config';

/** @deprecated 请使用 `getGitHubFullBackupRoot` from `@/lib/github-backup-user-config` */
export function getGitHubFullBackupRootFromEnv(): string {
  return getGitHubFullBackupRoot();
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export type GitHubBackupConfig = {
  token: string;
  apiUrl: string;
  /** KV 键名，如 `backups/selfapp/manifest.json` */
  path: string;
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
  diagnosticText: string;
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
): string {
  return [
    `=== ${phase} ===`,
    `${method} ${url}`,
    `HTTP ${status}`,
    '',
    '----- 响应正文（完整）-----',
    responseBody || '(空)',
  ].join('\n');
}

function buildKvRequestUrl(apiUrl: string, key: string): string {
  const base = apiUrl.replace(/\/+$/, '');
  return `${base}/?key=${encodeURIComponent(key)}`;
}

function payloadToUtf8String(payload: string | Uint8Array): string {
  if (typeof payload === 'string') return payload;
  return new TextDecoder('utf-8').decode(payload);
}

export class GitHubBackupManager {
  private readonly token: string;
  private readonly apiUrl: string;
  private readonly path: string;

  constructor(config: GitHubBackupConfig) {
    this.token = config.token.trim();
    this.apiUrl = config.apiUrl.trim();
    this.path = config.path.replace(/^\/+/, '').trim();
  }

  private authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'User-Agent': DEFAULT_USER_AGENT,
    };
  }

  private kvUrl(): string {
    return buildKvRequestUrl(this.apiUrl, this.path);
  }

  /**
   * 上传或覆盖备份（POST 覆盖写入）。
   */
  async uploadBackup(
    payload: string | Uint8Array,
    options?: { message?: string; signal?: AbortSignal },
  ): Promise<GitHubBackupUploadResult> {
    if (!this.token || !this.apiUrl || !this.path) {
      const msg = '云端 KV 配置不完整：apiUrl / token / path 均不能为空';
      return { ok: false, message: msg, diagnosticText: msg };
    }

    if (options?.signal?.aborted) {
      const msg = '操作已中止（例如应用进入后台）';
      return { ok: false, message: msg, diagnosticText: msg, aborted: true };
    }

    const url = this.kvUrl();
    let body: string;
    try {
      body = payloadToUtf8String(payload);
    } catch (e) {
      const diagnosticText = ['请求体编码失败', serializeUnknownError(e)].join('\n\n');
      return { ok: false, message: '本地数据编码失败', diagnosticText };
    }

    let res: Response;
    try {
      res = await fetchWithTimeoutAndRetry(
        url,
        {
          method: 'POST',
          headers: this.authHeaders(),
          body,
        },
        { signal: options?.signal },
      );
    } catch (e) {
      if (isAbortError(e) || options?.signal?.aborted) {
        const msg = '已中止：上传备份（常见于切到后台或网络多次超时）';
        return {
          ok: false,
          message: msg,
          diagnosticText: formatFetchThrownDiagnostic('POST', url, e),
          aborted: true,
        };
      }
      return {
        ok: false,
        message: '上传备份失败（网络层）',
        diagnosticText: formatFetchThrownDiagnostic('POST', url, e),
      };
    }

    const resText = await res.text().catch(() => '(读取响应正文失败)');

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status };
    }

    const hint =
      res.status === 401
        ? '（401 通常表示访问密钥不正确）'
        : res.status === 500
          ? '（500 若提示 KV 绑定，请检查 Worker 环境变量）'
          : '';
    return {
      ok: false,
      status: res.status,
      message: `备份失败：HTTP ${res.status}${hint}`,
      bodyText: resText || undefined,
      diagnosticText: formatHttpDiagnostic('上传 KV（POST）', 'POST', url, res.status, resText),
    };
  }

  /**
   * 下载指定 key 的 UTF-8 文本（通常为 JSON 备份）。
   */
  async downloadUtf8Text(options?: { signal?: AbortSignal }): Promise<GitHubDownloadResult> {
    if (!this.token || !this.apiUrl || !this.path) {
      const msg = '云端 KV 配置不完整：apiUrl / token / path 均不能为空';
      return { ok: false, message: msg, diagnosticText: msg };
    }

    if (options?.signal?.aborted) {
      const msg = '操作已中止（例如应用进入后台）';
      return { ok: false, message: msg, diagnosticText: msg, aborted: true };
    }

    const url = this.kvUrl();
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
        message: '云端不存在该 key',
        diagnosticText: formatHttpDiagnostic('下载 KV（GET）', 'GET', url, res.status, text),
      };
    }

    if (res.status !== 200) {
      const hint = res.status === 401 ? '（401 通常表示访问密钥不正确）' : '';
      return {
        ok: false,
        status: res.status,
        message: `下载失败：HTTP ${res.status}${hint}`,
        diagnosticText: formatHttpDiagnostic('下载 KV（GET）', 'GET', url, res.status, text),
      };
    }

    return { ok: true, text };
  }
}
