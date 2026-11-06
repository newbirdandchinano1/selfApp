/**
 * 全局助手会话本地缓存（P3-2）。
 * 仅 AsyncStorage，不进 app_settings 云同步；TTL 24h。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ActionCard } from '@/lib/assistant/action-card';

const KEY = '@selfapp/assistant_session_v1';
const TTL_MS = 24 * 60 * 60 * 1000;

export type AssistantSessionSnapshot = {
  session_id: string | null;
  reply: string | null;
  cards: ActionCard[];
  text_draft?: string;
  updated_at: number;
};

export async function loadAssistantSession(): Promise<AssistantSessionSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssistantSessionSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.updated_at || Date.now() - parsed.updated_at > TTL_MS) {
      await AsyncStorage.removeItem(KEY);
      return null;
    }
    if (!Array.isArray(parsed.cards)) return null;
    return {
      session_id: typeof parsed.session_id === 'string' ? parsed.session_id : null,
      reply: typeof parsed.reply === 'string' ? parsed.reply : null,
      cards: parsed.cards,
      text_draft: typeof parsed.text_draft === 'string' ? parsed.text_draft : undefined,
      updated_at: parsed.updated_at,
    };
  } catch {
    return null;
  }
}

export async function saveAssistantSession(
  snap: Omit<AssistantSessionSnapshot, 'updated_at'> & { updated_at?: number },
): Promise<void> {
  const payload: AssistantSessionSnapshot = {
    session_id: snap.session_id,
    reply: snap.reply,
    cards: snap.cards.slice(0, 8),
    text_draft: snap.text_draft,
    updated_at: snap.updated_at ?? Date.now(),
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export async function clearAssistantSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
