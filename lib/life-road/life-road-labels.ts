/**
 * 道路功能用户可见文案（与饮食 goal / 长期项目开关区分）。
 */
import type { LifeBetDerivedStats } from '@/lib/life-road/life-road-derived';
import type { LifeBetHorizon, LifeBetStatus } from '@/lib/life-road/life-road-limits';

export const LIFE_BET_HORIZON_LABELS: Record<LifeBetHorizon, string> = {
  year: '今年',
  multi: '两三年',
  farther: '更远',
};

export const LIFE_BET_STATUS_LABELS: Record<LifeBetStatus, string> = {
  on_track: '在路上',
  paused: '暂搁',
  arrived: '已抵达',
  dropped: '放弃',
};

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
