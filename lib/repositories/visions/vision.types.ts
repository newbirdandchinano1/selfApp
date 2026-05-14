import type { SyncStatus } from '../../database.native';

/** 与创建页「追踪方式」一致 */
export type VisionTrackKind = 'progress' | 'count' | 'countdown' | 'target';

export type VisionDirection = 'positive' | 'negative';

/** 「目标」愿景中关联的项目引用（可多选） */
export type VisionLinkedProjectRef = { id: string; name: string };

/** 存入 extra_data JSON，便于扩展且不频繁改表结构 */
export type VisionExtraPayload = {
  goalTotal?: string;
  step?: string;
  unit?: string;
  countFrequency?: 'daily' | 'weekly' | 'monthly';
  countStep?: string;
  countUnit?: string;
  countdownKind?: 'countdown' | 'countup';
  endDate?: string;
  dateFormat?: 'ymd' | 'year' | 'month' | 'week' | 'day';
  /** 「目标」：关联多个项目时写入；进度为各项目任务汇总 */
  linkedProjects?: VisionLinkedProjectRef[];
  /** 旧数据单项目关联（读取时由 collectVisionLinkedProjectsFromExtra 归一） */
  linkedProjectId?: string;
  linkedProjectName?: string;
  /** 自定义封面：本地 file:// 或 content:// URI（与 bg_option_idx 为「自定义」槽位配套） */
  customBgUri?: string;
  /** 计数 / 手动目标进度：当前累计值（字符串存数字，便于 JSON） */
  currentAmount?: string;
  /** 总目标所属维度（先建维度再在维度下建总目标） */
  dimensionId?: string;
  /** 冗余展示名，避免维度删除后卡片无标题 */
  dimensionName?: string;
};

/** 从 extra 解析关联项目列表（兼容仅 linkedProjectId 的旧数据） */
export function collectVisionLinkedProjectsFromExtra(extra: VisionExtraPayload | null | undefined): VisionLinkedProjectRef[] {
  if (!extra) return [];
  const multi = extra.linkedProjects;
  if (Array.isArray(multi) && multi.length > 0) {
    const out: VisionLinkedProjectRef[] = [];
    for (const item of multi) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id.trim() : '';
      if (!id) continue;
      const name = typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name : '';
      out.push({ id, name });
    }
    if (out.length > 0) return out;
  }
  const legacyId = extra.linkedProjectId?.trim();
  if (legacyId) {
    return [{ id: legacyId, name: extra.linkedProjectName?.trim() ?? '' }];
  }
  return [];
}

export type VisionRow = {
  id: string;
  title: string;
  description: string | null;
  track_kind: VisionTrackKind;
  direction: VisionDirection | null;
  bg_option_idx: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};

export type CreateVisionInput = {
  id: string;
  title: string;
  description?: string | null;
  track_kind: VisionTrackKind;
  /** 进度 / 目标 有意义；其余可为 null */
  direction?: VisionDirection | null;
  bg_option_idx: number;
  sort_order?: number;
  extra?: VisionExtraPayload | null;
};

export type UpdateVisionInput = Partial<
  Pick<
    VisionRow,
    'title' | 'description' | 'track_kind' | 'direction' | 'bg_option_idx' | 'sort_order' | 'extra_data'
  >
>;

/** 创建页 tab 索引 → track_kind */
export function visionTrackKindFromCreateTab(tab: 0 | 1 | 2 | 3): VisionTrackKind {
  const map: VisionTrackKind[] = ['progress', 'count', 'countdown', 'target'];
  return map[tab];
}
