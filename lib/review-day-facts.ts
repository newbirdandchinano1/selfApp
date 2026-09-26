import { ymdFromAuditDatetime } from '@/lib/api-mysql-datetime';
import { getDatabase } from '@/lib/database.native';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getTasks } from '@/lib/repositories/tasks/task';

export type ReviewDayFactItem = {
  kind: 'task' | 'habit';
  id: string;
  title: string;
};

export type ReviewDayFacts = {
  tasks: ReviewDayFactItem[];
  habits: ReviewDayFactItem[];
};

const MAX_ITEMS = 8;

/** 汇总某日已完成任务与习惯打卡，供复盘「今日事实」条使用 */
export async function loadReviewDayFacts(ymd: string): Promise<ReviewDayFacts> {
  const day = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { tasks: [], habits: [] };
  }

  const [tasks, habits, checkIns] = await Promise.all([
    getTasks().catch(() => []),
    getHabits().catch(() => []),
    (async () => {
      const db = await getDatabase();
      if (!db) return [] as { habit_id: string; count: number }[];
      return (
        (await db.getAllAsync<{ habit_id: string; count: number }>(
          `SELECT habit_id, count FROM habit_check_ins
           WHERE record_date = ? AND sync_status != 'pending_delete' AND count >= 1`,
          [day],
        )) ?? []
      );
    })(),
  ]);

  const completedTasks: ReviewDayFactItem[] = [];
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completed_at) continue;
    const doneDay = ymdFromAuditDatetime(t.completed_at);
    if (doneDay !== day) continue;
    const title = (t.title ?? '').trim();
    if (!title) continue;
    completedTasks.push({ kind: 'task', id: String(t.id), title });
    if (completedTasks.length >= MAX_ITEMS) break;
  }

  const habitTitleById = new Map(habits.map(h => [h.id, (h.name ?? '').trim() || '未命名习惯']));
  const habitItems: ReviewDayFactItem[] = [];
  for (const row of checkIns) {
    const title = habitTitleById.get(row.habit_id);
    if (!title) continue;
    habitItems.push({ kind: 'habit', id: row.habit_id, title });
    if (habitItems.length >= MAX_ITEMS) break;
  }

  return { tasks: completedTasks, habits: habitItems };
}

/** 生成可插入复盘正文的素材文本 */
export function formatReviewDayFactsInsertText(facts: ReviewDayFacts): string {
  const lines: string[] = [];
  if (facts.tasks.length > 0) {
    lines.push('完成任务：');
    for (const t of facts.tasks) lines.push(`· ${t.title}`);
  }
  if (facts.habits.length > 0) {
    if (lines.length) lines.push('');
    lines.push('习惯打卡：');
    for (const h of facts.habits) lines.push(`· ${h.title}`);
  }
  return lines.join('\n').trim();
}

export function reviewDayFactsIsEmpty(facts: ReviewDayFacts): boolean {
  return facts.tasks.length === 0 && facts.habits.length === 0;
}
