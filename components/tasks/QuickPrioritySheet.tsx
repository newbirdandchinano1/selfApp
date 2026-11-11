/**
 * 列表快捷改优先级：底部弹出四象限（含清除），带 scrim + 上滑出场。
 */
import type { TaskPriorityKey } from '@/components/composer';
import {
  taskPriorityKeyToNumber,
  taskPriorityToKey,
} from '@/components/composer';
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { toast } from '@/lib/app-feedback';
import {
  isNonUrgentPriorityKey,
  NON_URGENT_PRIORITY_LOCK_HINT,
} from '@/lib/due-soon-priority-bump';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const OPTIONS: {
  key: TaskPriorityKey | 'none';
  label: string;
  hint: string;
  short: string;
}[] = [
  { key: 'urgent-important', label: '紧急重要', hint: '立刻做 · 今天', short: 'P1' },
  { key: 'urgent-not-important', label: '紧急不重要', hint: '今天尽快处理', short: 'P2' },
  { key: 'not-urgent-important', label: '不紧急重要', hint: '本周安排', short: 'P3' },
  { key: 'not-urgent-not-important', label: '不紧急不重要', hint: '稍后 / 收集箱', short: 'P4' },
  { key: 'none', label: '未设置', hint: '清除优先级', short: '—' },
];

export type QuickPriorityTarget = {
  kind: 'task' | 'project';
  id: string;
  title: string;
  priority: number;
  lockNonUrgent?: boolean;
};

const SHEET_SLIDE_PX = 420;

export function QuickPrioritySheet({
  target,
  onClose,
  onSelect,
}: {
  target: QuickPriorityTarget | null;
  onClose: () => void;
  onSelect: (priority: 0 | 1 | 2 | 3 | 4) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate } = useFoldMotionGate();

  const open = target != null;
  const [presented, setPresented] = React.useState(false);
  const closingRef = React.useRef(false);
  const scrim = React.useRef(new Animated.Value(0)).current;
  const sheetY = React.useRef(new Animated.Value(1)).current;
  /** 关闭过程中仍展示最后一次目标，避免内容闪空 */
  const [displayTarget, setDisplayTarget] = React.useState<QuickPriorityTarget | null>(null);

  React.useEffect(() => {
    if (target) setDisplayTarget(target);
  }, [target]);

  const runOpen = React.useCallback(() => {
    closingRef.current = false;
    setPresented(true);
    if (!animate) {
      scrim.setValue(1);
      sheetY.setValue(0);
      return;
    }
    scrim.setValue(0);
    sheetY.setValue(1);
    Animated.parallel([
      Animated.timing(scrim, {
        toValue: 1,
        duration: TaskFoldMotion.scrim,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(sheetY, {
        toValue: 0,
        duration: TaskFoldMotion.sheet,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [animate, scrim, sheetY]);

  const runClose = React.useCallback(
    (after?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      const finish = () => {
        setPresented(false);
        scrim.setValue(0);
        sheetY.setValue(1);
        after?.();
        onClose();
        closingRef.current = false;
      };
      if (!animate) {
        finish();
        return;
      }
      Animated.parallel([
        Animated.timing(scrim, {
          toValue: 0,
          duration: Math.round(TaskFoldMotion.scrim * 0.85),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(sheetY, {
          toValue: 1,
          duration: Math.round(TaskFoldMotion.sheet * 0.75),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) finish();
        else closingRef.current = false;
      });
    },
    [animate, onClose, scrim, sheetY],
  );

  React.useEffect(() => {
    if (open) runOpen();
  }, [open, runOpen]);

  const handlePick = React.useCallback(
    (key: TaskPriorityKey | 'none') => {
      const lockNonUrgent = !!displayTarget?.lockNonUrgent;
      if (key !== 'none' && lockNonUrgent && isNonUrgentPriorityKey(key)) {
        toast.info(NON_URGENT_PRIORITY_LOCK_HINT);
        return;
      }
      const next = key === 'none' ? 0 : taskPriorityKeyToNumber(key);
      onSelect(next);
      runClose();
    },
    [displayTarget?.lockNonUrgent, onSelect, runClose],
  );

  const currentKey =
    displayTarget && (displayTarget.priority ?? 0) >= 1
      ? taskPriorityToKey(displayTarget.priority)
      : 'none';
  const lockNonUrgent = !!displayTarget?.lockNonUrgent;
  const kindLabel = displayTarget?.kind === 'project' ? '项目' : '待办';
  const footPad = Math.max(insets.bottom, 12);
  const slidePx = Math.min(SHEET_SLIDE_PX, Math.round(winH * 0.5));
  const translateY = sheetY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, slidePx],
  });
  const sheetBg = isDark ? tf.paper2 : tf.card;

  return (
    <Modal
      transparent
      visible={presented}
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => runClose()}>
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tf.dim, opacity: scrim }]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => runClose()}
          accessibilityRole="button"
          accessibilityLabel="关闭优先级选择"
        />

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: sheetBg,
              borderTopColor: tf.line,
              paddingBottom: footPad,
              transform: [{ translateY }],
              shadowColor: tf.shadow,
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: tf.line2 }]} />

          <View style={styles.head}>
            <View style={[styles.headIcon, { backgroundColor: tf.pond }]}>
              <MaterialIcons name="flag" size={16} color={tf.sun} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[styles.title, { color: tf.pond, fontFamily: fonts.serif }]}
                numberOfLines={1}>
                设置优先级
              </Text>
              <Text style={[styles.sub, { color: tf.faint }]} numberOfLines={1}>
                {kindLabel}
                {displayTarget?.title ? ` · ${displayTarget.title}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => runClose()}
              accessibilityRole="button"
              accessibilityLabel="关闭"
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: isDark ? tf.paper3 : '#F1EDE1', opacity: pressed ? 0.8 : 1 },
              ]}>
              <MaterialIcons name="close" size={16} color={tf.muted} />
            </Pressable>
          </View>

          {lockNonUrgent ? (
            <Text style={[styles.lockHint, { color: tf.amberInk }]}>{NON_URGENT_PRIORITY_LOCK_HINT}</Text>
          ) : null}

          <View style={styles.list}>
            {OPTIONS.map((opt, index) => {
              const active = currentKey === opt.key;
              const locked =
                opt.key !== 'none' && lockNonUrgent && isNonUrgentPriorityKey(opt.key);
              const accent =
                opt.key === 'urgent-important'
                  ? tf.rose
                  : opt.key === 'urgent-not-important'
                    ? tf.amber
                    : opt.key === 'not-urgent-important'
                      ? tf.frog
                      : opt.key === 'not-urgent-not-important'
                        ? tf.muted
                        : tf.faint;
              return (
                <FoldRiseIn
                  key={opt.key}
                  animate={animate && presented}
                  index={index}
                  duration={360}
                  staggerMs={32}
                  fromY={10}>
                  <Pressable
                    onPress={() => handlePick(opt.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: locked }}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        backgroundColor: active
                          ? isDark
                            ? `${accent}28`
                            : `${accent}14`
                          : isDark
                            ? tf.paper3
                            : '#F4F0E6',
                        borderColor: active ? accent : 'transparent',
                        opacity: locked ? 0.48 : pressed ? 0.88 : 1,
                      },
                    ]}>
                    <View
                      style={[styles.shortBadge, { backgroundColor: isDark ? tf.paper2 : '#EFEADF' }]}>
                      <Text style={[styles.shortText, { color: accent }]}>{opt.short}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.rowLabel, { color: tf.ink2 }]}>{opt.label}</Text>
                      <Text style={[styles.rowHint, { color: locked ? tf.faint : tf.muted }]}>
                        {locked ? '临期锁定' : opt.hint}
                      </Text>
                    </View>
                    {active ? <MaterialIcons name="check" size={18} color={accent} /> : null}
                  </Pressable>
                </FoldRiseIn>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 4,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  headIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '600' },
  sub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockHint: { fontSize: 11, fontWeight: '600', lineHeight: 15, marginBottom: 4 },
  list: { gap: 6, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  shortBadge: {
    minWidth: 34,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  shortText: { fontSize: 12, fontWeight: '800' },
  rowLabel: { fontSize: 13, fontWeight: '700' },
  rowHint: { fontSize: 10, marginTop: 1 },
});
