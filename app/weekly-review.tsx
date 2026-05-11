import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { generateWeeklyReviewCoaching } from '@/lib/weekly-review-coaching';
import { fetchWeeklyReviewMetrics, getCurrentWeekRange } from '@/lib/repositories/insights/weekly-review';
import type { WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import {
  getWeeklyReviewJournalByWeek,
  setWeeklyReviewCoachingText,
  updateWeeklyReviewAdjustFlags,
  upsertWeeklyReviewJournal,
} from '@/lib/repositories/insights/weekly-review-journal';
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function formatMetricMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '¥0';
  return `¥${Math.round(n).toLocaleString('zh-CN')}`;
}

function formatMetricInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n));
}

function formatWeekRangeLabel(): string {
  const { start, end } = getCurrentWeekRange();
  return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
}

const PLACEHOLDERS = {
  summary:
    '这周发生了什么？完成了哪些计划？有什么收获与结果？遇到什么问题、进展如何？见了哪些重要的人、谈了什么？',
  plans:
    '交付了什么成果？还有哪些任务没完成？这一周生活状态、家庭氛围如何？读了什么书、学到了什么？',
  reflect: '已完成的任务有没有更好的做法？没完成的问题出在哪，打算怎么解决？',
  learnings: '发现了什么问题？总结出哪些经验？',
  next: '下周如何安排时间、兼顾生活与工作？有哪些重点想推进？',
} as const;

export default function WeeklyReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? theme.surface : '#ffffff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.85)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.4)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';

  const weekStartYmd = useMemo(() => getCurrentWeekRange().startYmd, []);
  const weekRangeLabel = useMemo(() => formatWeekRangeLabel(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [metrics, setMetrics] = useState<WeeklyReviewMetrics | null>(null);

  const [sectionSummary, setSectionSummary] = useState('');
  const [sectionPlans, setSectionPlans] = useState('');
  const [sectionReflect, setSectionReflect] = useState('');
  const [sectionLearnings, setSectionLearnings] = useState('');
  const [sectionNext, setSectionNext] = useState('');
  const [executionScore, setExecutionScore] = useState(0);
  const [aiCoaching, setAiCoaching] = useState<string | null>(null);
  const [adjustTasks, setAdjustTasks] = useState(false);
  const [adjustSavings, setAdjustSavings] = useState(false);
  const [adjustPlans, setAdjustPlans] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [row, m] = await Promise.all([getWeeklyReviewJournalByWeek(weekStartYmd), fetchWeeklyReviewMetrics()]);
      setMetrics(m);
      if (row) {
        setSectionSummary(row.section_summary ?? '');
        setSectionPlans(row.section_plans ?? '');
        setSectionReflect(row.section_reflect ?? '');
        setSectionLearnings(row.section_learnings ?? '');
        setSectionNext(row.section_next_week ?? '');
        setExecutionScore(row.execution_score > 0 ? row.execution_score : 0);
        setAiCoaching(row.ai_coaching);
        setAdjustTasks(row.adjust_tasks === 1);
        setAdjustSavings(row.adjust_savings === 1);
        setAdjustPlans(row.adjust_plans === 1);
      }
    } catch {
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, [weekStartYmd]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistDraft = useCallback(async () => {
    setSaving(true);
    try {
      await upsertWeeklyReviewJournal({
        week_start_ymd: weekStartYmd,
        section_summary: sectionSummary,
        section_plans: sectionPlans,
        section_reflect: sectionReflect,
        section_learnings: sectionLearnings,
        section_next_week: sectionNext,
        execution_score: executionScore,
        adjust_tasks: adjustTasks,
        adjust_savings: adjustSavings,
        adjust_plans: adjustPlans,
      });
    } catch (e) {
      console.warn('weekly review save', e);
      Alert.alert('保存失败', '请稍后再试');
    } finally {
      setSaving(false);
    }
  }, [
    weekStartYmd,
    sectionSummary,
    sectionPlans,
    sectionReflect,
    sectionLearnings,
    sectionNext,
    executionScore,
    adjustTasks,
    adjustSavings,
    adjustPlans,
  ]);

  const onSaveDraft = useCallback(async () => {
    await persistDraft();
    Alert.alert('已保存', '本周复盘草稿已写入本地。');
  }, [persistDraft]);

  const onGenerateAi = useCallback(async () => {
    if (executionScore < 1 || executionScore > 5) {
      Alert.alert('请先自评', '请为「本周执行结果」选择 1～5 星后再生成建议。');
      return;
    }
    const totalLen =
      sectionSummary.length +
      sectionPlans.length +
      sectionReflect.length +
      sectionLearnings.length +
      sectionNext.length;
    if (totalLen < 30) {
      Alert.alert('多写一点', '每个板块哪怕几句话，也能让建议更贴近你；当前文字略少。');
      return;
    }
    setAiBusy(true);
    try {
      await persistDraft();
      const coaching = await generateWeeklyReviewCoaching({
        weekRangeLabel: weekRangeLabel,
        section_summary: sectionSummary,
        section_plans: sectionPlans,
        section_reflect: sectionReflect,
        section_learnings: sectionLearnings,
        section_next_week: sectionNext,
        executionScore,
        metrics,
      });
      await setWeeklyReviewCoachingText(weekStartYmd, coaching);
      setAiCoaching(coaching);
    } catch (e) {
      console.warn('weekly review ai', e);
      Alert.alert('生成失败', '请检查网络；未配置 OpenAI 密钥时将使用本地规则生成。');
    } finally {
      setAiBusy(false);
    }
  }, [
    executionScore,
    sectionSummary,
    sectionPlans,
    sectionReflect,
    sectionLearnings,
    sectionNext,
    weekRangeLabel,
    metrics,
    weekStartYmd,
    persistDraft,
  ]);

  const onSaveAdjustIntent = useCallback(async () => {
    try {
      await updateWeeklyReviewAdjustFlags(weekStartYmd, {
        adjust_tasks: adjustTasks,
        adjust_savings: adjustSavings,
        adjust_plans: adjustPlans,
      });
      Alert.alert('已记录', '已保存你的调整意向，可随时回来修改。');
    } catch {
      Alert.alert('保存失败', '请稍后再试');
    }
  }, [weekStartYmd, adjustTasks, adjustSavings, adjustPlans]);

  const inputSurface = isDark ? 'rgba(15,23,42,0.55)' : '#f4f6ff';
  const inputBorder = outlineVariant;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 8}>
        <View style={[styles.topBar, { borderBottomColor: outlineVariant, paddingTop: Math.max(insets.top, 12) }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
            <MaterialIcons name="arrow-back" size={24} color={primary} />
          </Pressable>
          <Text style={[styles.topTitle, { color: text }]}>每周复盘</Text>
          <View style={{ width: 28 }} />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={primary} />
          </View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.scroll, { paddingBottom: 28 + insets.bottom }]}>
            <Text style={[styles.weekTag, { color: outline }]}>本周 · {weekRangeLabel}</Text>
            <Text style={[styles.intro, { color: outline }]}>
              以下由你亲自书写。保存后可一键生成 AI 建议；若配置了环境变量 EXPO_PUBLIC_OPENAI_API_KEY，将优先调用
              OpenAI，否则使用本地规则汇总。
            </Text>

            <WeeklyMetricsReferenceCard
              open={metricsOpen}
              onToggle={() => setMetricsOpen(v => !v)}
              metrics={metrics}
              isDark={isDark}
              surface={surface}
              text={text}
              outline={outline}
              outlineVariant={outlineVariant}
              primary={primary}
              secondary={secondary}
              tertiary={tertiary}
            />

            <SectionTitle color={text} n="一" title="汇总本周事件" />
            <Field
              value={sectionSummary}
              onChangeText={setSectionSummary}
              placeholder={PLACEHOLDERS.summary}
              inputSurface={inputSurface}
              inputBorder={inputBorder}
              textColor={text}
              hintColor={outline}
            />

            <SectionTitle color={text} n="二" title="计划完成情况" />
            <Field
              value={sectionPlans}
              onChangeText={setSectionPlans}
              placeholder={PLACEHOLDERS.plans}
              inputSurface={inputSurface}
              inputBorder={inputBorder}
              textColor={text}
              hintColor={outline}
            />

            <SectionTitle color={text} n="三" title="本周反思" />
            <Field
              value={sectionReflect}
              onChangeText={setSectionReflect}
              placeholder={PLACEHOLDERS.reflect}
              inputSurface={inputSurface}
              inputBorder={inputBorder}
              textColor={text}
              hintColor={outline}
            />

            <SectionTitle color={text} n="四" title="复盘收获" />
            <Field
              value={sectionLearnings}
              onChangeText={setSectionLearnings}
              placeholder={PLACEHOLDERS.learnings}
              inputSurface={inputSurface}
              inputBorder={inputBorder}
              textColor={text}
              hintColor={outline}
            />

            <SectionTitle color={text} n="五" title="下周计划" />
            <Field
              value={sectionNext}
              onChangeText={setSectionNext}
              placeholder={PLACEHOLDERS.next}
              inputSurface={inputSurface}
              inputBorder={inputBorder}
              textColor={text}
              hintColor={outline}
            />

            <Text style={[styles.scoreTitle, { color: text }]}>本周执行结果自评</Text>
            <Text style={[styles.scoreHint, { color: outline }]}>1 星偏低，5 星代表整体执行满意</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <Pressable key={n} onPress={() => setExecutionScore(n)} hitSlop={6}>
                  <MaterialIcons
                    name={executionScore >= n ? 'star' : 'star-border'}
                    size={36}
                    color={executionScore >= n ? tertiary : outline}
                  />
                </Pressable>
              ))}
            </View>

            <View style={styles.btnRow}>
              <Pressable
                onPress={() => void onSaveDraft()}
                disabled={saving}
                style={({ pressed }) => [
                  styles.btnSecondary,
                  { borderColor: outlineVariant, opacity: pressed || saving ? 0.82 : 1 },
                ]}>
                {saving ? <ActivityIndicator color={primary} /> : <Text style={[styles.btnSecondaryText, { color: primary }]}>保存草稿</Text>}
              </Pressable>
              <Pressable
                onPress={() => void onGenerateAi()}
                disabled={aiBusy}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  { backgroundColor: primary, opacity: pressed || aiBusy ? 0.88 : 1 },
                ]}>
                {aiBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryText}>生成 AI 建议</Text>
                )}
              </Pressable>
            </View>

            {aiCoaching ? (
              <View style={[styles.aiCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
                <View style={[styles.aiBar, { backgroundColor: primary }]} />
                <Text style={[styles.aiHead, { color: text }]}>AI 汇总与建议</Text>
                <Text style={[styles.aiBody, { color: text }]}>{aiCoaching}</Text>

                <Text style={[styles.adjustTitle, { color: text }]}>是否愿意据此做调整？（自选）</Text>
                <CheckRow
                  checked={adjustTasks}
                  onToggle={() => setAdjustTasks(v => !v)}
                  label="调整任务安排 / 优先级"
                  textColor={text}
                  outline={outline}
                  primary={primary}
                />
                <CheckRow
                  checked={adjustSavings}
                  onToggle={() => setAdjustSavings(v => !v)}
                  label="检查或修正存钱计划节奏"
                  textColor={text}
                  outline={outline}
                  primary={primary}
                />
                <CheckRow
                  checked={adjustPlans}
                  onToggle={() => setAdjustPlans(v => !v)}
                  label="重新安排时间、兼顾生活与工作"
                  textColor={text}
                  outline={outline}
                  primary={primary}
                />

                <Pressable
                  onPress={() => void onSaveAdjustIntent()}
                  style={({ pressed }) => [styles.btnWide, { backgroundColor: secondary, opacity: pressed ? 0.9 : 1 }]}>
                  <Text style={styles.btnWideText}>保存调整意向</Text>
                </Pressable>

                <View style={styles.linkRow}>
                  <LinkChip label="去任务" onPress={() => router.push('/(tabs)/tasks')} color={primary} />
                  <LinkChip label="存钱计划" onPress={() => router.push('/savings-plan')} color={tertiary} />
                  <LinkChip label="财务日历" onPress={() => router.push('/finance-calendar')} color={primary} />
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function WeeklyMetricsReferenceCard({
  open,
  onToggle,
  metrics,
  isDark,
  surface,
  text,
  outline,
  outlineVariant,
  primary,
  secondary,
  tertiary,
}: {
  open: boolean;
  onToggle: () => void;
  metrics: WeeklyReviewMetrics | null;
  isDark: boolean;
  surface: string;
  text: string;
  outline: string;
  outlineVariant: string;
  primary: string;
  secondary: string;
  tertiary: string;
}) {
  const cardBg = isDark ? 'rgba(30,41,59,0.65)' : surface;
  const tileBg = isDark ? 'rgba(15,23,42,0.55)' : 'rgba(0,88,190,0.05)';
  const iconWrap = (bg: string) => ({
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: bg,
  });

  const preview =
    metrics == null
      ? '点开展开 · 加载失败时可稍后再试'
      : `${formatMetricInt(metrics.tasksCompleted)} 项完成 · ${formatMetricInt(metrics.habitCheckInTotal)} 次打卡 · 存钱 ${formatMetricMoney(metrics.savingsWeekTotal)}`;

  return (
    <View
      style={[
        styles.metricsCard,
        {
          backgroundColor: cardBg,
          borderColor: outlineVariant,
          shadowColor: isDark ? '#000' : primary,
        },
      ]}>
      <View style={[styles.metricsCardAccent, { backgroundColor: primary }]} />
      <View style={styles.metricsCardInner}>
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => [styles.metricsCardHead, { opacity: pressed ? 0.88 : 1 }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? '收起本周数据参考' : '展开本周数据参考'}>
          <View style={[iconWrap(isDark ? `${primary}22` : `${primary}14`)]}>
            <MaterialIcons name="insights" size={22} color={primary} />
          </View>
          <View style={styles.metricsCardHeadText}>
            <Text style={[styles.metricsCardTitle, { color: text }]}>本周数据参考</Text>
            <Text style={[styles.metricsCardSubtitle, { color: outline }]} numberOfLines={open ? 2 : 1}>
              {open ? '以下为应用内自动汇总，可与上方文字复盘对照，不必逐条一致。' : preview}
            </Text>
          </View>
          <View style={[styles.metricsChevronWrap, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,88,190,0.08)' }]}>
            <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={26} color={primary} />
          </View>
        </Pressable>

        {open ? (
          <View style={[styles.metricsExpanded, { borderTopColor: outlineVariant }]}>
              {!metrics ? (
                <View style={[styles.metricsEmpty, { borderColor: outlineVariant }]}>
                  <MaterialIcons name="cloud-off" size={32} color={outline} />
                  <Text style={[styles.metricsEmptyText, { color: outline }]}>本周统计数据暂不可用</Text>
                </View>
              ) : (
                <>
                  <View style={styles.metricsGrid}>
                    <View style={styles.metricsGridRow}>
                      <MetricTile
                        label="任务完成"
                        value={formatMetricInt(metrics.tasksCompleted)}
                        unit="项"
                        icon="task-alt"
                        iconColor={primary}
                        iconBg={isDark ? `${primary}28` : `${primary}18`}
                        tileBg={tileBg}
                        borderColor={outlineVariant}
                        textColor={text}
                        mutedColor={outline}
                      />
                      <MetricTile
                        label="新建任务"
                        value={formatMetricInt(metrics.tasksCreated)}
                        unit="项"
                        icon="post-add"
                        iconColor={secondary}
                        iconBg={isDark ? `${secondary}28` : `${secondary}18`}
                        tileBg={tileBg}
                        borderColor={outlineVariant}
                        textColor={text}
                        mutedColor={outline}
                      />
                    </View>
                    <View style={styles.metricsGridRow}>
                      <MetricTile
                        label="习惯打卡"
                        value={formatMetricInt(metrics.habitCheckInTotal)}
                        unit="次"
                        icon="local-fire-department"
                        iconColor="#e11d48"
                        iconBg={isDark ? 'rgba(225,29,72,0.22)' : 'rgba(225,29,72,0.1)'}
                        tileBg={tileBg}
                        borderColor={outlineVariant}
                        textColor={text}
                        mutedColor={outline}
                      />
                      <MetricTile
                        label="存钱入账"
                        value={formatMetricMoney(metrics.savingsWeekTotal)}
                        unit=""
                        icon="savings"
                        iconColor={tertiary}
                        iconBg={isDark ? `${tertiary}30` : `${tertiary}20`}
                        tileBg={tileBg}
                        borderColor={outlineVariant}
                        textColor={text}
                        mutedColor={outline}
                      />
                    </View>
                    <View style={styles.metricsGridRow}>
                      <MetricTile
                        label="记账收入"
                        value={formatMetricMoney(metrics.financeIncome)}
                        unit=""
                        icon="trending-up"
                        iconColor={secondary}
                        iconBg={isDark ? `${secondary}28` : `${secondary}18`}
                        tileBg={tileBg}
                        borderColor={outlineVariant}
                        textColor={text}
                        mutedColor={outline}
                      />
                      <MetricTile
                        label="记账支出"
                        value={formatMetricMoney(metrics.financeExpense)}
                        unit=""
                        icon="trending-down"
                        iconColor="#dc2626"
                        iconBg={isDark ? 'rgba(220,38,38,0.22)' : 'rgba(220,38,38,0.1)'}
                        tileBg={tileBg}
                        borderColor={outlineVariant}
                        textColor={text}
                        mutedColor={outline}
                      />
                    </View>
                  </View>
                  <View
                    style={[
                      styles.metricsFullTile,
                      { backgroundColor: tileBg, borderColor: outlineVariant },
                    ]}>
                    <View style={[styles.metricsFullIcon, { backgroundColor: isDark ? `${primary}28` : `${primary}16` }]}>
                      <MaterialIcons name="favorite-border" size={20} color={primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.metricsFullLabel, { color: outline }]}>心愿清单更新</Text>
                      <Text style={[styles.metricsFullValue, { color: text }]}>
                        {formatMetricInt(metrics.wishUpdates)}
                        <Text style={[styles.metricsFullUnit, { color: outline }]}> 条</Text>
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.metricsFootnote, { color: outline }]}>
                    周期：本周一至周日（本地日期）。收入/支出仅含对应类型的记账流水。
                  </Text>
                </>
              )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function MetricTile({
  label,
  value,
  unit,
  icon,
  iconColor,
  iconBg,
  tileBg,
  borderColor,
  textColor,
  mutedColor,
}: {
  label: string;
  value: string;
  unit: string;
  icon: 'task-alt' | 'post-add' | 'local-fire-department' | 'savings' | 'trending-up' | 'trending-down';
  iconColor: string;
  iconBg: string;
  tileBg: string;
  borderColor: string;
  textColor: string;
  mutedColor: string;
}) {
  return (
    <View style={[styles.metricTile, { backgroundColor: tileBg, borderColor }]}>
      <View style={[styles.metricTileIcon, { backgroundColor: iconBg }]}>
        <MaterialIcons name={icon} size={20} color={iconColor} />
      </View>
      <Text style={[styles.metricTileLabel, { color: mutedColor }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.metricTileValue, { color: textColor }]} numberOfLines={1}>
        {value}
        {unit ? <Text style={[styles.metricTileUnit, { color: mutedColor }]}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function SectionTitle({ n, title, color }: { n: string; title: string; color: string }) {
  return (
    <Text style={[styles.sectionTitle, { color }]}>
      {n}、{title}
    </Text>
  );
}

function Field({
  value,
  onChangeText,
  placeholder,
  inputSurface,
  inputBorder,
  textColor,
  hintColor,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  inputSurface: string;
  inputBorder: string;
  textColor: string;
  hintColor: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={hintColor}
      multiline
      textAlignVertical="top"
      style={[
        styles.input,
        {
          backgroundColor: inputSurface,
          borderColor: inputBorder,
          color: textColor,
        },
      ]}
    />
  );
}

function CheckRow({
  checked,
  onToggle,
  label,
  textColor,
  outline,
  primary,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  textColor: string;
  outline: string;
  primary: string;
}) {
  return (
    <Pressable onPress={onToggle} style={styles.checkRow}>
      <MaterialIcons name={checked ? 'check-box' : 'check-box-outline-blank'} size={24} color={checked ? primary : outline} />
      <Text style={[styles.checkLabel, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

function LinkChip({ label, onPress, color }: { label: string; onPress: () => void; color: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
      <Text style={{ color, fontWeight: '800', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTitle: { fontSize: 18, fontWeight: '900' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingTop: 16, gap: 12 },
  weekTag: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  intro: { fontSize: 13, lineHeight: 20, fontWeight: '600', marginBottom: 4 },
  metricsCard: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  metricsCardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    zIndex: 1,
  },
  metricsCardInner: {
    paddingLeft: 18,
    paddingRight: 14,
    paddingVertical: 14,
  },
  metricsCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metricsCardHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  metricsCardTitle: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  metricsCardSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    marginTop: 2,
  },
  metricsChevronWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsExpanded: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  metricsGrid: {
    gap: 10,
  },
  metricsGridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricTile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  metricTileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  metricTileLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  metricTileValue: {
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  metricTileUnit: {
    fontSize: 14,
    fontWeight: '700',
  },
  metricsFullTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  metricsFullIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsFullLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  metricsFullValue: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
    marginTop: 2,
  },
  metricsFullUnit: {
    fontSize: 15,
    fontWeight: '700',
  },
  metricsFootnote: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
    paddingHorizontal: 4,
  },
  metricsEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 8,
  },
  metricsEmptyText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  sectionTitle: { fontSize: 16, fontWeight: '900', marginTop: 8 },
  input: {
    minHeight: 120,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  scoreTitle: { fontSize: 16, fontWeight: '900', marginTop: 14 },
  scoreHint: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  starsRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btnSecondary: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: { fontSize: 15, fontWeight: '800' },
  btnPrimary: {
    flex: 1,
    borderRadius: 16,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  aiCard: {
    marginTop: 8,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
    gap: 10,
  },
  aiBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  aiHead: { fontSize: 17, fontWeight: '900', marginLeft: 8 },
  aiBody: { fontSize: 15, lineHeight: 24, fontWeight: '600', marginLeft: 8 },
  adjustTitle: { fontSize: 15, fontWeight: '900', marginTop: 8, marginLeft: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 4 },
  checkLabel: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  btnWide: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnWideText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  linkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 8,
    marginLeft: 8,
  },
});
