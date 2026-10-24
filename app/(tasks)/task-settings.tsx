/**
 * 设置 · 逻辑日与同步 — 对齐设计稿 shot 27
 * 日月弧线 · 日界 knob · 同步环 · 热力色阶 · FoldRiseIn
 */
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { useSettingsDrawerOptional } from '@/components/settings-drawer/settings-drawer-context';
import { FrogScheduleSettingsSheet } from '@/components/tasks/FrogScheduleSettingsSheet';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { notifyTasksPreferReduceMotionChanged } from '@/hooks/use-reduced-motion';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { getLastFullCloudBackupAtIso } from '@/lib/cloud-backup-meta';
import { getScheduleAxisSettings } from '@/lib/repositories/schedule/schedule-store';
import {
  DAY_BOUNDARY_PAGE_OPTIONS,
  formatTasksDayBoundaryLabel,
  type DayBoundaryPageId,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import {
  loadTasksFocusSync,
  loadTasksLocalEncrypt,
  loadTasksPreferReduceMotion,
  loadTasksWifiOnlyAttachments,
  saveTasksFocusSync,
  saveTasksLocalEncrypt,
  saveTasksPreferReduceMotion,
  saveTasksWifiOnlyAttachments,
} from '@/lib/tasks-ui-settings';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function minutesToLabel(mins: number) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function boundaryToRatio(b: TasksDayBoundary): number {
  return Math.max(0, Math.min(1, (b.hour * 60 + b.minute) / (24 * 60)));
}

function ratioToBoundary(ratio: number): TasksDayBoundary {
  const total = Math.round(Math.max(0, Math.min(1, ratio)) * 24 * 60);
  // 按 15 分钟对齐，便于操作
  const snapped = Math.round(total / 15) * 15;
  const clamped = Math.max(0, Math.min(24 * 60 - 15, snapped));
  return { hour: Math.floor(clamped / 60), minute: clamped % 60 };
}

function DayArcKnob({
  boundary,
  onChange,
  animate,
}: {
  boundary: TasksDayBoundary;
  onChange: (next: TasksDayBoundary) => void;
  animate: boolean;
}) {
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const [trackW, setTrackW] = React.useState(0);
  const ratio = useSharedValue(boundaryToRatio(boundary));
  const startRatio = useSharedValue(boundaryToRatio(boundary));

  React.useEffect(() => {
    const r = boundaryToRatio(boundary);
    if (animate) {
      ratio.value = withTiming(r, { duration: TaskFoldMotion.progressTween });
    } else {
      ratio.value = r;
    }
  }, [animate, boundary, ratio]);

  const commit = React.useCallback(
    (r: number) => {
      onChange(ratioToBoundary(r));
    },
    [onChange],
  );

  const pan = Gesture.Pan()
    .onBegin(() => {
      startRatio.value = ratio.value;
    })
    .onUpdate((e) => {
      if (trackW <= 0) return;
      const next = Math.max(0, Math.min(1, startRatio.value + e.translationX / trackW));
      ratio.value = next;
    })
    .onEnd(() => {
      runOnJS(commit)(ratio.value);
    });

  const fillStyle = useAnimatedStyle(() => ({
    width: `${ratio.value * 100}%`,
  }));
  const knobStyle = useAnimatedStyle(() => ({
    left: `${ratio.value * 100}%`,
  }));
  const arcLineStyle = useAnimatedStyle(() => ({
    left: `${ratio.value * 100}%`,
  }));

  const label = formatTasksDayBoundaryLabel(boundary);

  return (
    <View>
      <View
        style={[
          styles.dayarc,
          { backgroundColor: isDark ? tf.paper2 : undefined },
          !isDark && styles.dayarcLight,
        ]}>
        <View style={styles.sunm} />
        <View style={[styles.moonm, { backgroundColor: isDark ? '#6A7B72' : '#CBD8C6' }]} />
        <View style={[styles.arcDash, { borderColor: isDark ? tf.line2 : '#C9C3B2' }]} />
        <Animated.View style={[styles.boundary2, { borderColor: tf.sun }, arcLineStyle]}>
          <View style={[styles.boundaryBadge, { backgroundColor: tf.sun2, borderColor: '#E8CDA2' }]}>
            <Text style={[styles.boundaryBadgeText, { color: tf.amberInk, fontFamily: fonts.mono }]}>
              {label}
            </Text>
          </View>
        </Animated.View>
        <View style={styles.arcLabels}>
          <Text style={[styles.arcLabel, { color: tf.faint }]}>00:00</Text>
          <Text style={[styles.arcLabelBold, { color: '#5E6F61', fontFamily: fonts.mono }]}>
            {label} 前算前一天
          </Text>
          <Text style={[styles.arcLabel, { color: tf.faint }]}>24:00</Text>
        </View>
      </View>

      <GestureDetector gesture={pan}>
        <View
          style={styles.slidertrack}
          onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}>
          <View style={[styles.sliderBg, { backgroundColor: tf.track }]} />
          <Animated.View style={[styles.sliderFill, { backgroundColor: tf.sun }, fillStyle]} />
          <Animated.View style={[styles.knob, { backgroundColor: tf.white, borderColor: tf.sun }, knobStyle]} />
        </View>
      </GestureDetector>
      <View style={styles.setsliderLabels}>
        {['00', '06', '12', '18', '24'].map((t) => (
          <Text key={t} style={{ fontSize: 10, color: tf.faint, fontFamily: fonts.mono }}>
            {t}
          </Text>
        ))}
      </View>
    </View>
  );
}

function SetRow({
  icon,
  title,
  hint,
  value,
  onValueChange,
  showTopBorder,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  hint: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  showTopBorder?: boolean;
}) {
  const { tf } = useTaskFoldTheme();
  return (
    <View
      style={[
        styles.setrow,
        showTopBorder ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tf.line } : null,
      ]}>
      <View style={[styles.si, { backgroundColor: tf.lily2 }]}>
        <MaterialIcons name={icon} size={16} color={tf.frog} />
      </View>
      <View style={styles.sc}>
        <Text style={[styles.scTitle, { color: tf.ink2 }]}>{title}</Text>
        <Text style={[styles.scHint, { color: tf.faint }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: tf.track, true: tf.frog }}
        thumbColor={tf.white}
        ios_backgroundColor={tf.track}
      />
    </View>
  );
}

export default function TaskSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const settingsDrawer = useSettingsDrawerOptional();
  const openBackup = React.useCallback(() => {
    if (settingsDrawer) {
      settingsDrawer.open('backup');
      return;
    }
    toast.info('请返回主页后从左缘滑出设置，打开云备份');
  }, [settingsDrawer]);
  const {
    boundary,
    pages,
    setBoundary,
    setPages,
    isReady: dayReady,
  } = useDayBoundary();

  const [focusSync, setFocusSync] = React.useState(true);
  const [wifiOnly, setWifiOnly] = React.useState(true);
  const [localEncrypt, setLocalEncrypt] = React.useState(true);
  const [reduceMotionPref, setReduceMotionPref] = React.useState(false);
  const [axisLabel, setAxisLabel] = React.useState('08:00–20:00');
  const [backupLabel, setBackupLabel] = React.useState('尚未备份');
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [savingBoundary, setSavingBoundary] = React.useState(false);

  const reloadMeta = React.useCallback(async () => {
    const [fs, wo, le, rm, axis, backupIso] = await Promise.all([
      loadTasksFocusSync(),
      loadTasksWifiOnlyAttachments(),
      loadTasksLocalEncrypt(),
      loadTasksPreferReduceMotion(),
      getScheduleAxisSettings().catch(() => null),
      getLastFullCloudBackupAtIso().catch(() => null),
    ]);
    setFocusSync(fs);
    setWifiOnly(wo);
    setLocalEncrypt(le);
    setReduceMotionPref(rm);
    if (axis) {
      setAxisLabel(`${minutesToLabel(axis.startMinutes)}–${minutesToLabel(axis.endMinutes)}`);
    }
    if (backupIso) {
      const d = new Date(backupIso);
      if (!Number.isNaN(d.getTime())) {
        setBackupLabel(
          `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())} · 自动保留`,
        );
      }
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void reloadMeta();
    }, [reloadMeta]),
  );

  const onBoundaryChange = React.useCallback(
    (next: TasksDayBoundary) => {
      if (savingBoundary) return;
      setSavingBoundary(true);
      void (async () => {
        try {
          await setBoundary(next);
          toast.success(`日界已设为 ${formatTasksDayBoundaryLabel(next)} · 历史热力不重算`);
        } catch (e) {
          toast.error(toUserMessage(e, '未能保存日界'));
        } finally {
          setSavingBoundary(false);
        }
      })();
    },
    [savingBoundary, setBoundary],
  );

  const togglePage = React.useCallback(
    (page: DayBoundaryPageId, enabled: boolean) => {
      const next = enabled
        ? Array.from(new Set([...pages, page]))
        : pages.filter((p) => p !== page);
      void setPages(next).catch((e) => toast.error(toUserMessage(e, '未能更新作用页')));
    },
    [pages, setPages],
  );

  const cardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.9)';
  const footPad = Math.max(insets.bottom, 12);
  const boundaryLabel = formatTasksDayBoundaryLabel(boundary);
  let rise = 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <View style={[styles.appbar, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconbtnSoft, { borderColor: 'transparent', opacity: pressed ? 0.75 : 1 }]}>
          <MaterialIcons name="arrow-back" size={20} color={tf.ink2} />
        </Pressable>
        <View style={styles.appbarCenter}>
          <Text style={[styles.appbarTitle, { color: tf.ink }]}>设置</Text>
          <Text style={[styles.appbarSub, { color: tf.muted }]}>全局 · 本机优先 · v2.4</Text>
        </View>
        <Pressable
          onPress={openBackup}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconbtnSoft,
            {
              backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.7)',
              borderColor: tf.line2,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <MaterialIcons name="sync" size={18} color={tf.ink2} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 28 + footPad }]}
        showsVerticalScrollIndicator={false}>
        <FoldRiseIn animate={foldAnimate} index={rise++} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.setcard, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.sh}>
              <Text style={[styles.shTitle, { color: tf.ink2 }]}>逻辑日</Text>
              <Text style={[styles.shSide, { color: tf.faint }]}>当前 {boundaryLabel}</Text>
            </View>
            {dayReady ? (
              <DayArcKnob boundary={boundary} onChange={onBoundaryChange} animate={foldAnimate} />
            ) : (
              <View style={{ height: 120 }} />
            )}
            <View style={[styles.hintline, { marginTop: 8 }]}>
              <MaterialIcons name="lightbulb-outline" size={13} color={tf.sun} />
              <Text style={[styles.hintText, { color: tf.muted }]}>
                凌晨 {boundaryLabel} 前完成的记录归入前一个逻辑日；历史热力不重算。
              </Text>
            </View>
            <Text style={[styles.pageHint, { color: tf.faint }]}>作用页面</Text>
            {DAY_BOUNDARY_PAGE_OPTIONS.map((opt) => {
              const on = pages.includes(opt.id);
              return (
                <View key={opt.id} style={[styles.pageRow, { borderColor: tf.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.scTitle, { color: tf.ink2 }]}>{opt.label}</Text>
                    <Text style={[styles.scHint, { color: tf.faint }]}>{opt.hint}</Text>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={(v) => togglePage(opt.id, v)}
                    trackColor={{ false: tf.track, true: tf.frog }}
                    thumbColor={tf.white}
                  />
                </View>
              );
            })}
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={rise++} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <Pressable
            onPress={() => router.push('/quick-add-edit')}
            style={({ pressed }) => [
              styles.setcard,
              {
                backgroundColor: cardBg,
                borderColor: tf.line2,
                opacity: pressed ? 0.9 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              },
            ]}>
            <View style={[styles.si, { backgroundColor: tf.sun2, width: 40, height: 40, borderRadius: 12 }]}>
              <MaterialIcons name="bolt" size={20} color={tf.sun} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.shTitle, { color: tf.ink2, marginBottom: 2 }]}>快捷卡管理</Text>
              <Text style={[styles.scHint, { color: tf.faint }]}>
                健康 · 一句话快捷卡 · 启停与排序
              </Text>
            </View>
            <Text style={[styles.sv, { color: '#6F856B' }]}>打开 ›</Text>
          </Pressable>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={rise++} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.setcard, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.sh}>
              <Text style={[styles.shTitle, { color: tf.ink2 }]}>同步</Text>
              <Text style={[styles.shSide, { color: tf.faint }]}>本机优先</Text>
            </View>
            <SetRow
              icon="sync"
              title="下拉 / 聚焦同步"
              hint="打开应用与回到前台时增量拉取"
              value={focusSync}
              onValueChange={(v) => {
                setFocusSync(v);
                void saveTasksFocusSync(v);
                toast.success(v ? '已开启 · 聚焦同步' : '已关闭 · 仅手动下拉');
              }}
            />
            <SetRow
              icon="wifi"
              title="仅 Wi-Fi 下同步附件"
              hint="图片与 PDF 验收材料"
              value={wifiOnly}
              onValueChange={(v) => {
                setWifiOnly(v);
                void saveTasksWifiOnlyAttachments(v);
              }}
              showTopBorder
            />
            <SetRow
              icon="lock-outline"
              title="本机加密"
              hint="设备级密钥 · 私有云备份"
              value={localEncrypt}
              onValueChange={(v) => {
                setLocalEncrypt(v);
                void saveTasksLocalEncrypt(v);
              }}
              showTopBorder
            />
            <Pressable
              onPress={() => openBackup()}
              style={({ pressed }) => [
                styles.syncbar,
                { backgroundColor: isDark ? tf.lily2 : '#E9F0DF', opacity: pressed ? 0.88 : 1 },
              ]}>
              <View style={[styles.syncDot, { backgroundColor: '#6E9565' }]} />
              <Text style={[styles.syncText, { color: '#587752' }]} numberOfLines={1}>
                {backupLabel} · 冲突保留本机版本
              </Text>
              <Text style={{ fontSize: 11, color: '#7D9576', fontWeight: '600' }}>查看 ›</Text>
            </Pressable>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={rise++} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.setcard, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.sh}>
              <Text style={[styles.shTitle, { color: tf.ink2 }]}>日程轴</Text>
              <Text style={[styles.shSide, { color: tf.faint }]}>{axisLabel}</Text>
            </View>
            <Pressable
              onPress={() => setScheduleOpen(true)}
              style={({ pressed }) => [styles.setrow, { opacity: pressed ? 0.85 : 1 }]}>
              <View style={styles.sc}>
                <Text style={[styles.scTitle, { color: tf.ink2 }]}>工作时段</Text>
                <Text style={[styles.scHint, { color: tf.faint }]}>最简档只显示当前时段前后 30 分钟</Text>
              </View>
              <Text style={[styles.sv, { color: tf.muted }]}>{axisLabel} ›</Text>
            </Pressable>
            <Pressable
              onPress={() => toast.info('进入任务主屏默认「今日列表」')}
              style={({ pressed }) => [
                styles.setrow,
                {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: tf.line,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <View style={styles.sc}>
                <Text style={[styles.scTitle, { color: tf.ink2 }]}>默认缩放</Text>
                <Text style={[styles.scHint, { color: tf.faint }]}>进入任务主屏时</Text>
              </View>
              <Text style={[styles.sv, { color: tf.muted }]}>今日列表 ›</Text>
            </Pressable>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={rise++} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.setcard, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.sh}>
              <Text style={[styles.shTitle, { color: tf.ink2 }]}>完成热力</Text>
              <Text style={[styles.shSide, { color: tf.faint }]}>少 → 多</Text>
            </View>
            <View style={styles.colorsteps}>
              {[tf.heat0, tf.heat1, tf.heat2, tf.heat3, tf.heat4, tf.heat5].map((c, i) => (
                <View key={i} style={[styles.colorstep, { backgroundColor: c }]} />
              ))}
            </View>
            <View style={styles.miniheatlegend}>
              {['0', '1–2', '3–4', '5–6', '7–8', '9+'].map((t) => (
                <Text key={t} style={{ fontSize: 10, color: tf.faint, flex: 1, textAlign: 'center' }}>
                  {t}
                </Text>
              ))}
              <Text style={{ fontSize: 10, color: tf.faint, marginLeft: 4 }}>按逻辑日聚合</Text>
            </View>
            <SetRow
              icon="animation"
              title="减弱动效"
              hint="保留状态变化，移除呼吸与粒子"
              value={reduceMotionPref}
              onValueChange={(v) => {
                setReduceMotionPref(v);
                void saveTasksPreferReduceMotion(v);
                notifyTasksPreferReduceMotionChanged(v);
                toast.success(v ? '已减弱动效 · 仅保留短淡入' : '已恢复完整动效');
              }}
              showTopBorder
            />
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={rise++} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.setcard, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.sh}>
              <Text style={[styles.shTitle, { color: tf.ink2 }]}>数据与隐私</Text>
              <Text style={[styles.shSide, { color: tf.faint }]}>仅本机可读</Text>
            </View>
            <Pressable
              onPress={() => openBackup()}
              style={({ pressed }) => [styles.setrow, { opacity: pressed ? 0.85 : 1 }]}>
              <View style={[styles.si, { backgroundColor: tf.lily2 }]}>
                <MaterialIcons name="folder" size={16} color={tf.frog} />
              </View>
              <View style={styles.sc}>
                <Text style={[styles.scTitle, { color: tf.ink2 }]}>本机数据库</Text>
                <Text style={[styles.scHint, { color: tf.faint }]}>任务、习惯与完成记录</Text>
              </View>
              <Text style={[styles.sv, { color: tf.muted }]}>已加密</Text>
            </Pressable>
            <Pressable
              onPress={() => openBackup()}
              style={({ pressed }) => [
                styles.setrow,
                {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: tf.line,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <View style={[styles.si, { backgroundColor: tf.lily2 }]}>
                <MaterialIcons name="cloud-queue" size={16} color={tf.frog} />
              </View>
              <View style={styles.sc}>
                <Text style={[styles.scTitle, { color: tf.ink2 }]}>最近备份</Text>
                <Text style={[styles.scHint, { color: tf.faint }]}>{backupLabel}</Text>
              </View>
              <Text style={[styles.sv, { color: tf.muted }]}>立即备份 ›</Text>
            </Pressable>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={rise++} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.setcard, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.sh}>
              <Text style={[styles.shTitle, { color: tf.ink2 }]}>关于</Text>
              <Text style={[styles.shSide, { color: tf.faint }]}>FROG 2.4</Text>
            </View>
            <View style={styles.setrow}>
              <View style={styles.sc}>
                <Text style={[styles.scTitle, { color: tf.ink2 }]}>版本与更新</Text>
                <Text style={[styles.scHint, { color: tf.faint }]}>2.4.0 · 逻辑日与三窗格主屏</Text>
              </View>
              <Text style={[styles.sv, { color: tf.muted }]}>查看 ›</Text>
            </View>
          </View>
        </FoldRiseIn>

        <View style={[styles.hintline, { justifyContent: 'center', paddingVertical: 8 }]}>
          <MaterialIcons name="lock-outline" size={13} color={tf.faint} />
          <Text style={[styles.hintText, { color: tf.faint, textAlign: 'center' }]}>
            无广告 · 不做行为画像 · 可随时导出
          </Text>
        </View>
        <Text
          style={{
            textAlign: 'center',
            fontSize: 10,
            color: tf.faint,
            letterSpacing: 1.2,
            marginTop: 4,
            fontFamily: fonts.mono,
          }}>
          FROG · LOCAL FIRST · 2026
        </Text>
      </ScrollView>

      <FrogScheduleSettingsSheet visible={scheduleOpen} onClose={() => setScheduleOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  appbar: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  appbarCenter: { flex: 1, minWidth: 0 },
  appbarTitle: { fontSize: 17, fontWeight: '800' },
  appbarSub: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  iconbtnSoft: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 14, paddingTop: 4, gap: 10 },
  setcard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sh: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  shTitle: { fontSize: 15, fontWeight: '800' },
  shSide: { marginLeft: 'auto', fontSize: 11, fontWeight: '600' },
  dayarc: {
    height: 96,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
    position: 'relative',
  },
  dayarcLight: {
    backgroundColor: '#F6F2E8',
  },
  sunm: {
    position: 'absolute',
    left: 36,
    top: 28,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#D6974B',
  },
  moonm: {
    position: 'absolute',
    right: 40,
    top: 20,
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  arcDash: {
    position: 'absolute',
    left: 32,
    right: 32,
    top: 40,
    height: 36,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 80,
  },
  boundary2: {
    position: 'absolute',
    top: 10,
    bottom: 22,
    width: 0,
    borderLeftWidth: 2,
    marginLeft: -1,
  },
  boundaryBadge: {
    position: 'absolute',
    top: -2,
    left: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  boundaryBadgeText: { fontSize: 10, fontWeight: '700' },
  arcLabels: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  arcLabel: { fontSize: 10, fontWeight: '600' },
  arcLabelBold: { fontSize: 10, fontWeight: '700' },
  slidertrack: {
    height: 28,
    justifyContent: 'center',
    marginTop: 2,
  },
  sliderBg: {
    height: 6,
    borderRadius: 3,
    width: '100%',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
  },
  knob: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    marginLeft: -11,
    top: 3,
    shadowColor: '#20382F',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  setsliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 2,
  },
  setrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 6,
  },
  si: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sc: { flex: 1, minWidth: 0, gap: 2 },
  scTitle: { fontSize: 13, fontWeight: '700' },
  scHint: { fontSize: 11, fontWeight: '600' },
  sv: { fontSize: 12, fontWeight: '600' },
  hintline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  hintText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  pageHint: { fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  syncbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  syncDot: { width: 6, height: 6, borderRadius: 3 },
  syncText: { flex: 1, fontSize: 11, fontWeight: '600' },
  colorsteps: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  colorstep: { flex: 1, height: 14, borderRadius: 4 },
  miniheatlegend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
});
