/**
 * 复盘 coaching 上下文拼装（日 / 周 / 月对齐周表单路径）。
 * 仅本地拼 metrics_text / related_digest，不另开 Agent 路由。
 */
import { addDaysToYmd } from '@/lib/date';
import { formatYmd, parseYmd } from '@/lib/date';
import {
  formatReviewDayFactsInsertText,
  loadReviewDayFacts,
  loadReviewPeriodFacts,
  reviewDayFactsIsEmpty,
  reviewFactsTextForColumn,
  type ReviewDayFacts,
} from '@/lib/review-day-facts';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import {
  buildDailyDigest,
  parseDailyReviewJournal,
  parseWeeklyReviewFields,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listMonthlyReviewsBetween } from '@/lib/repositories/insights/monthly-review-journal';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import { BUILTIN_REVIEW_COLUMN_IDS } from '@/lib/repositories/insights/review-template-defaults';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { listWeeklyReviewsBetween } from '@/lib/repositories/insights/weekly-review-journal';
import { fetchReviewWeekMetrics } from '@/lib/review-page-api';
import { buildWishBoardPeriodDigest } from '@/lib/wish-board-period-digest';

export type ReviewAiScope = 'daily' | 'weekly' | 'monthly';

function monthEndYmdFromMonthStart(monthStartYmd: string): string {
  const start = parseYmd(monthStartYmd);
  if (!start) return monthStartYmd;
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return formatYmd(end);
}

function prevMonthStartYmd(monthStartYmd: string): string {
  const start = parseYmd(monthStartYmd);
  if (!start) return monthStartYmd;
  return formatYmd(new Date(start.getFullYear(), start.getMonth() - 1, 1));
}

async function digestFromMonthlyRange(startYmd: string, endYmd: string): Promise<string> {
  const rows = await listMonthlyReviewsBetween(startYmd, endYmd).catch(() => []);
  if (!rows.length) return '';
  const tpl = await listReviewTemplate('monthly').catch(() => []);
  const blocks: string[] = [];
  for (const row of rows) {
    const parsed = parseDailyReviewJournal(row.body ?? '', tpl);
    const parts: string[] = [];
    for (const dim of tpl) {
      for (const col of dim.columns) {
        const v = (parsed.fields[col.id] ?? '').trim();
        if (!v) continue;
        parts.push(`${col.title}：${v.slice(0, 160)}`);
      }
    }
    if (parts.length === 0) continue;
    blocks.push(`【月刊 ${row.month_start_ymd}】\n${parts.join('\n')}`);
  }
  return clipDigest(blocks.join('\n\n'));
}

/** 昨日缺陷栏截取一句，供提纲 / coaching 对照（无则空） */
export async function loadPreviousOpenDefectHint(ymd: string): Promise<string> {
  const yesterday = addDaysToYmd(ymd, -1);
  const rows = await listDailyReviewsBetween(yesterday, yesterday).catch(() => []);
  const body = rows[0]?.body ?? '';
  if (!body.trim()) return '';
  const tpl = await listReviewTemplate('daily').catch(() => []);
  const parsed = parseDailyReviewJournal(body, tpl);
  const defectColId = BUILTIN_REVIEW_COLUMN_IDS.daily.defects;
  const raw = (parsed.fields[defectColId] ?? '').trim();
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').slice(0, 120);
}

const DIGEST_MAX = 3500;

export type ReviewCoachingExtras = {
  metricsText?: string;
  relatedDigest?: string;
  executionScore?: number;
};

/** 把日事实压成短 metrics 块（供 coaching / 起草） */
export function formatReviewFactsMetricsText(facts: ReviewDayFacts, label = '系统事实'): string {
  if (reviewDayFactsIsEmpty(facts)) return '';
  const frogDone = facts.frogs.filter(f => f.done).length;
  const todoDone = facts.todos.filter(t => t.done).length;
  const habitDone = facts.habits.filter(h => h.done).length;
  const lines = [
    `${label}：`,
    `青蛙 ${frogDone}/${facts.frogs.length}，待办 ${todoDone}/${facts.todos.length}，习惯 ${habitDone}/${facts.habits.length}`,
    `摄入：热量 ${Math.round(facts.health.calories)}kcal · 蛋白 ${Math.round(facts.health.protein)}g · 碳水 ${Math.round(facts.health.carbohydrate)}g · 饮水 ${Math.round(facts.health.hydration)}ml`,
  ];
  if (facts.health.weightKg != null) {
    lines.push(`体重：${facts.health.weightKg}kg`);
  }
  lines.push(
    `记账：收入 ¥${Math.round(facts.finance.income).toLocaleString('zh-CN')}，支出 ¥${Math.round(facts.finance.expense).toLocaleString('zh-CN')}`,
  );
  const insert = formatReviewDayFactsInsertText(facts, 'daily');
  if (insert) {
    lines.push('');
    lines.push(insert.slice(0, 1200));
  }
  return lines.join('\n').trim();
}

function clipDigest(text: string): string {
  const t = text.trim();
  if (t.length <= DIGEST_MAX) return t;
  return `${t.slice(0, DIGEST_MAX)}…`;
}

async function digestFromDailyRange(
  startYmd: string,
  endYmd: string,
  template?: ReviewDimensionTemplate[],
): Promise<string> {
  const rows = await listDailyReviewsBetween(startYmd, endYmd).catch(() => []);
  if (!rows.length) return '';
  const tpl = template ?? (await listReviewTemplate('daily').catch(() => []));
  const entries = rows
    .map(row => {
      const parsed = parseDailyReviewJournal(row.body ?? '', tpl);
      return { label: row.record_date_ymd, fields: parsed.fields as ReviewFieldValues };
    })
    .filter(e => Object.values(e.fields).some(v => (v ?? '').trim()));
  return clipDigest(buildDailyDigest(entries, tpl));
}

async function digestFromWeeklyRange(startYmd: string, endYmd: string): Promise<string> {
  const rows = await listWeeklyReviewsBetween(startYmd, endYmd).catch(() => []);
  if (!rows.length) return '';
  const tpl = await listReviewTemplate('weekly').catch(() => []);
  const columnIds = tpl.flatMap(dim => dim.columns.map(col => col.id));
  const blocks: string[] = [];
  for (const row of rows) {
    const fields = parseWeeklyReviewFields(row, columnIds);
    const parts: string[] = [];
    for (const dim of tpl) {
      for (const col of dim.columns) {
        const v = (fields[col.id] ?? '').trim();
        if (!v) continue;
        parts.push(`${col.title}：${v.slice(0, 160)}`);
      }
    }
    if (parts.length === 0) continue;
    blocks.push(`【周刊 ${row.week_start_ymd}】\n${parts.join('\n')}`);
  }
  return clipDigest(blocks.join('\n\n'));
}

async function safeWishDigest(startYmd: string, endYmd: string): Promise<string> {
  try {
    return (await buildWishBoardPeriodDigest({ startYmd, endYmd })).trim();
  } catch {
    return '';
  }
}

/** 日 / 周 / 月 coaching 附加上下文；失败时静默降级为空 */
export async function buildReviewCoachingExtras(input: {
  scope: ReviewAiScope;
  periodYmd?: string;
  template?: ReviewDimensionTemplate[];
}): Promise<ReviewCoachingExtras> {
  const periodYmd = (input.periodYmd ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodYmd)) return {};

  try {
    if (input.scope === 'daily') {
      const facts = await loadReviewDayFacts(periodYmd);
      const metricsText = formatReviewFactsMetricsText(facts, '当日系统事实') || undefined;
      const yesterday = addDaysToYmd(periodYmd, -1);
      const relatedParts: string[] = [];
      const yDigest = await digestFromDailyRange(yesterday, yesterday);
      if (yDigest) relatedParts.push(`昨日复盘：\n${yDigest}`);
      const defectHint = await loadPreviousOpenDefectHint(periodYmd);
      if (defectHint) relatedParts.push(`昨日缺陷未闭环：${defectHint}`);
      const relatedDigest = relatedParts.join('\n\n') || undefined;
      return { metricsText, relatedDigest };
    }

    if (input.scope === 'weekly') {
      const endYmd = addDaysToYmd(periodYmd, 6);
      let metricsText: string | undefined;
      try {
        const m = await fetchReviewWeekMetrics({
          start: periodYmd,
          end: endYmd,
          rangeKind: 'calendar-week',
        });
        metricsText = [
          `完成任务（系统）: ${m.tasksCompleted} 项`,
          `新建任务（系统）: ${m.tasksCreated} 项`,
          `习惯打卡合计: ${m.habitCheckInTotal} 次`,
          `存钱入账: ¥${Math.round(m.savingsWeekTotal).toLocaleString('zh-CN')}`,
          `记账收入: ¥${Math.round(m.financeIncome).toLocaleString('zh-CN')}，支出: ¥${Math.round(m.financeExpense).toLocaleString('zh-CN')}`,
        ].join('\n');
      } catch {
        const facts = await loadReviewPeriodFacts(periodYmd, endYmd);
        metricsText = formatReviewFactsMetricsText(facts, '本周系统事实') || undefined;
      }
      const dailyDigest = await digestFromDailyRange(periodYmd, endYmd, input.template);
      const prevWeekStart = addDaysToYmd(periodYmd, -7);
      const prevWeekEnd = addDaysToYmd(periodYmd, -1);
      const prevWeekly = await digestFromWeeklyRange(prevWeekStart, prevWeekEnd);
      const wish = await safeWishDigest(periodYmd, endYmd);
      const relatedDigest =
        [
          prevWeekly ? `【上一周刊】\n${prevWeekly}` : '',
          dailyDigest ? `近七日日刊：\n${dailyDigest}` : '',
          wish ? `心愿周期：\n${wish}` : '',
        ]
          .filter(Boolean)
          .join('\n\n') || undefined;
      return { metricsText, relatedDigest };
    }

    // monthly
    const monthEnd = monthEndYmdFromMonthStart(periodYmd);
    const facts = await loadReviewPeriodFacts(periodYmd, monthEnd);
    const metricsText = formatReviewFactsMetricsText(facts, '本月系统事实') || undefined;
    const weeklyDigest = await digestFromWeeklyRange(periodYmd, monthEnd);
    const dailyDigest = await digestFromDailyRange(periodYmd, monthEnd);
    const prevMonthStart = prevMonthStartYmd(periodYmd);
    const prevMonthEnd = monthEndYmdFromMonthStart(prevMonthStart);
    const prevMonthly = await digestFromMonthlyRange(prevMonthStart, prevMonthEnd);
    const wish = await safeWishDigest(periodYmd, monthEnd);
    const relatedDigest =
      [
        prevMonthly ? `【上一月刊】\n${prevMonthly}` : '',
        weeklyDigest ? `本月周刊摘要：\n${weeklyDigest}` : '',
        !weeklyDigest && dailyDigest ? `本月日刊摘要：\n${dailyDigest}` : '',
        wish ? `心愿周期：\n${wish}` : '',
      ]
        .filter(Boolean)
        .join('\n\n') || undefined;
    return { metricsText, relatedDigest };
  } catch (e) {
    console.warn('[review-ai] buildCoachingExtras failed', e);
    return {};
  }
}

/** 单栏起草用：优先栏目事实，否则整日/周期事实 */
export async function buildReviewDraftFactsText(opts: {
  scope: ReviewAiScope;
  periodYmd: string;
  columnId?: string;
}): Promise<string> {
  const periodYmd = opts.periodYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodYmd)) return '';

  if (opts.scope === 'daily') {
    const facts = await loadReviewDayFacts(periodYmd);
    if (opts.columnId) {
      const col = reviewFactsTextForColumn(facts, 'daily', opts.columnId);
      if (col?.trim()) return col.trim();
    }
    return formatReviewDayFactsInsertText(facts, 'daily');
  }

  const end =
    opts.scope === 'weekly' ? addDaysToYmd(periodYmd, 6) : monthEndYmdFromMonthStart(periodYmd);
  const facts = await loadReviewPeriodFacts(periodYmd, end);
  const scopeFacts = opts.scope === 'weekly' ? 'weekly' : 'monthly';
  if (opts.columnId) {
    const col = reviewFactsTextForColumn(facts, scopeFacts, opts.columnId);
    if (col?.trim()) return col.trim();
  }
  return formatReviewDayFactsInsertText(facts, scopeFacts);
}
