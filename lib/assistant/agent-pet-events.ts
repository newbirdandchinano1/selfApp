/**
 * 桌宠外部事件总线：消息提醒 / 视觉态 / 任务进度。
 * UI 层订阅；业务侧只发事件，避免耦合组件。
 */
import type {
  AgentPetTaskProgress,
  AgentPetVisualState,
} from '@/components/agent-pet/types/agentPet.types';

export type AgentPetEvent =
  | { type: 'bubble'; text: string; force?: boolean }
  | { type: 'visual'; state: AgentPetVisualState | null }
  | { type: 'task'; progress: AgentPetTaskProgress | null }
  | { type: 'success' }
  | { type: 'error'; label?: string };

type Listener = (event: AgentPetEvent) => void;

const listeners = new Set<Listener>();

export function emitAgentPetEvent(event: AgentPetEvent): void {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeAgentPetEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 有新消息时轻提醒（自带节流，见 prefs） */
export function notifyAgentPetMessage(text: string, force = false): void {
  emitAgentPetEvent({ type: 'bubble', text, force });
}
