import { useHealthHomeTheme } from '@/constants/health-home-theme';
import {
  clampHealthThresholdPercent,
  healthMetricThresholdAbsolute,
  isCaloriesPenaltyEligible,
  isIntakeMetricRewardEligible,
  saveHealthMetricPointsSettings,
  type HealthMetricKey,
  type HealthMetricPointsSettings,
} from '@/lib/health-metric-points-settings';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { formatPoints, normalizeRewardPoints } from '@/lib/reward-points';
import {
  formatHealthMetricLedgerRefTitle,
  formatPointsLedgerReasonLabel,
} from '@/lib/points-ledger-reason-label';
import { listLocalPointsLedger } from '@/lib/repositories/points/points';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type HealthMetricDaySnapshot = {
  current: number;
  target: number;
};

export type HealthMetricPointsSettingsSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSaved: (next: HealthMetricPointsSettings) => void;
  initialSettings: HealthMetricPointsSettings;
  dayMetrics: Record<HealthMetricKey, HealthMetricDaySnapshot>;
};

type SettlementRow = {
  key: HealthMetricKey;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  current: number;
  threshold: number;
  unit: string;
  pointsDelta: number;
};

type RecentChangeRow = {
  id: string;
  dateLabel: string;
  title: string;
  delta: number;
};

const METRIC_META: Record<
  HealthMetricKey,
  { label: string; icon: keyof typeof MaterialIcons.glyphMap; unit: string }
> = {
  hydration: { label: '水分', icon: 'water-drop', unit: 'ml' },
  protein: { label: '蛋白质', icon: 'egg', unit: 'g' },
  carbohydrate: { label: '碳水', icon: 'eco', unit: 'g' },
  calories: { label: '热量', icon: 'local-fire-department', unit: 'kcal' },
};

const SLIDER_TICKS = [1, 25, 50, 75, 100] as const;

function formatAmount(value: number): string {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString('zh-CN');
}

function formatSignedPoints(delta: number): string {
  if (delta > 0) return `+${formatPoints(delta)}`;
  if (delta < 0) return formatPoints(delta);
  return '0';
}

function formatLedgerDateLabel(createdAt: string): string {
  const raw = String(createdAt ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw.slice(0, 10) || '—';
  return `${Number(m[2])}月${Number(m[3])}日`;
}

function ThresholdSlider({
  value,
  onChange,
  enabled,
  trackColor,
  fillColor,
  thumbColor,
  mutedColor,
}: {
  value: number;
  onChange: (next: number) => void;
  enabled: boolean;
  trackColor: string;
  fillColor: string;
  thumbColor: string;
  mutedColor: string;
}) {
  const widthSv = useSharedValue(1);
  const startX = useSharedValue(0);

  const setFromX = React.useCallback(
    (x: number, width: number) => {
      if (!enabled || width <= 0) return;
      const ratio = Math.min(1, Math.max(0, x / width));
      onChange(clampHealthThresholdPercent(Math.round(ratio * 99) + 1));
    },
    [enabled, onChange],
  );

  const pan = Gesture.Pan()
    .enabled(enabled)
    .onBegin((e) => {
      startX.value = e.x;
      runOnJS(setFromX)(e.x, widthSv.value);
    })
    .onUpdate((e) => {
      runOnJS(setFromX)(e.x, widthSv.value);
    });

  const tap = Gesture.Tap()
    .enabled(enabled)
    .onEnd((e) => {
      runOnJS(setFromX)(e.x, widthSv.value);
    });

  const gesture = Gesture.Simultaneous(pan, tap);
  const pct = Math.min(100, Math.max(1, value));
  const fillRatio = (pct - 1) / 99;

  return (
    <View style={styles.sliderBlock}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.sliderHit, !enabled && { opacity: 0.45 }]}
          onLayout={(e) => {
            widthSv.value = Math.max(1, e.nativeEvent.layout.width);
          }}
        >
          <View style={[styles.sliderTrack, { backgroundColor: trackColor }]}>
            <View
              style={[
                styles.sliderFill,
                { width: `${fillRatio * 100}%`, backgroundColor: fillColor },
              ]}
            />
            <View
              style={[
                styles.sliderThumb,
                {
                  left: `${fillRatio * 100}%`,
                  backgroundColor: thumbColor,
                  borderColor: fillColor,
                },
              ]}
            />
          </View>
        </Animated.View>
      </GestureDetector>
      <View style={styles.sliderTicks}>
        {SLIDER_TICKS.map((tick) => (
          <Text key={tick} style={[styles.sliderTickText, { color: mutedColor }]}>
            {tick}%
          </Text>
        ))}
      </View>
    </View>
  );
}

export function HealthMetricPointsSettingsSheet({
  visible,
  onClose,
  onSaved,
  initialSettings,
  dayMetrics,
}: HealthMetricPointsSettingsSheetProps) {
  const { hh, nutrients } = useHealthHomeTheme();
  const insets = useSafeAreaInsets();

  const [enabled, setEnabled] = React.useState(initialSettings.enabled);
  const [thresholdPercent, setThresholdPercent] = React.useState(initialSettings.thresholdPercent);
  const [rewardPoints, setRewardPoints] = React.useState(initialSettings.rewardPoints);
  const [editingPoints, setEditingPoints] = React.useState(false);
  const [pointsText, setPointsText] = React.useState(formatPoints(initialSettings.rewardPoints));
  const [saving, setSaving] = React.useState(false);
  const [recentRows, setRecentRows] = React.useState<RecentChangeRow[]>([]);
  const [recentLoading, setRecentLoading] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setEnabled(initialSettings.enabled);
    setThresholdPercent(initialSettings.thresholdPercent);
    setRewardPoints(initialSettings.rewardPoints);
    setPointsText(formatPoints(initialSettings.rewardPoints));
    setEditingPoints(false);
  }, [visible, initialSettings]);

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setRecentLoading(true);
    void listLocalPointsLedger({ page: 1, limit: 40 })
      .then((res) => {
        if (cancelled) return;
        const rows: RecentChangeRow[] = [];
        for (const item of res.items) {
          if (String(item.ref_type ?? '') !== 'health_metric') continue;
          const metricTitle = formatHealthMetricLedgerRefTitle(item.ref_type, item.ref_id);
          const reason = formatPointsLedgerReasonLabel(item.reason);
          rows.push({
            id: item.id,
            dateLabel: formatLedgerDateLabel(item.created_at),
            title: metricTitle ? `${reason} · ${metricTitle}` : reason,
            delta: item.delta,
          });
          if (rows.length >= 5) break;
        }
        setRecentRows(rows);
      })
      .catch(() => {
        if (!cancelled) setRecentRows([]);
      })
      .finally(() => {
        if (!cancelled) setRecentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const draftSettings = React.useMemo(
    (): HealthMetricPointsSettings => ({
      enabled,
      thresholdPercent: clampHealthThresholdPercent(thresholdPercent),
      rewardPoints: normalizeRewardPoints(rewardPoints),
    }),
    [enabled, thresholdPercent, rewardPoints],
  );

  const thresholdAbs = React.useMemo(
    () => ({
      hydration: healthMetricThresholdAbsolute(dayMetrics.hydration.target, draftSettings.thresholdPercent),
      protein: healthMetricThresholdAbsolute(dayMetrics.protein.target, draftSettings.thresholdPercent),
      carbohydrate: healthMetricThresholdAbsolute(
        dayMetrics.carbohydrate.target,
        draftSettings.thresholdPercent,
      ),
      calories: healthMetricThresholdAbsolute(dayMetrics.calories.target, draftSettings.thresholdPercent),
    }),
    [dayMetrics, draftSettings.thresholdPercent],
  );

  const settlementRows = React.useMemo((): SettlementRow[] => {
    const reward = Math.abs(normalizeRewardPoints(draftSettings.rewardPoints));
    const intakeKeys: HealthMetricKey[] = ['hydration', 'protein', 'carbohydrate'];
    const rows: SettlementRow[] = intakeKeys.map((key) => {
      const meta = METRIC_META[key];
      const current = dayMetrics[key].current;
      const target = dayMetrics[key].target;
      const percent = target > 0 ? Math.round((current / target) * 100) : 0;
      const eligible = isIntakeMetricRewardEligible(percent, draftSettings);
      return {
        key,
        label: meta.label,
        icon: meta.icon,
        current,
        threshold: thresholdAbs[key],
        unit: meta.unit,
        pointsDelta: eligible ? reward : 0,
      };
    });

    const calCurrent = dayMetrics.calories.current;
    const calTarget = dayMetrics.calories.target;
    const calUncapped = calTarget > 0 ? Math.round((calCurrent / calTarget) * 100) : 0;
    const calPenalty = isCaloriesPenaltyEligible(calUncapped, draftSettings);
    rows.push({
      key: 'calories',
      label: METRIC_META.calories.label,
      icon: METRIC_META.calories.icon,
      current: calCurrent,
      threshold: thresholdAbs.calories,
      unit: METRIC_META.calories.unit,
      pointsDelta: calPenalty ? -reward : 0,
    });
    return rows;
  }, [dayMetrics, draftSettings, thresholdAbs]);

  const settlementTotal = React.useMemo(
    () => settlementRows.reduce((sum, row) => sum + row.pointsDelta, 0),
    [settlementRows],
  );

  const commitPointsEdit = React.useCallback(() => {
    const next = Math.abs(normalizeRewardPoints(pointsText));
    setRewardPoints(next);
    setPointsText(formatPoints(next));
    setEditingPoints(false);
    Keyboard.dismiss();
  }, [pointsText]);

  const handleSave = React.useCallback(async () => {
    if (saving) return;
    if (editingPoints) commitPointsEdit();
    setSaving(true);
    try {
      const next = await saveHealthMetricPointsSettings({
        enabled,
        thresholdPercent: clampHealthThresholdPercent(thresholdPercent),
        rewardPoints: Math.abs(normalizeRewardPoints(editingPoints ? pointsText : rewardPoints)),
      });
      onSaved(next);
      onClose();
      toast.success('已保存');
    } catch (e) {
      toast.error(toUserMessage(e, '积分设置未能写入，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  }, [
    commitPointsEdit,
    editingPoints,
    enabled,
    onClose,
    onSaved,
    pointsText,
    rewardPoints,
    saving,
    thresholdPercent,
  ]);

  const accentFor = (key: HealthMetricKey) => {
    if (key === 'hydration') return nutrients.hydration;
    if (key === 'protein') return nutrients.protein;
    if (key === 'carbohydrate') return nutrients.carbohydrate;
    return nutrients.calories;
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.overlay, { backgroundColor: 'rgba(30, 42, 36, 0.42)' }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: hh.paper,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={styles.grabberWrap}>
            <View style={[styles.grabber, { backgroundColor: hh.lineStrong }]} />
          </View>

          <View style={styles.header}>
            <View style={styles.headerTextCol}>
              <Text style={[styles.title, { color: hh.ink }]}>健康指标积分</Text>
              <Text style={[styles.subtitle, { color: hh.muted }]}>达到阈值加分 · 热量超额扣分</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: hh.cardMuted },
                pressed && { opacity: 0.75 },
              ]}
            >
              <MaterialIcons name="close" size={18} color={hh.inkSoft} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={[styles.card, { backgroundColor: hh.card, borderColor: hh.line }]}>
              <View style={[styles.iconTile, { backgroundColor: hh.sageSoft }]}>
                <MaterialIcons name="auto-awesome" size={18} color={hh.pine} />
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: hh.ink }]}>启用指标积分</Text>
                <Text style={[styles.cardHint, { color: hh.muted }]}>关闭后不再增减，已有积分保留</Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ false: hh.track, true: hh.pine }}
                thumbColor={hh.card}
              />
            </View>

            <View
              style={[
                styles.cardCol,
                { backgroundColor: hh.card, borderColor: hh.line },
                !enabled && styles.dimmed,
              ]}
            >
              <View style={styles.rowBetween}>
                <Text style={[styles.sectionLabel, { color: hh.ink }]}>达标阈值</Text>
                <View style={[styles.pctBadge, { backgroundColor: hh.sageSoft }]}>
                  <Text style={[styles.pctBadgeText, { color: hh.pine }]}>{thresholdPercent}%</Text>
                </View>
              </View>
              <ThresholdSlider
                value={thresholdPercent}
                onChange={setThresholdPercent}
                enabled={enabled}
                trackColor={hh.track}
                fillColor={hh.pine}
                thumbColor={hh.card}
                mutedColor={hh.faint}
              />
              <Text style={[styles.thresholdAbs, { color: hh.inkSoft }]}>
                {formatAmount(thresholdAbs.hydration)} ml · {formatAmount(thresholdAbs.protein)} g ·{' '}
                {formatAmount(thresholdAbs.carbohydrate)} g
              </Text>
              <Text style={[styles.cardHint, { color: hh.muted }]}>水 / 蛋白 / 碳水达到阈值即加分</Text>
            </View>

            <View
              style={[
                styles.card,
                { backgroundColor: hh.card, borderColor: hh.line },
                !enabled && styles.dimmed,
              ]}
            >
              <View style={[styles.iconTile, { backgroundColor: hh.sageSoft }]}>
                <MaterialIcons name="add" size={20} color={hh.pine} />
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: hh.ink }]}>单项积分</Text>
                <Text style={[styles.cardHint, { color: hh.muted }]}>
                  每项达标 +{formatPoints(Math.abs(rewardPoints))} · 热量超额 -
                  {formatPoints(Math.abs(rewardPoints))}
                </Text>
              </View>
              <View style={styles.pointsEditCol}>
                {editingPoints ? (
                  <TextInput
                    value={pointsText}
                    onChangeText={setPointsText}
                    keyboardType="decimal-pad"
                    autoFocus
                    onBlur={commitPointsEdit}
                    onSubmitEditing={commitPointsEdit}
                    style={[styles.pointsInput, { color: hh.ink, borderColor: hh.lineStrong }]}
                  />
                ) : (
                  <Text style={[styles.pointsValue, { color: hh.ink }]}>
                    {formatPoints(Math.abs(rewardPoints))} 分
                  </Text>
                )}
                <Pressable
                  onPress={() => {
                    if (!enabled) return;
                    if (editingPoints) {
                      commitPointsEdit();
                    } else {
                      setPointsText(formatPoints(Math.abs(rewardPoints)));
                      setEditingPoints(true);
                    }
                  }}
                  disabled={!enabled}
                  style={({ pressed }) => [
                    styles.modifyBtn,
                    { borderColor: hh.lineStrong },
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Text style={[styles.modifyBtnText, { color: hh.pine }]}>
                    {editingPoints ? '完成' : '修改'}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={[styles.cardCol, { backgroundColor: hh.card, borderColor: hh.line }]}>
              <Text style={[styles.sectionLabel, { color: hh.ink }]}>今日结算预览</Text>
              {settlementRows.map((row, index) => (
                <View
                  key={row.key}
                  style={[
                    styles.settleRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: hh.line },
                  ]}
                >
                  <View style={[styles.settleIcon, { backgroundColor: `${accentFor(row.key)}22` }]}>
                    <MaterialIcons name={row.icon} size={16} color={accentFor(row.key)} />
                  </View>
                  <Text style={[styles.settleLabel, { color: hh.ink }]}>{row.label}</Text>
                  <Text style={[styles.settleProgress, { color: hh.muted }]}>
                    {formatAmount(row.current)} / {formatAmount(row.threshold)}
                  </Text>
                  <Text
                    style={[
                      styles.settleDelta,
                      {
                        color:
                          row.pointsDelta > 0
                            ? hh.pine
                            : row.pointsDelta < 0
                              ? '#C45C4A'
                              : hh.faint,
                      },
                    ]}
                  >
                    {formatSignedPoints(row.pointsDelta)}
                  </Text>
                </View>
              ))}
              <View style={[styles.settleFooter, { borderTopColor: hh.line }]}>
                <Text style={[styles.settleFooterLabel, { color: hh.inkSoft }]}>今日合计</Text>
                <Text
                  style={[
                    styles.settleFooterValue,
                    {
                      color:
                        settlementTotal > 0 ? hh.pine : settlementTotal < 0 ? '#C45C4A' : hh.ink,
                    },
                  ]}
                >
                  {formatSignedPoints(settlementTotal)} 分
                </Text>
              </View>
            </View>

            <View style={styles.rulesBlock}>
              <Text style={[styles.ruleLine, { color: hh.muted }]}>
                · 水分 / 蛋白 / 碳水：达到阈值即加分；进度回落后自动冲正
              </Text>
              <Text style={[styles.ruleLine, { color: hh.muted }]}>
                · 热量：超过阈值扣同等分；按未封顶百分比判断超额
              </Text>
              <Text style={[styles.ruleLine, { color: hh.muted }]}>
                · 关闭开关后立即停止增减；历史流水保留
              </Text>
            </View>

            <View style={[styles.cardCol, { backgroundColor: hh.card, borderColor: hh.line }]}>
              <Text style={[styles.sectionLabel, { color: hh.ink }]}>最近积分变动</Text>
              {recentLoading ? (
                <ActivityIndicator color={hh.pine} style={{ marginVertical: 12 }} />
              ) : recentRows.length === 0 ? (
                <Text style={[styles.emptyRecent, { color: hh.muted }]}>暂无健康指标积分记录</Text>
              ) : (
                recentRows.map((row, index) => (
                  <View
                    key={row.id}
                    style={[
                      styles.recentRow,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: hh.line },
                    ]}
                  >
                    <View style={styles.recentTextCol}>
                      <Text style={[styles.recentDate, { color: hh.faint }]}>{row.dateLabel}</Text>
                      <Text style={[styles.recentTitle, { color: hh.inkSoft }]} numberOfLines={2}>
                        {row.title}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.recentDelta,
                        { color: row.delta >= 0 ? hh.pine : '#C45C4A' },
                      ]}
                    >
                      {formatSignedPoints(row.delta)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>

          <Pressable
            onPress={() => void handleSave()}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: hh.pine },
              (pressed || saving) && { opacity: 0.85 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={hh.onPine} />
            ) : (
              <Text style={[styles.saveBtnText, { color: hh.onPine }]}>保存设置</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  grabberWrap: { alignItems: 'center', paddingBottom: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  headerTextCol: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, fontWeight: '600' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: { gap: 12, paddingBottom: 14 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  cardCol: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  dimmed: { opacity: 0.55 },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardHint: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  sectionLabel: { fontSize: 15, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pctBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pctBadgeText: { fontSize: 13, fontWeight: '800' },
  sliderBlock: { gap: 8 },
  sliderHit: { height: 28, justifyContent: 'center' },
  sliderTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'visible',
    justifyContent: 'center',
  },
  sliderFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999 },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    marginLeft: -11,
    borderWidth: 3,
    shadowColor: '#1E2A24',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  sliderTicks: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderTickText: { fontSize: 11, fontWeight: '600' },
  thresholdAbs: { fontSize: 13, fontWeight: '700' },
  pointsEditCol: { alignItems: 'flex-end', gap: 6 },
  pointsValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  pointsInput: {
    minWidth: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'right',
  },
  modifyBtn: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modifyBtnText: { fontSize: 12, fontWeight: '800' },
  settleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  settleIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settleLabel: { width: 48, fontSize: 13, fontWeight: '700' },
  settleProgress: { flex: 1, fontSize: 12, fontWeight: '600', textAlign: 'right' },
  settleDelta: { width: 42, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  settleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    marginTop: 2,
  },
  settleFooterLabel: { fontSize: 13, fontWeight: '700' },
  settleFooterValue: { fontSize: 18, fontWeight: '800' },
  rulesBlock: { gap: 6, paddingHorizontal: 4 },
  ruleLine: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  emptyRecent: { fontSize: 13, fontWeight: '600', paddingVertical: 8 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  recentTextCol: { flex: 1, minWidth: 0, gap: 2 },
  recentDate: { fontSize: 11, fontWeight: '700' },
  recentTitle: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  recentDelta: { fontSize: 15, fontWeight: '800' },
  saveBtn: {
    marginTop: 8,
    borderRadius: 18,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '800' },
});
