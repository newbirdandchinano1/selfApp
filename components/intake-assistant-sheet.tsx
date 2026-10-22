/**
 * 健康首页「智能建议」底部弹层 — 对齐 health-screens 06 / 07。
 * 业务状态由 HomeScreen 持有；本组件只负责展示与交互回调。
 */
import { useHealthHomeTheme } from '@/constants/health-home-theme';
import type { IntakeAssistantSuggestKind, IntakeAssistantUiTab } from '@/lib/intake-assistant-selection';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const { height: screenHeight } = Dimensions.get('window');

const TABS: {
  key: IntakeAssistantUiTab;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
}[] = [
  { key: '水分', icon: 'water-drop' },
  { key: '蛋白质', icon: 'egg' },
  { key: '碳水', icon: 'rice-bowl' },
  { key: '热量', icon: 'local-fire-department' },
];

export type IntakeAssistantContextRow = {
  label: string;
  value: string;
};

export type IntakeAssistantOtherGoal = {
  label: string;
  valueLabel: string;
};

export type IntakeAssistantLocalFormula = {
  /** 如「基础代谢 1,430 kcal × 活动系数 1.35 + 训练日 +80」 */
  estimateLine: string;
  /** 如「今天已摄入 1,420 kcal，剩余 630 kcal」 */
  intakeRemainLine?: string | null;
  rows: { label: string; value: string }[];
};

export type IntakeAssistantSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSave: () => void;
  onConfigureAi?: () => void;
  tab: IntakeAssistantUiTab;
  onTabChange: (tab: IntakeAssistantUiTab) => void;
  /** 有 AI 缓存时传日期文案；本地兜底传「本地估算」 */
  subtitle: string;
  selection: IntakeAssistantSuggestKind;
  onSelectKind: (kind: IntakeAssistantSuggestKind) => void;
  bestValue: number;
  communityValue: number;
  unit: string;
  manualGoal: string;
  onManualGoalChange: (text: string) => void;
  dailyAiLoading?: boolean;
  hasAiTargets: boolean;
  aiConfigured: boolean;
  rationaleZh?: string | null;
  contextRows?: IntakeAssistantContextRow[];
  otherGoals?: IntakeAssistantOtherGoal[];
  localFormula?: IntakeAssistantLocalFormula | null;
  rememberedHint?: string | null;
};

function formatLocale(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('zh-CN');
}

export function IntakeAssistantSheet({
  visible,
  onClose,
  onSave,
  onConfigureAi,
  tab,
  onTabChange,
  subtitle,
  selection,
  onSelectKind,
  bestValue,
  communityValue,
  unit,
  manualGoal,
  onManualGoalChange,
  dailyAiLoading = false,
  hasAiTargets,
  aiConfigured,
  rationaleZh,
  contextRows = [],
  otherGoals = [],
  localFormula = null,
  rememberedHint = null,
}: IntakeAssistantSheetProps) {
  const { hh, isDark, nutrients, fonts } = useHealthHomeTheme();
  const [shouldRender, setShouldRender] = React.useState(visible);
  const translateY = React.useRef(new Animated.Value(screenHeight)).current;
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;

  const open = React.useCallback(() => {
    translateY.setValue(screenHeight);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, translateY]);

  const close = React.useCallback(
    (after?: () => void) => {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: screenHeight,
          duration: 280,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) after?.();
      });
    },
    [backdropOpacity, translateY],
  );

  React.useEffect(() => {
    if (visible) {
      setShouldRender(true);
      requestAnimationFrame(open);
      return;
    }
    if (!shouldRender) return;
    close(() => setShouldRender(false));
  }, [close, open, shouldRender, visible]);

  if (!shouldRender) return null;

  const tabAccent =
    tab === '水分'
      ? nutrients.hydration
      : tab === '蛋白质'
        ? nutrients.protein
        : tab === '碳水'
          ? nutrients.carbohydrate
          : nutrients.calories;

  /** 无 AI 目标缓存时走本地公式展示（含未配密钥 / 请求失败） */
  const useLocalFallback = !hasAiTargets && !dailyAiLoading;
  const showAiKeyWarning = !aiConfigured;
  const bestBadge = hasAiTargets ? 'AI 目标' : '本地公式';
  const bestTitleUnit =
    tab === '水分' ? 'ml 水分' : tab === '蛋白质' ? 'g 蛋白质' : tab === '碳水' ? 'g 碳水' : 'kcal';

  const candidateRows: {
    kind: IntakeAssistantSuggestKind;
    title: string;
    sub: string;
    value: number | null;
  }[] = [
    {
      kind: 'best',
      title: `今日最佳 · ${formatLocale(bestValue)} ${unit}`,
      sub: hasAiTargets ? 'AI 目标 · 综合档案与近七日摄入' : '本地公式 · 体重 / 目标 / 活动水平',
      value: bestValue,
    },
    {
      kind: 'community',
      title: `社群达标 · ${formatLocale(communityValue)} ${unit}`,
      sub: '相近人群 / 身体指标周计划均值',
      value: communityValue,
    },
    {
      kind: 'manual',
      title: `手动输入 · ${manualGoal || '—'} ${unit}`,
      sub: '仅数字，最多 4 位',
      value: null,
    },
  ];

  return (
    <Modal transparent visible onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={styles.backdropPressable} onPress={onClose}>
          <Animated.View
            style={[
              styles.backdrop,
              { opacity: backdropOpacity, backgroundColor: isDark ? 'rgba(0,0,0,0.62)' : 'rgba(30,42,36,0.38)' },
            ]}
          />
        </Pressable>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View
            style={[styles.sheet, { backgroundColor: hh.paper, transform: [{ translateY }] }]}
          >
            <View style={styles.handleWrap}>
              <View
                style={[
                  styles.handle,
                  { backgroundColor: isDark ? 'rgba(230,221,206,0.22)' : 'rgba(30,57,50,0.16)' },
                ]}
              />
            </View>

            <View style={styles.header}>
              <View style={styles.headerTextCol}>
                <Text style={[styles.title, { color: hh.ink, fontFamily: fonts.serif }]}>智能建议</Text>
                <Text style={[styles.subtitle, { color: hh.muted }]} numberOfLines={1}>
                  设定今日目标 · {subtitle}
                </Text>
              </View>
              <Pressable
                style={[styles.closeBtn, { backgroundColor: hh.card, borderColor: hh.line }]}
                onPress={onClose}
                accessibilityLabel="关闭，不保存"
              >
                <MaterialIcons name="close" size={20} color={hh.inkSoft} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.contentScroll}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.tabBar, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
                {TABS.map((item) => {
                  const active = tab === item.key;
                  const accent =
                    item.key === '水分'
                      ? nutrients.hydration
                      : item.key === '蛋白质'
                        ? nutrients.protein
                        : item.key === '碳水'
                          ? nutrients.carbohydrate
                          : nutrients.calories;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => onTabChange(item.key)}
                      style={[
                        styles.tabBtn,
                        active && { backgroundColor: hh.pine },
                      ]}
                    >
                      <MaterialIcons name={item.icon} size={14} color={active ? hh.onPine : accent} />
                      <Text style={[styles.tabText, { color: active ? hh.onPine : hh.muted }]}>{item.key}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {showAiKeyWarning ? (
                <View style={[styles.warnBanner, { backgroundColor: isDark ? 'rgba(196,120,82,0.16)' : '#F8E8D8' }]}>
                  <MaterialIcons name="info-outline" size={18} color={nutrients.protein} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.warnTitle, { color: hh.ink }]}>未配置 AI 密钥，已切换本地公式</Text>
                    <Text style={[styles.warnBody, { color: hh.inkSoft }]}>
                      「今日最佳」按体重、目标与活动水平估算，仍可保存。
                      {onConfigureAi ? (
                        <Text style={{ color: hh.pine, fontWeight: '800' }} onPress={onConfigureAi}>
                          {' '}
                          去「我的」配置
                        </Text>
                      ) : null}
                    </Text>
                  </View>
                </View>
              ) : null}

              {dailyAiLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={hh.pine} />
                  <Text style={[styles.loadingText, { color: hh.muted }]}>正在生成今日 AI 摄入建议…</Text>
                </View>
              ) : null}

              <View style={[styles.bestCard, { backgroundColor: hh.pine }]}>
                <View style={styles.bestTopRow}>
                  <View style={styles.bestBadges}>
                    <Text style={[styles.bestEyebrow, { color: 'rgba(247,245,236,0.72)' }]}>TODAY BEST</Text>
                    <View style={[styles.bestBadge, { backgroundColor: hh.amber }]}>
                      <Text style={[styles.bestBadgeText, { color: hh.pine }]}>{bestBadge}</Text>
                    </View>
                  </View>
                  <Text style={[styles.bestCorner, { color: 'rgba(247,245,236,0.55)' }]}>
                    {hasAiTargets ? '基于身体数据' : '无需联网'}
                  </Text>
                </View>
                <View style={styles.bestValueRow}>
                  <Text style={[styles.bestValue, { color: hh.amber, fontFamily: fonts.mono }]}>
                    {formatLocale(bestValue)}
                  </Text>
                  <Text style={[styles.bestUnit, { color: hh.onPine }]}>{bestTitleUnit}</Text>
                </View>
                {rationaleZh || localFormula?.estimateLine ? (
                  <View style={[styles.reasonBox, { backgroundColor: 'rgba(247,245,236,0.1)' }]}>
                    <Text style={[styles.reasonLabel, { color: hh.amber }]}>理由</Text>
                    <Text style={[styles.reasonBody, { color: 'rgba(247,245,236,0.88)' }]}>
                      {rationaleZh?.trim() || localFormula?.estimateLine}
                      {localFormula?.intakeRemainLine ? `\n${localFormula.intakeRemainLine}` : ''}
                    </Text>
                  </View>
                ) : null}
              </View>

              {contextRows.length > 0 && hasAiTargets ? (
                <View style={[styles.sectionCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                  <Text style={[styles.sectionTitle, { color: hh.ink }]}>今日上下文</Text>
                  {contextRows.map((row) => (
                    <View key={row.label} style={[styles.contextRow, { borderTopColor: hh.line }]}>
                      <Text style={[styles.contextLabel, { color: hh.muted }]}>{row.label}</Text>
                      <Text style={[styles.contextValue, { color: hh.ink }]}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {useLocalFallback && localFormula && localFormula.rows.length > 0 ? (
                <View style={[styles.sectionCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                  <Text style={[styles.sectionTitle, { color: hh.ink }]}>本地公式说明</Text>
                  {localFormula.rows.map((row) => (
                    <View key={row.label} style={[styles.contextRow, { borderTopColor: hh.line }]}>
                      <Text style={[styles.contextLabel, { color: hh.muted }]}>{row.label}</Text>
                      <Text style={[styles.contextValue, { color: hh.ink }]}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.helperBlock}>
                <Text style={[styles.sectionTitle, { color: hh.ink, marginBottom: 8 }]}>其他候选</Text>
                <View style={styles.candidateList}>
                  {candidateRows.map((row) => {
                    const selected = selection === row.kind;
                    return (
                      <Pressable
                        key={row.kind}
                        onPress={() => onSelectKind(row.kind)}
                        style={[
                          styles.candidateRow,
                          {
                            backgroundColor: selected ? hh.sageSoft : hh.card,
                            borderColor: selected ? hh.pine : hh.line,
                          },
                        ]}
                      >
                        <View style={styles.candidateBody}>
                          <Text style={[styles.candidateTitle, { color: hh.ink }]}>{row.title}</Text>
                          <Text style={[styles.candidateSub, { color: hh.muted }]}>{row.sub}</Text>
                        </View>
                        {row.value != null ? (
                          <Text style={[styles.candidateValue, { color: selected ? hh.pine : hh.inkSoft }]}>
                            {formatLocale(row.value)}
                          </Text>
                        ) : null}
                        {selected ? (
                          <View style={[styles.checkCircle, { backgroundColor: hh.pine }]}>
                            <MaterialIcons name="check" size={14} color={hh.onPine} />
                          </View>
                        ) : (
                          <View style={[styles.radioEmpty, { borderColor: hh.lineStrong }]} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {selection === 'manual' ? (
                <View style={[styles.manualBox, { backgroundColor: hh.card, borderColor: hh.line }]}>
                  <View style={styles.manualTop}>
                    <Text style={[styles.manualLabel, { color: hh.ink }]}>手动目标</Text>
                    <Text style={[styles.manualRange, { color: hh.faint }]}>0 – 9999</Text>
                  </View>
                  <View style={[styles.manualInputRow, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
                    <TextInput
                      value={manualGoal}
                      onChangeText={onManualGoalChange}
                      keyboardType="number-pad"
                      autoCorrect={false}
                      autoCapitalize="none"
                      placeholder="0"
                      placeholderTextColor={hh.faint}
                      style={[styles.manualInput, { color: hh.ink, fontFamily: fonts.mono }]}
                    />
                    <Text style={[styles.manualUnit, { color: tabAccent }]}>{unit}</Text>
                  </View>
                  <Text style={[styles.manualCounter, { color: hh.faint }]}>
                    {manualGoal.length} / 4 位
                  </Text>
                </View>
              ) : null}

              {otherGoals.length > 0 ? (
                <View style={[styles.sectionCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                  <View style={styles.otherHeader}>
                    <Text style={[styles.sectionTitle, { color: hh.ink, marginBottom: 0 }]}>今日其他目标</Text>
                    <Text style={[styles.otherHint, { color: hh.faint }]}>随本次保存同步</Text>
                  </View>
                  {otherGoals.map((g) => (
                    <View key={g.label} style={[styles.contextRow, { borderTopColor: hh.line }]}>
                      <Text style={[styles.contextLabel, { color: hh.muted }]}>{g.label}</Text>
                      <Text style={[styles.contextValue, { color: hh.ink }]}>{g.valueLabel}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <Text style={[styles.disclaimer, { color: hh.faint }]}>
                建议随训练日 / 休息日微调；保存仅影响今日目标，可随时再改。
              </Text>
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: hh.line, backgroundColor: hh.paper }]}>
              {rememberedHint ? (
                <View style={styles.rememberRow}>
                  <MaterialIcons name="check-circle" size={14} color={hh.sage} />
                  <Text style={[styles.rememberText, { color: hh.muted }]}>{rememberedHint}</Text>
                </View>
              ) : null}
              <Pressable
                onPress={onSave}
                style={({ pressed }) => [
                  styles.saveBtn,
                  { backgroundColor: hh.pine, opacity: pressed ? 0.92 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="保存为今日目标"
              >
                <Text style={[styles.saveBtnText, { color: hh.onPine }]}>保存为今日目标</Text>
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
  backdropPressable: { ...StyleSheet.absoluteFill },
  backdrop: { flex: 1 },
  sheet: {
    width: '100%',
    maxHeight: Math.min(860, screenHeight - 24),
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: 'hidden',
    shadowColor: '#1E2A24',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 18,
  },
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  handle: { width: 42, height: 5, borderRadius: 999 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 12,
  },
  headerTextCol: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, fontWeight: '600' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  contentScroll: { maxHeight: screenHeight - 210, flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 16, gap: 14 },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 4,
  },
  tabText: { fontSize: 11, fontWeight: '800' },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 16,
    padding: 12,
  },
  warnTitle: { fontSize: 13, fontWeight: '800' },
  warnBody: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { fontSize: 12, fontWeight: '600' },
  bestCard: {
    borderRadius: 24,
    padding: 18,
    gap: 12,
    overflow: 'hidden',
  },
  bestTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bestBadges: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bestEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  bestBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  bestBadgeText: { fontSize: 10, fontWeight: '800' },
  bestCorner: { fontSize: 11, fontWeight: '600' },
  bestValueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bestValue: { fontSize: 48, fontWeight: '800', letterSpacing: -1.4, lineHeight: 52 },
  bestUnit: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  reasonBox: { borderRadius: 14, padding: 12, gap: 6 },
  reasonLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  reasonBody: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  sectionCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', marginBottom: 4 },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contextLabel: { fontSize: 12, fontWeight: '700' },
  contextValue: { fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  helperBlock: { gap: 0 },
  candidateList: { gap: 8 },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  candidateBody: { flex: 1, minWidth: 0, gap: 2 },
  candidateTitle: { fontSize: 14, fontWeight: '800' },
  candidateSub: { fontSize: 11, fontWeight: '600' },
  candidateValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioEmpty: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
  },
  manualBox: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  manualTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  manualLabel: { fontSize: 14, fontWeight: '800' },
  manualRange: { fontSize: 11, fontWeight: '600' },
  manualInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  manualInput: { flex: 1, fontSize: 28, fontWeight: '800', padding: 0 },
  manualUnit: { fontSize: 14, fontWeight: '800' },
  manualCounter: { fontSize: 11, fontWeight: '600', textAlign: 'right' },
  otherHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  otherHint: { fontSize: 11, fontWeight: '600' },
  disclaimer: { fontSize: 11, fontWeight: '600', lineHeight: 16, paddingHorizontal: 2 },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 18 : 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  rememberText: { flex: 1, fontSize: 11, fontWeight: '600', lineHeight: 16 },
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    paddingVertical: 16,
  },
  saveBtnText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
});
