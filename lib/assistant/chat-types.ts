/**
 * 全局助手聊天消息 / 会话模型（阶段四）。
 * parts：text / image / tool_result / kb_hits / action_card。
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
