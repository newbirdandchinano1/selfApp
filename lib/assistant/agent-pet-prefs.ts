/**
 * 桌宠可见性与位置持久化（本地，不同步）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AgentPetPosition } from '@/components/agent-pet/types/agentPet.types';

const VISIBLE_KEY = '@selfapp/agent_pet_visible_v1';
const POSITION_KEY = '@selfapp/agent_pet_position_v1';

/** 气泡提醒最小间隔，避免频繁打扰 */
export const AGENT_PET_BUBBLE_COOLDOWN_MS = 45_000;

let visibleCache: boolean | null = null;
let positionCache: AgentPetPosition | null = null;
let lastBubbleAt = 0;

const visibleListeners = new Set<(visible: boolean) => void>();

function isValidPosition(raw: unknown): raw is AgentPetPosition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  return (
    (o.side === 'left' || o.side === 'right') &&
    typeof o.y === 'number' &&
    Number.isFinite(o.y)
  );
}

export async function loadAgentPetVisible(): Promise<boolean> {
  if (visibleCache != null) return visibleCache;
  try {
    const raw = await AsyncStorage.getItem(VISIBLE_KEY);
    if (raw === '0' || raw === 'false') {
      visibleCache = false;
      return false;
    }
  } catch {
    /* ignore */
  }
  visibleCache = true;
  return true;
}

export async function setAgentPetVisible(visible: boolean): Promise<void> {
  visibleCache = visible;
  try {
    await AsyncStorage.setItem(VISIBLE_KEY, visible ? '1' : '0');
  } catch {
    /* ignore */
  }
  for (const fn of visibleListeners) {
    try {
      fn(visible);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeAgentPetVisible(listener: (visible: boolean) => void): () => void {
  visibleListeners.add(listener);
  return () => {
    visibleListeners.delete(listener);
  };
}

export async function loadAgentPetPosition(): Promise<AgentPetPosition | null> {
  if (positionCache) return positionCache;
  try {
    const raw = await AsyncStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidPosition(parsed)) {
      positionCache = parsed;
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function saveAgentPetPosition(pos: AgentPetPosition): Promise<void> {
  positionCache = pos;
  try {
    await AsyncStorage.setItem(POSITION_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

/** 是否允许弹出气泡（节流） */
export function canShowAgentPetBubble(now = Date.now()): boolean {
  return now - lastBubbleAt >= AGENT_PET_BUBBLE_COOLDOWN_MS;
}

export function markAgentPetBubbleShown(now = Date.now()): void {
  lastBubbleAt = now;
}
