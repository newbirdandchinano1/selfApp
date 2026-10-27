/**
 * 格内详情 · 完成确认 — 对齐设计稿 shot 04
 * 底栏 380ms 上滑 · 青蛙跳一次 · 完成前 340ms 确认弹窗 · 说明积分与热力
 */
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { FoldProgressRing } from '@/components/tasks/fold-progress-ring';
import {
  TaskFoldMotion,
  useTaskFoldTheme,
  type TaskFoldPalette,
} from '@/constants/task-fold-theme';
import { formatYmdCN } from '@/lib/date';
import { formatPoints, parseRewardPointsFromExtraData } from '@/lib/reward-points';
import { isFrogSubjectDeleted } from '@/lib/repositories/tasks/frog-completion-events';
import type { ScheduleBreak, SchedulePlacementRow } from '@/lib/schedule/types';
import {
  formatMinutesAsHm,
  placementEndMinutes,
  slotStartMinutes,
} from '@/lib/schedule/axis';
import { ymdForWeekday } from '@/lib/schedule/week';
import { resolveAcceptanceCriteria } from '@/lib/acceptance-criteria';
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

import { Alert } from '@/lib/app-feedback';
export type ScheduleSubjectInfo = {
  kind: 'task' | 'project';
  id: string;
  title: string;
  priority: number;
  dueDate: string | null;
  acceptanceCriteria: string;
  projectName: string | null;
  extraData: string | null;
  status: string;
  done: boolean;
  deletedSnapshot: boolean;
};

/** 格内详情表面：真实青蛙占用 / 习惯虚拟块 / 待办虚拟块 */
export type ScheduleDetailSurface = 'frog' | 'habit' | 'todo';

/** 虚拟块无 placement 时的时刻信息 */
export type ScheduleVirtualSlot = {
  assignYmd: string;
  startSlotIndex: number;
  spanSlots: number;
  hour: number;
  minute: number;
};

type Axis = {
  startMinutes: number;
  endMinutes: number;
  slotHours: number;
  breaks?: ScheduleBreak[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  placement: SchedulePlacementRow | null;
  /** 习惯 / 待办虚拟块：无真实 placement 时用 */
  virtualSlot?: ScheduleVirtualSlot | null;
  /** 默认 frog；虚拟块传 habit / todo */
  surface?: ScheduleDetailSurface;
  axis: Axis;
  subject: ScheduleSubjectInfo | null;
  editable: boolean;
  /** 确认完成后调用（Sheet 内已二次确认） */
  onToggleDone: () => void;
  onRemoveSegment?: () => void;
  onCancelAssign?: () => void;
  onEdit?: () => void;
  /** 改派 / 未入格重新落入时间 */
  onReassignTime?: () => void;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const WEEKDAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function priorityShort(p: number): string {
  if (p >= 4) return 'P1';
  if (p === 3) return 'P2';
  if (p === 2) return 'P3';
  if (p === 1) return 'P4';
  return '未设';
}

function priorityLabel(p: number): string {
  if (p >= 4) return '紧急重要';
  if (p === 3) return '紧急不重要';
  if (p === 2) return '不紧急重要';
  if (p === 1) return '不紧急不重要';
  return '未设优先级';
}

function formatElapsed(mins: number): string {
  if (mins < 1) return '未开始';
  if (mins < 60) return `已进行 ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `已进行 ${h}h ${m}m` : `已进行 ${h}h`;
}

function DetailFrogMark({ tf, size = 34 }: { tf: TaskFoldPalette; size?: number }) {
  const { animate } = useFoldMotionGate();
  const hopY = React.useRef(new Animated.Value(0)).current;
  const hopScale = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!animate) return;
    hopY.setValue(0);
    hopScale.setValue(1);
    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(hopY, {
          toValue: -9,
          duration: Math.round(TaskFoldMotion.frogHop * 0.32),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(hopScale, {
          toValue: 1.04,
          duration: Math.round(TaskFoldMotion.frogHop * 0.32),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(hopY, {
          toValue: 0,
          duration: Math.round(TaskFoldMotion.frogHop * 0.3),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(hopScale, {
          toValue: 0.98,
          duration: Math.round(TaskFoldMotion.frogHop * 0.3),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(hopScale, {
        toValue: 1,
        duration: Math.round(TaskFoldMotion.frogHop * 0.38),
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animate, hopScale, hopY]);

  return (
    <Animated.View
      style={[
        styles.pdi,
        {
          width: size,
          height: size,
          borderRadius: 11,
          backgroundColor: tf.pond,
          transform: [{ translateY: hopY }, { scale: hopScale }],
        },
      ]}>
      <MaterialIcons name="cruelty-free" size={Math.round(size * 0.52)} color={tf.onPond} />
    </Animated.View>
  );
}

export function SchedulePlacementDetailSheet({
  visible,
  onClose,
  placement,
  virtualSlot = null,
  surface = 'frog',
  axis,
  subject,
  editable,
  onToggleDone,
  onRemoveSegment,
  onCancelAssign,
  onEdit,
  onReassignTime,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { tf, isDark, fonts } = useTaskFoldTheme();
  const { animate } = useFoldMotionGate();

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  /** complete = 确认完成/打卡；undo = 撤销完成/打卡（统一走设计稿弹窗，不用系统 Alert） */
  const [confirmKind, setConfirmKind] = React.useState<'complete' | 'undo'>('complete');
  const [nowMins, setNowMins] = React.useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  const scrim = React.useRef(new Animated.Value(0)).current;
  const sheetY = React.useRef(new Animated.Value(1)).current;
  const dialogScale = React.useRef(new Animated.Value(0.92)).current;
  const dialogOpacity = React.useRef(new Animated.Value(0)).current;

  /** 有真实占用即可改派/取消指派（含琥珀黄独立待办占用；与 surface 文案无关） */
  const canManagePlacement = !!placement;

  React.useEffect(() => {
    if (!visible) {
      setConfirmOpen(false);
      scrim.setValue(0);
      sheetY.setValue(1);
      return;
    }
    const tick = () => {
      const d = new Date();
      setNowMins(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [visible, scrim, sheetY]);

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
        duration: TaskFoldMotion.detailSheet,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animate, visible, scrim, sheetY]);

  React.useEffect(() => {
    if (!confirmOpen) {
      dialogScale.setValue(0.92);
      dialogOpacity.setValue(0);
      return;
    }
    if (!animate) {
      dialogScale.setValue(1);
      dialogOpacity.setValue(1);
      return;
    }
    dialogScale.setValue(0.92);
    dialogOpacity.setValue(0);
    const anim = Animated.parallel([
      Animated.timing(dialogOpacity, {
        toValue: 1,
        duration: TaskFoldMotion.confirmDialog,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
      Animated.timing(dialogScale, {
        toValue: 1,
        duration: TaskFoldMotion.confirmDialog,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animate, confirmOpen, dialogOpacity, dialogScale]);

  const deleted =
    canManagePlacement &&
    (!!subject?.deletedSnapshot || isFrogSubjectDeleted(subject?.extraData ?? null));
  const readOnly = !editable || deleted;
  const isOrphaned =
    canManagePlacement && (placement!.orphaned === 1 || placement!.startSlotIndex == null);
  const rewardPts = parseRewardPointsFromExtraData(subject?.extraData);
  const rewardLabel =
    rewardPts !== 0 ? `${rewardPts > 0 ? '+' : ''}${formatPoints(rewardPts)} 积分` : null;

  const assignYmd = placement
    ? ymdForWeekday(placement.weekStartYmd, placement.weekday)
    : (virtualSlot?.assignYmd ?? '');
  const weekdayIdx = placement
    ? ((placement.weekday - 1 + 7) % 7)
    : assignYmd
      ? ((new Date(`${assignYmd}T12:00:00`).getDay() + 6) % 7)
      : 0;

  const startMins = (() => {
    if (virtualSlot) {
      return virtualSlot.hour * 60 + virtualSlot.minute;
    }
    if (placement && placement.startSlotIndex != null && !placement.orphaned) {
      return slotStartMinutes(axis, placement.startSlotIndex);
    }
    return null;
  })();
  const endMins = (() => {
    if (virtualSlot) {
      return placementEndMinutes(axis, virtualSlot.startSlotIndex, virtualSlot.spanSlots);
    }
    if (placement && placement.startSlotIndex != null && !placement.orphaned) {
      return placementEndMinutes(axis, placement.startSlotIndex, placement.spanSlots);
    }
    return null;
  })();

  const timeRange =
    virtualSlot != null
      ? `${pad2(virtualSlot.hour)}:${pad2(virtualSlot.minute)}`
      : startMins != null && endMins != null
        ? `${formatMinutesAsHm(startMins)}–${formatMinutesAsHm(endMins)}`
        : '未入格';

  const elapsedMins =
    startMins != null && endMins != null
      ? Math.max(0, Math.min(endMins, nowMins) - startMins)
      : 0;
  const spanMins =
    startMins != null && endMins != null ? Math.max(1, endMins - startMins) : 1;
  const progressRatio = subject?.done
    ? 1
    : startMins == null
      ? 0
      : Math.max(0, Math.min(1, elapsedMins / spanMins));

  const dateLine = assignYmd
    ? `${formatYmdCN(assignYmd).replace(/^\d+年/, '')} ${WEEKDAY_CN[weekdayIdx]} · ${timeRange}${
        subject?.done ? ' · 已完成' : startMins != null ? ` · ${formatElapsed(elapsedMins)}` : ''
      }`
    : timeRange;

  const primaryChipLabel =
    surface === 'habit' ? '习惯' : surface === 'todo' ? '待办' : '青蛙';
  const secondaryChipLabel =
    surface === 'habit'
      ? '习惯虚拟块'
      : surface === 'todo'
        ? '虚拟入格'
        : subject?.kind === 'task'
          ? '叶子任务'
          : '项目';
  const confirmTitle =
    confirmKind === 'undo'
      ? surface === 'habit'
        ? '撤销这项打卡？'
        : surface === 'todo'
          ? '撤销待办完成？'
          : '取消青蛙完成？'
      : surface === 'habit'
        ? '完成这项习惯？'
        : surface === 'todo'
          ? '完成这项待办？'
          : '完成这只青蛙？';
  const confirmStatPrimary =
    confirmKind === 'undo'
      ? surface === 'habit'
        ? '撤销打卡'
        : surface === 'todo'
          ? '待办撤销'
          : '青蛙撤销'
      : surface === 'habit'
        ? '习惯打卡'
        : surface === 'todo'
          ? '待办 +1'
          : '青蛙 +1';
  const confirmBodyLead =
    confirmKind === 'undo'
      ? surface === 'habit'
        ? '撤销后恢复未打卡状态，热力会按规则回退'
        : '撤销完成后恢复原积分与热力'
      : surface === 'habit'
        ? '打卡后计入今日习惯与完成热力'
        : '完成后计入今日完成热力';
  const confirmPrimaryLabel =
    confirmKind === 'undo'
      ? surface === 'habit'
        ? '撤销打卡'
        : '撤销完成'
      : surface === 'habit'
        ? '打卡'
        : '完成';
  const detailBtnLabel = surface === 'habit' ? '习惯详情' : surface === 'todo' ? '待办详情' : '任务详情';
  const noteText = subject?.done
    ? surface === 'habit'
      ? '撤销后恢复未打卡状态，热力会按规则回退。'
      : '撤销完成后恢复原积分与热力。'
    : surface === 'habit'
      ? `打卡会计入今日习惯与热力，并延迟 ${TaskFoldMotion.heatRefreshDebounce}ms 刷新；若误点可撤销。`
      : rewardPts !== 0
        ? `完成会结算 ${rewardPts > 0 ? '+' : ''}${formatPoints(rewardPts)} 积分，并延迟 ${TaskFoldMotion.heatRefreshDebounce}ms 刷新热力；撤销完成后恢复原积分与热力。`
        : `完成会计入今日热力，并延迟 ${TaskFoldMotion.heatRefreshDebounce}ms 刷新；若误点可在热力日明细中撤销。`;

  const translateY = sheetY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.min(420, winH * 0.55)],
  });

  const openCompleteConfirm = () => {
    if (readOnly || !subject) return;
    setConfirmKind(subject.done ? 'undo' : 'complete');
    setConfirmOpen(true);
  };

  const confirmComplete = () => {
    setConfirmOpen(false);
    onClose();
    onToggleDone();
  };

  const sheetBg = isDark ? tf.paper2 : '#FFFCF5';
  const heroIconName: React.ComponentProps<typeof MaterialIcons>['name'] =
    surface === 'habit' ? 'spa' : surface === 'todo' ? 'check-circle-outline' : 'cruelty-free';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tf.dim, opacity: scrim }]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: sheetBg,
              borderTopColor: tf.line,
              paddingBottom: Math.max(insets.bottom, 14),
              maxHeight: winH * 0.72,
              transform: [{ translateY }],
              shadowColor: tf.shadow,
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: tf.line2 }]} />

          {/* pd-hero */}
          <View style={styles.pdHero}>
            {surface === 'frog' ? (
              <DetailFrogMark tf={tf} />
            ) : (
              <View style={[styles.pdi, { width: 34, height: 34, borderRadius: 12, backgroundColor: tf.lily2 }]}>
                <MaterialIcons name={heroIconName} size={20} color={tf.frog} />
              </View>
            )}
            <View style={styles.pdc}>
              <Text style={[styles.pdTitle, { color: tf.ink2 }]} numberOfLines={2}>
                {subject?.title?.trim() ||
                  (surface === 'habit' ? '习惯详情' : surface === 'todo' ? '待办详情' : '青蛙详情')}
              </Text>
              <Text style={[styles.pdSub, { color: tf.faint }]} numberOfLines={2}>
                {dateLine}
              </Text>
            </View>
            <FoldProgressRing
              ratio={progressRatio}
              size={37}
              strokeWidth={3}
              color={tf.sun}
              trackColor={isDark ? tf.line2 : '#E6E1D4'}
            />
          </View>

          {/* pd-meta chips */}
          <View style={styles.pdMeta}>
            <View
              style={[
                styles.fchip,
                styles.fchipOn,
                {
                  backgroundColor:
                    surface === 'habit' ? '#A8BE8C' : surface === 'todo' ? '#D6974B' : tf.pond,
                },
              ]}>
              <Text
                style={[
                  styles.fchipText,
                  {
                    color:
                      surface === 'habit' || surface === 'todo' ? '#FFFCF5' : tf.onPond,
                  },
                ]}>
                {primaryChipLabel}
              </Text>
            </View>
            <View style={[styles.fchip, { backgroundColor: isDark ? tf.paper3 : '#F4EFE2' }]}>
              <Text style={[styles.fchipText, { color: tf.muted }]}>{secondaryChipLabel}</Text>
            </View>
            {surface !== 'habit' ? (
              <View style={[styles.fchip, { backgroundColor: isDark ? tf.paper3 : '#F4EFE2' }]}>
                <Text style={[styles.fchipText, { color: tf.muted }]}>
                  {priorityShort(subject?.priority ?? 0)}
                </Text>
              </View>
            ) : null}
            {subject?.projectName ? (
              <View style={[styles.fchip, { backgroundColor: isDark ? tf.paper3 : '#F4EFE2' }]}>
                <Text style={[styles.fchipText, { color: tf.muted }]} numberOfLines={1}>
                  {subject.projectName}
                </Text>
              </View>
            ) : null}
            {rewardLabel ? (
              <View style={[styles.fchip, { backgroundColor: tf.amber2 }]}>
                <Text style={[styles.fchipText, { color: tf.amberInk }]}>{rewardLabel}</Text>
              </View>
            ) : null}
            {isOrphaned ? (
              <View style={[styles.fchip, { backgroundColor: tf.rose2 }]}>
                <Text style={[styles.fchipText, { color: tf.rose }]}>未入格</Text>
              </View>
            ) : null}
            {deleted ? (
              <View style={[styles.fchip, { backgroundColor: tf.rose2 }]}>
                <Text style={[styles.fchipText, { color: tf.rose }]}>已删除快照</Text>
              </View>
            ) : null}
          </View>

          {/* pd-actions：青蛙 完成/改派/取消指派/详情；虚拟块仅完成（+ 可选详情） */}
          <View style={styles.pdActions}>
            {!deleted ? (
              <Pressable
                disabled={readOnly}
                onPress={openCompleteConfirm}
                style={({ pressed }) => [
                  styles.pdAct,
                  styles.pdActMain,
                  {
                    backgroundColor: tf.pond,
                    borderColor: tf.pond,
                    opacity: readOnly ? 0.4 : pressed ? 0.9 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  subject?.done
                    ? surface === 'habit'
                      ? '撤销打卡'
                      : '取消完成'
                    : surface === 'habit'
                      ? '打卡'
                      : '完成'
                }>
                <MaterialIcons
                  name={subject?.done ? 'undo' : 'check'}
                  size={16}
                  color={tf.onPond}
                />
                <Text style={[styles.pdActLabel, { color: tf.onPond }]}>
                  {subject?.done
                    ? surface === 'habit'
                      ? '撤销打卡'
                      : '撤销完成'
                    : surface === 'habit'
                      ? '打卡'
                      : '完成'}
                </Text>
              </Pressable>
            ) : null}

            {canManagePlacement && onReassignTime ? (
              <Pressable
                disabled={readOnly}
                onPress={onReassignTime}
                style={({ pressed }) => [
                  styles.pdAct,
                  {
                    backgroundColor: isDark ? tf.paper3 : 'rgba(255,252,245,0.7)',
                    borderColor: isDark ? tf.line : 'rgba(216,205,187,0.7)',
                    opacity: readOnly ? 0.4 : pressed ? 0.88 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={isOrphaned ? '重新指派时间' : '改派'}>
                <MaterialIcons name="refresh" size={16} color={tf.muted} />
                <Text style={[styles.pdActLabel, { color: '#748478' }]}>
                  {isOrphaned ? '重新指派' : '改派'}
                </Text>
              </Pressable>
            ) : null}

            {canManagePlacement && onCancelAssign ? (
              <Pressable
                disabled={readOnly}
                onPress={() => {
                  Alert.alert('取消指派', '将去掉该日全部占用并取消该日青蛙指派（其它日保留）。', [
                    { text: '保留', style: 'cancel' },
                    { text: '取消指派', style: 'destructive', onPress: onCancelAssign },
                  ]);
                }}
                style={({ pressed }) => [
                  styles.pdAct,
                  {
                    backgroundColor: isDark ? tf.paper3 : 'rgba(255,252,245,0.7)',
                    borderColor: isDark ? tf.line : 'rgba(216,205,187,0.7)',
                    opacity: readOnly ? 0.4 : pressed ? 0.88 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="取消指派">
                <MaterialIcons name="close" size={16} color={tf.clay} />
                <Text style={[styles.pdActLabel, { color: '#A56547' }]}>取消指派</Text>
              </Pressable>
            ) : null}

            {onEdit ? (
              <Pressable
                disabled={deleted}
                onPress={onEdit}
                style={({ pressed }) => [
                  styles.pdAct,
                  {
                    backgroundColor: isDark ? tf.paper3 : 'rgba(255,252,245,0.7)',
                    borderColor: isDark ? tf.line : 'rgba(216,205,187,0.7)',
                    opacity: deleted ? 0.4 : pressed ? 0.88 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={detailBtnLabel}>
                <MaterialIcons name="north-east" size={16} color={tf.muted} />
                <Text style={[styles.pdActLabel, { color: '#748478' }]}>{detailBtnLabel}</Text>
              </Pressable>
            ) : null}
          </View>

          {canManagePlacement && !isOrphaned && onRemoveSegment ? (
            <Pressable
              disabled={readOnly}
              onPress={() => {
                Alert.alert(
                  '从本格段移除',
                  '仅删除这一段占用；若该日已无其它占用将取消当日指派。',
                  [
                    { text: '取消', style: 'cancel' },
                    { text: '移除', style: 'destructive', onPress: onRemoveSegment },
                  ],
                );
              }}
              style={({ pressed }) => [{ opacity: readOnly ? 0.4 : pressed ? 0.7 : 1, paddingVertical: 4 }]}>
              <Text style={{ fontSize: 11, color: tf.faint, textAlign: 'center' }}>
                仅移除本格段 · {priorityLabel(subject?.priority ?? 0)}
              </Text>
            </Pressable>
          ) : null}

          <Text style={[styles.pdNote, { color: tf.faint }]}>{noteText}</Text>

          {(subject?.acceptanceCriteria || '').trim() ? (
            <Text style={[styles.pdAccept, { color: tf.muted }]} numberOfLines={2}>
              验收 · {(subject?.acceptanceCriteria || '').trim()}
            </Text>
          ) : null}

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
              <Text style={[styles.ghostBtnText, { color: tf.ink2 }]}>关闭</Text>
            </Pressable>
            {!deleted ? (
              <Pressable
                disabled={readOnly}
                onPress={openCompleteConfirm}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: readOnly ? tf.faint : tf.pond,
                    opacity: pressed && !readOnly ? 0.92 : 1,
                    shadowColor: tf.shadow,
                  },
                ]}>
                <MaterialIcons
                  name={subject?.done ? 'undo' : 'check'}
                  size={16}
                  color={tf.onPond}
                />
                <Text style={[styles.primaryBtnText, { color: tf.onPond }]}>
                  {subject?.done
                    ? surface === 'habit'
                      ? '撤销打卡'
                      : '撤销完成'
                    : surface === 'habit'
                      ? '确认打卡'
                      : '标记完成'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>

        {/* 完成确认弹窗 */}
        {confirmOpen ? (
          <View style={styles.dialogWrap} pointerEvents="box-none">
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setConfirmOpen(false)}
              accessibilityLabel="关闭确认"
            />
            <Animated.View
              style={[
                styles.dialog,
                {
                  backgroundColor: isDark ? tf.paper2 : '#FBF7ED',
                  borderColor: isDark ? tf.line : 'rgba(255,255,255,0.65)',
                  opacity: dialogOpacity,
                  transform: [{ scale: dialogScale }],
                  shadowColor: tf.shadow,
                },
              ]}>
              <View style={[styles.dic, { backgroundColor: tf.lily2 }]}>
                <MaterialIcons name={heroIconName} size={20} color={tf.frog} />
              </View>
              <Text style={[styles.dialogTitle, { color: tf.pond, fontFamily: fonts.serif }]}>
                {confirmTitle}
              </Text>
              <Text style={[styles.dialogBody, { color: '#7E8C81' }]}>
                {confirmBodyLead}
                {confirmKind === 'complete' && rewardPts !== 0 ? `，并结算 ` : '。'}
                {confirmKind === 'complete' && rewardPts !== 0 ? (
                  <Text style={{ fontWeight: '800', color: tf.pond }}>
                    {rewardPts > 0 ? '+' : ''}
                    {formatPoints(rewardPts)}
                  </Text>
                ) : null}
                {confirmKind === 'complete' && rewardPts !== 0 ? ' 积分。' : ''}
                {confirmKind === 'complete' ? '若误点，可撤销。' : ''}
              </Text>
              <View style={styles.dstats}>
                <View style={[styles.dstat, { backgroundColor: 'rgba(232,239,217,0.65)' }]}>
                  <Text style={[styles.dstatText, { color: '#5D7A57', fontFamily: fonts.mono }]}>
                    {confirmStatPrimary}
                  </Text>
                </View>
                <View style={[styles.dstat, { backgroundColor: 'rgba(232,239,217,0.65)' }]}>
                  <Text style={[styles.dstatText, { color: '#5D7A57', fontFamily: fonts.mono }]}>
                    积分{' '}
                    {confirmKind === 'undo'
                      ? rewardPts !== 0
                        ? `${rewardPts > 0 ? '-' : '+'}${formatPoints(Math.abs(rewardPts))}`
                        : '—'
                      : rewardPts !== 0
                        ? `${rewardPts > 0 ? '+' : ''}${formatPoints(rewardPts)}`
                        : '—'}
                  </Text>
                </View>
                <View style={[styles.dstat, { backgroundColor: 'rgba(232,239,217,0.65)' }]}>
                  <Text style={[styles.dstatText, { color: '#5D7A57', fontFamily: fonts.mono }]}>
                    {confirmKind === 'undo' ? '热力 ↓' : '热力 ↑'}
                  </Text>
                </View>
              </View>
              <View style={styles.dbtns}>
                <Pressable
                  onPress={() => setConfirmOpen(false)}
                  style={({ pressed }) => [
                    styles.dbtn,
                    { backgroundColor: '#EDE7D9', opacity: pressed ? 0.88 : 1 },
                  ]}>
                  <Text style={[styles.dbtnText, { color: '#7C887D' }]}>再看看</Text>
                </Pressable>
                <Pressable
                  onPress={confirmComplete}
                  style={({ pressed }) => [
                    styles.dbtn,
                    { backgroundColor: tf.pond, opacity: pressed ? 0.92 : 1 },
                  ]}>
                  <Text style={[styles.dbtnText, { color: tf.onPond }]}>{confirmPrimaryLabel}</Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** 供外部组装 subject 信息时复用 */
export function buildAcceptance(description: string | null, note: string | null): string {
  return resolveAcceptanceCriteria(description, note);
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 6,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  pdHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 3,
    paddingBottom: 7,
  },
  pdi: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pdc: { flex: 1, minWidth: 0 },
  pdTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  pdSub: { fontSize: 11, marginTop: 3, lineHeight: 15 },
  pdMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    paddingHorizontal: 2,
    marginBottom: 8,
  },
  fchip: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fchipOn: {},
  fchipText: { fontSize: 10, fontWeight: '700' },
  pdActions: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  pdAct: {
    flex: 1,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pdActMain: {},
  pdActLabel: { fontSize: 10, fontWeight: '700' },
  pdNote: {
    fontSize: 10.5,
    lineHeight: 15,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  pdAccept: {
    fontSize: 10.5,
    lineHeight: 15,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  foot2: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  ghostBtn: {
    flex: 1,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: { fontSize: 13, fontWeight: '700' },
  primaryBtn: {
    flex: 1.35,
    height: 42,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryBtnText: { fontSize: 13, fontWeight: '800' },
  dialogWrap: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(25,34,28,0.44)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    paddingHorizontal: 28,
  },
  dialog: {
    width: '100%',
    maxWidth: 300,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 13,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.28,
    shadowRadius: 40,
    elevation: 16,
  },
  dic: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  dialogTitle: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  dialogBody: { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  dstats: { flexDirection: 'row', gap: 4, marginBottom: 12 },
  dstat: {
    flex: 1,
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  dstatText: { fontSize: 10, fontWeight: '700' },
  dbtns: { flexDirection: 'row', gap: 5 },
  dbtn: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dbtnText: { fontSize: 13, fontWeight: '800' },
});
