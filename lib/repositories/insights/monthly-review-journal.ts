import type { MonthlyReviewJournalRow } from './monthly-review-journal.types';
import {
  getReviewJournalByPeriod,
  listReviewJournalsBetween,
  upsertBodyReviewJournal,
} from './review-journal-store';

/** 读路径已改走 `/api/pages/review/*`；仓库层只读 SQLite，禁止 List 全表。 */
export async function getMonthlyReviewJournalByMonth(
  monthStartYmd: string,
): Promise<MonthlyReviewJournalRow | null> {
  return getReviewJournalByPeriod('monthly', monthStartYmd);
}

export async function listMonthlyReviewsBetween(
  startYmd: string,
  endYmd: string,
): Promise<MonthlyReviewJournalRow[]> {
  return listReviewJournalsBetween('monthly', startYmd, endYmd);
}

export async function upsertMonthlyReviewJournal(month_start_ymd: string, body: string): Promise<void> {
  await upsertBodyReviewJournal('monthly', month_start_ymd, body);
}
