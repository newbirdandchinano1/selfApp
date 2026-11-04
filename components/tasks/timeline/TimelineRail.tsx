/**
 * 阶段 F：左侧时间轨道（竖线 + 语义时段标签 + 事件圆点 + 现在指示点）。
 * break 禁排区不画厚行，仅在轨道上弱化提示（由 DayTimelineSchedule 背景带承担）。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { SemanticBucketSegment } from '@/lib/schedule/timeline/labels';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export const TIMELINE_RAIL_W = 52;

type RailDot = { top: number; color: string };

type Props = {
  bodyHeight: number;
  buckets: SemanticBucketSegment[];
  axisStartMinutes: number;
  minutePx: number;
  nowMinutes: number | null;
  dots: RailDot[];
};

export function TimelineRail({
  bodyHeight,
  buckets,
  axisStartMinutes,
  minutePx,
  nowMinutes,
  dots,
}: Props) {
  const { isDark } = useAppTheme();
  const { tf } = useTaskFoldTheme();
  const lineColor = isDark ? tf.line : 'rgba(226,218,203,0.9)';

  const offsetOf = (minutes: number) => (minutes - axisStartMinutes) * minutePx;

  return (
    <View style={[styles.rail, { height: bodyHeight }]}>
      <View style={[styles.line, { backgroundColor: lineColor }]} />
      {buckets.map((b, i) => {
        const top = offsetOf(b.startMinutes);
        if (top >= bodyHeight - 2) return null;
        return (
          <Text
            key={`${b.key}-${i}`}
            numberOfLines={1}
            style={[
              styles.bucketLabel,
              { top, color: tf.faint, opacity: i === 0 ? 0.95 : 0.8 },
            ]}>
            {b.label}
          </Text>
        );
      })}
      {dots.map((d, i) => (
        <View
          key={`dot-${i}`}
          style={[
            styles.dot,
            { top: d.top - 3, backgroundColor: d.color, borderColor: isDark ? tf.paper2 : '#FFFDF8' },
          ]}
        />
      ))}
      {nowMinutes != null ? (
        <View
          style={[
            styles.nowDot,
            {
              top: offsetOf(nowMinutes) - 4,
              backgroundColor: tf.sun,
              borderColor: isDark ? tf.paper2 : '#FFFDF8',
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: TIMELINE_RAIL_W,
    position: 'relative',
  },
  line: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  bucketLabel: {
    position: 'absolute',
    right: 16,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'right',
    width: TIMELINE_RAIL_W - 20,
  },
  dot: {
    position: 'absolute',
    right: 7,
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
  },
  nowDot: {
    position: 'absolute',
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
});
