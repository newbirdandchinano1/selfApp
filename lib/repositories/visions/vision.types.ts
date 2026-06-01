import { makeTimestampEntityId } from '@/lib/entity-id';
import type { SyncStatus } from '../../database.native';

/** 与创建页「追踪方式」一致 */
export type VisionTrackKind = 'progress' | 'count' | 'countdown' | 'target';

export type VisionDirection = 'positive' | 'negative';

/** 「目标」愿景中关联的项目引用（可多选） */
export type VisionLinkedProjectRef = { id: string; name: string };

/** 「目标」追踪下的单个小目标；创建后可绑定多个项目 */
export type VisionSubGoal = {
  id: string;
  name: string;
  description?: string;
  linkedProjects?: VisionLinkedProjectRef[];
  /** @deprecated 读取时并入 linkedProjects */
  linkedProject?: VisionLinkedProjectRef;
  /** 未绑定项目时作为独立目标，可手动标记完成 */
  done?: boolean;
};

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
  /** 「目标」：小目标列表（名称/简介自定义，每项可绑定多个项目） */
  subGoals?: VisionSubGoal[];
  /** @deprecated 由 subGoals 承载；读取时迁移到小目标 */
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

export function newVisionSubGoalId(): string {
  return makeTimestampEntityId('vsg_', 8);
}

function normalizeLinkedProjectRef(raw: unknown): VisionLinkedProjectRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const id = typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id.trim() : '';
  if (!id) return undefined;
  const name = typeof (raw as { name?: unknown }).name === 'string' ? (raw as { name: string }).name.trim() : '';
  return { id, name };
}

function normalizeLinkedProjectList(raw: unknown): VisionLinkedProjectRef[] {
  if (!Array.isArray(raw)) return [];
  const out: VisionLinkedProjectRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const ref = normalizeLinkedProjectRef(item);
    if (!ref || seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}

/** 未绑定项目的小目标，自身计为 1 个可完成目标 */
export function isStandaloneVisionSubGoal(sg: VisionSubGoal): boolean {
  return collectLinkedProjectsFromSubGoal(sg).length === 0;
}

/** 独立小目标的完成统计（total 恒为 1） */
export function standaloneSubGoalTaskStats(sg: VisionSubGoal): { total: number; completed: number } {
  return { total: 1, completed: sg.done ? 1 : 0 };
}

/** 绑定项目的小目标：关联任务全部完成时视为自动完成 */
export function isBoundVisionSubGoalTaskComplete(
  taskProgress: { completed: number; total: number } | null | undefined
): boolean {
  return (
    taskProgress != null &&
    taskProgress.total > 0 &&
    taskProgress.completed >= taskProgress.total
  );
}

/** 小目标上已绑定的项目（兼容旧版单项目字段） */
export function collectLinkedProjectsFromSubGoal(sg: VisionSubGoal): VisionLinkedProjectRef[] {
  const multi = normalizeLinkedProjectList(sg.linkedProjects);
  if (multi.length > 0) return multi;
  const one = normalizeLinkedProjectRef(sg.linkedProject);
  return one ? [one] : [];
}

/** 从 extra 解析小目标列表（兼容旧版顶层 linkedProjects） */
export function collectVisionSubGoalsFromExtra(extra: VisionExtraPayload | null | undefined): VisionSubGoal[] {
  if (!extra) return [];
  const raw = extra.subGoals;
  if (Array.isArray(raw) && raw.length > 0) {
    const out: VisionSubGoal[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id.trim() : '';
      const name = typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name.trim() : '';
      if (!id || !name) continue;
      const description =
        typeof (item as { description?: unknown }).description === 'string'
          ? (item as { description: string }).description.trim()
          : '';
      const linkedProjects = normalizeLinkedProjectList((item as { linkedProjects?: unknown }).linkedProjects);
      const legacyOne = normalizeLinkedProjectRef((item as { linkedProject?: unknown }).linkedProject);
      const merged =
        linkedProjects.length > 0
          ? linkedProjects
          : legacyOne
            ? [legacyOne]
            : [];
      const done = (item as { done?: unknown }).done === true;
      out.push({
        id,
        name,
        ...(description ? { description } : {}),
        ...(merged.length > 0 ? { linkedProjects: merged } : {}),
        ...(merged.length === 0 && done ? { done: true } : {}),
      });
    }
    if (out.length > 0) return out;
  }
  const legacyProjects = collectVisionLinkedProjectsFromExtraLegacy(extra);
  if (legacyProjects.length === 0) return [];
  return legacyProjects.map(p => ({
    id: newVisionSubGoalId(),
    name: p.name.trim() || '未命名小目标',
    linkedProjects: [p],
  }));
}

function collectVisionLinkedProjectsFromExtraLegacy(extra: VisionExtraPayload): VisionLinkedProjectRef[] {
  const multi = extra.linkedProjects;
  if (Array.isArray(multi) && multi.length > 0) {
    const out: VisionLinkedProjectRef[] = [];
    for (const item of multi) {
      const ref = normalizeLinkedProjectRef(item);
      if (ref) out.push(ref);
    }
    if (out.length > 0) return out;
  }
  const legacyId = extra.linkedProjectId?.trim();
  if (legacyId) {
    return [{ id: legacyId, name: extra.linkedProjectName?.trim() ?? '' }];
  }
  return [];
}

/** 从小目标与旧数据汇总去重后的关联项目（用于任务进度统计） */
export function collectVisionLinkedProjectsFromExtra(extra: VisionExtraPayload | null | undefined): VisionLinkedProjectRef[] {
  const subGoals = collectVisionSubGoalsFromExtra(extra);
  if (subGoals.length > 0) {
    const seen = new Set<string>();
    const out: VisionLinkedProjectRef[] = [];
    for (const sg of subGoals) {
      for (const p of collectLinkedProjectsFromSubGoal(sg)) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
      }
    }
    return out;
  }
  if (!extra) return [];
  return collectVisionLinkedProjectsFromExtraLegacy(extra);
}

export function serializeVisionSubGoalsForExtra(subGoals: VisionSubGoal[]): VisionSubGoal[] {
  return subGoals
    .map(sg => {
      const name = sg.name.trim();
      const id = sg.id.trim();
      if (!id || !name) return null;
      const description = sg.description?.trim() ?? '';
      const linkedProjects = collectLinkedProjectsFromSubGoal(sg).map(p => ({
        id: p.id.trim(),
        name: (p.name ?? '').trim(),
      }));
      const standalone = linkedProjects.length === 0;
      return {
        id,
        name,
        ...(description ? { description } : {}),
        ...(linkedProjects.length > 0 ? { linkedProjects } : {}),
        ...(standalone && sg.done ? { done: true } : {}),
      };
    })
    .filter((x): x is VisionSubGoal => x != null);
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
  sync_status: SyncStatus;
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

/** 创建页 tab 索引 → track_kind（无「计数」） */
export function visionTrackKindFromCreateTab(tab: 0 | 1 | 2): VisionTrackKind {
  const map: VisionTrackKind[] = ['progress', 'countdown', 'target'];
  return map[tab];
}
