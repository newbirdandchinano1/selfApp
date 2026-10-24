/**
 * 独立待办四象限 — 对齐设计稿 `.prio`：2×2 紧凑格，选中 220ms 灰→绿。
 */
import {
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import type { TaskPriorityKey } from '@/components/composer';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

const CELLS: {
  key: TaskPriorityKey;
  title: string;
  hint: string;
  q1?: boolean;
}[] = [
  { key: 'urgent-important', title: '紧急重要', hint: '立刻做 · 今天', q1: true },
  { key: 'urgent-not-important', title: '紧急不重要', hint: '今天尽快处理' },
  { key: 'not-urgent-important', title: '不紧急重要', hint: '本周安排' },
  { key: 'not-urgent-not-important', title: '不紧急不重要', hint: '稍后 / 收集箱' },
];

function PrioCell({
  title,
  hint,
  q1,
  active,
  onPress,
}: {
  title: string;
  hint: string;
  q1?: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const { tf } = useTaskFoldTheme();
  const { animate } = useFoldMotionGate();
  const progress = React.useRef(new Animated.Value(active ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: animate ? TaskFoldMotion.prioSelect : 120,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start();
  }, [active, animate, progress]);

  const bgIdle = '#F2EEE2';
  const bgOn = q1 ? 'rgba(196,112,85,0.18)' : 'rgba(201,217,163,0.45)';
  const borderIdle = 'transparent';
  const borderOn = q1 ? '#D39A86' : '#AFC38E';
  const titleIdle = '#59685C';
  const titleOn = q1 ? '#8B4A34' : '#3F5D3E';
  const hintIdle = '#909A91';
  const hintOn = q1 ? '#A56B55' : '#5A7358';

  const backgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [bgIdle, bgOn],
  });
  const borderColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [borderIdle, borderOn],
  });
  const titleColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [titleIdle, titleOn],
  });
  const hintColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [hintIdle, hintOn],
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.cellWrap, { opacity: pressed ? 0.9 : 1 }]}>
      <Animated.View style={[styles.cell, { backgroundColor, borderColor }]}>
        <Animated.Text style={[styles.cellTitle, { color: titleColor }]}>{title}</Animated.Text>
        <Animated.Text style={[styles.cellHint, { color: hintColor }]}>{hint}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

export function TaskFoldPriorityGrid({
  value,
  onChange,
  subtitle = '独立待办使用四象限',
}: {
  value: TaskPriorityKey;
  onChange: (key: TaskPriorityKey) => void;
  subtitle?: string;
}) {
  const { tf } = useTaskFoldTheme();

  return (
    <View>
      <View style={styles.head}>
        <Text style={[styles.headTitle, { color: '#5B6A5D' }]}>优先级</Text>
        <Text style={[styles.headSub, { color: tf.faint }]}>{subtitle}</Text>
      </View>
      <View style={styles.grid}>
        {CELLS.map((c) => (
          <PrioCell
            key={c.key}
            title={c.title}
            hint={c.hint}
            q1={c.q1}
            active={value === c.key}
            onPress={() => onChange(c.key)}
          />
        ))}
      </View>
      <Text style={[styles.dragHint, { color: '#8E9A90' }]}>可点选改判</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  headTitle: { fontSize: 12, fontWeight: '800' },
  headSub: { fontSize: 10, flex: 1 },
  dragHint: { fontSize: 10, marginTop: 6, textAlign: 'right' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  cellWrap: {
    width: '48.5%',
    flexGrow: 1,
  },
  cell: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
    justifyContent: 'center',
  },
  cellTitle: { fontSize: 12, fontWeight: '700', lineHeight: 16 },
  cellHint: { fontSize: 10, lineHeight: 14, marginTop: 2 },
});
