/**
 * 跨周期洞察：本地裁剪近 N 周 / N 月刊摘要，供 period-insights。
 * 不另开 compare 路由；禁止自动改历史刊。
 */
import { addDaysToYmd, formatYmd, parseYmd } from '@/lib/date';
import type { ReviewPeriodSummaryItem } from '@/lib/ai-api-client';
import { parseReviewAiPayload } from '@/lib/review-ai-sections';
import {
  parseDailyReviewJournal,
  parseWeeklyReviewFields,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listMonthlyReviewsBetween } from '@/lib/repositories/insights/monthly-review-journal';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import { BUILTIN_REVIEW_COLUMN_IDS } from '@/lib/repositories/insights/review-template-defaults';
import { listWeeklyReviewsBetween } from '@/lib/repositories/insights/weekly-review-journal';
import {
  addWeeksToWeekStart,
  formatWeekRangeLabel,
  getWeekStartMondayYmd,
} from '@/lib/schedule/week';

export type ReviewPeriodInsightsScope = 'weekly' | 'monthly';

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function fieldPreview(fields: ReviewFieldValues, columnId: string, max: number): string {
  return clip(fields[columnId] ?? '', max);
}

function monthStartYmd(ymd: string): string {
  const d = parseYmd(ymd);
  if (!d) return ymd.slice(0, 8) + '01';
  return formatYmd(new Date(d.getFullYear(), d.getMonth(), 1));
}

function prevMonthStart(monthStart: string): string {
  const d = parseYmd(monthStart);
  if (!d) return monthStart;
  return formatYmd(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}

function monthEndYmd(monthStart: string): string {
  const d = parseYmd(monthStart);
  if (!d) return monthStart;
  return formatYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function monthLabel(monthStart: string): string {
  const d = parseYmd(monthStart);
  if (!d) return monthStart;
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/** 近 4 周刊摘要（默认）或近 3 月刊摘要 */
export async function buildReviewPeriodInsightPeriods(opts: {
  scope: ReviewPeriodInsightsScope;
  /** 锚点日：通常 logicalToday；周刊从此周往前推 */
  anchorYmd: string;
  weekCount?: number;
  monthCount?: number;
}): Promise<{
  periods: ReviewPeriodSummaryItem[];
  aggregateMetrics?: string;
}> {
  const anchor = (opts.anchorYmd ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
    return { periods: [] };
  }

  if (opts.scope === 'monthly') {
    const count = Math.min(6, Math.max(2, opts.monthCount ?? 3));
    let cursor = monthStartYmd(anchor);
    const starts: string[] = [];
    for (let i = 0; i < count; i++) {
      starts.push(cursor);
      cursor = prevMonthStart(cursor);
    }
    starts.reverse();
    const rangeStart = starts[0];
    const rangeEnd = monthEndYmd(starts[starts.length - 1]!);
    const rows = await listMonthlyReviewsBetween(rangeStart, rangeEnd).catch(() => []);
    const byStart = new Map(rows.map(r => [r.month_start_ymd, r]));
    const tpl = await listReviewTemplate('monthly').catch(() => []);
    const defectId = BUILTIN_REVIEW_COLUMN_IDS.monthly.defects;
    const ideasId = BUILTIN_REVIEW_COLUMN_IDS.monthly.ideas;
    const periods: ReviewPeriodSummaryItem[] = [];
    for (const start of starts) {
      const row = byStart.get(start);
      if (!row) continue;
      const parsed = parseDailyReviewJournal(row.body ?? '', tpl);
      const fields = parsed.fields as ReviewFieldValues;
      const hasAny = Object.values(fields).some(v => (v ?? '').trim());
      if (!hasAny) continue;
      const overviewParts: string[] = [];
      for (const dim of tpl) {
        for (const col of dim.columns) {
          if (col.id === defectId || col.id === ideasId) continue;
          const v = (fields[col.id] ?? '').trim();
          if (v) overviewParts.push(v);
        }
      }
      periods.push({
        period_label: monthLabel(start),
        title_or_overview: clip(overviewParts.join('；'), 80),
        defects_preview: fieldPreview(fields, defectId, 120),
        ideas_preview: fieldPreview(fields, ideasId, 120),
      });
    }
    return {
      periods,
      aggregateMetrics: periods.length
        ? `近 ${periods.length} 个月刊参与洞察（有正文）`
        : undefined,
    };
  }

  // weekly
  const count = Math.min(8, Math.max(2, opts.weekCount ?? 4));
  let weekStart = getWeekStartMondayYmd(anchor);
  const starts: string[] = [];
  for (let i = 0; i < count; i++) {
    starts.push(weekStart);
    weekStart = addWeeksToWeekStart(weekStart, -1);
  }
  starts.reverse();
  const rangeStart = starts[0]!;
  const rangeEnd = addDaysToYmd(starts[starts.length - 1]!, 6);
  const rows = await listWeeklyReviewsBetween(rangeStart, rangeEnd).catch(() => []);
  const byStart = new Map(rows.map(r => [r.week_start_ymd, r]));
  const tpl = await listReviewTemplate('weekly').catch(() => []);
  const columnIds = tpl.flatMap(dim => dim.columns.map(col => col.id));
  const defectId = BUILTIN_REVIEW_COLUMN_IDS.weekly.defects;
  const ideasId = BUILTIN_REVIEW_COLUMN_IDS.weekly.ideas;
  const periods: ReviewPeriodSummaryItem[] = [];
  let scoreSum = 0;
  let scoreN = 0;
  for (const start of starts) {
    const row = byStart.get(start);
    if (!row) continue;
    const fields = parseWeeklyReviewFields(row, columnIds);
    const hasAny = Object.values(fields).some(v => (v ?? '').trim()) || Boolean(row.ai_coaching?.trim());
    if (!hasAny) continue;
    const coaching = parseReviewAiPayload(row.ai_coaching);
    const overviewParts: string[] = [];
    if (coaching.title) overviewParts.push(coaching.title);
    else if (coaching.overview) overviewParts.push(coaching.overview);
    else {
      for (const dim of tpl) {
        for (const col of dim.columns) {
          if (col.id === defectId || col.id === ideasId) continue;
          const v = (fields[col.id] ?? '').trim();
          if (v) overviewParts.push(v);
        }
      }
    }
    const score =
      typeof row.execution_score === 'number' && Number.isFinite(row.execution_score)
        ? Math.max(0, Math.min(5, Math.round(row.execution_score)))
        : null;
    if (score != null) {
      scoreSum += score;
      scoreN += 1;
    }
    periods.push({
      period_label: formatWeekRangeLabel(start),
      tags: coaching.tags?.length ? coaching.tags.slice(0, 4) : undefined,
      title_or_overview: clip(overviewParts.join('；'), 80),
      defects_preview: fieldPreview(fields, defectId, 120),
      ideas_preview: fieldPreview(fields, ideasId, 120),
      metrics: score != null ? `执行分 ${score}/5` : undefined,
    });
  }
  const aggregateMetrics = periods.length
    ? [
        `近 ${periods.length} 周刊参与洞察（有正文）`,
        scoreN > 0 ? `平均执行分 ${(scoreSum / scoreN).toFixed(1)}/5` : '',
      ]
        .filter(Boolean)
        .join('；')
    : undefined;
  return { periods, aggregateMetrics };
}
