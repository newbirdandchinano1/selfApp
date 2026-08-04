import { parseVisionExtra, serializeVisionExtra } from '@/lib/repositories/visions/vision';
import { formatVisionAmountStored, parseVisionAmountInput } from '@/lib/repositories/visions/vision-amount';
import type { UpdateVisionInput, VisionExtraPayload, VisionRow, VisionSubGoal } from '@/lib/repositories/visions/vision.types';
import {
  collectVisionSubGoalsFromExtra,
  serializeVisionSubGoalsForExtra,
} from '@/lib/repositories/visions/vision.types';

/** 内置背景图数量；`bg_option_idx === 该值` 表示自定义封面槽位 */
export const VISION_BUILTIN_BG_COUNT = 3;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addLocalDays(base: Date, delta: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date | null {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : startOfLocalDay(dt);
}

export function clampEndDateToKind(iso: string, kind: 'countdown' | 'countup'): string {
  const today = startOfLocalDay(new Date());
  const parsed = parseYmd(iso);
  if (kind === 'countdown') {
    const min = addLocalDays(today, 1);
    if (!parsed || parsed <= today) return formatYmd(min);
    return formatYmd(parsed);
  }
  const max = addLocalDays(today, -1);
  if (!parsed || parsed >= today) return formatYmd(max);
  return formatYmd(parsed);
}

export function defaultEndDateForKind(kind: 'countdown' | 'countup'): string {
  const today = startOfLocalDay(new Date());
  return kind === 'countdown' ? formatYmd(addLocalDays(today, 1)) : formatYmd(addLocalDays(today, -1));
}

export type VisionEditDraft = {
  bgIdx: number;
  customBgUri: string | null;
  direction: 'positive' | 'negative';
  goalTotal: string;
  currentAmount: string;
  unit: string;
  countFrequency: NonNullable<VisionExtraPayload['countFrequency']>;
  countStep: string;
  countUnit: string;
  countdownKind: 'countdown' | 'countup';
  endDate: string;
  dateFormat: NonNullable<VisionExtraPayload['dateFormat']>;
  subGoals: VisionSubGoal[];
};

function normalizeBgIdx(idx: number): number {
  if (idx >= 0 && idx <= VISION_BUILTIN_BG_COUNT) return idx;
  return 0;
}

export function draftFromRow(row: VisionRow): VisionEditDraft {
  const extra = parseVisionExtra(row.extra_data) ?? {};
  const bgIdx = normalizeBgIdx(row.bg_option_idx);
  const isCustom = bgIdx === VISION_BUILTIN_BG_COUNT;
  const ck = extra.countdownKind === 'countup' ? 'countup' : 'countdown';
  const endRaw = extra.endDate?.trim() || defaultEndDateForKind(ck);
  return {
    bgIdx,
    customBgUri: isCustom ? (extra.customBgUri?.trim() ?? null) : null,
    direction: row.direction === 'negative' ? 'negative' : 'positive',
    goalTotal: extra.goalTotal ?? '100',
    currentAmount: extra.currentAmount ?? '0',
    unit: extra.unit ?? '',
    countFrequency: extra.countFrequency ?? 'daily',
    countStep: extra.countStep ?? '1',
    countUnit: extra.countUnit ?? '次',
    countdownKind: ck,
    endDate: clampEndDateToKind(endRaw, ck),
    dateFormat: (extra.dateFormat ?? 'ymd') as VisionEditDraft['dateFormat'],
    subGoals: collectVisionSubGoalsFromExtra(extra),
  };
}

export function validateAndBuildVisionUpdate(
  row: VisionRow,
  d: VisionEditDraft,
  title: string,
  descriptionTrimmed: string | null
): { ok: true; input: UpdateVisionInput } | { ok: false; message: string } {
  const base = parseVisionExtra(row.extra_data) ?? {};
  const extra: VisionExtraPayload = { ...base };

  if (d.bgIdx === VISION_BUILTIN_BG_COUNT) {
    const u = d.customBgUri?.trim();
    if (!u) return { ok: false, message: '请选择自定义封面图片，或改用上方预设背景。' };
    extra.customBgUri = u;
  } else {
    delete extra.customBgUri;
  }

  let direction: VisionRow['direction'] = row.direction;

  switch (row.track_kind) {
    case 'progress': {
      const g = Number(d.goalTotal);
      if (!Number.isFinite(g) || g <= 0) return { ok: false, message: '目标总量需为大于 0 的数字。' };
      const cur = parseVisionAmountInput(d.currentAmount);
      if (cur === null) return { ok: false, message: '当前完成值需为不小于 0 的数字，最多两位小数。' };
      extra.goalTotal = d.goalTotal.trim();
      extra.currentAmount = formatVisionAmountStored(cur);
      extra.unit = d.unit.trim();
      delete extra.step;
      direction = d.direction;
      break;
    }
    case 'count': {
      extra.countFrequency = d.countFrequency;
      extra.countStep = d.countStep.trim() || '1';
      extra.countUnit = d.countUnit.trim() || '次';
      direction = null;
      break;
    }
    case 'countdown': {
      const clamped = clampEndDateToKind(d.endDate.trim(), d.countdownKind);
      if (!parseYmd(clamped)) return { ok: false, message: '请填写有效的日期（YYYY-MM-DD）。' };
      extra.countdownKind = d.countdownKind;
      extra.endDate = clamped;
      extra.dateFormat = d.dateFormat;
      direction = null;
      break;
    }
    case 'target': {
      const emptyNames = d.subGoals.some(
        sg =>
          !sg.name.trim() &&
          (sg.description?.trim() || (sg.linkedProjects?.length ?? 0) > 0)
      );
      if (emptyNames) {
        return { ok: false, message: '已填写简介或绑定项目的小目标须填写名称。' };
      }
      const serialized = serializeVisionSubGoalsForExtra(d.subGoals);
      if (serialized.length > 0) {
        extra.subGoals = serialized;
      } else {
        delete extra.subGoals;
      }
      delete extra.linkedProjects;
      delete extra.linkedProjectId;
      delete extra.linkedProjectName;
      direction = null;
      break;
    }
    default:
      direction = row.direction;
  }

  const extra_data = serializeVisionExtra(extra);

  return {
    ok: true,
    input: {
      title,
      description: descriptionTrimmed,
      direction,
      bg_option_idx: d.bgIdx,
      extra_data,
    },
  };
}
