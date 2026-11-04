/**
 * 阶段 F：时间线卡片配色（浅底圆角卡 + 左侧粗色条 + 完成退饱和）。
 * 与旧课表 `.blk` 语义一致：习惯浅绿 · 待办琥珀 · 项目灰绿 · 青蛙深绿。
 */
import type { TaskFoldPalette } from '@/constants/task-fold-theme';
import type { TimelineEventKind } from '@/lib/schedule/timeline/types';

export type TimelineTone = {
  barColor: string;
  cardBg: string;
  cardBorder: string;
  titleColor: string;
  metaColor: string;
  dotColor: string;
};

export function resolveTimelineTone(
  kind: TimelineEventKind,
  opts: { done: boolean; isDark: boolean; tf: TaskFoldPalette; overdue?: boolean },
): TimelineTone {
  const { done, isDark, tf, overdue } = opts;

  if (done) {
    return {
      barColor: isDark ? tf.line2 : '#C9CFC2',
      cardBg: isDark ? 'rgba(255,252,245,0.04)' : 'rgba(255,252,245,0.7)',
      cardBorder: isDark ? tf.line : 'rgba(210,206,194,0.7)',
      titleColor: isDark ? tf.faint : '#9AA096',
      metaColor: isDark ? 'rgba(152,161,151,0.7)' : 'rgba(154,160,150,0.85)',
      dotColor: isDark ? tf.faint : '#B4BAAF',
    };
  }

  const base =
    kind === 'habit'
      ? { bar: '#87A566', light: '135,165,102', title: '#4C653F', darkBar: tf.frog2 }
      : kind === 'todo'
        ? { bar: '#D6974B', light: '214,151,75', title: '#7A5B2D', darkBar: tf.sun }
        : kind === 'proj'
          ? { bar: '#7FA695', light: '127,166,149', title: '#4B6048', darkBar: tf.sage }
          : { bar: '#35604A', light: '53,96,74', title: '#24402F', darkBar: tf.frog };

  const accent = overdue ? tf.rose : null;

  return {
    barColor: accent ?? (isDark ? base.darkBar : base.bar),
    cardBg: isDark ? `rgba(${base.light},0.16)` : `rgba(${base.light},0.09)`,
    cardBorder: accent
      ? `${tf.rose}66`
      : isDark
        ? `rgba(${base.light},0.4)`
        : `rgba(${base.light},0.22)`,
    titleColor: isDark ? tf.ink2 : base.title,
    metaColor: isDark ? 'rgba(198,206,199,0.72)' : 'rgba(76,90,80,0.66)',
    dotColor: accent ?? (isDark ? base.darkBar : base.bar),
  };
}
