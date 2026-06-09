import { LEGACY_WEEKLY_COLUMN_IDS } from './review-template-defaults';
import type { ReviewColumnTemplate, ReviewDimensionTemplate } from './review-template.types';
import type { WeeklyReviewJournalRow } from './weekly-review-journal.types';

export const REVIEW_BODY_VERSION = 2 as const;

export type ReviewFieldValues = Record<string, string>;

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

export function serializeReviewBody(fields: ReviewFieldValues): string {
  return JSON.stringify({ v: REVIEW_BODY_VERSION, fields });
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

export function parseWeeklyReviewFields(
  row: WeeklyReviewJournalRow | null,
  columnIds: string[],
): ReviewFieldValues {
  const empty = emptyFieldValues(columnIds);
  if (!row) return empty;

  if (row.extra_data) {
    try {
      const o = JSON.parse(row.extra_data) as Record<string, unknown>;
      if (o?.body_v === REVIEW_BODY_VERSION && o.fields && typeof o.fields === 'object') {
        const fields = o.fields as Record<string, unknown>;
        const out = { ...empty };
        for (const id of columnIds) {
          if (fields[id] != null) out[id] = String(fields[id]);
        }
        return out;
      }
    } catch {
      // fall through
    }
  }

  const legacy: ReviewFieldValues = { ...empty };
  legacy[LEGACY_WEEKLY_COLUMN_IDS.section_summary] = row.section_summary ?? '';
  legacy[LEGACY_WEEKLY_COLUMN_IDS.section_plans] = row.section_plans ?? '';
  legacy[LEGACY_WEEKLY_COLUMN_IDS.section_reflect] = row.section_reflect ?? '';
  legacy[LEGACY_WEEKLY_COLUMN_IDS.section_learnings] = row.section_learnings ?? '';
  legacy[LEGACY_WEEKLY_COLUMN_IDS.section_next_week] = row.section_next_week ?? '';
  return legacy;
}

export function serializeWeeklyReviewExtraData(fields: ReviewFieldValues): string {
  return JSON.stringify({ body_v: REVIEW_BODY_VERSION, fields });
}

/** 将动态字段写回旧版周记列（与默认栏目 ID 对齐时） */
export function legacyWeeklyColumnsFromFields(fields: ReviewFieldValues): {
  section_summary: string;
  section_plans: string;
  section_reflect: string;
  section_learnings: string;
  section_next_week: string;
} {
  return {
    section_summary: fields[LEGACY_WEEKLY_COLUMN_IDS.section_summary] ?? '',
    section_plans: fields[LEGACY_WEEKLY_COLUMN_IDS.section_plans] ?? '',
    section_reflect: fields[LEGACY_WEEKLY_COLUMN_IDS.section_reflect] ?? '',
    section_learnings: fields[LEGACY_WEEKLY_COLUMN_IDS.section_learnings] ?? '',
    section_next_week: fields[LEGACY_WEEKLY_COLUMN_IDS.section_next_week] ?? '',
  };
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
    .map(c => fields[c.id]?.trim().replace(/\s+/g, ' ') ?? '')
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
