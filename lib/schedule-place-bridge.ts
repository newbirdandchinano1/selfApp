/**
 * 从任务/项目/待办详情发起「入格」：经模块 pending 回任务 Tab，
 * 避免路由 params 在 tab 切换时丢失（对齐 schedule-picker-bridge）。
 */
import type { SchedulePlacePreselected } from '@/components/tasks/SchedulePlaceFrogSheet';

export type SchedulePlaceBridgePayload = SchedulePlacePreselected;

let pending: SchedulePlaceBridgePayload | null = null;

export function setPendingSchedulePlace(payload: SchedulePlaceBridgePayload) {
  pending = { ...payload };
}

export function peekPendingSchedulePlace(): SchedulePlaceBridgePayload | null {
  return pending;
}

export function consumePendingSchedulePlace(): SchedulePlaceBridgePayload | null {
  const next = pending;
  pending = null;
  return next;
}

export function clearPendingSchedulePlace() {
  pending = null;
}
