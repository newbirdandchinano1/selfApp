import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { getDatabase } from '../../database.native';
import type { DailyReviewJournalRow } from './daily-review-journal.types';

function journalIdForYmd(ymd: string) {
  return `drj_${ymd.replace(/-/g, '')}`;
}

/** 读路径已改走 `/api/pages/review/*`；仓库层只读 SQLite，禁止 `/api/data/daily_review_journal` List。 */
export async function listDailyReviewsBetween(startYmd: string, endYmd: string): Promise<DailyReviewJournalRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<DailyReviewJournalRow>(
    `SELECT * FROM daily_review_journal
     WHERE record_date_ymd >= ? AND record_date_ymd <= ?
       AND sync_status != 'pending_delete'
     ORDER BY record_date_ymd ASC`,
    [startYmd, endYmd],
  );
  return rows ?? [];
}

export async function upsertDailyReviewJournal(record_date_ymd: string, body: string): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  const id = journalIdForYmd(record_date_ymd);

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM daily_review_journal WHERE record_date_ymd = ? LIMIT 1`,
    [record_date_ymd],
  );

  if (existing) {
    await db.runAsync(
      `UPDATE daily_review_journal SET
         body = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [body || null, existing.id],
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO daily_review_journal (
      id, record_date_ymd, body,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, datetime('now'), datetime('now'), 'pending_create', NULL)`,
    [id, record_date_ymd, body || null],
  );
}
