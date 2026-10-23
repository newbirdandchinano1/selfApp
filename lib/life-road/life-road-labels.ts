/**
 * 道路功能用户可见文案（与饮食 goal / 长期项目开关区分）。
 */
import type { LifeBetDerivedStats } from '@/lib/life-road/life-road-derived';
import type { LifeBetHorizon, LifeBetStatus } from '@/lib/life-road/life-road-limits';

export const LIFE_BET_HORIZON_LABELS: Record<LifeBetHorizon, string> = {
  year: '今年',
  multi: '多年',
  farther: '更远',
};

export const LIFE_BET_STATUS_LABELS: Record<LifeBetStatus, string> = {
  on_track: '在路上',
  paused: '暂搁',
  arrived: '已完成',
  dropped: '已放弃',
};

/** 道路列表行 meta：年份 · 关联项目 · 派生备注 */
export function formatLifeBetListMeta(
  bet: { year: number | null; status: LifeBetStatus },
  stats: Pick<LifeBetDerivedStats, 'activeProjectCount' | 'latestCompletedName' | 'isEmptyWindow'>,
  progressPct?: number | null,
): string {
  const parts: string[] = [];
  if (bet.year != null) parts.push(String(bet.year));
  if (stats.activeProjectCount != null) {
    parts.push(
      stats.activeProjectCount > 0
        ? `关联项目 ${stats.activeProjectCount} 个`
        : stats.isEmptyWindow
          ? '暂无项目'
          : '关联项目 0 个',
    );
  }
  if (progressPct != null && Number.isFinite(progressPct) && bet.status !== 'dropped') {
    parts.push(`${Math.round(Math.max(0, Math.min(100, progressPct)))}%`);
  } else if (stats.latestCompletedName) {
    parts.push(`最近「${stats.latestCompletedName}」`);
  }
  return parts.length > 0 ? parts.join(' · ') : formatLifeBetDerivedCaption(stats);
}

/** Fold 态状态色（对齐设计稿 bs-road / bs-pause / bs-done） */
export function lifeBetFoldStatusTone(
  status: LifeBetStatus,
  fold: {
    sage2: string;
    pine2: string;
    amber2: string;
    amber: string;
    paper2: string;
    muted: string;
    clay2: string;
    clay: string;
  },
): { bg: string; text: string } {
  switch (status) {
    case 'on_track':
      return { bg: '#E3EFE6', text: '#3C614F' };
    case 'paused':
      return { bg: '#F3E7D3', text: '#8A6222' };
    case 'arrived':
      return { bg: '#E6E9E1', text: '#6E7A6F' };
    case 'dropped':
      return { bg: fold.clay2, text: fold.clay };
    default:
      return { bg: fold.paper2, text: fold.muted };
  }
}

/** 状态徽标色：沿用任务页 wash，不引入新品牌色 */
export function lifeBetStatusTone(
  status: LifeBetStatus,
  taskUi: {
    successWash: string;
    successWashBorder: string;
    primaryWash: string;
    primaryWashBorder: string;
    dangerSoftWash: string;
    dangerSoftBorder: string;
    shelvedSurface: string;
    hairline: string;
  },
  colors: { secondary: string; primary: string; textSecondary: string; danger: string; outline: string },
): { bg: string; border: string; text: string } {
  switch (status) {
    case 'on_track':
      return {
        bg: taskUi.successWash,
        border: taskUi.successWashBorder,
        text: colors.secondary,
      };
    case 'paused':
      return {
        bg: taskUi.shelvedSurface,
        border: taskUi.hairline,
        text: colors.textSecondary,
      };
    case 'arrived':
      return {
        bg: taskUi.primaryWash,
        border: taskUi.primaryWashBorder,
        text: colors.primary,
      };
    case 'dropped':
      return {
        bg: taskUi.dangerSoftWash,
        border: taskUi.dangerSoftBorder,
        text: colors.danger,
      };
    default:
      return {
        bg: taskUi.primaryWash,
        border: colors.outline,
        text: colors.textSecondary,
      };
  }
}

/**
 * 卡片/列表派生一行：失败为「—」；空窗「暂无项目」；否则项目数与最近完成。
 */
export function formatLifeBetDerivedCaption(
  stats: Pick<LifeBetDerivedStats, 'activeProjectCount' | 'latestCompletedName' | 'isEmptyWindow'>,
  opts?: { preferStatusLabel?: LifeBetStatus },
): string {
  if (opts?.preferStatusLabel && opts.preferStatusLabel !== 'on_track') {
    const statusLabel = LIFE_BET_STATUS_LABELS[opts.preferStatusLabel];
    if (stats.activeProjectCount === null) {
      return statusLabel;
    }
    if (stats.activeProjectCount === 0 && !stats.latestCompletedName) {
      return statusLabel;
    }
  }

  if (stats.activeProjectCount === null) return '—';
  if (stats.isEmptyWindow || stats.activeProjectCount === 0) {
    if (stats.latestCompletedName) {
      return `暂无项目 · 最近「${stats.latestCompletedName}」`;
    }
    return '暂无项目';
  }
  const countPart =
    stats.activeProjectCount === 1
      ? '1 个项目在跑'
      : `${stats.activeProjectCount} 个项目在跑`;
  if (stats.latestCompletedName) {
    return `${stats.activeProjectCount} 个项目 · 最近「${stats.latestCompletedName}」`;
  }
  return countPart;
}
