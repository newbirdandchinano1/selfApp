/**
 * Agent Chat SSE 读取：优先 fetch ReadableStream；RN 不支持时回退 XHR onprogress。
 *
 * 出卡铁律：card / cards / tool_result 事件必须能在 CRLF、多 data 行、半包下可靠解析；
 * 静默丢包会导致「工具摘要说有确认卡，气泡却没有卡」。
 */
import { ApiRequestError } from '@/lib/api/http';

export type SseJsonHandler = (ev: Record<string, unknown>) => void;

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && e.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError')
  );
}

/** 代理/网关常把 LF 转成 CRLF；统一成 \n 才能按 \n\n 分帧 */
export function normalizeSseNewlines(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 解析单个 SSE 事件块（已按空行切分）。
 * - 标准：多行 data: 用 \n 拼接成一个 JSON
 * - 容错：若拼接失败且有多行 data，尝试逐行当独立 JSON（分帧错乱时的自救）
 */
export function parseSseChunk(rawEvent: string, onEvent: SseJsonHandler): void {
  const normalized = normalizeSseNewlines(rawEvent);
  const lines = normalized.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    // SSE：data: 后可选一个前导空格
    dataLines.push(line.slice(5).replace(/^\s/, ''));
  }
  if (!dataLines.length) return;

  const joined = dataLines.join('\n');
  try {
    const ev = JSON.parse(joined) as Record<string, unknown>;
    if (ev && typeof ev === 'object') onEvent(ev);
    return;
  } catch {
    // 分帧失败时可能把多个事件揉进一块：逐 data 行自救
    if (dataLines.length <= 1) return;
    for (const line of dataLines) {
      const t = line.trim();
      if (!t.startsWith('{') && !t.startsWith('[')) continue;
      try {
        const ev = JSON.parse(t) as Record<string, unknown>;
        if (ev && typeof ev === 'object') onEvent(ev);
      } catch {
        // 单行仍坏则跳过
      }
    }
  }
}

export function feedSseBuffer(
  buffer: string,
  chunk: string,
  onEvent: SseJsonHandler,
): string {
  const next = normalizeSseNewlines(buffer + chunk);
  const parts = next.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    if (part.trim()) parseSseChunk(part, onEvent);
  }
  return rest;
}

async function readSseViaFetch(opts: {
  res: Response;
  signal?: AbortSignal;
  onEvent: SseJsonHandler;
}): Promise<void> {
  const reader = opts.res.body?.getReader?.();
  if (!reader) {
    throw new ApiRequestError('当前环境不支持流式响应', opts.res.status, -1, {
      retryable: false,
    });
  }
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer = feedSseBuffer(buffer, decoder.decode(value, { stream: true }), opts.onEvent);
    }
    if (buffer.trim()) parseSseChunk(buffer, opts.onEvent);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

/**
 * XHR 流式：利用 onprogress 增量读取 responseText（RN / 旧环境兜底）。
 */
function readSseViaXhr(opts: {
  url: string;
  apiKey: string;
  body: string;
  signal?: AbortSignal;
  onEvent: SseJsonHandler;
}): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let buffer = '';
    let lastIndex = 0;
    let settled = false;

    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const ok = (status: number) => {
      if (settled) return;
      settled = true;
      resolve({ status });
    };

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // ignore
      }
      fail(new DOMException('Aborted', 'AbortError'));
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        fail(new DOMException('Aborted', 'AbortError'));
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.open('POST', opts.url, true);
    xhr.setRequestHeader('X-API-Key', opts.apiKey);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.responseType = 'text';

    const consume = () => {
      const text = xhr.responseText || '';
      if (text.length <= lastIndex) return;
      const slice = text.slice(lastIndex);
      lastIndex = text.length;
      buffer = feedSseBuffer(buffer, slice, opts.onEvent);
    };

    xhr.onprogress = () => consume();
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3 || xhr.readyState === 4) consume();
    };
    xhr.onload = () => {
      consume();
      if (buffer.trim()) parseSseChunk(buffer, opts.onEvent);
      opts.signal?.removeEventListener('abort', onAbort);
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(
          new ApiRequestError(`助手流式请求失败：HTTP ${xhr.status}`, xhr.status, -1, {
            retryable: xhr.status >= 500,
          }),
        );
        return;
      }
      ok(xhr.status);
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      fail(new ApiRequestError('网络异常，请检查连接后重试', 0, -1, { retryable: true }));
    };
    xhr.onabort = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      fail(new DOMException('Aborted', 'AbortError'));
    };

    try {
      xhr.send(opts.body);
    } catch (e) {
      opts.signal?.removeEventListener('abort', onAbort);
      fail(e);
    }
  });
}

export async function readAgentChatSse(opts: {
  url: string;
  apiKey: string;
  body: unknown;
  signal?: AbortSignal;
  onEvent: SseJsonHandler;
  /** 已拿到的 fetch Response；若 body 可读则走 fetch，否则改 XHR */
  response?: Response | null;
}): Promise<void> {
  const bodyStr = JSON.stringify(opts.body);

  if (opts.response) {
    if (!opts.response.ok) {
      const status = opts.response.status;
      if (status === 401 || status === 403) {
        throw new ApiRequestError('助手服务鉴权失败，请检查 Agent API Key', status, -1, {
          retryable: false,
        });
      }
      throw new ApiRequestError(`助手流式请求失败：HTTP ${status}`, status, -1, {
        retryable: status >= 500,
      });
    }
    if (opts.response.body?.getReader) {
      try {
        await readSseViaFetch({
          res: opts.response,
          signal: opts.signal,
          onEvent: opts.onEvent,
        });
        return;
      } catch (e) {
        if (isAbortError(e)) throw e;
        // fetch 流中途失败则不再盲回退（请求已消费）
        throw e;
      }
    }
  }

  // 无可用 ReadableStream：整请求走 XHR 增量
  await readSseViaXhr({
    url: opts.url,
    apiKey: opts.apiKey,
    body: bodyStr,
    signal: opts.signal,
    onEvent: opts.onEvent,
  });
}

export { isAbortError as isSseAbortError };
