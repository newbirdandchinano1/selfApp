/**
 * 全局助手多会话本地存储（阶段二）。
 * AsyncStorage；不进云同步。最多保留近期会话，避免无限膨胀。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseActionCard } from '@/lib/assistant/action-card';
import {
  metaFromAgentResult,
  previewFromSession,
  titleFromFirstUserMessage,
  toSessionSummary,
  type ChatMessage,
  type ChatMessagePart,
  type ChatSession,
  type ChatSessionSummary,
} from '@/lib/assistant/chat-types';

const KEY = '@selfapp/assistant_chat_sessions_v1';
const ACTIVE_KEY = '@selfapp/assistant_chat_active_v1';
const MAX_SESSIONS = 30;
const MAX_MESSAGES_PER_SESSION = 120;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (o.role !== 'user' && o.role !== 'assistant' && o.role !== 'system') return null;
  if (!Array.isArray(o.parts)) return null;
  const parts: ChatMessagePart[] = [];
  for (const rawPart of o.parts) {
    if (!rawPart || typeof rawPart !== 'object') continue;
    const p = rawPart as Record<string, unknown>;
    if (p.type === 'text' && typeof p.text === 'string') {
      parts.push({ type: 'text', text: p.text });
    } else if (p.type === 'image' && typeof p.uri === 'string') {
      parts.push({ type: 'image', uri: p.uri });
    } else if (p.type === 'tool_result' && typeof p.toolName === 'string') {
      parts.push({
        type: 'tool_result',
        toolName: p.toolName,
        summary: typeof p.summary === 'string' ? p.summary : p.toolName,
        ok: p.ok !== false,
      });
    } else if (p.type === 'kb_hits' && typeof p.summary === 'string') {
      parts.push({ type: 'kb_hits', summary: p.summary });
    } else if (p.type === 'action_card') {
      if (p.card && typeof p.card === 'object') {
        parts.push({ type: 'action_card', card: parseActionCard(p.card) });
      }
    }
  }
  const meta =
    o.meta && typeof o.meta === 'object' && !Array.isArray(o.meta)
      ? metaFromAgentResult(o.meta as Record<string, unknown>)
      : undefined;
  return {
    id: o.id,
    role: o.role,
    parts,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    status:
      o.status === 'sending' || o.status === 'streaming' || o.status === 'done' || o.status === 'error'
        ? o.status
        : 'done',
    ...(meta ? { meta } : {}),
  };
}

function sanitizeSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  const messages = Array.isArray(o.messages)
    ? o.messages.map(sanitizeMessage).filter((m): m is ChatMessage => Boolean(m))
    : [];
  return {
    id: o.id,
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : '新对话',
    messages: messages.slice(-MAX_MESSAGES_PER_SESSION),
    remoteSessionId: typeof o.remoteSessionId === 'string' ? o.remoteSessionId : null,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
  };
}

async function readAllSessions(): Promise<ChatSession[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeSession)
      .filter((s): s is ChatSession => Boolean(s))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

async function writeAllSessions(sessions: ChatSession[]): Promise<void> {
  const trimmed = sessions
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
    .map(s => ({
      ...s,
      messages: s.messages.slice(-MAX_MESSAGES_PER_SESSION),
    }));
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota */
  }
}

export async function listChatSessionSummaries(): Promise<ChatSessionSummary[]> {
  const sessions = await readAllSessions();
  return sessions.map(toSessionSummary);
}

export async function getChatSession(sessionId: string): Promise<ChatSession | null> {
  const sessions = await readAllSessions();
  return sessions.find(s => s.id === sessionId) ?? null;
}

export async function getActiveChatSessionId(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(ACTIVE_KEY);
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export async function setActiveChatSessionId(sessionId: string | null): Promise<void> {
  try {
    if (!sessionId) {
      await AsyncStorage.removeItem(ACTIVE_KEY);
      return;
    }
    await AsyncStorage.setItem(ACTIVE_KEY, sessionId);
  } catch {
    /* ignore */
  }
}

export async function createChatSession(opts?: {
  title?: string;
  makeActive?: boolean;
}): Promise<ChatSession> {
  const now = Date.now();
  const session: ChatSession = {
    id: makeId('cs'),
    title: opts?.title?.trim() || '新对话',
    messages: [],
    remoteSessionId: null,
    createdAt: now,
    updatedAt: now,
  };
  const sessions = await readAllSessions();
  sessions.unshift(session);
  await writeAllSessions(sessions);
  if (opts?.makeActive !== false) {
    await setActiveChatSessionId(session.id);
  }
  return session;
}

/** 打开助手时：有活跃会话则复用，否则新建 */
export async function ensureActiveChatSession(): Promise<ChatSession> {
  const activeId = await getActiveChatSessionId();
  if (activeId) {
    const existing = await getChatSession(activeId);
    if (existing) return existing;
  }
  return createChatSession({ makeActive: true });
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  const sessions = await readAllSessions();
  const next = sessions.filter(s => s.id !== session.id);
  const title =
    session.title && session.title !== '新对话'
      ? session.title
      : (() => {
          const firstUser = session.messages.find(m => m.role === 'user');
          if (!firstUser) return session.title || '新对话';
          const text = previewFromSession({ ...session, messages: [firstUser] });
          return titleFromFirstUserMessage(text);
        })();
  next.unshift({
    ...session,
    title,
    updatedAt: Date.now(),
    messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION),
  });
  await writeAllSessions(next);
  await setActiveChatSessionId(session.id);
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const sessions = await readAllSessions();
  const next = sessions.filter(s => s.id !== sessionId);
  await writeAllSessions(next);
  const active = await getActiveChatSessionId();
  if (active === sessionId) {
    await setActiveChatSessionId(next[0]?.id ?? null);
  }
}

export function createChatMessage(input: {
  role: ChatMessage['role'];
  text?: string;
  imageUri?: string;
  status?: ChatMessage['status'];
}): ChatMessage {
  const parts: ChatMessage['parts'] = [];
  if (input.text?.trim()) parts.push({ type: 'text', text: input.text.trim() });
  if (input.imageUri) parts.push({ type: 'image', uri: input.imageUri });
  if (!parts.length) parts.push({ type: 'text', text: '' });
  return {
    id: makeId('cm'),
    role: input.role,
    parts,
    createdAt: Date.now(),
    status: input.status ?? 'done',
  };
}

export async function clearAllChatSessions(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY, ACTIVE_KEY]);
  } catch {
    /* ignore */
  }
}
