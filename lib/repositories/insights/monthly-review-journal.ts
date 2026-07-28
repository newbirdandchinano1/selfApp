import { readApiTable } from '@/lib/api-read';
import { getDatabase } from '../../database.native';
import type { MonthlyReviewJournalRow } from './monthly-review-journal.types';

function journalIdForMonth(monthStartYmd: string) {
  return `mrj_${monthStartYmd.replace(/-/g, '')}`;
}

export async function getMonthlyReviewJournalByMonth(
  monthStartYmd: string,
): Promise<MonthlyReviewJournalRow | null> {
  const rows = await readApiTable<MonthlyReviewJournalRow>('monthly_review_journal', {
    offlineFallback: true,
  });
  return rows.find(r => r.month_start_ymd === monthStartYmd) ?? null;
}

export async function upsertMonthlyReviewJournal(month_start_ymd: string, body: string): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  const id = journalIdForMonth(month_start_ymd);

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM monthly_review_journal WHERE month_start_ymd = ? LIMIT 1`,
    [month_start_ymd],
  );

  if (existing) {
    await db.runAsync(
      `UPDATE monthly_review_journal SET
         body = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [body || null, existing.id],
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO monthly_review_journal (
      id, month_start_ymd, body,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, datetime('now'), datetime('now'), 'pending_create', NULL)`,
    [id, month_start_ymd, body || null],
  );
}
