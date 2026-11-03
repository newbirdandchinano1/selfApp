/**
 * 任务状态标签：列表 / 详情 / 项目树共用文案与色调。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskStatus } from '@/lib/repositories/tasks/task.types';
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export type TaskStatusTone = 'green' | 'amber' | 'gray' | 'rose' | 'pond';

export function formatTaskStatusLabel(status: string | null | undefined): string {
  if (status === 'doing') return '进行中';
  if (status === 'done') return '已完成';
  if (status === 'blocked') return '受阻';
  if (status === 'cancelled') return '已取消';
  if (status === 'shelved') return '搁置';
  return '待办';
}

export function resolveTaskStatusTone(status: string | null | undefined): TaskStatusTone {
  if (status === 'doing') return 'pond';
  if (status === 'done') return 'green';
  if (status === 'blocked') return 'amber';
  if (status === 'shelved') return 'gray';
  if (status === 'cancelled') return 'rose';
  return 'gray';
}

/** 列表行是否展示状态芯片（默认待办不标，避免噪声） */
export function shouldShowTaskStatusMarker(status: string | null | undefined): boolean {
  return (
    status === 'doing' ||
    status === 'blocked' ||
    status === 'shelved' ||
    status === 'cancelled' ||
    status === 'done'
  );
}

export function taskStatusMarkerLabel(status: string | null | undefined): string {
  if (status === 'shelved') return '搁置';
  return formatTaskStatusLabel(status);
}

type ToneColors = { bg: string; fg: string };

export function useTaskStatusToneColors(): Record<TaskStatusTone, ToneColors> {
  const { tf, isDark } = useTaskFoldTheme();
  return React.useMemo(
    () => ({
      green: { bg: tf.lily2, fg: tf.frog },
      pond: { bg: tf.sage2, fg: isDark ? tf.pond : '#36594D' },
      amber: { bg: tf.amber2, fg: tf.amberInk },
      gray: { bg: isDark ? tf.paper3 : '#EAE6DC', fg: '#777B75' },
      rose: { bg: tf.rose2, fg: tf.rose },
    }),
    [isDark, tf],
  );
}

type TaskStatusTagProps = {
  status: TaskStatus | string;
  /** 详情页可强制展示「待办」；列表默认隐藏 todo */
  force?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function TaskStatusTag({ status, force = false, compact = true, style }: TaskStatusTagProps) {
  const tones = useTaskStatusToneColors();
  if (!force && !shouldShowTaskStatusMarker(status)) return null;
  const tone = resolveTaskStatusTone(status);
  const colors = tones[tone];
  const label = taskStatusMarkerLabel(status);
  return (
    <View
      style={[
        styles.tag,
        compact ? styles.tagCompact : styles.tagRoomy,
        { backgroundColor: colors.bg },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`状态 ${label}`}>
      <Text style={[compact ? styles.textCompact : styles.textRoomy, { color: colors.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'center',
    flexShrink: 0,
  },
  tagCompact: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minHeight: 16,
    justifyContent: 'center',
  },
  tagRoomy: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  textCompact: {
    fontSize: 9,
    fontWeight: '800',
  },
  textRoomy: {
    fontSize: 11,
    fontWeight: '700',
  },
});
