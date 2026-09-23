import type { SyncStatus } from '@/lib/database.native';

/** 格宽仅允许 1–4 小时 */
export type ScheduleSlotHours = 1 | 2 | 3 | 4;

/** 全局时间轴（可编辑周使用） */
export type ScheduleAxisSettings = {
  startMinutes: number;
  endMinutes: number;
  slotHours: ScheduleSlotHours;
  updatedAt: string;
};

/** 历史周轴快照（只读展示，永不重算） */
export type ScheduleWeekAxisSnapshot = {
  weekStartYmd: string;
  startMinutes: number;
  endMinutes: number;
  slotHours: ScheduleSlotHours;
  createdAt: string;
};

export type ScheduleSubjectKind = 'task' | 'project';

/**
 * 一条占用实例（自然周）。
 * orphaned=1 或 startSlotIndex=null：改轴后无法落入新格，数据保留为「未入格」。
 */
export type SchedulePlacementRow = {
  id: string;
  weekStartYmd: string;
  /** 1=周一 … 7=周日 */
  weekday: number;
  startSlotIndex: number | null;
  spanSlots: number;
  subjectKind: ScheduleSubjectKind;
  subjectId: string;
  orphaned: number;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
};

export type SchedulePlacementInput = {
  weekStartYmd: string;
  weekday: number;
  startSlotIndex: number;
  spanSlots: number;
  subjectKind: ScheduleSubjectKind;
  subjectId: string;
};

export const DEFAULT_SCHEDULE_AXIS: Omit<ScheduleAxisSettings, 'updatedAt'> = {
  startMinutes: 8 * 60,
  endMinutes: 22 * 60,
  slotHours: 2,
};

export const SCHEDULE_AXIS_SETTING_KEY = '@selfapp/frog_schedule_axis_v1';
