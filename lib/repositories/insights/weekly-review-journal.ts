import { getDatabase } from '../../database.native';
import type { UpsertWeeklyReviewJournalInput, WeeklyReviewJournalRow } from './weekly-review-journal.types';

function journalIdForWeek(weekStartYmd: string) {
  return `wrj_${weekStartYmd.replace(/-/g, '')}`;
}

export async function getWeeklyReviewJournalByWeek(weekStartYmd: string): Promise<WeeklyReviewJournalRow | null> {
  const db = await getDatabase();
  if (!db) return null;
  return db.getFirstAsync<WeeklyReviewJournalRow>(
    `SELECT * FROM weekly_review_journal WHERE week_start_ymd = ? AND deleted_at IS NULL LIMIT 1`,
    [weekStartYmd],
  );
}

export async function upsertWeeklyReviewJournal(input: UpsertWeeklyReviewJournalInput): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  const id = journalIdForWeek(input.week_start_ymd);
  const adjustTasks = input.adjust_tasks ? 1 : 0;
  const adjustSavings = input.adjust_savings ? 1 : 0;
  const adjustPlans = input.adjust_plans ? 1 : 0;

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM weekly_review_journal WHERE week_start_ymd = ? AND deleted_at IS NULL LIMIT 1`,
    [input.week_start_ymd],
  );

  if (existing) {
    const touchAi = input.ai_coaching !== undefined;
    if (touchAi) {
      await db.runAsync(
        `UPDATE weekly_review_journal SET
           section_summary = ?,
           section_plans = ?,
           section_reflect = ?,
           section_learnings = ?,
           section_next_week = ?,
           execution_score = ?,
           ai_coaching = ?,
           adjust_tasks = ?,
           adjust_savings = ?,
           adjust_plans = ?,
           updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
           version = version + 1
         WHERE id = ?`,
        [
          input.section_summary || null,
          input.section_plans || null,
          input.section_reflect || null,
          input.section_learnings || null,
          input.section_next_week || null,
          input.execution_score,
          input.ai_coaching ?? null,
          adjustTasks,
          adjustSavings,
          adjustPlans,
          existing.id,
        ],
      );
    } else {
      await db.runAsync(
        `UPDATE weekly_review_journal SET
           section_summary = ?,
           section_plans = ?,
           section_reflect = ?,
           section_learnings = ?,
           section_next_week = ?,
           execution_score = ?,
           adjust_tasks = ?,
           adjust_savings = ?,
           adjust_plans = ?,
           updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
           version = version + 1
         WHERE id = ?`,
        [
          input.section_summary || null,
          input.section_plans || null,
          input.section_reflect || null,
          input.section_learnings || null,
          input.section_next_week || null,
          input.execution_score,
          adjustTasks,
          adjustSavings,
          adjustPlans,
          existing.id,
        ],
      );
    }
    return;
  }

  await db.runAsync(
    `INSERT INTO weekly_review_journal (
      id, week_start_ymd,
      section_summary, section_plans, section_reflect, section_learnings, section_next_week,
      execution_score, ai_coaching, adjust_tasks, adjust_savings, adjust_plans,
      created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, NULL)`,
    [
      id,
      input.week_start_ymd,
      input.section_summary || null,
      input.section_plans || null,
      input.section_reflect || null,
      input.section_learnings || null,
      input.section_next_week || null,
      input.execution_score,
      input.ai_coaching ?? null,
      adjustTasks,
      adjustSavings,
      adjustPlans,
    ],
  );
}

/** 写入 AI 建议正文（不修改调整意向勾选） */
export async function setWeeklyReviewCoachingText(weekStartYmd: string, ai_coaching: string): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await db.runAsync(
    `UPDATE weekly_review_journal SET
       ai_coaching = ?,
       updated_at = datetime('now'),
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
       version = version + 1
     WHERE week_start_ymd = ? AND deleted_at IS NULL`,
    [ai_coaching, weekStartYmd],
  );
}

/** 仅更新「是否愿意调整…」勾选 */
export async function updateWeeklyReviewAdjustFlags(
  weekStartYmd: string,
  flags: { adjust_tasks: boolean; adjust_savings: boolean; adjust_plans: boolean },
): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await db.runAsync(
    `UPDATE weekly_review_journal SET
       adjust_tasks = ?,
       adjust_savings = ?,
       adjust_plans = ?,
       updated_at = datetime('now'),
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
       version = version + 1
     WHERE week_start_ymd = ? AND deleted_at IS NULL`,
    [flags.adjust_tasks ? 1 : 0, flags.adjust_savings ? 1 : 0, flags.adjust_plans ? 1 : 0, weekStartYmd],
  );
}
