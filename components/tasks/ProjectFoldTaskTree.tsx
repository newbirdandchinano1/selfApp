/**
 * 项目窗格 · 任务树 — 对齐设计稿 `.tasktree` / `.trow` / `.frogleaf`
 * 树展开 360ms · 箭头旋转 · 子行 35ms 级联 · 叶子青蛙标记
 */
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { getFrogAssignedDates } from '@/lib/frog-assignment';
import type { TaskTreeNode } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

function formatFrogLeaf(
  extraData: string | null,
  todayYmd: string,
  formatDayLabel: (ymd: string, today: string) => string,
): string {
  const dates = getFrogAssignedDates(extraData);
  if (dates.length === 0) return '';
  const upcoming = dates.filter((d) => d >= todayYmd);
  const show = upcoming.length > 0 ? upcoming : dates;
  const label = formatDayLabel(show[0], todayYmd);
  return `🐸 ${label}`;
}

function directProgressLabel(children: TaskTreeNode[]): string {
  let total = 0;
  let done = 0;
  for (const c of children) {
    total += 1;
    if (c.status === 'done' || c.status === 'cancelled') done += 1;
  }
  if (total <= 0) return '';
  return `${done}/${total}`;
}

function ProjectFoldTaskRow({
  node,
  depth,
  index,
  expandAnimate,
  locked,
  logicalTodayYmd,
  formatDayLabel,
  priorityLabel,
  collapsed,
  onToggleCollapse,
  onToggleDone,
  onOpen,
  onLongPress,
}: {
  node: TaskTreeNode;
  depth: number;
  index: number;
  expandAnimate: boolean;
  locked: boolean;
  logicalTodayYmd: string;
  formatDayLabel: (ymd: string, today: string) => string;
  priorityLabel: (priority: number) => string;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onToggleDone: () => void;
  onOpen: () => void;
  onLongPress?: () => void;
}) {
  const { tf, fonts } = useTaskFoldTheme();
  const { animate } = useFoldMotionGate();
  const done = node.status === 'done' || node.status === 'cancelled';
  const children = Array.isArray(node.children) ? node.children : [];
  const hasChildren = children.length > 0;
  const frogLeaf =
    !done && getFrogAssignedDates(node.extra_data).length > 0
      ? formatFrogLeaf(node.extra_data, logicalTodayYmd, formatDayLabel)
      : '';
  const tp = hasChildren
    ? directProgressLabel(children)
    : priorityLabel(node.priority ?? 0) || '';
  const padLeft = 3 + depth * 13;

  const chev = React.useRef(new Animated.Value(collapsed ? 0 : 1)).current;
  React.useEffect(() => {
    Animated.timing(chev, {
      toValue: collapsed ? 0 : 1,
      duration: animate ? TaskFoldMotion.treeExpand * 0.7 : 0,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [animate, chev, collapsed]);

  const rotate = chev.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  return (
    <FoldRiseIn
      animate={expandAnimate && animate}
      index={index}
      staggerMs={TaskFoldMotion.treeStagger}
      duration={TaskFoldMotion.treeExpand}
      fromY={6}
      fromScale={0.98}>
      <View style={[styles.trow, { paddingLeft: padLeft }]}>
        {hasChildren ? (
          <Pressable
            onPress={onToggleCollapse}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? '展开子任务' : '收起子任务'}
            style={styles.chevHit}>
            <Animated.View style={{ transform: [{ rotate }] }}>
              <MaterialIcons name="chevron-right" size={14} color={tf.faint} />
            </Animated.View>
          </Pressable>
        ) : (
          <View style={[styles.chevHit, { opacity: 0.28 }]}>
            <MaterialIcons name="chevron-right" size={14} color={tf.faint} />
          </View>
        )}

        <Pressable
          onPress={onToggleDone}
          disabled={locked}
          hitSlop={8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done, disabled: locked }}
          style={({ pressed }) => [
            styles.cb,
            {
              borderColor: done ? tf.frog : '#C8D1C0',
              backgroundColor: done ? tf.frog : 'rgba(255,255,255,0.5)',
              opacity: locked ? 0.55 : pressed ? 0.85 : 1,
            },
          ]}>
          {done ? <MaterialIcons name="check" size={10} color={tf.onPond} /> : null}
          {locked && !done ? <MaterialIcons name="lock" size={9} color={tf.muted} /> : null}
        </Pressable>

        <Pressable
          onPress={onOpen}
          onLongPress={onLongPress}
          delayLongPress={380}
          style={({ pressed }) => [styles.tnWrap, pressed && { opacity: 0.82 }]}>
          <Text
            style={[
              styles.tn,
              {
                color: done ? '#A8AFA6' : tf.ink2,
                textDecorationLine: done ? 'line-through' : 'none',
              },
            ]}
            numberOfLines={1}>
            {node.title?.trim() || '（无标题）'}
          </Text>
          {frogLeaf ? (
            <View style={[styles.frogleaf, { backgroundColor: tf.lily2 }]}>
              <Text style={[styles.frogleafText, { color: '#5A8256' }]}>{frogLeaf}</Text>
            </View>
          ) : null}
          {tp ? (
            <Text style={[styles.tp, { color: tf.faint, fontFamily: fonts.mono }]}>{tp}</Text>
          ) : null}
        </Pressable>
      </View>
    </FoldRiseIn>
  );
}

export function ProjectFoldTaskTree({
  nodes,
  expanded,
  locked,
  logicalTodayYmd,
  collapsedTaskIds,
  formatDayLabel,
  priorityLabel,
  onToggleCollapse,
  onToggleDone,
  onOpenTask,
  onLongPressTask,
  maxDepth = 3,
}: {
  nodes: TaskTreeNode[];
  expanded: boolean;
  locked: boolean;
  logicalTodayYmd: string;
  collapsedTaskIds: Record<string, boolean>;
  formatDayLabel: (ymd: string, today: string) => string;
  priorityLabel: (priority: number) => string;
  onToggleCollapse: (taskId: string) => void;
  onToggleDone: (task: TaskRow) => void;
  onOpenTask: (taskId: string) => void;
  onLongPressTask?: (task: TaskRow) => void;
  maxDepth?: number;
}) {
  const { animate } = useFoldMotionGate();
  const heightProg = React.useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const [measuredH, setMeasuredH] = React.useState(0);
  const measuredHRef = React.useRef(0);
  const [mounted, setMounted] = React.useState(expanded);
  const nodeSig = React.useMemo(() => {
    let n = 0;
    const walk = (list: TaskTreeNode[]) => {
      for (const node of list) {
        n += 1;
        const ch = Array.isArray(node.children) ? node.children : [];
        if (ch.length) walk(ch);
      }
    };
    walk(nodes);
    return n;
  }, [nodes]);

  React.useEffect(() => {
    // 节点增减后重新测量，避免高度卡在旧值把新行裁掉
    measuredHRef.current = 0;
    setMeasuredH(0);
  }, [nodeSig]);

  React.useEffect(() => {
    if (expanded) {
      setMounted(true);
      // 尚未量到高度时先满开，避免 opacity=0 / height=0 导致看不见行、也量不到高
      if (measuredHRef.current <= 0) {
        heightProg.setValue(1);
      }
    }
    Animated.timing(heightProg, {
      toValue: expanded ? 1 : 0,
      duration: animate ? TaskFoldMotion.treeExpand : 0,
      easing: expanded ? FOLD_MOTION_SPRING : FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !expanded) {
        setMounted(false);
        measuredHRef.current = 0;
        setMeasuredH(0);
      }
    });
  }, [animate, expanded, heightProg]);

  if (!mounted && !expanded) return null;

  let rowIndex = 0;
  const renderLevel = (list: TaskTreeNode[], depth: number): React.ReactNode => {
    if (list.length === 0 || depth > maxDepth) return null;
    return list.map((node) => {
      const children = Array.isArray(node.children) ? node.children : [];
      const hasChildren = children.length > 0;
      const isCollapsed = hasChildren ? !!collapsedTaskIds[node.id] : false;
      const idx = rowIndex++;
      return (
        <View key={node.id}>
          <ProjectFoldTaskRow
            node={node}
            depth={depth}
            index={idx}
            expandAnimate={expanded}
            locked={locked}
            logicalTodayYmd={logicalTodayYmd}
            formatDayLabel={formatDayLabel}
            priorityLabel={priorityLabel}
            collapsed={isCollapsed}
            onToggleCollapse={hasChildren ? () => onToggleCollapse(node.id) : undefined}
            onToggleDone={() => onToggleDone(node)}
            onOpen={() => onOpenTask(node.id)}
            onLongPress={onLongPressTask ? () => onLongPressTask(node) : undefined}
          />
          {hasChildren && !isCollapsed && depth < maxDepth
            ? renderLevel(children, depth + 1)
            : null}
        </View>
      );
    });
  };

  const treeBody = (
    <View
      style={styles.tree}
      onLayout={(e) => {
        const h = Math.ceil(e.nativeEvent.layout.height);
        if (h > 0 && Math.abs(h - measuredHRef.current) > 1) {
          measuredHRef.current = h;
          setMeasuredH(h);
        }
      }}>
      {renderLevel(nodes, 0)}
    </View>
  );

  // 展开且未测高：不锁 height，立即露出任务行（设计稿默认可见树）
  if (expanded && measuredH <= 0) {
    return treeBody;
  }

  const animatedStyle =
    measuredH > 0
      ? {
          height: heightProg.interpolate({
            inputRange: [0, 1],
            outputRange: [0, measuredH],
          }),
          opacity: heightProg,
          overflow: 'hidden' as const,
        }
      : { opacity: heightProg };

  return <Animated.View style={animatedStyle}>{treeBody}</Animated.View>;
}

const styles = StyleSheet.create({
  tree: {
    paddingLeft: 3,
    marginTop: 3,
  },
  trow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    minHeight: 26,
  },
  chevHit: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cb: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tnWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tn: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  frogleaf: {
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  frogleafText: {
    fontSize: 10,
    fontWeight: '700',
  },
  tp: {
    marginLeft: 'auto',
    fontSize: 10,
    flexShrink: 0,
  },
});
