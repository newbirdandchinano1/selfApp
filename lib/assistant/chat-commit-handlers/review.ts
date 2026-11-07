/**
 * S9.3 W2：commit_review_dimension（动态 import）。
 * 期刊正文口述写入属 W3（commit_review_journal）；本 handler 落维度/栏目模板。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

function asScope(raw: unknown): 'daily' | 'weekly' | 'monthly' {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'weekly' || s === '周' || s === 'week') return 'weekly';
  if (s === 'monthly' || s === '月' || s === 'month') return 'monthly';
  return 'daily';
}

export async function commitReviewDimension(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const title =
    draftString(draft, 'dimension_title') ||
    draftString(draft, 'title') ||
    draftString(draft, 'name');
  if (!title) {
    return fail('incomplete_draft', '缺少复盘维度标题');
  }

  const scope = asScope(draft.scope);
  const body =
    draftString(draft, 'body') ||
    draftString(draft, 'text') ||
    draftString(draft, 'draft_text');
  const columnTitle =
    draftString(draft, 'column_title') ||
    (body ? 'AI 起草' : '');

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const {
    listReviewDimensions,
    createReviewDimension,
    updateReviewDimension,
    createReviewColumn,
    listReviewColumnsForDimension,
  } = await import('@/lib/repositories/insights/review-template');

  const existingId =
    draftString(draft, 'dimension_id') || draftString(draft, 'id');
  let dimensionId = existingId;

  if (dimensionId) {
    const updated = await updateReviewDimension(dimensionId, {
      title: title.slice(0, 80),
    });
    if (!updated) {
      return fail('dimension_missing', '找不到要更新的复盘维度');
    }
  } else {
    const dims = await listReviewDimensions(scope);
    const hit = dims.find(d => d.title.trim() === title.trim());
    if (hit) {
      dimensionId = hit.id;
      if (draftString(draft, 'rewrite_title')) {
        await updateReviewDimension(hit.id, { title: title.slice(0, 80) });
      }
    } else {
      dimensionId = makeTimestampEntityId('rdim_', 8);
      await createReviewDimension({
        id: dimensionId,
        scope,
        title: title.slice(0, 80),
      });
    }
  }

  if (columnTitle && dimensionId) {
    const cols = await listReviewColumnsForDimension(dimensionId);
    const colHit = cols.find(c => c.title.trim() === columnTitle.trim());
    if (!colHit) {
      await createReviewColumn({
        id: makeTimestampEntityId('rcol_', 8),
        dimension_id: dimensionId,
        title: columnTitle.slice(0, 80),
        placeholder: body ? body.slice(0, 500) : null,
      });
    }
  }

  await requestPushPending();
  return ok(dimensionId, `已保存复盘维度「${title.slice(0, 40)}」`);
}

function mondayOfYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function monthStartOfYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[1]}-${m[2]}-01`;
}

export async function commitReviewJournal(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const body =
    draftString(draft, 'body') ||
    draftString(draft, 'text') ||
    draftString(draft, 'content');
  if (!body) return fail('incomplete_draft', '缺少复盘正文');

  const { formatYmd } = await import('@/lib/date');
  const scopeRaw = draftString(draft, 'scope').toLowerCase() || 'daily';
  const scope =
    scopeRaw === 'weekly' || scopeRaw === '周'
      ? 'weekly'
      : scopeRaw === 'monthly' || scopeRaw === '月'
        ? 'monthly'
        : 'daily';
  const period =
    draftString(draft, 'period_ymd') ||
    draftString(draft, 'ymd') ||
    draftString(draft, 'record_date') ||
    formatYmd(new Date());

  if (scope === 'weekly') {
    const { upsertWeeklyReviewJournal } = await import(
      '@/lib/repositories/insights/weekly-review-journal'
    );
    const { BUILTIN_REVIEW_COLUMN_IDS } = await import(
      '@/lib/repositories/insights/review-template-defaults'
    );
    const weekStart = mondayOfYmd(period);
    const fields: Record<string, string> = {
      [BUILTIN_REVIEW_COLUMN_IDS.weekly.ideas]: body.slice(0, 4000),
    };
    await upsertWeeklyReviewJournal({
      week_start_ymd: weekStart,
      fields,
      execution_score: draftNumber(draft, 'execution_score') ?? 0,
    });
    await requestPushPending();
    return ok(weekStart, `已写入周复盘（${weekStart}）`);
  }

  if (scope === 'monthly') {
    const { upsertMonthlyReviewJournal } = await import(
      '@/lib/repositories/insights/monthly-review-journal'
    );
    const monthStart = monthStartOfYmd(period);
    await upsertMonthlyReviewJournal(monthStart, body.slice(0, 8000));
    await requestPushPending();
    return ok(monthStart, `已写入月复盘（${monthStart}）`);
  }

  const { upsertDailyReviewJournal } = await import(
    '@/lib/repositories/insights/daily-review-journal'
  );
  await upsertDailyReviewJournal(period, body.slice(0, 8000));
  await requestPushPending();
  return ok(period, `已写入日复盘（${period}）`);
}

export async function commitReviewColumn(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const title =
    draftString(draft, 'column_title') ||
    draftString(draft, 'title') ||
    draftString(draft, 'name');
  if (!title) return fail('incomplete_draft', '缺少复盘栏标题');

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const {
    createReviewColumn,
    updateReviewColumn,
    listReviewDimensions,
    createReviewDimension,
  } = await import('@/lib/repositories/insights/review-template');

  const existingId =
    draftString(draft, 'column_id') || draftString(draft, 'id');
  if (existingId) {
    await updateReviewColumn(existingId, {
      title: title.slice(0, 80),
      placeholder: draftString(draft, 'body') || draftString(draft, 'placeholder') || undefined,
    });
    await requestPushPending();
    return ok(existingId, `已更新复盘栏「${title.slice(0, 40)}」`);
  }

  let dimensionId = draftString(draft, 'dimension_id');
  const scope = asScope(draft.scope);
  if (!dimensionId) {
    const dimTitle =
      draftString(draft, 'dimension_title') ||
      draftString(draft, 'dimension') ||
      '助手写入';
    const dims = await listReviewDimensions(scope);
    const hit = dims.find(d => d.title.trim() === dimTitle.trim());
    if (hit) {
      dimensionId = hit.id;
    } else {
      dimensionId = makeTimestampEntityId('rdim_', 8);
      await createReviewDimension({
        id: dimensionId,
        scope,
        title: dimTitle.slice(0, 80),
      });
    }
  }

  const colId = makeTimestampEntityId('rcol_', 8);
  await createReviewColumn({
    id: colId,
    dimension_id: dimensionId,
    title: title.slice(0, 80),
    placeholder: draftString(draft, 'body') || null,
  });
  await requestPushPending();
  return ok(colId, `已创建复盘栏「${title.slice(0, 40)}」`);
}

export const reviewCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_review_dimension: async input => commitReviewDimension(input.draft),
  commit_review_journal: async input => commitReviewJournal(input.draft),
  commit_review_column: async input => commitReviewColumn(input.draft),
};
