/**
 * 聊天历史裁剪（纯逻辑，无 RN / fetch 依赖）。
 */

import { textFromParts, type ChatMessage } from '@/lib/assistant/chat-types';

export const AGENT_CHAT_HISTORY_LIMIT = 24;

export type AgentChatHistoryItem = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
};

/** 多轮时附带压缩 tool 痕迹，便于「那待办呢」衔接。 */
export function historyFromMessages(
  messages: ChatMessage[],
  limit = AGENT_CHAT_HISTORY_LIMIT,
): AgentChatHistoryItem[] {
  const out: AgentChatHistoryItem[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = textFromParts(m.parts);
    const toolBits = m.parts
      .filter(
        (p): p is Extract<(typeof m.parts)[number], { type: 'tool_result' | 'kb_hits' }> =>
          p.type === 'tool_result' || p.type === 'kb_hits',
      )
      .map(p => {
        if (p.type === 'kb_hits') return `[kb] ${p.summary}`;
        return `[${p.ok === false ? 'tool失败' : '已查询'} ${p.toolName}] ${p.summary}`;
      })
      .slice(0, 4);
    const merged = [content, ...toolBits].filter(Boolean).join('\n').trim();
    if (!merged) continue;
    out.push({ role: m.role, content: merged.slice(0, 2_000) });
  }
  return out.slice(-limit);
}

export function isStreamUnsupportedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  // 不依赖 ApiRequestError instanceof（避免脚本单测拉入 RN 依赖链）
  if (name === 'ApiRequestError' || message.includes('流式')) {
    return /不支持流式|ReadableStream|stream body/i.test(message);
  }
  return false;
}
