import { getDatabase } from '../../database.native';
import type { DailyReviewJournalRow } from './daily-review-journal.types';

function journalIdForYmd(ymd: string) {
  return `drj_${ymd.replace(/-/g, '')}`;
}

export async function listDailyReviewsBetween(startYmd: string, endYmd: string): Promise<DailyReviewJournalRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  return db.getAllAsync<DailyReviewJournalRow>(
    `SELECT * FROM daily_review_journal
      WHERE deleted_at IS NULL AND record_date_ymd >= ? AND record_date_ymd <= ?
      ORDER BY record_date_ymd ASC`,
    [startYmd, endYmd],
  );
}

export async function upsertDailyReviewJournal(record_date_ymd: string, body: string): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  const id = journalIdForYmd(record_date_ymd);

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM daily_review_journal WHERE record_date_ymd = ? AND deleted_at IS NULL LIMIT 1`,
    [record_date_ymd],
  );

  if (existing) {
    await db.runAsync(
      `UPDATE daily_review_journal SET
         body = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
         version = version + 1
       WHERE id = ?`,
      [body || null, existing.id],
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO daily_review_journal (
      id, record_date_ymd, body,
      created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, NULL)`,
    [id, record_date_ymd, body || null],
  );
}
