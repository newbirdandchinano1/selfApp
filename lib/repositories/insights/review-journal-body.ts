import {
  BUILTIN_REVIEW_COLUMN_IDS,
  LEGACY_MONTHLY_COLUMN_TO_BUILTIN,
  LEGACY_WEEKLY_COLUMN_IDS,
  LEGACY_WEEKLY_COLUMN_TO_BUILTIN,
  REVIEW_BUILTIN_MODULE_KEYS,
  builtinReviewColumnId,
  childToParentBuiltinColumnId,
} from './review-template-defaults';
import { reviewContentToPlainDisplay, reviewContentToPlainPreview } from '@/lib/review-journal-format';
import type { ReviewColumnTemplate, ReviewDimensionTemplate } from './review-template.types';
import type { WeeklyReviewJournalRow } from './weekly-review-journal.types';

export const REVIEW_BODY_VERSION = 2 as const;

export type ReviewFieldValues = Record<string, string>;

export type ReviewJournalMeta = {
  weather?: string;
  mood?: string;
  /** AI 分析正文（日/月复盘） */
  ai_analysis?: string;
};

export function emptyFieldValues(columnIds: string[]): ReviewFieldValues {
  const out: ReviewFieldValues = {};
  for (const id of columnIds) out[id] = '';
  return out;
}

export function mergeFieldValues(base: ReviewFieldValues, patch: ReviewFieldValues): ReviewFieldValues {
  return { ...base, ...patch };
}

export function collectColumnIds(template: ReviewDimensionTemplate[]): string[] {
  const ids: string[] = [];
  for (const dim of template) {
    for (const col of dim.columns) ids.push(col.id);
  }
  return ids;
}

export function serializeReviewBody(fields: ReviewFieldValues, meta?: ReviewJournalMeta): string {
  const payload: Record<string, unknown> = { v: REVIEW_BODY_VERSION, fields };
  if (meta && (meta.weather || meta.mood || meta.ai_analysis)) {
    payload.meta = meta;
  }
  return JSON.stringify(payload);
}

function parseReviewJournalMeta(raw: string | null | undefined): ReviewJournalMeta {
  if (!raw || !String(raw).trim()) return {};
  try {
    const o = JSON.parse(String(raw).trim()) as Record<string, unknown>;
    if (!o?.meta || typeof o.meta !== 'object') return {};
    const m = o.meta as Record<string, unknown>;
    const meta: ReviewJournalMeta = {};
    if (m.weather != null) meta.weather = String(m.weather);
    if (m.mood != null) meta.mood = String(m.mood);
    if (m.ai_analysis != null) meta.ai_analysis = String(m.ai_analysis);
    return meta;
  } catch {
    return {};
  }
}

export function parseDailyReviewJournal(
  raw: string | null | undefined,
  columnIds: string[],
): { fields: ReviewFieldValues; meta: ReviewJournalMeta } {
  return {
    fields: parseDailyReviewBody(raw, columnIds),
    meta: parseReviewJournalMeta(raw),
  };
}

/** 解析日复盘 body；兼容 v1 固定键与纯文本 */
export function parseDailyReviewBody(raw: string | null | undefined, columnIds: string[]): ReviewFieldValues {
  const empty = emptyFieldValues(columnIds);
  if (!raw || !String(raw).trim()) return empty;

  const s = String(raw).trim();
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    if (o && typeof o === 'object') {
      if (o.v === REVIEW_BODY_VERSION && o.fields && typeof o.fields === 'object') {
        const fields = o.fields as Record<string, unknown>;
        const out = { ...empty };
        for (const id of columnIds) {
          if (fields[id] != null) out[id] = String(fields[id]);
        }
        return out;
      }
      if (o.v === 1) {
        const out = { ...empty };
        for (const id of columnIds) {
          if (o[id] != null) out[id] = String(o[id]);
        }
        return out;
      }
    }
  } catch {
    // 旧版整段纯文本：写入第一个栏目
  }

  if (columnIds.length > 0) {
    return { ...empty, [columnIds[0]]: s };
  }
  return empty;
}

function migrateLegacyFieldsIntoBuiltin(
  fields: ReviewFieldValues,
  rawFields: Record<string, unknown>,
  mapping: Record<string, string>,
): ReviewFieldValues {
  const out = { ...fields };
  const initiallyFilled = new Set(
    Object.entries(out)
      .filter(([, v]) => (v ?? '').trim())
      .map(([id]) => id),
  );
  for (const [legacyId, builtinId] of Object.entries(mapping)) {
    if (!(builtinId in out)) continue;
    if (initiallyFilled.has(builtinId)) continue;
    const raw = rawFields[legacyId];
    if (raw == null) continue;
    const text = String(raw).trim();
    if (!text) continue;
    const prev = (out[builtinId] ?? '').trim();
    out[builtinId] = prev ? `${prev}\n\n${text}` : text;
  }
  return out;
}

export function parseWeeklyReviewFields(
  row: WeeklyReviewJournalRow | null,
  columnIds: string[],
): ReviewFieldValues {
  const empty = emptyFieldValues(columnIds);
  if (!row) return empty;

  let rawFields: Record<string, unknown> = {};
  if (row.extra_data) {
    try {
      const o = JSON.parse(row.extra_data) as Record<string, unknown>;
      if (o?.body_v === REVIEW_BODY_VERSION && o.fields && typeof o.fields === 'object') {
        rawFields = o.fields as Record<string, unknown>;
        const out = { ...empty };
        for (const id of columnIds) {
          if (rawFields[id] != null) out[id] = String(rawFields[id]);
        }
        return migrateLegacyFieldsIntoBuiltin(out, rawFields, LEGACY_WEEKLY_COLUMN_TO_BUILTIN);
      }
    } catch {
      // fall through
    }
  }

  rawFields = {
    [LEGACY_WEEKLY_COLUMN_IDS.section_summary]: row.section_summary ?? '',
    [LEGACY_WEEKLY_COLUMN_IDS.section_plans]: row.section_plans ?? '',
    [LEGACY_WEEKLY_COLUMN_IDS.section_reflect]: row.section_reflect ?? '',
    [LEGACY_WEEKLY_COLUMN_IDS.section_learnings]: row.section_learnings ?? '',
    [LEGACY_WEEKLY_COLUMN_IDS.section_next_week]: row.section_next_week ?? '',
  };
  return migrateLegacyFieldsIntoBuiltin(empty, rawFields, LEGACY_WEEKLY_COLUMN_TO_BUILTIN);
}

/** 解析月复盘时把旧栏目内容迁入新内置栏（仅空栏） */
export function migrateMonthlyLegacyFields(
  fields: ReviewFieldValues,
  rawBody: string | null | undefined,
): ReviewFieldValues {
  if (!rawBody || !String(rawBody).trim()) return fields;
  try {
    const o = JSON.parse(String(rawBody).trim()) as Record<string, unknown>;
    if (!o?.fields || typeof o.fields !== 'object') return fields;
    return migrateLegacyFieldsIntoBuiltin(
      fields,
      o.fields as Record<string, unknown>,
      LEGACY_MONTHLY_COLUMN_TO_BUILTIN,
    );
  } catch {
    return fields;
  }
}

export type ReviewRollupChildEntry = {
  label: string;
  fields: ReviewFieldValues;
};

/**
 * 将子周期（日→周 / 周→月）同名内置栏目汇总为父周期默认正文。
 * 格式：【标签】\n正文，多天/周之间空行分隔；跳过空栏目。
 */
export function aggregateBuiltinFieldsFromChildren(opts: {
  children: ReviewRollupChildEntry[];
  childScope: 'daily' | 'weekly';
  parentScope: 'weekly' | 'monthly';
}): ReviewFieldValues {
  const out: ReviewFieldValues = {};
  for (const key of REVIEW_BUILTIN_MODULE_KEYS) {
    out[builtinReviewColumnId(opts.parentScope, key)] = '';
  }

  for (const key of REVIEW_BUILTIN_MODULE_KEYS) {
    const parentId = builtinReviewColumnId(opts.parentScope, key);
    const childId = builtinReviewColumnId(opts.childScope, key);
    const blocks: string[] = [];
    for (const child of opts.children) {
      const raw = (child.fields[childId] ?? '').trim();
      if (!raw) continue;
      const plain = reviewContentToPlainDisplay(raw).trim() || reviewContentToPlainPreview(raw).trim();
      if (!plain) continue;
      blocks.push(`【${child.label}】\n${plain}`);
    }
    out[parentId] = blocks.join('\n\n');
  }
  return out;
}

/** 仅用汇总填充当前为空的栏目；已有内容（含用户手写）不动 */
export function fillEmptyFieldsFromRollup(
  fields: ReviewFieldValues,
  rollup: ReviewFieldValues,
): ReviewFieldValues {
  const out = { ...fields };
  for (const [id, value] of Object.entries(rollup)) {
    if (!(id in out)) out[id] = '';
    if ((out[id] ?? '').trim()) continue;
    const v = (value ?? '').trim();
    if (!v) continue;
    out[id] = value;
  }
  return out;
}

export function hasAnyFilledField(fields: ReviewFieldValues): boolean {
  return Object.values(fields).some(v => (v ?? '').trim().length > 0);
}

/** 周复盘 legacy 列：尽量从新内置栏回填，便于旧端兼容 */
export function legacyWeeklyColumnsFromFields(fields: ReviewFieldValues): {
  section_summary: string;
  section_plans: string;
  section_reflect: string;
  section_learnings: string;
  section_next_week: string;
} {
  const w = BUILTIN_REVIEW_COLUMN_IDS.weekly;
  return {
    section_summary:
      fields[LEGACY_WEEKLY_COLUMN_IDS.section_summary] || fields[w.routine] || '',
    section_plans: fields[LEGACY_WEEKLY_COLUMN_IDS.section_plans] || fields[w.tasks] || '',
    section_reflect: fields[LEGACY_WEEKLY_COLUMN_IDS.section_reflect] || fields[w.defects] || '',
    section_learnings:
      fields[LEGACY_WEEKLY_COLUMN_IDS.section_learnings] || fields[w.ideas] || '',
    section_next_week:
      fields[LEGACY_WEEKLY_COLUMN_IDS.section_next_week] || fields[w.routine] || '',
  };
}

// re-export for callers that build parent maps
export { childToParentBuiltinColumnId };

export function serializeWeeklyReviewExtraData(fields: ReviewFieldValues): string {
  return JSON.stringify({ body_v: REVIEW_BODY_VERSION, fields });
}

export function buildDailyDigest(
  entries: { label: string; fields: ReviewFieldValues }[],
  template: ReviewDimensionTemplate[],
): string {
  const labelByCol = new Map<string, string>();
  for (const dim of template) {
    for (const col of dim.columns) labelByCol.set(col.id, col.title);
  }

  const blocks: string[] = [];
  for (const e of entries) {
    const parts: string[] = [];
    for (const [colId, value] of Object.entries(e.fields)) {
      const v = value.trim();
      if (!v) continue;
      const lab = labelByCol.get(colId) ?? colId;
      parts.push(`${lab}：${v}`);
    }
    if (parts.length === 0) continue;
    blocks.push(`【${e.label}】\n${parts.join('\n')}`);
  }
  return blocks.join('\n\n');
}

export function previewTextFromFields(
  fields: ReviewFieldValues,
  columns: ReviewColumnTemplate[],
): string {
  const bits = columns
    .map(c => reviewContentToPlainPreview(fields[c.id] ?? ''))
    .filter(Boolean);
  return bits.join(' · ');
}

export type FilledReviewField = {
  columnId: string;
  columnTitle: string;
  dimensionTitle: string;
  value: string;
};

/** 按模板顺序提取已填写的栏目，便于结构化展示 */
export function getFilledFieldsFromTemplate(
  fields: ReviewFieldValues,
  template: ReviewDimensionTemplate[],
): FilledReviewField[] {
  const result: FilledReviewField[] = [];
  for (const dim of template) {
    for (const col of dim.columns) {
      const value = (fields[col.id] ?? '').trim();
      if (!value) continue;
      result.push({
        columnId: col.id,
        columnTitle: col.title,
        dimensionTitle: dim.title,
        value,
      });
    }
  }
  return result;
}

export function totalFilledLength(fields: ReviewFieldValues): number {
  return Object.values(fields).reduce((n, v) => n + v.length, 0);
}
