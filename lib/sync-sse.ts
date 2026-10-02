import { getApiAuthToken, getApiBaseUrl } from '@/lib/api-config';
import { getOrCreateDeviceId } from '@/lib/device-id';

export type SyncSseChangesPayload = {
  type: 'changes';
  cursor: number;
  dirtyTables: string[];
};

type SyncSseHandlers = {
  onChanges: (payload: SyncSseChangesPayload) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
};

const RECONNECT_BASE_MS = 1_500;
const RECONNECT_MAX_MS = 30_000;

let running = false;
let abortCtrl: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let handlers: SyncSseHandlers | null = null;

function clearReconnectTimer(): void {
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function parseSseBlocks(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  let rest = buffer;
  // SSE 事件以空行分隔
  while (true) {
    const sep = rest.indexOf('\n\n');
    if (sep < 0) break;
    const block = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }
  return { events, rest };
}

function dispatchParsed(event: string, data: string): void {
  if (!handlers) return;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (event === 'ready') {
      handlers.onConnected?.();
      return;
    }
    if (event === 'changes' || parsed.type === 'changes') {
      handlers.onChanges({
        type: 'changes',
        cursor: Number(parsed.cursor) || 0,
        dirtyTables: Array.isArray(parsed.dirtyTables)
          ? parsed.dirtyTables.map((t) => String(t))
          : [],
      });
    }
  } catch {
    /* ignore malformed */
  }
}

async function consumeViaReader(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 兼容 \r\n\r\n
      buffer = buffer.replace(/\r\n/g, '\n');
      const { events, rest } = parseSseBlocks(buffer);
      buffer = rest;
      for (const ev of events) dispatchParsed(ev.event, ev.data);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

/**
 * RN / 无 stream body 时用 XHR onprogress 增量读。
 */
function consumeViaXhr(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastIndex = 0;
    let buffer = '';

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
    };
    signal.addEventListener('abort', onAbort);

    xhr.open('GET', url, true);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.responseType = 'text';

    xhr.onprogress = () => {
      const text = String(xhr.responseText ?? '');
      if (text.length <= lastIndex) return;
      const chunk = text.slice(lastIndex);
      lastIndex = text.length;
      buffer += chunk.replace(/\r\n/g, '\n');
      const { events, rest } = parseSseBlocks(buffer);
      buffer = rest;
      for (const ev of events) dispatchParsed(ev.event, ev.data);
    };

    xhr.onload = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    xhr.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('SSE XHR network error'));
    };
    xhr.onabort = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };

    xhr.send();
  });
}

async function connectOnce(): Promise<void> {
  const token = await getApiAuthToken();
  if (!token) return;

  const baseUrl = await getApiBaseUrl();
  const deviceId = await getOrCreateDeviceId();
  const url = `${baseUrl.replace(/\/$/, '')}/api/app/sync/stream`;

  abortCtrl = new AbortController();
  const { signal } = abortCtrl;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Device-Id': deviceId,
  };

  const res = await fetch(url, { method: 'GET', headers, signal });
  if (!res.ok) {
    throw new Error(`SSE HTTP ${res.status}`);
  }

  reconnectAttempt = 0;

  if (res.body && typeof (res.body as ReadableStream<Uint8Array>).getReader === 'function') {
    await consumeViaReader(res.body as ReadableStream<Uint8Array>, signal);
  } else {
    // fetch 无 stream：关掉本次再走 XHR onprogress（RN 常见）
    try {
      abortCtrl.abort();
    } catch {
      /* ignore */
    }
    abortCtrl = new AbortController();
    await consumeViaXhr(url, headers, abortCtrl.signal);
  }
}

function scheduleReconnect(): void {
  if (!running) return;
  clearReconnectTimer();
  const delay = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * Math.pow(2, Math.min(reconnectAttempt, 5)),
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    void runLoop();
  }, delay);
}

async function runLoop(): Promise<void> {
  if (!running) return;
  try {
    await connectOnce();
  } catch (e) {
    if (running) {
      console.warn('[sync-sse] 连接中断', e);
      handlers?.onDisconnected?.();
    }
  }
  if (running) {
    handlers?.onDisconnected?.();
    scheduleReconnect();
  }
}

/** 启动 SSE；断线自动重连 */
export function startSyncSse(nextHandlers: SyncSseHandlers): void {
  handlers = nextHandlers;
  if (running) return;
  running = true;
  reconnectAttempt = 0;
  void runLoop();
}

export function stopSyncSse(): void {
  running = false;
  clearReconnectTimer();
  handlers = null;
  if (abortCtrl) {
    try {
      abortCtrl.abort();
    } catch {
      /* ignore */
    }
    abortCtrl = null;
  }
}

export function isSyncSseRunning(): boolean {
  return running;
}
