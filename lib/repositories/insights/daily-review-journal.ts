import type { DailyReviewJournalRow } from './daily-review-journal.types';
import {
  getReviewJournalByPeriod,
  listReviewJournalsBetween,
  upsertBodyReviewJournal,
} from './review-journal-store';

/** 读路径已改走 `/api/pages/review/*`；仓库层只读 SQLite，禁止 `/api/data/daily_review_journal` List。 */
export async function listDailyReviewsBetween(startYmd: string, endYmd: string): Promise<DailyReviewJournalRow[]> {
  return listReviewJournalsBetween('daily', startYmd, endYmd);
}

export async function getDailyReviewJournalByDay(ymd: string): Promise<DailyReviewJournalRow | null> {
  return getReviewJournalByPeriod('daily', ymd);
}

export async function upsertDailyReviewJournal(record_date_ymd: string, body: string): Promise<void> {
  await upsertBodyReviewJournal('daily', record_date_ymd, body);
}
