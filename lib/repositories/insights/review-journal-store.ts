/**
 * 日 / 周 / 月复盘 journal 的同构存储层。
 * 差别主要是表名与主键列（哪一天 / 哪周 / 哪月）；日·月 body 同构，周刊走 extra_data + legacy 列。
 */
import { getDatabase } from '../../database.native';
import type { DailyReviewJournalRow } from './daily-review-journal.types';
import type { MonthlyReviewJournalRow } from './monthly-review-journal.types';
import type { WeeklyReviewJournalRow } from './weekly-review-journal.types';

export type ReviewJournalScope = 'daily' | 'weekly' | 'monthly';

export type ReviewJournalRowByScope = {
  daily: DailyReviewJournalRow;
  weekly: WeeklyReviewJournalRow;
  monthly: MonthlyReviewJournalRow;
};

type ScopeConfig = {
  table: string;
  periodColumn: string;
  idPrefix: string;
};

export const REVIEW_JOURNAL_SCOPE: Record<ReviewJournalScope, ScopeConfig> = {
  daily: {
    table: 'daily_review_journal',
    periodColumn: 'record_date_ymd',
    idPrefix: 'drj_',
  },
  weekly: {
    table: 'weekly_review_journal',
    periodColumn: 'week_start_ymd',
    idPrefix: 'wrj_',
  },
  monthly: {
    table: 'monthly_review_journal',
    periodColumn: 'month_start_ymd',
    idPrefix: 'mrj_',
  },
};

export function journalIdForPeriod(scope: ReviewJournalScope, periodYmd: string): string {
  return `${REVIEW_JOURNAL_SCOPE[scope].idPrefix}${periodYmd.replace(/-/g, '')}`;
}

/** 按区间列出 journal（读路径经 page API 灌库后读 SQLite） */
export async function listReviewJournalsBetween<S extends ReviewJournalScope>(
  scope: S,
  startYmd: string,
  endYmd: string,
): Promise<ReviewJournalRowByScope[S][]> {
  const db = await getDatabase();
  if (!db) return [];
  const { table, periodColumn } = REVIEW_JOURNAL_SCOPE[scope];
  const rows = await db.getAllAsync<ReviewJournalRowByScope[S]>(
    `SELECT * FROM ${table}
     WHERE ${periodColumn} >= ? AND ${periodColumn} <= ?
       AND sync_status != 'pending_delete'
     ORDER BY ${periodColumn} ASC`,
    [startYmd, endYmd],
  );
  return rows ?? [];
}

/** 按周期主键取一条 */
export async function getReviewJournalByPeriod<S extends ReviewJournalScope>(
  scope: S,
  periodYmd: string,
): Promise<ReviewJournalRowByScope[S] | null> {
  const db = await getDatabase();
  if (!db) return null;
  const { table, periodColumn } = REVIEW_JOURNAL_SCOPE[scope];
  return db.getFirstAsync<ReviewJournalRowByScope[S]>(
    `SELECT * FROM ${table}
     WHERE ${periodColumn} = ? AND sync_status != 'pending_delete'
     LIMIT 1`,
    [periodYmd],
  );
}

/**
 * 日 / 月 body 同构写入。周刊请用 upsertWeeklyReviewJournal（含 legacy 列与 adjust 标志）。
 */
export async function upsertBodyReviewJournal(
  scope: 'daily' | 'monthly',
  periodYmd: string,
  body: string,
): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  const { table, periodColumn } = REVIEW_JOURNAL_SCOPE[scope];
  const id = journalIdForPeriod(scope, periodYmd);

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM ${table} WHERE ${periodColumn} = ? LIMIT 1`,
    [periodYmd],
  );

  if (existing) {
    await db.runAsync(
      `UPDATE ${table} SET
         body = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [body || null, existing.id],
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO ${table} (
      id, ${periodColumn}, body,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, datetime('now'), datetime('now'), 'pending_create', NULL)`,
    [id, periodYmd, body || null],
  );
}
