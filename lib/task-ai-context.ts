/**
 * 任务 AI 请求上下文：裁剪任务/习惯/青蛙候选摘要，控制 token。
 */
import type {
  TaskAiFrogCandidateSummary,
  TaskAiHabitSummary,
  TaskAiTaskSummary,
} from '@/lib/ai-api-client';
import type { FrogCandidate } from '@/lib/frog-candidates-api';
import { isFrogAssignedOn } from '@/lib/frog-assignment';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { isTaskActiveStatus } from '@/lib/repositories/tasks/task.types';
import { parseScheduleMetaFromExtra } from '@/lib/schedule/meta';
import { toYmd } from '@/lib/schedule/ymd';
import { parseTaskRepeatSchedule } from '@/lib/task-repeat-rollover';

function dueYmdOf(task: TaskRow): string | null {
  if (task.due_date) return toYmd(task.due_date) ?? task.due_date.slice(0, 10);
  const schedule = parseScheduleMetaFromExtra(task.extra_data);
  if (schedule?.date) return toYmd(schedule.date) ?? schedule.date.slice(0, 10);
  if (schedule?.range?.end) return toYmd(schedule.range.end) ?? schedule.range.end.slice(0, 10);
  return null;
}

function hasRepeat(task: TaskRow): boolean {
  const r = parseTaskRepeatSchedule(task.extra_data);
  return !!r && r.repeatOption !== '不重复';
}

export function buildTaskAiSummaries(
  tasks: TaskRow[],
  opts?: {
    logicalTodayYmd?: string;
    tagsByTaskId?: Map<string, string[]>;
    max?: number;
  },
): TaskAiTaskSummary[] {
  const max = opts?.max ?? 60;
  const today = opts?.logicalTodayYmd?.trim() || '';
  const out: TaskAiTaskSummary[] = [];
  for (const t of tasks) {
    if (!t.id?.trim() || !t.title?.trim()) continue;
    if (!isTaskActiveStatus(t.status)) continue;
    const due = dueYmdOf(t);
    const isOverdue = !!(today && due && due < today);
    out.push({
      id: t.id,
      title: t.title.trim().slice(0, 80),
      status: t.status,
      priority: typeof t.priority === 'number' ? t.priority : 0,
      due_ymd: due,
      project_id: t.project_id,
      parent_id: t.parent_task_id,
      is_frog_today: today ? isFrogAssignedOn(t.extra_data, today) : false,
      is_overdue: isOverdue,
      tags: (opts?.tagsByTaskId?.get(t.id) ?? []).slice(0, 6),
      has_repeat: hasRepeat(t),
    });
    if (out.length >= max) break;
  }
  return out;
}

export function buildFrogCandidateAiSummaries(
  items: FrogCandidate[],
  max = 30,
): TaskAiFrogCandidateSummary[] {
  const out: TaskAiFrogCandidateSummary[] = [];
  for (const it of items) {
    if (it.kind !== 'task') continue; // 青蛙 AI 建议只指派任务
    if (!it.id?.trim() || !it.title?.trim()) continue;
    if (it.blockedReason) continue;
    out.push({
      id: it.id,
      title: it.title.trim().slice(0, 80),
      kind: it.kind,
      priority: it.priority,
      due_ymd: it.dueDate ? it.dueDate.slice(0, 10) : null,
      is_overdue: !!it.isOverdue,
      already_assigned: !!it.alreadyAssigned,
    });
    if (out.length >= max) break;
  }
  return out;
}

export type HabitAiSource = {
  id: string;
  name: string;
  kind?: string | null;
  todayCount?: number | null;
  dailyGoal?: number | null;
  streak?: number | null;
};

export function buildHabitAiSummaries(habits: HabitAiSource[], max = 30): TaskAiHabitSummary[] {
  const out: TaskAiHabitSummary[] = [];
  for (const h of habits) {
    if (!h.id?.trim() || !h.name?.trim()) continue;
    out.push({
      id: h.id,
      name: h.name.trim().slice(0, 40),
      kind: h.kind ?? null,
      today_count: typeof h.todayCount === 'number' ? h.todayCount : 0,
      daily_goal: typeof h.dailyGoal === 'number' ? h.dailyGoal : 1,
      streak: typeof h.streak === 'number' ? h.streak : 0,
    });
    if (out.length >= max) break;
  }
  return out;
}
