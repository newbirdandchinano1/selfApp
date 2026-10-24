/**
 * 添加子任务 · 页内轻量 Sheet（设计稿 shot 14）
 * 遮罩 240ms + Sheet 420ms spring；不跳转路由。
 */
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import {
  taskPriorityKeyToNumber,
  taskPriorityToKey,
  type TaskPriorityKey,
} from '@/components/composer';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { makeTimestampEntityId } from '@/lib/entity-id';
import {
  parseDateLimitParam,
  parseDefaultScheduleParam,
  resolveInheritedDefaultSchedule,
  type DateLimitYmd,
} from '@/lib/schedule-inherit';
import type { PickedScheduleMeta } from '@/lib/schedule-picker-bridge';
import { toast } from '@/lib/app-feedback';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useComposerSchedule } from './use-composer-schedule';
import { clampTitle, ENTITY_TITLE_MAX, validateRequiredTitle } from './validation';

export type AddSubtaskDraft = {
  id: string;
  title: string;
  done: boolean;
  deadline?: string;
  deadlineText?: string;
  reminder?: string;
  reminderText?: string;
  repeat?: string;
  repeatText?: string;
  note?: string | null;
  schedule?: PickedScheduleMeta | null;
  priority?: number;
  estimatedMinutes?: number;
};

export type AddSubtaskSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (task: AddSubtaskDraft) => void | Promise<void>;
  parentTitle: string;
  parentPriority?: number;
  progressDone?: number;
  progressTotal?: number;
  /** 日程继承（可选，静默应用） */
  dateLimit?: DateLimitYmd | null;
  defaultSchedule?: PickedScheduleMeta | Record<string, unknown> | null;
  lockSchedule?: boolean;
  scheduleSource?: string;
};

const PRIO_CHIPS: { key: TaskPriorityKey; label: string }[] = [
  { key: 'urgent-important', label: 'P1 紧急重要' },
  { key: 'urgent-not-important', label: 'P2' },
  { key: 'not-urgent-important', label: 'P3' },
  { key: 'not-urgent-not-important', label: 'P4' },
];

export function AddSubtaskSheet({
  visible,
  onClose,
  onSubmit,
  parentTitle,
  parentPriority = 0,
  progressDone = 0,
  progressTotal = 0,
  dateLimit = null,
  defaultSchedule = null,
  lockSchedule = false,
  scheduleSource = 'add-subtask',
}: AddSubtaskSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate } = useFoldMotionGate();

  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [estimatedMinutes, setEstimatedMinutes] = React.useState(30);
  const [priority, setPriority] = React.useState<TaskPriorityKey>(() =>
    taskPriorityToKey(parentPriority),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const titleInputRef = React.useRef<React.ElementRef<typeof TextInput>>(null);
  const defaultScheduleApplied = React.useRef(false);

  const resolvedDateLimit = React.useMemo(
    () =>
      dateLimit ??
      parseDateLimitParam(undefined),
    [dateLimit],
  );

  const { deadlineText, reminderText, repeatText, scheduleMeta, applySchedule, clearSchedule } =
    useComposerSchedule({
      source: scheduleSource,
      dateLimit: resolvedDateLimit,
      locked: lockSchedule,
    });

  React.useEffect(() => {
    if (!visible) return;
    setTitle('');
    setNote('');
    setEstimatedMinutes(30);
    setPriority(taskPriorityToKey(parentPriority));
    setSubmitting(false);
    defaultScheduleApplied.current = false;
    clearSchedule();
    // 仅在打开时重置；clearSchedule 引用变化不重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, parentPriority]);

  React.useEffect(() => {
    if (!visible || defaultScheduleApplied.current || scheduleMeta) return;
    const inherited = resolveInheritedDefaultSchedule(
      (defaultSchedule as PickedScheduleMeta | null | undefined) ??
        parseDefaultScheduleParam(undefined),
      resolvedDateLimit,
    );
    if (!inherited) return;
    defaultScheduleApplied.current = true;
    applySchedule(inherited as PickedScheduleMeta);
  }, [visible, applySchedule, defaultSchedule, resolvedDateLimit, scheduleMeta]);

  const scrim = React.useRef(new Animated.Value(0)).current;
  const sheetY = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!visible) {
      scrim.setValue(0);
      sheetY.setValue(1);
      return;
    }
    if (!animate) {
      scrim.setValue(1);
      sheetY.setValue(0);
      return;
    }
    scrim.setValue(0);
    sheetY.setValue(1);
    const anim = Animated.parallel([
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
    ]);
    anim.start();
    return () => anim.stop();
  }, [animate, visible, scrim, sheetY]);

  const nextTotal = progressTotal + 1;
  const nextPct = nextTotal > 0 ? Math.round((progressDone / nextTotal) * 100) : 0;
  const currPct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;
  const parentPrioShort =
    parentPriority >= 4
      ? 'P1'
      : parentPriority === 3
        ? 'P2'
        : parentPriority === 2
          ? 'P3'
          : parentPriority === 1
            ? 'P4'
            : '';

  const bumpEstimate = (delta: number) => {
    setEstimatedMinutes((n) => Math.max(5, Math.min(480, n + delta)));
  };

  const handleSave = async () => {
    const result = validateRequiredTitle(title, { emptyMessage: '请输入子任务名称。' });
    if (!result.ok) {
      titleInputRef.current?.focus?.();
      toast.error('请输入子任务名称');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        id: makeTimestampEntityId('tsk_', 8),
        title: result.title,
        done: false,
        deadline: deadlineText,
        deadlineText,
        reminder: reminderText,
        reminderText,
        repeat: repeatText,
        repeatText,
        note: note.trim() || null,
        schedule: scheduleMeta,
        priority: taskPriorityKeyToNumber(priority),
        estimatedMinutes,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const titleMax = ENTITY_TITLE_MAX.subtask;
  const footPad = Math.max(insets.bottom, 12);
  const sheetBg = isDark ? tf.paper2 : tf.card;
  const translateY = sheetY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.min(520, winH * 0.55)],
  });
  const maxSheetH = Math.round(winH * 0.88);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tf.dim, opacity: scrim }]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
          pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: sheetBg,
                borderTopColor: tf.line,
                paddingBottom: footPad,
                maxHeight: maxSheetH,
                transform: [{ translateY }],
                shadowColor: tf.shadow,
              },
            ]}>
            <View style={[styles.handle, { backgroundColor: tf.line2 }]} />

            <View style={styles.sheetH}>
              <View style={[styles.frogmark, { backgroundColor: tf.pond }]}>
                <MaterialIcons name="add" size={16} color={tf.sun} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.sheetTitle, { color: tf.pond, fontFamily: fonts.serif }]}>
                  添加子任务
                </Text>
                <Text style={[styles.sheetSub, { color: tf.faint }]} numberOfLines={2}>
                  挂在「{parentTitle || '父任务'}」下 · 子任务本身不可直接指派为青蛙
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="关闭"
                style={({ pressed }) => [
                  styles.closeBtn,
                  { backgroundColor: isDark ? tf.paper3 : '#F1EDE1', opacity: pressed ? 0.8 : 1 },
                ]}>
                <MaterialIcons name="close" size={16} color={tf.muted} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetBody}>
              <FoldRiseIn animate={animate && visible} index={0} duration={420} staggerMs={40} fromY={10}>
                <View
                  style={[
                    styles.parentCard,
                    {
                      backgroundColor: isDark ? 'rgba(232,239,217,0.12)' : 'rgba(232,239,217,0.36)',
                      borderColor: isDark ? tf.line2 : '#C8D8B1',
                    },
                  ]}>
                  <Text style={{ fontSize: 11, color: '#8A988C' }}>父任务</Text>
                  <Text
                    style={{ fontSize: 13, fontWeight: '700', color: '#4F6152', flex: 1 }}
                    numberOfLines={1}>
                    {parentTitle || '父任务'}
                  </Text>
                  {parentPrioShort ? (
                    <View style={[styles.tagAmber, { backgroundColor: tf.amber2 }]}>
                      <Text style={{ fontSize: 10, color: tf.amberInk, fontWeight: '700' }}>
                        {parentPrioShort}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={animate && visible} index={1} duration={420} staggerMs={40} fromY={10}>
                <TextInput
                  ref={titleInputRef}
                  value={title}
                  onChangeText={(text) => setTitle(clampTitle(text, titleMax))}
                  placeholder="子任务名称…"
                  placeholderTextColor={tf.faint}
                  multiline
                  maxLength={titleMax}
                  style={[
                    styles.titleInput,
                    { color: tf.ink, fontFamily: fonts.serif, borderColor: tf.line },
                  ]}
                />
              </FoldRiseIn>

              <FoldRiseIn animate={animate && visible} index={2} duration={420} staggerMs={40} fromY={10}>
                <View style={styles.chipRow}>
                  {PRIO_CHIPS.map((chip) => {
                    const on = priority === chip.key;
                    return (
                      <Pressable
                        key={chip.key}
                        onPress={() => setPriority(chip.key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={[
                          styles.fchip,
                          on && { backgroundColor: tf.pond, borderColor: tf.pond },
                        ]}>
                        <Text style={[styles.fchipText, { color: on ? tf.onPond : '#7C897E' }]}>
                          {chip.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Text
                    style={{
                      marginLeft: 'auto',
                      fontSize: 10,
                      color: '#A2AAA1',
                      alignSelf: 'center',
                    }}>
                    继承项目标签
                  </Text>
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={animate && visible} index={3} duration={420} staggerMs={40} fromY={10}>
                <View
                  style={[
                    styles.frow,
                    {
                      borderTopColor: 'rgba(232,224,210,0.6)',
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}>
                  <Text style={[styles.frowLab, { color: '#8A968C' }]}>预估时长</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: tf.ink2 }}>
                      {estimatedMinutes} 分钟
                    </Text>
                    <Text style={{ fontSize: 10, color: tf.faint }}>不计入项目总工时</Text>
                  </View>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => bumpEstimate(-5)}
                      style={styles.stepperBtn}
                      accessibilityLabel="减少预估">
                      <Text style={{ color: '#6F7D72', fontWeight: '700' }}>−</Text>
                    </Pressable>
                    <Text
                      style={{
                        fontFamily: fonts.mono,
                        color: '#5C6D60',
                        minWidth: 22,
                        textAlign: 'center',
                      }}>
                      {estimatedMinutes}
                    </Text>
                    <Pressable
                      onPress={() => bumpEstimate(5)}
                      style={styles.stepperBtn}
                      accessibilityLabel="增加预估">
                      <Text style={{ color: '#6F7D72', fontWeight: '700' }}>+</Text>
                    </Pressable>
                  </View>
                </View>

                <View
                  style={[
                    styles.frow,
                    {
                      borderTopColor: 'rgba(232,224,210,0.6)',
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}>
                  <Text style={[styles.frowLab, { color: '#8A968C' }]}>备注</Text>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="可选补充说明"
                    placeholderTextColor={tf.faint}
                    style={[styles.noteInput, { color: tf.ink2 }]}
                  />
                  <MaterialIcons name="edit" size={14} color={tf.faint} />
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={animate && visible} index={4} duration={420} staggerMs={40} fromY={10}>
                <View
                  style={[
                    styles.previewCard,
                    {
                      backgroundColor: isDark ? 'rgba(232,239,217,0.14)' : 'rgba(232,239,217,0.38)',
                      borderColor: isDark ? tf.line2 : '#C8D8B1',
                    },
                  ]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#4F6152' }}>
                      保存后父任务进度 {currPct}% → {nextPct}%
                    </Text>
                    <Text style={{ fontSize: 10, color: '#7F947B', marginTop: 2 }}>
                      子任务数 {progressDone} / {progressTotal || 0} → {progressDone} / {nextTotal}
                      ；子任务不可直接成为青蛙
                    </Text>
                  </View>
                  <View style={[styles.willUpdate, { backgroundColor: tf.lily2 }]}>
                    <Text style={{ fontSize: 10, color: tf.frog, fontWeight: '700' }}>将更新</Text>
                  </View>
                </View>
              </FoldRiseIn>
            </ScrollView>

            <View style={styles.foot2}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.ghostBtn,
                  {
                    borderColor: tf.line2,
                    backgroundColor: isDark ? tf.paper3 : 'rgba(255,252,245,0.55)',
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: tf.ink2 }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleSave()}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: tf.pond, opacity: submitting ? 0.65 : pressed ? 0.9 : 1 },
                ]}>
                <MaterialIcons name="check" size={16} color={tf.onPond} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: tf.onPond }}>保存子任务</Text>
              </Pressable>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheetWrap: { width: '100%', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
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
  sheetH: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  frogmark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: { fontSize: 18, fontWeight: '600' },
  sheetSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: { paddingBottom: 8, gap: 8 },
  parentCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tagAmber: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleInput: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  fchip: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F1EDE1',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fchipText: { fontSize: 12, fontWeight: '600' },
  frow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingVertical: 4,
  },
  frowLab: { width: 64, fontSize: 12, flexShrink: 0 },
  noteInput: { flex: 1, fontSize: 13, paddingVertical: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#F0EBDE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  willUpdate: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foot2: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 4,
  },
  ghostBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    flex: 1.4,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
