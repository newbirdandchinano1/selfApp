/**
 * 全局助手聊天消息 / 会话模型（阶段四 / S10 P3）。
 * parts：text / image / tool_result / kb_hits / action_card。
 * meta：answer_status / unofficial_advice / source_labels（供 UI 打标）。
 */

import type { ActionCard } from '@/lib/assistant/action-card';
import { parseActionCards } from '@/lib/assistant/action-card';

export type ChatToolTrace = {
  id: string;
  name: string;
  ok: boolean;
  summary: string;
  arguments?: Record<string, unknown>;
};

export type ChatSourceLabel = {
  span: string;
  source: string;
};

export type ChatAnswerStatus = 'answered' | 'refused' | 'partial';

/** S10 P3：助手回复元数据（来自 /agent/chat metadata / done.usage） */
export type ChatAnswerMeta = {
  answer_status?: ChatAnswerStatus | string;
  unofficial_advice?: string;
  source_labels?: ChatSourceLabel[];
};

export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; uri: string }
  | { type: 'action_card'; card: ActionCard }
  | { type: 'tool_result'; toolName: string; summary: string; ok?: boolean }
  | { type: 'kb_hits'; summary: string };

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export type ChatMessageStatus = 'sending' | 'streaming' | 'done' | 'error';

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  parts: ChatMessagePart[];
  createdAt: number;
  status?: ChatMessageStatus;
  /** S10 P3：来源 / 非官方结构化字段 */
  meta?: ChatAnswerMeta;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  /** 服务端 session_id（/api/v1/agent/chat） */
  remoteSessionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ChatSessionSummary = {
  id: string;
  title: string;
  updatedAt: number;
  preview: string;
  messageCount: number;
};

export function textFromParts(parts: ChatMessagePart[]): string {
  return parts
    .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('\n')
    .trim();
}

export function previewFromSession(session: ChatSession): string {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const t = textFromParts(session.messages[i].parts);
    if (t) return t.slice(0, 80);
  }
  return '新对话';
}

export function titleFromFirstUserMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '新对话';
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}

export function toSessionSummary(session: ChatSession): ChatSessionSummary {
  return {
    id: session.id,
    title: session.title || '新对话',
    updatedAt: session.updatedAt,
    preview: previewFromSession(session),
    messageCount: session.messages.length,
  };
}

export function partsFromAgentResult(opts: {
  reply: string;
  toolTraces?: ChatToolTrace[];
  cards?: unknown[] | ActionCard[];
}): ChatMessagePart[] {
  const parts: ChatMessagePart[] = [];
  for (const t of opts.toolTraces ?? []) {
    if (t.name === 'kb.search' || t.name.startsWith('kb.')) {
      parts.push({ type: 'kb_hits', summary: t.summary });
    } else {
      parts.push({
        type: 'tool_result',
        toolName: t.name,
        summary: t.summary,
        ok: t.ok,
      });
    }
  }
  const cards = parseActionCards(opts.cards ?? []);
  for (const card of cards) {
    parts.push({ type: 'action_card', card });
  }
  if (opts.reply.trim()) {
    parts.push({ type: 'text', text: opts.reply });
  }
  return parts.length ? parts : [{ type: 'text', text: opts.reply }];
}

function asSourceLabels(raw: unknown): ChatSourceLabel[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatSourceLabel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const span = typeof o.span === 'string' ? o.span.trim() : '';
    const source = typeof o.source === 'string' ? o.source.trim() : '';
    if (!span || !source) continue;
    out.push({ span, source });
  }
  return out;
}

/** 从 Agent metadata / usage 抽出 UI 打标字段 */
export function metaFromAgentResult(
  metadata?: Record<string, unknown> | null,
): ChatAnswerMeta | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const statusRaw = metadata.answer_status;
  const adviceRaw = metadata.unofficial_advice;
  const labels = asSourceLabels(metadata.source_labels);

  const answer_status =
    typeof statusRaw === 'string' && statusRaw.trim() ? statusRaw.trim() : undefined;
  const unofficial_advice =
    typeof adviceRaw === 'string' ? adviceRaw.trim() : adviceRaw === null ? '' : undefined;

  if (!answer_status && unofficial_advice === undefined && !labels.length) {
    return undefined;
  }
  const meta: ChatAnswerMeta = {};
  if (answer_status) meta.answer_status = answer_status;
  if (unofficial_advice !== undefined) meta.unofficial_advice = unofficial_advice;
  if (labels.length) meta.source_labels = labels;
  return meta;
}
