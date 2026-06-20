/** 新建任务页回传：用模块内 pending 传递，避免 globalThis 在路由切换时丢失 */

import { normalizeRouteParam } from '@/lib/schedule-picker-bridge';

export type AddTaskBridgePayload = {
  source: string;
  task: {
    id: string;
    title: string;
    done: boolean;
    priority?: string;
    priorityLabel?: string;
    deadline?: string;
    deadlineText?: string;
    reminder?: string;
    reminderText?: string;
    repeat?: string;
    repeatText?: string;
    note?: string;
    acceptanceCriteria?: string;
    schedule?: Record<string, unknown> | null;
    isLongTermTask?: boolean;
  };
};

let pending: AddTaskBridgePayload | null = null;

export function setAddTaskResult(result: AddTaskBridgePayload): void {
  pending = { ...result, source: normalizeRouteParam(result.source) };
}

export function consumeAddTaskResult(expectedSource: string): AddTaskBridgePayload | null {
  if (!pending) return null;
  const expected = normalizeRouteParam(expectedSource);
  if (pending.source !== expected) return null;
  const next = pending;
  pending = null;
  return next;
}
