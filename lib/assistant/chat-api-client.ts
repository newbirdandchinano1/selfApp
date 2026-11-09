/**
 * 全局助手对话客户端（阶段五；全覆盖 S0+）。
 * 主路径：POST /api/v1/agent/chat；可选 /agent/chat/stream（SSE + 超时）。
 *
 * 鉴权转发约定：metadata.user_access_token = App 业务 JWT（短期），
 * Agent 只读 Tool 原样转发给 self_app_back；本客户端不把密码交给 Agent。
 */

import { getAgentApiKey, getAgentBaseUrl } from '@/lib/agent-config';
import { getApiAuthToken } from '@/lib/api-config';
import { ApiRequestError } from '@/lib/api/http';
import type { ActionCard } from '@/lib/assistant/action-card';
import { parseActionCards } from '@/lib/assistant/action-card';
import { loadAssistantBriefContext } from '@/lib/assistant/brief-context-load';
import { buildClientCapabilities } from '@/lib/assistant/chat-commit';
import { ensureChatCommitHandlersRegistered } from '@/lib/assistant/chat-commit-handlers';
import { historyFromMessages, type AgentChatHistoryItem } from '@/lib/assistant/chat-history';
import { isSseAbortError, readAgentChatSse } from '@/lib/assistant/chat-sse';
import type { ChatMessage, ChatToolTrace } from '@/lib/assistant/chat-types';
import { drainExecutionResults } from '@/lib/assistant/commit-result';
import { fetchWithTimeoutAndRetry, isAbortError } from '@/lib/cloud-fetch-retry';

// S9.3：拉起 W1/W2 commit handlers，CLIENT_CAPABILITIES 才能上报 commit_*
ensureChatCommitHandlersRegistered();

export type { AgentChatHistoryItem } from '@/lib/assistant/chat-history';
export { historyFromMessages, isStreamUnsupportedError } from '@/lib/assistant/chat-history';

const CHAT_TIMEOUT_MS = 120_000;
const STREAM_TIMEOUT_MS = 120_000;

/** 将 data URI 或纯 base64 拆成 Agent 识图字段 */
export function splitImagePayload(raw: string): {
  image_base64: string;
  image_mime_type?: string;
} | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('data:') && s.includes(',')) {
    const comma = s.indexOf(',');
    const header = s.slice(0, comma);
    const b64 = s.slice(comma + 1).trim();
    if (!b64) return null;
    const mimeMatch = /^data:([^;]+)/i.exec(header);
    const mime = mimeMatch?.[1]?.trim();
    return mime ? { image_base64: b64, image_mime_type: mime } : { image_base64: b64 };
  }
  return { image_base64: s };
}

export type AgentChatResult = {
  reply: string;
  session_id: string | null;
  tool_traces: ChatToolTrace[];
  cards: ActionCard[];
  metadata: Record<string, unknown>;
};

export type AgentChatStreamHandlers = {
  onSession?: (sessionId: string) => void;
  onDelta?: (text: string) => void;
  onToolCall?: (ev: { id: string; name: string; arguments?: Record<string, unknown> }) => void;
  onToolResult?: (ev: ChatToolTrace & { data?: unknown }) => void;
  onCard?: (card: ActionCard) => void;
  onError?: (message: string) => void;
};

function parseToolTraces(raw: unknown): ChatToolTrace[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatToolTrace[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const name = typeof o.name === 'string' ? o.name : '';
    if (!name) continue;
    out.push({
      id: id || name,
      name,
      ok: o.ok !== false,
      summary: typeof o.summary === 'string' ? o.summary : name,
      arguments:
        o.arguments && typeof o.arguments === 'object' && !Array.isArray(o.arguments)
          ? (o.arguments as Record<string, unknown>)
          : undefined,
    });
  }
  return out;
}

async function loadBrief(opts: {
  briefContext?: Record<string, unknown> | null;
  includeBrief?: boolean;
}): Promise<Record<string, unknown>> {
  if (opts.briefContext) return opts.briefContext;
  if (opts.includeBrief === false) return {};
  try {
    return (await loadAssistantBriefContext()) as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function buildBody(opts: {
  message: string;
  sessionId?: string | null;
  history: AgentChatHistoryItem[];
  brief_context: Record<string, unknown>;
  locale?: string;
  imageDataUri?: string | null;
  /** S9.6：未确认草稿，供 Agent 复用 operation_id */
  pendingOperations?: Array<Record<string, unknown>>;
}) {
  const metadata: Record<string, unknown> = {
    source: 'selfapp.assistant.chat',
    phase: 5,
  };
  // S0：接口形状落地；S2+ 只读 Tool 才会真正转发到 self_app_back
  try {
    const token = await getApiAuthToken();
    if (token) metadata.user_access_token = token;
  } catch {
    /* 未登录 / 无 token：Agent 降级 brief_context */
  }
  // S9.2 方案 B 预留：上轮 commit 回执随 metadata 回灌（Agent 可转述，不可改写成败）
  const executionResults = drainExecutionResults();
  if (executionResults.length) {
    metadata.execution_results = executionResults;
  }
  // S9.6：未确认草稿，供 Agent 改稿复用 operation_id
  if (opts.pendingOperations?.length) {
    metadata.pending_operations = opts.pendingOperations;
  }
  const body: Record<string, unknown> = {
    message: opts.message,
    session_id: opts.sessionId || undefined,
    history: opts.history,
    brief_context: opts.brief_context,
    // S9.2：随已注册 commit handler 递增；无 handler 时与 S8 preview 基线一致
    client_capabilities: buildClientCapabilities(),
    locale: opts.locale ?? 'zh-CN',
    metadata,
  };
  // S5：本轮附图 → Agent 识图 Capability（不落盘）
  const img = opts.imageDataUri ? splitImagePayload(opts.imageDataUri) : null;
  if (img) {
    body.image_base64 = img.image_base64;
    if (img.image_mime_type) body.image_mime_type = img.image_mime_type;
  }
  return body;
}

function throwAgentHttpError(status: number, fallbackPrefix: string): never {
  if (status === 401 || status === 403) {
    throw new ApiRequestError('助手服务鉴权失败，请检查 Agent API Key', status, -1, {
      retryable: false,
    });
  }
  throw new ApiRequestError(`${fallbackPrefix}：HTTP ${status}`, status, -1, {
    retryable: status >= 500,
  });
}

/**
 * 发送一轮对话（非流式聚合）。history 不含本轮 user message。
 */
export async function runAgentChat(opts: {
  message: string;
  sessionId?: string | null;
  historyMessages?: ChatMessage[];
  locale?: string;
  briefContext?: Record<string, unknown> | null;
  includeBrief?: boolean;
  /** S5：本轮附图 data URI / base64 */
  imageDataUri?: string | null;
  /** S9.6：未确认草稿 operation 摘要 */
  pendingOperations?: Array<Record<string, unknown>>;
  signal?: AbortSignal;
}): Promise<AgentChatResult> {
  const message = opts.message.trim();
  if (!message) {
    throw new ApiRequestError('消息不能为空', 400, -1, { retryable: false });
  }

  const baseUrl = await getAgentBaseUrl();
  const apiKey = await getAgentApiKey();
  const url = `${baseUrl}/api/v1/agent/chat`;

  const history = historyFromMessages(opts.historyMessages ?? []);
  const brief_context = await loadBrief(opts);

  const res = await fetchWithTimeoutAndRetry(
    url,
    {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        await buildBody({
          message,
          sessionId: opts.sessionId,
          history,
          brief_context,
          locale: opts.locale,
          imageDataUri: opts.imageDataUri,
          pendingOperations: opts.pendingOperations,
        }),
      ),
    },
    {
      perAttemptTimeoutMs: CHAT_TIMEOUT_MS,
      maxAttempts: 4,
      baseDelayMs: 800,
      maxDelayMs: 8_000,
      signal: opts.signal,
    },
  );

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    throwAgentHttpError(res.status, '助手请求失败');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ApiRequestError(`助手请求失败：HTTP ${res.status}`, res.status, -1, {
      retryable: res.status >= 500,
    });
  }

  const o = parsed as Record<string, unknown>;
  const reply = typeof o.reply === 'string' ? o.reply : '';
  if (!reply.trim()) {
    throw new ApiRequestError('助手没有返回内容', res.status, -1, { retryable: true });
  }

  return {
    reply,
    session_id: typeof o.session_id === 'string' ? o.session_id : null,
    tool_traces: parseToolTraces(o.tool_traces),
    cards: parseActionCards(o.cards),
    metadata:
      o.metadata && typeof o.metadata === 'object' && !Array.isArray(o.metadata)
        ? (o.metadata as Record<string, unknown>)
        : {},
  };
}

/**
 * SSE 流式对话。优先 fetch ReadableStream；RN 不支持时自动走 XHR onprogress。
 */
export async function runAgentChatStream(opts: {
  message: string;
  sessionId?: string | null;
  historyMessages?: ChatMessage[];
  locale?: string;
  briefContext?: Record<string, unknown> | null;
  includeBrief?: boolean;
  /** S5：本轮附图 data URI / base64 */
  imageDataUri?: string | null;
  /** S9.6：未确认草稿 operation 摘要 */
  pendingOperations?: Array<Record<string, unknown>>;
  signal?: AbortSignal;
  handlers?: AgentChatStreamHandlers;
}): Promise<AgentChatResult> {
  const message = opts.message.trim();
  if (!message) {
    throw new ApiRequestError('消息不能为空', 400, -1, { retryable: false });
  }

  const baseUrl = await getAgentBaseUrl();
  const apiKey = await getAgentApiKey();
  const url = `${baseUrl}/api/v1/agent/chat/stream`;

  const history = historyFromMessages(opts.historyMessages ?? []);
  const brief_context = await loadBrief(opts);
  const body = await buildBody({
    message,
    sessionId: opts.sessionId,
    history,
    brief_context,
    locale: opts.locale,
    imageDataUri: opts.imageDataUri,
    pendingOperations: opts.pendingOperations,
  });

  const combined = new AbortController();
  const onOuterAbort = () => combined.abort();
  if (opts.signal) {
    if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    opts.signal.addEventListener('abort', onOuterAbort);
  }
  const timeoutId = setTimeout(() => combined.abort(), STREAM_TIMEOUT_MS);

  const mapStreamAbort = (e: unknown): never => {
    if (isAbortError(e) || isSseAbortError(e)) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new ApiRequestError('助手流式请求超时，请重试', 408, -1, { retryable: true });
    }
    throw e;
  };

  let reply = '';
  let sessionId: string | null = opts.sessionId ?? null;
  const tool_traces: ChatToolTrace[] = [];
  const cards: ActionCard[] = [];
  let metadata: Record<string, unknown> = {};
  let sawDone = false;

  const onEvent = (ev: Record<string, unknown>) => {
    const event = typeof ev.event === 'string' ? ev.event : '';
    if (event === 'session' && typeof ev.session_id === 'string') {
      sessionId = ev.session_id;
      opts.handlers?.onSession?.(ev.session_id);
    } else if (event === 'delta' && typeof ev.text === 'string') {
      reply += ev.text;
      opts.handlers?.onDelta?.(ev.text);
    } else if (event === 'tool_call') {
      opts.handlers?.onToolCall?.({
        id: typeof ev.id === 'string' ? ev.id : '',
        name: typeof ev.name === 'string' ? ev.name : '',
        arguments:
          ev.arguments && typeof ev.arguments === 'object' && !Array.isArray(ev.arguments)
            ? (ev.arguments as Record<string, unknown>)
            : undefined,
      });
    } else if (event === 'tool_result') {
      const trace: ChatToolTrace = {
        id: typeof ev.id === 'string' ? ev.id : '',
        name: typeof ev.name === 'string' ? ev.name : '',
        ok: ev.ok !== false,
        summary: typeof ev.summary === 'string' ? ev.summary : String(ev.name || 'tool'),
      };
      tool_traces.push(trace);
      opts.handlers?.onToolResult?.({ ...trace, data: ev.data });
    } else if (event === 'card') {
      const parsed = parseActionCards([ev.card]);
      if (parsed[0]) {
        cards.push(parsed[0]);
        opts.handlers?.onCard?.(parsed[0]);
      }
    } else if (event === 'error' && typeof ev.message === 'string') {
      opts.handlers?.onError?.(ev.message);
    } else if (event === 'done') {
      sawDone = true;
      if (typeof ev.reply === 'string' && ev.reply) reply = ev.reply;
      if (typeof ev.session_id === 'string') sessionId = ev.session_id;
      if (Array.isArray(ev.tool_traces) && tool_traces.length === 0) {
        tool_traces.push(...parseToolTraces(ev.tool_traces));
      }
      if (Array.isArray(ev.cards) && cards.length === 0) {
        cards.push(...parseActionCards(ev.cards));
      }
      if (ev.usage && typeof ev.usage === 'object') {
        metadata = ev.usage as Record<string, unknown>;
      }
    }
  };

  try {
    const canFetchStream =
      typeof ReadableStream !== 'undefined' &&
      typeof TextDecoder !== 'undefined' &&
      typeof Response !== 'undefined';

    let res: Response | null = null;
    if (canFetchStream) {
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(body),
          signal: combined.signal,
        });
        if (!res.ok) {
          throwAgentHttpError(res.status, '助手流式请求失败');
        }
        if (!res.body?.getReader) {
          // body 不可读：改走 XHR（会再发一次请求；优于假打字机）
          res = null;
        }
      } catch (e) {
        if (isAbortError(e) || isSseAbortError(e)) mapStreamAbort(e);
        if (e instanceof ApiRequestError) throw e;
        res = null;
      }
    }

    try {
      await readAgentChatSse({
        url,
        apiKey,
        body,
        signal: combined.signal,
        onEvent,
        response: res,
      });
    } catch (e) {
      mapStreamAbort(e);
    }

    if (!reply.trim()) {
      throw new ApiRequestError(
        sawDone ? '助手没有返回内容' : '流式响应未完成',
        res?.status ?? 0,
        -1,
        { retryable: true },
      );
    }

    return {
      reply,
      session_id: sessionId,
      tool_traces,
      cards,
      metadata,
    };
  } finally {
    clearTimeout(timeoutId);
    if (opts.signal) opts.signal.removeEventListener('abort', onOuterAbort);
  }
}
