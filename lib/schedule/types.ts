/**
 * 青蛙周课表：视图 / 排课层类型（placement + 轴）。
 * 任务截止与重复规则见 `./meta` / `./repeat`；勿在此扩展 ScheduleMeta。
 */
import type { SyncStatus } from '@/lib/database.native';

/** 格宽仅允许 1–4 小时 */
export type ScheduleSlotHours = 1 | 2 | 3 | 4;

/** 用户自定义断开时段（如午休），整点对齐 */
export type ScheduleBreak = {
  startMinutes: number;
  endMinutes: number;
  /** 展示标签，如「午休」 */
  label: string;
};

/** 全局时间轴（可编辑周使用） */
export type ScheduleAxisSettings = {
  startMinutes: number;
  endMinutes: number;
  slotHours: ScheduleSlotHours;
  breaks: ScheduleBreak[];
  updatedAt: string;
};

/** 历史周轴快照（只读展示，永不重算） */
export type ScheduleWeekAxisSnapshot = {
  weekStartYmd: string;
  startMinutes: number;
  endMinutes: number;
  slotHours: ScheduleSlotHours;
  breaks: ScheduleBreak[];
  createdAt: string;
};

export type ScheduleSubjectKind = 'task' | 'project';

/**
 * 一条占用实例（自然周）。
 * orphaned=1 或 startSlotIndex=null：改轴后无法落入新格，数据保留为「未入格」。
 * startSlotIndex 相对「可排工作格」列表（不含断开行）。
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
  breaks: [],
};

export const SCHEDULE_BREAK_LABEL_MAX_LEN = 6;
export const SCHEDULE_BREAKS_MAX = 8;

export const SCHEDULE_AXIS_SETTING_KEY = '@selfapp/frog_schedule_axis_v1';
