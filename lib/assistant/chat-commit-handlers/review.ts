/**
 * 复盘 commit：维度/栏目模板、期刊正文、空栏填事实、设置、删除。
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

function draftBool(draft: Record<string, unknown>, key: string): boolean | undefined {
  const v = draft[key];
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return undefined;
}

function draftFieldsMap(draft: Record<string, unknown>): Record<string, string> {
  const raw = draft.fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim();
    if (!key) continue;
    out[key] = v == null ? '' : String(v);
  }
  return out;
}

async function resolveColumnId(
  scope: 'daily' | 'weekly' | 'monthly',
  draft: Record<string, unknown>,
): Promise<string | null> {
  const direct =
    draftString(draft, 'column_id') || draftString(draft, 'id');
  if (direct) return direct;
  const colTitle = draftString(draft, 'column_title') || draftString(draft, 'column');
  if (!colTitle) return null;
  const { listReviewTemplate } = await import('@/lib/repositories/insights/review-template');
  const tpl = await listReviewTemplate(scope);
  const dimTitle = draftString(draft, 'dimension_title') || draftString(draft, 'dimension');
  for (const dim of tpl) {
    if (dimTitle && dim.title.trim() !== dimTitle.trim()) continue;
    const hit = dim.columns.find(c => c.title.trim() === colTitle.trim());
    if (hit) return hit.id;
  }
  // 无维度过滤时再全量找
  if (dimTitle) {
    for (const dim of tpl) {
      const hit = dim.columns.find(c => c.title.trim() === colTitle.trim());
      if (hit) return hit.id;
    }
  }
  return null;
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

export async function commitReviewJournal(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const { formatYmd } = await import('@/lib/date');
  const scope = asScope(draft.scope);
  const period =
    draftString(draft, 'period_ymd') ||
    draftString(draft, 'ymd') ||
    draftString(draft, 'record_date') ||
    formatYmd(new Date());
  const clear =
    draft.clear === true ||
    draftString(draft, 'action') === 'clear' ||
    draftString(draft, 'clear') === '1';

  const body =
    draftString(draft, 'body') ||
    draftString(draft, 'text') ||
    draftString(draft, 'content');
  let fieldsPatch = draftFieldsMap(draft);
  const colId = await resolveColumnId(scope, draft);
  if (colId && body && !(colId in fieldsPatch)) {
    fieldsPatch = { ...fieldsPatch, [colId]: body.slice(0, 8000) };
  }

  const executionScore = draftNumber(draft, 'execution_score');
  const adjustTasks = draftBool(draft, 'adjust_tasks');
  const adjustSavings = draftBool(draft, 'adjust_savings');
  const adjustPlans = draftBool(draft, 'adjust_plans');
  const hasWeeklyMeta =
    executionScore != null ||
    adjustTasks != null ||
    adjustSavings != null ||
    adjustPlans != null;

  if (clear) {
    if (scope === 'weekly') {
      const { upsertWeeklyReviewJournal } = await import(
        '@/lib/repositories/insights/weekly-review-journal'
      );
      const weekStart = mondayOfYmd(period);
      await upsertWeeklyReviewJournal({
        week_start_ymd: weekStart,
        fields: {},
        execution_score: 0,
        adjust_tasks: false,
        adjust_savings: false,
        adjust_plans: false,
      });
      await requestPushPending();
      return ok(weekStart, `已清空周复盘（${weekStart}）`);
    }
    if (scope === 'monthly') {
      const { upsertMonthlyReviewJournal } = await import(
        '@/lib/repositories/insights/monthly-review-journal'
      );
      const { serializeReviewBody } = await import(
        '@/lib/repositories/insights/review-journal-body'
      );
      const monthStart = monthStartOfYmd(period);
      await upsertMonthlyReviewJournal(monthStart, serializeReviewBody({}));
      await requestPushPending();
      return ok(monthStart, `已清空月复盘（${monthStart}）`);
    }
    const { upsertDailyReviewJournal } = await import(
      '@/lib/repositories/insights/daily-review-journal'
    );
    const { serializeReviewBody } = await import(
      '@/lib/repositories/insights/review-journal-body'
    );
    await upsertDailyReviewJournal(period, serializeReviewBody({}));
    await requestPushPending();
    return ok(period, `已清空日复盘（${period}）`);
  }

  if (!body && Object.keys(fieldsPatch).length === 0 && !hasWeeklyMeta) {
    return fail('incomplete_draft', '缺少复盘正文、栏目字段或执行分/调整意向');
  }

  if (scope === 'weekly') {
    const { getWeeklyReviewJournalByWeek, upsertWeeklyReviewJournal } = await import(
      '@/lib/repositories/insights/weekly-review-journal'
    );
    const { listReviewTemplate } = await import('@/lib/repositories/insights/review-template');
    const { collectColumnIds, parseWeeklyReviewFields } = await import(
      '@/lib/repositories/insights/review-journal-body'
    );
    const { BUILTIN_REVIEW_COLUMN_IDS } = await import(
      '@/lib/repositories/insights/review-template-defaults'
    );
    const weekStart = mondayOfYmd(period);
    const tpl = await listReviewTemplate('weekly');
    const colIds = collectColumnIds(tpl);
    const existing = await getWeeklyReviewJournalByWeek(weekStart);
    let fields = existing ? parseWeeklyReviewFields(existing, colIds) : {};
    if (Object.keys(fieldsPatch).length > 0) {
      fields = { ...fields, ...fieldsPatch };
    } else if (body) {
      fields = {
        ...fields,
        [BUILTIN_REVIEW_COLUMN_IDS.weekly.ideas]: body.slice(0, 4000),
      };
    }
    await upsertWeeklyReviewJournal({
      week_start_ymd: weekStart,
      fields,
      execution_score:
        executionScore ?? existing?.execution_score ?? 0,
      adjust_tasks: adjustTasks ?? Boolean(existing?.adjust_tasks),
      adjust_savings: adjustSavings ?? Boolean(existing?.adjust_savings),
      adjust_plans: adjustPlans ?? Boolean(existing?.adjust_plans),
    });
    await requestPushPending();
    const bits: string[] = [];
    if (Object.keys(fieldsPatch).length || body) bits.push('正文');
    if (executionScore != null) bits.push(`执行分 ${executionScore}`);
    if (adjustTasks) bits.push('调任务');
    if (adjustSavings) bits.push('调存钱');
    if (adjustPlans) bits.push('调计划');
    return ok(weekStart, `已更新周复盘（${weekStart}）${bits.length ? '：' + bits.join(' · ') : ''}`);
  }

  if (scope === 'monthly') {
    const { getMonthlyReviewJournalByMonth, upsertMonthlyReviewJournal } = await import(
      '@/lib/repositories/insights/monthly-review-journal'
    );
    const { listReviewTemplate } = await import('@/lib/repositories/insights/review-template');
    const {
      collectColumnIds,
      parseDailyReviewJournal,
      serializeReviewBody,
    } = await import('@/lib/repositories/insights/review-journal-body');
    const monthStart = monthStartOfYmd(period);
    const tpl = await listReviewTemplate('monthly');
    const colIds = collectColumnIds(tpl);
    const existing = await getMonthlyReviewJournalByMonth(monthStart);
    const parsed = parseDailyReviewJournal(existing?.body ?? '', colIds);
    let fields = { ...parsed.fields };
    if (Object.keys(fieldsPatch).length > 0) {
      fields = { ...fields, ...fieldsPatch };
    } else if (body) {
      // 无栏目时整段写入第一个栏目或作为纯文本兼容
      const firstId = colIds[0];
      if (firstId) fields[firstId] = body.slice(0, 8000);
      else {
        await upsertMonthlyReviewJournal(monthStart, body.slice(0, 8000));
        await requestPushPending();
        return ok(monthStart, `已写入月复盘（${monthStart}）`);
      }
    }
    await upsertMonthlyReviewJournal(
      monthStart,
      serializeReviewBody(fields, parsed.meta),
    );
    await requestPushPending();
    return ok(monthStart, `已更新月复盘（${monthStart}）`);
  }

  const { getDailyReviewJournalByDay, upsertDailyReviewJournal } = await import(
    '@/lib/repositories/insights/daily-review-journal'
  );
  const { listReviewTemplate } = await import('@/lib/repositories/insights/review-template');
  const {
    collectColumnIds,
    parseDailyReviewJournal,
    serializeReviewBody,
  } = await import('@/lib/repositories/insights/review-journal-body');
  const { BUILTIN_REVIEW_COLUMN_IDS } = await import(
    '@/lib/repositories/insights/review-template-defaults'
  );
  const tpl = await listReviewTemplate('daily');
  const colIds = collectColumnIds(tpl);
  const existing = await getDailyReviewJournalByDay(period);
  const parsed = parseDailyReviewJournal(existing?.body ?? '', colIds);
  let fields = { ...parsed.fields };
  if (Object.keys(fieldsPatch).length > 0) {
    fields = { ...fields, ...fieldsPatch };
  } else if (body) {
    const ideasId = BUILTIN_REVIEW_COLUMN_IDS.daily.ideas;
    const target = colIds.includes(ideasId) ? ideasId : colIds[0];
    if (target) fields[target] = body.slice(0, 8000);
    else {
      await upsertDailyReviewJournal(period, body.slice(0, 8000));
      await requestPushPending();
      return ok(period, `已写入日复盘（${period}）`);
    }
  }
  await upsertDailyReviewJournal(period, serializeReviewBody(fields, parsed.meta));
  await requestPushPending();
  return ok(period, `已更新日复盘（${period}）`);
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

export async function commitReviewFillEmpty(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const { formatYmd } = await import('@/lib/date');
  const scope = asScope(draft.scope);
  const period =
    draftString(draft, 'period_ymd') ||
    draftString(draft, 'ymd') ||
    formatYmd(new Date());
  const replace = draft.replace === true || draftString(draft, 'replace') === '1';
  const columnFilter = Array.isArray(draft.columns)
    ? new Set(
        (draft.columns as unknown[])
          .map(c => String(c ?? '').trim())
          .filter(Boolean),
      )
    : null;

  const { listReviewTemplate } = await import('@/lib/repositories/insights/review-template');
  const {
    collectColumnIds,
    fillEmptyFieldsFromRollup,
    mergeFieldValues,
    parseDailyReviewJournal,
    parseWeeklyReviewFields,
    serializeReviewBody,
  } = await import('@/lib/repositories/insights/review-journal-body');
  const {
    builtinReviewFactsFieldPatch,
    loadReviewDayFacts,
    reviewDayFactsIsEmpty,
  } = await import('@/lib/review-day-facts');

  if (scope === 'daily') {
    const facts = await loadReviewDayFacts(period);
    if (reviewDayFactsIsEmpty(facts)) {
      return ok(period, '今天没有可写入的健康、任务或财务数据');
    }
    let patch = builtinReviewFactsFieldPatch('daily', facts);
    if (columnFilter) {
      patch = Object.fromEntries(
        Object.entries(patch).filter(([id]) => columnFilter.has(id)),
      );
    }
    if (Object.keys(patch).length === 0) {
      return ok(period, '指定栏目没有可写入的事实数据');
    }
    const { getDailyReviewJournalByDay, upsertDailyReviewJournal } = await import(
      '@/lib/repositories/insights/daily-review-journal'
    );
    const tpl = await listReviewTemplate('daily');
    const colIds = collectColumnIds(tpl);
    const existing = await getDailyReviewJournalByDay(period);
    const parsed = parseDailyReviewJournal(existing?.body ?? '', colIds);
    const next = replace
      ? mergeFieldValues(parsed.fields, patch)
      : fillEmptyFieldsFromRollup(parsed.fields, patch);
    const changed = Object.keys(patch).filter(
      id => replace || !(parsed.fields[id] ?? '').trim(),
    );
    if (changed.length === 0) {
      return ok(period, '空栏均已有内容，未覆盖写入');
    }
    await upsertDailyReviewJournal(period, serializeReviewBody(next, parsed.meta));
    await requestPushPending();
    return ok(period, `已写入 ${changed.length} 栏今日事实（${period}）`);
  }

  if (scope === 'weekly') {
    const weekStart = mondayOfYmd(period);
    const { getWeeklyReviewJournalByWeek, upsertWeeklyReviewJournal } = await import(
      '@/lib/repositories/insights/weekly-review-journal'
    );
    const { rollupWeeklyFieldsFromDailyEntries } = await import(
      '@/components/review/review-utils'
    );
    const { listDailyReviewsBetween } = await import(
      '@/lib/repositories/insights/daily-review-journal'
    );
    const { getWeeklyReviewConfiguredWeekday } = await import(
      '@/lib/weekly-review-settings'
    );
    const { addDaysToYmd } = await import('@/lib/date');
    const tpl = await listReviewTemplate('weekly');
    const dailyTpl = await listReviewTemplate('daily');
    const colIds = collectColumnIds(tpl);
    const dailyColIds = collectColumnIds(dailyTpl);
    const existing = await getWeeklyReviewJournalByWeek(weekStart);
    const fields = existing ? parseWeeklyReviewFields(existing, colIds) : {};
    const configuredDow = await getWeeklyReviewConfiguredWeekday();
    const endYmd = addDaysToYmd(weekStart, 6);
    const dailies = await listDailyReviewsBetween(weekStart, endYmd);
    const dailyEntries = dailies.map(row => {
      const parsed = parseDailyReviewJournal(row.body ?? '', dailyColIds);
      const d = new Date(
        Number(row.record_date_ymd.slice(0, 4)),
        Number(row.record_date_ymd.slice(5, 7)) - 1,
        Number(row.record_date_ymd.slice(8, 10)),
      );
      const label = `${d.getMonth() + 1}月${d.getDate()}日`;
      return { ymd: row.record_date_ymd, label, fields: parsed.fields };
    });
    let next = await rollupWeeklyFieldsFromDailyEntries(
      fields,
      dailyEntries,
      endYmd,
      configuredDow,
    );
    if (columnFilter) {
      const filtered: Record<string, string> = { ...fields };
      for (const id of columnFilter) {
        if (next[id] != null) filtered[id] = next[id]!;
      }
      next = filtered;
    } else if (!replace) {
      next = fillEmptyFieldsFromRollup(fields, next);
    }
    const changed = Object.keys(next).filter(id => {
      const nv = (next[id] ?? '').trim();
      const ov = (fields[id] ?? '').trim();
      return nv && (replace || !ov) && nv !== ov;
    });
    if (changed.length === 0) {
      return ok(weekStart, '周刊空栏无需汇总写入');
    }
    await upsertWeeklyReviewJournal({
      week_start_ymd: weekStart,
      fields: next,
      execution_score: existing?.execution_score ?? 0,
      adjust_tasks: Boolean(existing?.adjust_tasks),
      adjust_savings: Boolean(existing?.adjust_savings),
      adjust_plans: Boolean(existing?.adjust_plans),
    });
    await requestPushPending();
    return ok(weekStart, `已汇总写入周刊 ${changed.length} 栏（${weekStart}）`);
  }

  // monthly
  const monthStart = monthStartOfYmd(period);
  const { getMonthlyReviewJournalByMonth, upsertMonthlyReviewJournal } = await import(
    '@/lib/repositories/insights/monthly-review-journal'
  );
  const { rollupMonthlyFieldsFromWeeklyJournals } = await import(
    '@/components/review/review-utils'
  );
  const tpl = await listReviewTemplate('monthly');
  const colIds = collectColumnIds(tpl);
  const existing = await getMonthlyReviewJournalByMonth(monthStart);
  const parsed = parseDailyReviewJournal(existing?.body ?? '', colIds);
  let next = await rollupMonthlyFieldsFromWeeklyJournals(parsed.fields, monthStart);
  if (columnFilter) {
    const filtered: Record<string, string> = { ...parsed.fields };
    for (const id of columnFilter) {
      if (next[id] != null) filtered[id] = next[id]!;
    }
    next = filtered;
  } else if (!replace) {
    next = fillEmptyFieldsFromRollup(parsed.fields, next);
  }
  const changed = Object.keys(next).filter(id => {
    const nv = (next[id] ?? '').trim();
    const ov = (parsed.fields[id] ?? '').trim();
    return nv && (replace || !ov) && nv !== ov;
  });
  if (changed.length === 0) {
    return ok(monthStart, '月刊空栏无需汇总写入');
  }
  await upsertMonthlyReviewJournal(monthStart, serializeReviewBody(next, parsed.meta));
  await requestPushPending();
  return ok(monthStart, `已汇总写入月刊 ${changed.length} 栏（${monthStart}）`);
}

export async function commitReviewSettings(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const parts: string[] = [];

  const weekdayRaw =
    draftNumber(draft, 'weekly_review_weekday') ??
    draftNumber(draft, 'weekday');
  if (weekdayRaw != null) {
    const n = Math.round(weekdayRaw);
    if (n < 0 || n > 6) return fail('invalid_weekday', '周复盘日须为 0–6');
    const { setWeeklyReviewConfiguredWeekday } = await import(
      '@/lib/weekly-review-settings'
    );
    await setWeeklyReviewConfiguredWeekday(n);
    const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    parts.push(`周复盘日=${labels[n]}`);
  }

  const dailyEnabled = draftBool(draft, 'daily_reminder_enabled');
  const dailyHour = draftNumber(draft, 'daily_reminder_hour');
  const dailyMinute = draftNumber(draft, 'daily_reminder_minute');
  if (dailyEnabled != null || dailyHour != null || dailyMinute != null) {
    const { getDailyReviewReminderSettings, setDailyReviewReminderSettings } =
      await import('@/lib/daily-review-reminder-settings');
    const prev = await getDailyReviewReminderSettings();
    const next = {
      enabled: dailyEnabled ?? prev.enabled,
      hour: dailyHour ?? prev.hour,
      minute: dailyMinute ?? prev.minute,
    };
    await setDailyReviewReminderSettings(next);
    parts.push(
      next.enabled
        ? `日提醒 ${next.hour}:${String(next.minute).padStart(2, '0')}`
        : '日提醒关',
    );
  }

  const weeklyEnabled = draftBool(draft, 'weekly_reminder_enabled');
  const weeklyHour = draftNumber(draft, 'weekly_reminder_hour');
  const weeklyMinute = draftNumber(draft, 'weekly_reminder_minute');
  if (weeklyEnabled != null || weeklyHour != null || weeklyMinute != null) {
    const { getWeeklyReviewReminderSettings, setWeeklyReviewReminderSettings } =
      await import('@/lib/weekly-review-reminder-settings');
    const prev = await getWeeklyReviewReminderSettings();
    const next = {
      enabled: weeklyEnabled ?? prev.enabled,
      hour: weeklyHour ?? prev.hour,
      minute: weeklyMinute ?? prev.minute,
    };
    await setWeeklyReviewReminderSettings(next);
    parts.push(
      next.enabled
        ? `周提醒 ${next.hour}:${String(next.minute).padStart(2, '0')}`
        : '周提醒关',
    );
  }

  const pointsEnabled = draftBool(draft, 'points_enabled');
  const dailyReward = draftNumber(draft, 'daily_reward_points');
  const streakBonus = draftNumber(draft, 'streak7_bonus_points');
  if (pointsEnabled != null || dailyReward != null || streakBonus != null) {
    const { loadReviewPointsSettings, saveReviewPointsSettings } = await import(
      '@/lib/review-points-settings'
    );
    const prev = await loadReviewPointsSettings();
    const next = {
      enabled: pointsEnabled ?? prev.enabled,
      dailyRewardPoints: dailyReward ?? prev.dailyRewardPoints,
      streak7BonusPoints: streakBonus ?? prev.streak7BonusPoints,
    };
    await saveReviewPointsSettings(next);
    parts.push(
      next.enabled
        ? `积分开 · 日${next.dailyRewardPoints}/七天${next.streak7BonusPoints}`
        : '积分关',
    );
  }

  if (parts.length === 0) {
    return fail('incomplete_draft', '缺少可写的复盘设置字段');
  }
  await requestPushPending();
  return ok('review_settings', `已更新复盘设置：${parts.join(' · ')}`);
}

export async function commitReviewDimensionDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const {
    listReviewDimensions,
    deleteReviewDimension,
  } = await import('@/lib/repositories/insights/review-template');
  const { isBuiltinReviewDimensionId } = await import(
    '@/lib/repositories/insights/review-template-defaults'
  );
  let id = draftString(draft, 'dimension_id') || draftString(draft, 'id');
  const title =
    draftString(draft, 'dimension_title') ||
    draftString(draft, 'title') ||
    draftString(draft, 'name');
  const scope = asScope(draft.scope);
  if (!id && title) {
    const dims = await listReviewDimensions(scope);
    const hit = dims.find(d => d.title.trim() === title.trim());
    id = hit?.id ?? '';
  }
  if (!id) return fail('missing_dimension', '找不到要删除的维度');
  if (isBuiltinReviewDimensionId(id)) {
    return fail('builtin_locked', '内置维度不可删除');
  }
  await deleteReviewDimension(id);
  await requestPushPending();
  return ok(id, `已删除复盘维度「${title || id}」`);
}

export async function commitReviewColumnDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const {
    listReviewTemplate,
    deleteReviewColumn,
  } = await import('@/lib/repositories/insights/review-template');
  const { isBuiltinReviewColumnId } = await import(
    '@/lib/repositories/insights/review-template-defaults'
  );
  let id = draftString(draft, 'column_id') || draftString(draft, 'id');
  const title =
    draftString(draft, 'column_title') ||
    draftString(draft, 'title') ||
    draftString(draft, 'name');
  const scope = asScope(draft.scope);
  const dimTitle = draftString(draft, 'dimension_title');
  if (!id && title) {
    const tpl = await listReviewTemplate(scope);
    for (const dim of tpl) {
      if (dimTitle && dim.title.trim() !== dimTitle.trim()) continue;
      const hit = dim.columns.find(c => c.title.trim() === title.trim());
      if (hit) {
        id = hit.id;
        break;
      }
    }
  }
  if (!id) return fail('missing_column', '找不到要删除的栏目');
  if (isBuiltinReviewColumnId(id)) {
    return fail('builtin_locked', '内置栏目不可删除');
  }
  await deleteReviewColumn(id);
  await requestPushPending();
  return ok(id, `已删除复盘栏目「${title || id}」`);
}

export const reviewCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_review_dimension: async input => commitReviewDimension(input.draft),
  commit_review_journal: async input => commitReviewJournal(input.draft),
  commit_review_column: async input => commitReviewColumn(input.draft),
  commit_review_fill_empty: async input => commitReviewFillEmpty(input.draft),
  commit_review_settings: async input => commitReviewSettings(input.draft),
  commit_review_dimension_delete: async input =>
    commitReviewDimensionDelete(input.draft),
  commit_review_column_delete: async input => commitReviewColumnDelete(input.draft),
};
