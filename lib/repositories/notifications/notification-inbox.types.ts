/** 底部业务 Tab 键（与 expo-router tabs 名对齐；profile 本期不打角标） */
export type NotificationModuleTab = 'index' | 'tasks' | 'finance' | 'review' | 'profile';

export type NotificationInboxSource = 'local' | 'remote';

export type NotificationInboxRow = {
  id: string;
  dedupeKey: string;
  category: string;
  moduleTab: NotificationModuleTab;
  title: string;
  body: string;
  dataJson: string;
  createdAt: string;
  readAt: string | null;
  source: NotificationInboxSource;
};

export type UpsertInboxFromNotificationInput = {
  dedupeKey: string;
  category: string;
  title: string;
  body?: string;
  /** 序列化进 data_json；对象会 JSON.stringify */
  data?: unknown;
  createdAt?: string;
  source?: NotificationInboxSource;
  /** 省略则按 category 映射 */
  moduleTab?: NotificationModuleTab;
};

export type ListInboxOptions = {
  limit?: number;
  onlyUnread?: boolean;
  /** 省略则不过滤；通知 Tab 传 `local`，资讯镜像可传 `remote` */
  source?: NotificationInboxSource;
};

/**
 * 未读聚合结果。
 * - 各 module 字段：仅 local（业务 Tab 角标；profile 本期不展示）
 * - total：local + remote（铃铛）
 */
export type UnreadCountByModuleTab = {
  index: number;
  tasks: number;
  finance: number;
  review: number;
  profile: number;
  total: number;
};
