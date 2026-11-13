/** 时间线视图 / 区间解析用类型（阶段 C+，阶段 F 扩展事件模型） */
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import type { VirtualHabitPlacement } from '@/lib/schedule/habit-virtual-placement';
import type { VirtualTaskPlacement } from '@/lib/schedule/task-virtual-placement';

export type PlacementIntervalSource = 'stored' | 'derived';

/** 占用在逻辑日轴上的半开区间 `[startMinutes, endMinutes)` */
export type PlacementInterval = {
  startMinutes: number;
  endMinutes: number;
  allDay: boolean;
  source: PlacementIntervalSource;
};

/** resolve 所需的最小 placement 形状（真实行 / 远程 hydrate 均可） */
export type PlacementLikeForInterval = {
  startSlotIndex: number | null;
  spanSlots: number;
  orphaned?: number | boolean | null;
  startMinutes?: number | null;
  endMinutes?: number | null;
  allDay?: number | boolean | null;
};

/** 时间线色种类：青蛙 / 习惯 / 待办 / 项目（与旧课表 `.blk` 语义一致） */
export type TimelineEventKind = 'frog' | 'habit' | 'todo' | 'proj';

/** 事件来源，点选时据此路由到详情 / 打卡 / 待办 */
export type TimelineEventSource =
  | { type: 'placement'; placement: SchedulePlacementRow }
  | { type: 'habit'; habit: VirtualHabitPlacement }
  | { type: 'virtualTask'; task: VirtualTaskPlacement };

/** 时间线视图模型（一天内的一条安排） */
export type TimelineEvent = {
  id: string;
  kind: TimelineEventKind;
  title: string;
  /** 任务 / 项目 / 习惯自带图标（emoji）；缺省 null */
  icon: string | null;
  done: boolean;
  overdue: boolean;
  allDay: boolean;
  startMinutes: number;
  endMinutes: number;
  priority: number;
  assignYmd: string;
  source: TimelineEventSource;
  /** 同类别内部排序：任务树 sort_order */
  sortOrder?: number;
  /** 同类别内部排序：有效截止毫秒 */
  dueMs?: number | null;
  /** 同类别内部排序：奖励积分 */
  rewardPoints?: number;
  /** 同类别内部排序：更新时间 */
  updatedAt?: string | null;
  /** 同类别内部排序：主体 id（习惯稳定序） */
  subjectId?: string | null;
};

/** 定时事件并排分栏后的布局结果 */
export type TimedEventLayout = {
  event: TimelineEvent;
  /** 0-based 横向分栏索引 */
  column: number;
  /** 该重叠簇的总栏数 */
  columns: number;
  /** 传递重叠簇 id（同簇共享列坐标） */
  clusterId: number;
};
