import type {
  ProfileVisionCarouselItem,
  VisionCardImageSource,
  VisionRecord,
  VisionWallCardModel,
  VisionWallFields,
} from '@/lib/visions-registry';
import { getTaskCompletionStatsByProjectIds } from '@/lib/repositories/tasks/task';
import {
  collectVisionLinkedProjectsFromExtra,
  type VisionExtraPayload,
  type VisionRow,
  type VisionTrackKind,
} from './vision.types';
import { parseVisionExtra } from './vision';

/** 关联项目下的任务完成统计，用于「目标」类愿景 */
export type LinkedTargetTaskProgress = { total: number; completed: number } | null;

const bg1 = require('../../../assets/vision-bg/bg1.png');
const bg2 = require('../../../assets/vision-bg/bg2.png');
const bg3 = require('../../../assets/vision-bg/bg3.png');

const BG_SOURCES = [bg1, bg2, bg3] as const;

export function resolveVisionBgSource(bg_option_idx: number): number {
  if (bg_option_idx >= 0 && bg_option_idx < BG_SOURCES.length) {
    return BG_SOURCES[bg_option_idx];
  }
  return bg1;
}

/** 内置背景数量；`bg_option_idx === 内置数量` 表示「自定义封面」槽位 */
const VISION_PRESET_BG_COUNT = BG_SOURCES.length;

export function resolveVisionBgImageSource(
  bg_option_idx: number,
  extra: VisionExtraPayload | null | undefined
): VisionCardImageSource {
  if (bg_option_idx === VISION_PRESET_BG_COUNT) {
    const u = extra?.customBgUri?.trim();
    if (u) return { uri: u };
    return bg1;
  }
  if (bg_option_idx >= 0 && bg_option_idx < VISION_PRESET_BG_COUNT) {
    return BG_SOURCES[bg_option_idx];
  }
  return bg1;
}

function formatVisionAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  const t = n.toFixed(4).replace(/\.?0+$/, '');
  return t || '0';
}

function freqLabel(f?: VisionExtraPayload['countFrequency']): string {
  switch (f) {
    case 'daily':
      return '每日';
    case 'weekly':
      return '每周';
    case 'monthly':
      return '每月';
    default:
      return '计数';
  }
}

function detailKickerFor(kind: VisionTrackKind): string {
  const m: Record<VisionTrackKind, string> = {
    progress: '进度追踪',
    count: '计数习惯',
    countdown: '时间节点',
    target: '目标达成',
  };
  return m[kind];
}

function localMidnightFromYmd(ymd: string): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd.trim())) return null;
  const [ys, ms, ds] = ymd.trim().split('-').map(Number);
  const t = new Date(ys, ms - 1, ds);
  t.setHours(0, 0, 0, 0);
  if (t.getFullYear() !== ys || t.getMonth() !== ms - 1 || t.getDate() !== ds) return null;
  return t;
}

function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** 两个本地零点日期之间相差的整日历天数（late − early） */
function calendarDaysBetween(early: Date, late: Date): number {
  return Math.round((late.getTime() - early.getTime()) / 86400000);
}

/** early ≤ late，按日历字段求年月日差 */
function diffYmdEarlyToLate(early: Date, late: Date): { y: number; m: number; d: number } {
  let y = late.getFullYear() - early.getFullYear();
  let m = late.getMonth() - early.getMonth();
  let d = late.getDate() - early.getDate();
  if (d < 0) {
    m -= 1;
    d += new Date(late.getFullYear(), late.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  return { y, m, d };
}

function joinYmdParts(prefix: string, diff: { y: number; m: number; d: number }): string {
  const parts: string[] = [];
  if (diff.y > 0) parts.push(`${diff.y} 年`);
  if (diff.m > 0) parts.push(`${diff.m} 个月`);
  if (diff.d > 0) parts.push(`${diff.d} 天`);
  if (parts.length === 0) return `${prefix} 0 天`;
  return `${prefix} ${parts.join('')}`;
}

function formatByKind(
  prefix: string,
  totalDays: number,
  diff: { y: number; m: number; d: number },
  fmt: NonNullable<VisionExtraPayload['dateFormat']>
): string {
  switch (fmt) {
    case 'day':
      return `${prefix} ${totalDays} 天`;
    case 'week': {
      const w = Math.max(1, Math.ceil(totalDays / 7));
      return `${prefix} ${w} 周`;
    }
    case 'month': {
      const months = diff.y * 12 + diff.m;
      if (months > 0 && diff.d > 0) return `${prefix} ${months} 个月 ${diff.d} 天`;
      if (months > 0) return `${prefix} ${months} 个月`;
      return `${prefix} ${diff.d} 天`;
    }
    case 'year': {
      if (diff.y > 0) {
        const tail: string[] = [];
        if (diff.m > 0) tail.push(`${diff.m} 个月`);
        if (diff.d > 0) tail.push(`${diff.d} 天`);
        return tail.length ? `${prefix} ${diff.y} 年 ${tail.join(' ')}` : `${prefix} ${diff.y} 年`;
      }
      if (diff.m > 0 || diff.d > 0) return joinYmdParts(prefix, { y: 0, m: diff.m, d: diff.d });
      return `${prefix} 0 天`;
    }
    case 'ymd':
    default:
      return joinYmdParts(prefix, diff);
  }
}

/**
 * 按创建时「显示格式」生成剩余/已过期/已过去文案（墙卡 remainText）。
 * 截止日期本身仍用原始 YYYY-MM-DD 展示。
 */
export function formatVisionCountdownRemainDisplay(
  endDateStr: string | undefined,
  dateFormat: VisionExtraPayload['dateFormat'] | undefined,
  kind: 'countdown' | 'countup'
): string {
  const end = localMidnightFromYmd(endDateStr ?? '');
  if (!end) return '—';
  const today = startOfToday();
  const fmt = (dateFormat ?? 'ymd') as NonNullable<VisionExtraPayload['dateFormat']>;

  if (kind === 'countup') {
    const days = calendarDaysBetween(end, today);
    if (days < 0) return '—';
    if (days === 0) return '从今天开始';
    const diff = diffYmdEarlyToLate(end, today);
    return formatByKind('已过去', days, diff, fmt);
  }

  const ahead = calendarDaysBetween(today, end);
  if (ahead === 0) return '今天截止';
  if (ahead > 0) {
    const diff = diffYmdEarlyToLate(today, end);
    return formatByKind('还有', ahead, diff, fmt);
  }
  const past = calendarDaysBetween(end, today);
  const diff = diffYmdEarlyToLate(end, today);
  return formatByKind('已过期', past, diff, fmt);
}

/** @deprecated 语义并入 formatVisionCountdownRemainDisplay；保留兼容，等价于「按天」 */
export function countdownRemainLabel(endDateStr: string | undefined): string {
  return formatVisionCountdownRemainDisplay(endDateStr, 'day', 'countdown');
}

/** @deprecated 语义并入 formatVisionCountdownRemainDisplay；保留兼容，等价于「按天」 */
export function countupElapsedLabel(endDateStr: string | undefined): string {
  return formatVisionCountdownRemainDisplay(endDateStr, 'day', 'countup');
}

async function resolveLinkedTargetProgress(
  row: VisionRow,
  extra: VisionExtraPayload
): Promise<LinkedTargetTaskProgress> {
  if (row.track_kind !== 'target') return null;
  const ids = collectVisionLinkedProjectsFromExtra(extra).map(p => p.id);
  if (ids.length === 0) return null;
  return getTaskCompletionStatsByProjectIds(ids);
}

function wallFieldsFromRow(
  row: VisionRow,
  extra: VisionExtraPayload,
  linkedTaskProgress: LinkedTargetTaskProgress
): VisionWallFields {
  const unitSuffix = extra.unit ? ` ${extra.unit}` : '';

  switch (row.track_kind) {
    case 'progress': {
      const goal = Number(extra.goalTotal);
      const safeGoal = Number.isFinite(goal) && goal > 0 ? goal : 100;
      const cur = Math.max(0, Number(extra.currentAmount ?? 0) || 0);
      const stepNum = Math.max(0.0001, Number(extra.step) || 1);
      const isNeg = row.direction === 'negative';
      const rightMain = isNeg
        ? `剩余 ${formatVisionAmount(Math.max(0, safeGoal - cur))} / ${formatVisionAmount(safeGoal)}${unitSuffix}`
        : `已完成 ${formatVisionAmount(cur)} / ${formatVisionAmount(safeGoal)}${unitSuffix}`;
      return {
        kind: 'progress',
        title: row.title,
        leftKicker: '本周进度',
        leftValue: '待记录',
        rightKicker: '当前总量',
        rightValue: rightMain,
        wallAdjust: { current: cur, step: stepNum },
      };
    }
    case 'count': {
      const stepNum = Math.max(0.0001, Number(extra.countStep) || 1);
      const cur = Math.max(0, Number(extra.currentAmount ?? 0) || 0);
      const unit = extra.countUnit?.trim() || '次';
      return {
        kind: 'count',
        title: row.title,
        leftKicker: '当前累计',
        leftValue: `${formatVisionAmount(cur)} ${unit}`.trim(),
        rightKicker: '频率 · 单次',
        rightValue: `${freqLabel(extra.countFrequency)} · ${stepNum} ${unit}`,
        wallAdjust: { current: cur, step: stepNum },
      };
    }
    case 'target': {
      const goalNum = Number(extra.goalTotal);
      const safeGoal = Number.isFinite(goalNum) && goalNum > 0 ? goalNum : 100;
      const stepNum = Math.max(0.0001, Number(extra.step) || 1);
      const cur = Math.max(0, Number(extra.currentAmount ?? 0) || 0);

      if (linkedTaskProgress && linkedTaskProgress.total > 0) {
        const pct = linkedTaskProgress.completed / linkedTaskProgress.total;
        return {
          kind: 'target',
          title: row.title,
          percentText: `${Math.round(pct * 100)}%`,
          percent: pct,
          taskProgressOnly: true,
          wallAdjust: { current: cur, step: stepNum },
        };
      }

      const pctManual = Math.min(1, safeGoal > 0 ? cur / safeGoal : 0);
      return {
        kind: 'target',
        title: row.title,
        percentText: `${Math.round(pctManual * 100)}%`,
        percent: pctManual,
        taskProgressOnly: false,
        wallAdjust: { current: cur, step: stepNum },
      };
    }
    case 'countdown': {
      const dateText = extra.endDate ?? '—';
      const ck = extra.countdownKind === 'countup' ? 'countup' : 'countdown';
      return {
        kind: 'countdown',
        title: row.title,
        dateText,
        remainText: formatVisionCountdownRemainDisplay(extra.endDate, extra.dateFormat, ck),
        countdownKind: ck,
      };
    }
    default:
      return {
        kind: 'progress',
        title: row.title,
        leftKicker: '本周进度',
        leftValue: '—',
        rightKicker: '当前总量',
        rightValue: '—',
      };
  }
}

export async function visionRowToWallCard(row: VisionRow): Promise<VisionWallCardModel> {
  const extra = parseVisionExtra(row.extra_data) ?? {};
  const linked = await resolveLinkedTargetProgress(row, extra);
  const wall = wallFieldsFromRow(row, extra, linked);
  const imageSource = resolveVisionBgImageSource(row.bg_option_idx, extra);
  return { ...wall, imageSource } as VisionWallCardModel;
}

export async function visionRowToProfileCarouselItem(
  row: VisionRow,
  preloadedLinked?: LinkedTargetTaskProgress
): Promise<ProfileVisionCarouselItem> {
  const extra = parseVisionExtra(row.extra_data) ?? {};
  const year = row.created_at.slice(0, 10).slice(0, 4);
  const kickerMap: Record<VisionTrackKind, string> = {
    progress: '进度追踪',
    count: '计数',
    countdown: '倒数日',
    target: '目标',
  };

  const unitSuffix = extra.unit ? ` ${extra.unit}` : '';
  let progressText = '';
  let progressPct = 0;

  const linked =
    preloadedLinked !== undefined ? preloadedLinked : await resolveLinkedTargetProgress(row, extra);

  switch (row.track_kind) {
    case 'progress':
      progressText = `总量 ${extra.goalTotal ?? '—'}${unitSuffix} · 待更新`;
      break;
    case 'target': {
      const linkedCount = collectVisionLinkedProjectsFromExtra(extra).length;
      if (linkedCount > 0 && linked && linked.total > 0) {
        progressText =
          linkedCount > 1
            ? `已关联 ${linkedCount} 个项目 · 任务 ${linked.completed} / ${linked.total}`
            : `项目任务 ${linked.completed} / ${linked.total}`;
        progressPct = Math.round((linked.completed / linked.total) * 100);
      } else if (linkedCount > 0) {
        progressText = `已关联 ${linkedCount} 个项目，暂无统计任务`;
      } else {
        progressText = `目标 ${extra.goalTotal ?? '—'}${unitSuffix}`;
      }
      break;
    }
    case 'count':
      progressText = `${freqLabel(extra.countFrequency)} · ${extra.countStep ?? '1'}${extra.countUnit ?? '次'}`;
      break;
    case 'countdown':
      progressText = extra.endDate ? `截止 ${extra.endDate}` : '倒数日';
      break;
    default:
      progressText = '';
  }

  return {
    id: row.id,
    kicker: kickerMap[row.track_kind],
    title: row.title,
    progressText,
    progress: progressPct,
    year,
  };
}

export async function visionRowToDetailRecord(row: VisionRow): Promise<VisionRecord> {
  const extra = parseVisionExtra(row.extra_data) ?? {};
  const imageSource = resolveVisionBgImageSource(row.bg_option_idx, extra);
  const linked = await resolveLinkedTargetProgress(row, extra);
  const wall = wallFieldsFromRow(row, extra, linked);
  const carousel = await visionRowToProfileCarouselItem(row, linked);

  return {
    id: row.id,
    kind: row.track_kind,
    title: row.title,
    imageSource,
    profile: {
      kicker: carousel.kicker,
      year: carousel.year,
      progressPercent: carousel.progress,
      progressText: carousel.progressText,
    },
    detailKicker: detailKickerFor(row.track_kind),
    description: row.description?.trim() || '暂无描述',
    wall,
    milestones: undefined,
  };
}
