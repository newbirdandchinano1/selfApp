/**
 * 每日青蛙指派上限（四象限）：
 * 紧急重要 2 · 紧急不重要 3 · 不紧急重要 4 · 不紧急不重要 5
 */
import { isFrogAssignedOn } from '@/lib/frog-assignment';
import { getProjectById, getProjects } from '@/lib/repositories/projects/project';
import { getTaskById, getTasks } from '@/lib/repositories/tasks/task';

export type DailyAssignBucket = 1 | 2 | 3 | 4;

/** bucket 4=P1 … 1=P4 → 日上限 */
export const DAILY_ASSIGN_MAX_BY_BUCKET: Record<DailyAssignBucket, number> = {
  4: 2,
  3: 3,
  2: 4,
  1: 5,
};

export const DAILY_ASSIGN_BUCKET_META: Record<
  DailyAssignBucket,
  { label: string; shortLabel: string }
> = {
  4: { label: '紧急重要', shortLabel: 'P1' },
  3: { label: '紧急不重要', shortLabel: 'P2' },
  2: { label: '不紧急重要', shortLabel: 'P3' },
  1: { label: '不紧急不重要', shortLabel: 'P4' },
};

export const DAILY_ASSIGN_BUCKET_ORDER: readonly DailyAssignBucket[] = [4, 3, 2, 1];

export type DailyAssignQuotaBucketStat = {
  bucket: DailyAssignBucket;
  label: string;
  shortLabel: string;
  used: number;
  max: number;
  remaining: number;
};

/** 某日某优先级桶内已指派的主体（任务 / 项目 / 待办） */
export type DailyAssignedSubject = {
  kind: 'task' | 'project';
  id: string;
  title: string;
  priority: number;
  /** 独立待办：任务且无 project_id */
  isStandaloneTodo: boolean;
  projectName: string | null;
  done: boolean;
  extraData: string | null;
};

export function dailyAssignBucketFromPriority(priority: number): DailyAssignBucket {
  if (priority >= 4) return 4;
  if (priority === 3) return 3;
  if (priority === 2) return 2;
  return 1;
}

export function dailyAssignMaxForPriority(priority: number): number {
  return DAILY_ASSIGN_MAX_BY_BUCKET[dailyAssignBucketFromPriority(priority)];
}

export function emptyDailyAssignQuotaStats(): DailyAssignQuotaBucketStat[] {
  return DAILY_ASSIGN_BUCKET_ORDER.map((bucket) => {
    const max = DAILY_ASSIGN_MAX_BY_BUCKET[bucket];
    const meta = DAILY_ASSIGN_BUCKET_META[bucket];
    return {
      bucket,
      label: meta.label,
      shortLabel: meta.shortLabel,
      used: 0,
      max,
      remaining: max,
    };
  });
}

export function summarizeDailyAssignQuota(
  items: ReadonlyArray<{ priority: number; extraData: string | null | undefined }>,
  assignYmd: string,
): DailyAssignQuotaBucketStat[] {
  const used: Record<DailyAssignBucket, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const item of items) {
    if (!isFrogAssignedOn(item.extraData ?? null, assignYmd)) continue;
    used[dailyAssignBucketFromPriority(item.priority)] += 1;
  }
  return DAILY_ASSIGN_BUCKET_ORDER.map((bucket) => {
    const max = DAILY_ASSIGN_MAX_BY_BUCKET[bucket];
    const u = used[bucket];
    const meta = DAILY_ASSIGN_BUCKET_META[bucket];
    return {
      bucket,
      label: meta.label,
      shortLabel: meta.shortLabel,
      used: u,
      max,
      remaining: Math.max(0, max - u),
    };
  });
}

/** 从本地已加载的 tasks/projects 列出某日某桶已指派项 */
export function listAssignedSubjectsForBucket(params: {
  assignYmd: string;
  bucket: DailyAssignBucket;
  tasks: ReadonlyArray<{
    id: string;
    title: string;
    priority?: number | null;
    extra_data: string | null;
    project_id?: string | null;
    status?: string | null;
  }>;
  projects: ReadonlyArray<{
    id: string;
    name: string;
    priority?: number | null;
    extra_data: string | null;
    status?: string | null;
  }>;
}): DailyAssignedSubject[] {
  const { assignYmd, bucket, tasks, projects } = params;
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const out: DailyAssignedSubject[] = [];

  for (const t of tasks) {
    if (!isFrogAssignedOn(t.extra_data, assignYmd)) continue;
    if (dailyAssignBucketFromPriority(t.priority ?? 0) !== bucket) continue;
    const projectId = t.project_id?.trim() || null;
    out.push({
      kind: 'task',
      id: t.id,
      title: (t.title ?? '').trim() || '任务',
      priority: t.priority ?? 0,
      isStandaloneTodo: !projectId,
      projectName: projectId ? projectNameById.get(projectId) ?? null : null,
      done: t.status === 'done' || t.status === 'completed',
      extraData: t.extra_data,
    });
  }

  for (const p of projects) {
    if (!isFrogAssignedOn(p.extra_data, assignYmd)) continue;
    if (dailyAssignBucketFromPriority(p.priority ?? 0) !== bucket) continue;
    out.push({
      kind: 'project',
      id: p.id,
      title: (p.name ?? '').trim() || '项目',
      priority: p.priority ?? 0,
      isStandaloneTodo: false,
      projectName: null,
      done: p.status === 'completed' || p.status === 'archived' || p.status === 'done',
      extraData: p.extra_data,
    });
  }

  out.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.title.localeCompare(b.title, 'zh');
  });
  return out;
}

export type DailyAssignedSubjectRef = {
  kind: 'task' | 'project';
  id: string;
  title: string;
  priority: number;
  bucket: DailyAssignBucket;
};

/** 某日已指派主体；可按象限桶过滤 */
export function listDailyAssignedSubjects(
  items: ReadonlyArray<{
    kind: 'task' | 'project';
    id: string;
    title: string;
    priority: number;
    extraData: string | null | undefined;
  }>,
  assignYmd: string,
  bucket?: DailyAssignBucket,
): DailyAssignedSubjectRef[] {
  const out: DailyAssignedSubjectRef[] = [];
  for (const item of items) {
    if (!isFrogAssignedOn(item.extraData ?? null, assignYmd)) continue;
    const b = dailyAssignBucketFromPriority(item.priority);
    if (bucket != null && b !== bucket) continue;
    out.push({
      kind: item.kind,
      id: item.id,
      title: item.title.trim() || (item.kind === 'project' ? '项目' : '任务'),
      priority: item.priority,
      bucket: b,
    });
  }
  out.sort((a, b) => {
    if (a.bucket !== b.bucket) return b.bucket - a.bucket;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.title.localeCompare(b.title, 'zh');
  });
  return out;
}

export function canAssignPriorityOnDay(
  stats: DailyAssignQuotaBucketStat[],
  priority: number,
): { ok: true } | { ok: false; message: string; used: number; max: number } {
  const bucket = dailyAssignBucketFromPriority(priority);
  const row =
    stats.find((s) => s.bucket === bucket) ??
    emptyDailyAssignQuotaStats().find((s) => s.bucket === bucket)!;
  if (row.remaining > 0) return { ok: true };
  return {
    ok: false,
    message: `今日「${row.label}」已达上限 ${row.max} 项（已指派 ${row.used}）`,
    used: row.used,
    max: row.max,
  };
}

export async function loadDailyAssignQuotaStats(
  assignYmd: string,
): Promise<DailyAssignQuotaBucketStat[]> {
  const [tasks, projects] = await Promise.all([getTasks(), getProjects()]);
  const items: { priority: number; extraData: string | null }[] = [];
  for (const t of tasks) {
    items.push({ priority: t.priority ?? 0, extraData: t.extra_data });
  }
  for (const p of projects) {
    items.push({ priority: p.priority ?? 0, extraData: p.extra_data });
  }
  return summarizeDailyAssignQuota(items, assignYmd);
}

/** 指派前校验：同日已指派则放行；否则按优先级桶占用日配额 */
export async function assertCanAssignSubjectOnDay(params: {
  kind: 'task' | 'project';
  id: string;
  assignYmd: string;
}): Promise<{ alreadyAssigned: boolean }> {
  let priority = 0;
  let extraData: string | null = null;

  if (params.kind === 'project') {
    const project = await getProjectById(params.id);
    if (!project) throw new Error('项目不存在');
    priority = project.priority ?? 0;
    extraData = project.extra_data;
  } else {
    const task = await getTaskById(params.id);
    if (!task) throw new Error('任务不存在');
    priority = task.priority ?? 0;
    extraData = task.extra_data;
  }

  if (isFrogAssignedOn(extraData, params.assignYmd)) {
    return { alreadyAssigned: true };
  }

  const stats = await loadDailyAssignQuotaStats(params.assignYmd);
  const gate = canAssignPriorityOnDay(stats, priority);
  if (!gate.ok) throw new Error(gate.message);
  return { alreadyAssigned: false };
}
