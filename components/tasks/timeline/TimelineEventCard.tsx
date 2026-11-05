/**
 * 阶段 F：时间线单条事件卡（右侧浅底圆角卡 + 左侧粗色条 + 图标 + 标题 + 友好时长）
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatEventDuration } from '@/lib/schedule/timeline/layout';
import type { TimelineEvent } from '@/lib/schedule/timeline/types';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { resolveTimelineTone } from '@/components/tasks/timeline/timeline-tone';

type Props = {
  event: TimelineEvent;
  /** 由父容器给定的像素高度 */
  height: number;
  onPress: (event: TimelineEvent) => void;
};

export function TimelineEventCard({ event, height, onPress }: Props) {
  const { isDark } = useAppTheme();
  const { tf } = useTaskFoldTheme();
  /** 多栏已按全宽横滑，不再因栏数压缩文案；仅矮卡收紧 */
  const compact = height < 38;
  const tone = resolveTimelineTone(event.id, {
    done: event.done,
    isDark,
    tf,
    overdue: event.overdue,
  });

  const duration = formatEventDuration(event.startMinutes, event.endMinutes);
  const metaLabel =
    event.overdue && !event.done
      ? duration
        ? `过期 · ${duration}`
        : '过期'
      : duration;

  return (
    <Pressable
      onPress={() => onPress(event)}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}${event.done ? '，已完成' : ''}${
        duration ? `，${duration}` : ''
      }`}
      style={({ pressed }) => [
        styles.card,
        {
          height,
          backgroundColor: tone.cardBg,
          borderColor: tone.cardBorder,
          opacity: pressed ? 0.86 : 1,
        },
      ]}>
      <View style={[styles.bar, { backgroundColor: tone.barColor }]} />
      {event.icon ? (
        <Text style={styles.icon} numberOfLines={1}>
          {event.icon}
        </Text>
      ) : null}
      <View style={styles.body}>
        <Text
          numberOfLines={compact ? 1 : 2}
          style={[
            styles.title,
            {
              color: tone.titleColor,
              fontSize: compact ? 11 : 12,
              textDecorationLine: event.done ? 'line-through' : 'none',
              opacity: event.done ? 0.72 : 1,
            },
          ]}>
          {event.title}
        </Text>
        {!compact && metaLabel ? (
          <Text
            numberOfLines={1}
            style={[styles.meta, { color: tone.metaColor }]}>
            {metaLabel}
          </Text>
        ) : null}
      </View>
      {event.done ? (
        <MaterialIcons name="check-circle" size={compact ? 12 : 14} color={tone.barColor} style={styles.ck} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  icon: {
    fontSize: 13,
    marginRight: 4,
  },
  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  title: {
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  meta: {
    fontSize: 9,
    fontWeight: '500',
    marginTop: 1,
  },
  ck: {
    marginLeft: 4,
  },
});
