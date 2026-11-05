/**
 * 今日青蛙 / 下一格 · 纯规则（可单测）。
 * 输入已解析好的时段块，输出小组件 / Live Activity 共用的一眼摘要。
 */

export type FrogScheduleDisplayKind = 'frog' | 'todo' | 'project';

export type FrogScheduleBlock = {
  placementId: string;
  subjectKind: 'task' | 'project';
  subjectId: string;
  title: string;
  displayKind: FrogScheduleDisplayKind;
  /** 轴分钟（可跨午夜） */
  startMins: number;
  endMins: number;
  done: boolean;
};

export type FrogScheduleFocusMode = 'active_first' | 'next_first';

export type FrogScheduleGlance = {
  status: 'empty' | 'active' | 'upcoming' | 'cleared';
  focus: FrogScheduleBlock | null;
  /** 焦点之后、尚未开始的未完成块（按开始时刻） */
  upcoming: FrogScheduleBlock[];
  placedCount: number;
  /** 已过结束时刻且未完成 */
  overdueCount: number;
  nowMins: number;
};

export type FrogScheduleWidgetProps = {
  headline: string;
  /** 锁屏标题；隐私收紧时可隐藏具体待办名 */
  lockHeadline: string;
  kindLabel: string;
  kindColor: string;
  timeRange: string;
  statusLine: string;
  summaryLine: string;
  upcoming1: string;
  upcoming2: string;
  upcoming3: string;
  upcomingVisible: number;
  hasFocus: number;
  deepLink: string;
};

export type FrogScheduleLiveActivityProps = {
  title: string;
  kindLabel: string;
  timeRange: string;
  statusLine: string;
  placementId: string;
};

export const FROG_SCHEDULE_KIND_META: Record<
  FrogScheduleDisplayKind,
  { label: string; color: string }
> = {
  frog: { label: '青蛙', color: '#2F6B4F' },
  todo: { label: '待办', color: '#C48A2A' },
  project: { label: '项目', color: '#5A6B5E' },
};

export function formatAxisHm(minutes: number): string {
  const rounded = Math.round(minutes);
  const day = 24 * 60;
  if (rounded === day) return '24:00';
  const m = ((rounded % day) + day) % day;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatRemainLabel(remainSec: number, opts?: { untilStart?: boolean }): string {
  const sec = Math.max(0, Math.floor(remainSec));
  const prefix = opts?.untilStart ? '距开始' : '剩余';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${prefix} ${h} 时 ${m} 分`;
  if (m > 0) return `${prefix} ${m} 分`;
  return `${prefix}不足 1 分`;
}

function wallClockAxisMinutes(now: Date, dayStartYmdLocalNoon: Date): number {
  const day0 = new Date(
    dayStartYmdLocalNoon.getFullYear(),
    dayStartYmdLocalNoon.getMonth(),
    dayStartYmdLocalNoon.getDate(),
    0,
    0,
    0,
    0,
  );
  return (now.getTime() - day0.getTime()) / 60_000;
}

export function buildFrogScheduleGlance(input: {
  blocks: FrogScheduleBlock[];
  now: Date;
  /** 逻辑「今天」对应的本地 Date（建议正午，避免 DST 边界） */
  todayLocalDate: Date;
  focusMode?: FrogScheduleFocusMode;
  upcomingLimit?: number;
}): FrogScheduleGlance {
  const focusMode = input.focusMode ?? 'active_first';
  const upcomingLimit = Math.max(1, Math.min(3, input.upcomingLimit ?? 3));
  const nowMins = wallClockAxisMinutes(input.now, input.todayLocalDate);

  const timed = [...input.blocks]
    .filter((b) => Number.isFinite(b.startMins) && Number.isFinite(b.endMins) && b.endMins > b.startMins)
    .sort((a, b) => a.startMins - b.startMins || a.title.localeCompare(b.title, 'zh'));

  const open = timed.filter((b) => !b.done);
  const overdueCount = open.filter((b) => b.endMins <= nowMins).length;
  const placedCount = timed.length;

  const active = open.find((b) => b.startMins <= nowMins && nowMins < b.endMins) ?? null;
  const next = open.find((b) => b.startMins > nowMins) ?? null;

  let focus: FrogScheduleBlock | null = null;
  let status: FrogScheduleGlance['status'] = 'empty';

  if (focusMode === 'next_first') {
    focus = next ?? active;
  } else {
    focus = active ?? next;
  }

  if (focus) {
    status = active && focus.placementId === active.placementId ? 'active' : 'upcoming';
  } else if (placedCount > 0 && open.length === 0) {
    status = 'cleared';
  } else if (open.length > 0 && !next && !active) {
    // 仅有过期未完成：仍展示最早过期块，便于「滞留」感知
    focus = open[0] ?? null;
    status = focus ? 'upcoming' : 'empty';
  }

  const upcoming = open
    .filter((b) => {
      if (!focus) return b.startMins > nowMins;
      if (b.placementId === focus.placementId) return false;
      return b.startMins >= focus.endMins || b.startMins > nowMins;
    })
    .slice(0, upcomingLimit);

  return {
    status,
    focus,
    upcoming,
    placedCount,
    overdueCount,
    nowMins,
  };
}

export function frogScheduleGlanceToWidgetProps(
  glance: FrogScheduleGlance,
  opts?: { deepLink?: string; lockScreenStrict?: boolean },
): FrogScheduleWidgetProps {
  const deepLink = opts?.deepLink ?? 'zheng://tasks';
  const lockStrict = !!opts?.lockScreenStrict;
  const empty: FrogScheduleWidgetProps = {
    headline: '今日暂无入格',
    lockHeadline: '今日暂无入格',
    kindLabel: '',
    kindColor: '#5A6B5E',
    timeRange: '',
    statusLine: '在任务页把青蛙拖入今日时段',
    summaryLine: '',
    upcoming1: '',
    upcoming2: '',
    upcoming3: '',
    upcomingVisible: 0,
    hasFocus: 0,
    deepLink,
  };

  if (glance.status === 'cleared') {
    return {
      ...empty,
      headline: '今日入格已清',
      lockHeadline: '今日入格已清',
      statusLine: '做得不错',
      summaryLine: `今日 ${glance.placedCount} 格`,
      hasFocus: 0,
    };
  }

  if (!glance.focus) return empty;

  const meta = FROG_SCHEDULE_KIND_META[glance.focus.displayKind];
  const timeRange = `${formatAxisHm(glance.focus.startMins)}–${formatAxisHm(glance.focus.endMins)}`;
  let statusLine = timeRange;
  if (glance.status === 'active') {
    const remainSec = (glance.focus.endMins - glance.nowMins) * 60;
    statusLine = `进行中 · ${formatRemainLabel(remainSec)}`;
  } else if (glance.focus.startMins > glance.nowMins) {
    const remainSec = (glance.focus.startMins - glance.nowMins) * 60;
    statusLine = `下一场 · ${formatRemainLabel(remainSec, { untilStart: true })}`;
  } else {
    statusLine = `滞留 · ${timeRange}`;
  }

  const summaryParts = [`今日 ${glance.placedCount} 格`];
  if (glance.overdueCount > 0) summaryParts.push(`滞留 ${glance.overdueCount}`);
  const lines = glance.upcoming.map(
    (b) => `${formatAxisHm(b.startMins)} ${b.title}`.slice(0, 28),
  );
  const headline = glance.focus.title.slice(0, 40);

  return {
    headline,
    lockHeadline: lockStrict ? meta.label || '日程摘要' : headline,
    kindLabel: meta.label,
    kindColor: meta.color,
    timeRange,
    statusLine,
    summaryLine: summaryParts.join(' · '),
    upcoming1: lines[0] ?? '',
    upcoming2: lines[1] ?? '',
    upcoming3: lines[2] ?? '',
    upcomingVisible: lines.length,
    hasFocus: 1,
    deepLink,
  };
}

export function frogScheduleGlanceToLiveActivityProps(
  glance: FrogScheduleGlance,
): FrogScheduleLiveActivityProps | null {
  if (glance.status !== 'active' || !glance.focus) return null;
  const meta = FROG_SCHEDULE_KIND_META[glance.focus.displayKind];
  const remainSec = (glance.focus.endMins - glance.nowMins) * 60;
  return {
    title: glance.focus.title.slice(0, 40),
    kindLabel: meta.label,
    timeRange: `${formatAxisHm(glance.focus.startMins)}–${formatAxisHm(glance.focus.endMins)}`,
    statusLine: formatRemainLabel(remainSec),
    placementId: glance.focus.placementId,
  };
}
