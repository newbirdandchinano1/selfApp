import { Colors } from '@/constants/theme';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { generateWeeklyReviewCoaching } from '@/lib/weekly-review-coaching';
import { fetchWeeklyReviewMetrics, getRollingSevenDayRange, getRollingSevenDayRangeEndingOnNextReviewDay } from '@/lib/repositories/insights/weekly-review';
import {
  getWeeklyReviewConfiguredWeekday,
  isTodayConfiguredWeeklyReviewDay,
  setWeeklyReviewConfiguredWeekday,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
} from '@/lib/weekly-review-settings';
import type { WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import {
  getWeeklyReviewJournalByWeek,
  setWeeklyReviewCoachingText,
  updateWeeklyReviewAdjustFlags,
  upsertWeeklyReviewJournal,
} from '@/lib/repositories/insights/weekly-review-journal';
import { listDailyReviewsBetween, upsertDailyReviewJournal } from '@/lib/repositories/insights/daily-review-journal';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function formatMetricMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '¥0';
  return `¥${Math.round(n).toLocaleString('zh-CN')}`;
}

function formatMetricInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n));
}

function formatRangeLabel(start: Date, end: Date): string {
  return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
}

const DAILY_BODY_VERSION = 1 as const;

type DailyFieldKey = 'audit_tasks' | 'audit_issues' | 'insight_high' | 'insight_block' | 'iter_top3' | 'iter_tweak';

type DailyStructured = Record<DailyFieldKey, string>;

function createEmptyDailyFields(): DailyStructured {
  return {
    audit_tasks: '',
    audit_issues: '',
    insight_high: '',
    insight_block: '',
    iter_top3: '',
    iter_tweak: '',
  };
}

function serializeDailyBody(f: DailyStructured): string {
  return JSON.stringify({
    v: DAILY_BODY_VERSION,
    audit_tasks: f.audit_tasks,
    audit_issues: f.audit_issues,
    insight_high: f.insight_high,
    insight_block: f.insight_block,
    iter_top3: f.iter_top3,
    iter_tweak: f.iter_tweak,
  });
}

function parseDailyBody(raw: string | null | undefined): DailyStructured {
  const empty = createEmptyDailyFields();
  if (!raw || !String(raw).trim()) return empty;
  const s = String(raw).trim();
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    if (o && typeof o === 'object' && o.v === DAILY_BODY_VERSION) {
      return {
        audit_tasks: String(o.audit_tasks ?? ''),
        audit_issues: String(o.audit_issues ?? ''),
        insight_high: String(o.insight_high ?? ''),
        insight_block: String(o.insight_block ?? ''),
        iter_top3: String(o.iter_top3 ?? ''),
        iter_tweak: String(o.iter_tweak ?? ''),
      };
    }
  } catch {
    // 旧版整段文本：落入「完成任务」便于继续编辑
  }
  return { ...empty, audit_tasks: s };
}

const DAILY_FIELD_LABELS: Record<DailyFieldKey, string> = {
  audit_tasks: '完成任务',
  audit_issues: '遗留问题',
  insight_high: '效率高点',
  insight_block: '障碍点',
  iter_top3: '明日 Top 3 目标',
  iter_tweak: '执行微调',
};

const DAILY_FORM_SECTIONS: {
  sectionTitle: string;
  fields: { key: DailyFieldKey; label: string; placeholder: string; minH: number }[];
}[] = [
  {
    sectionTitle: '今日总结 (Audit)',
    fields: [
      { key: 'audit_tasks', label: '完成任务', placeholder: '[ ] A, [ ] B…', minH: 72 },
      { key: 'audit_issues', label: '遗留问题', placeholder: '…', minH: 72 },
    ],
  },
  {
    sectionTitle: '今日洞察 (Insight)',
    fields: [
      { key: 'insight_high', label: '效率高点', placeholder: '例如：上午深度工作 2 小时', minH: 72 },
      { key: 'insight_block', label: '障碍点', placeholder: '例如：被频繁的消息通知打断', minH: 72 },
    ],
  },
  {
    sectionTitle: '明日迭代 (Iteration)',
    fields: [
      { key: 'iter_top3', label: '明日 Top 3 目标', placeholder: '1. … 2. … 3. …', minH: 88 },
      { key: 'iter_tweak', label: '执行微调', placeholder: '例如：明天把手机放在客厅再开始工作', minH: 72 },
    ],
  },
];

type DailyEntry = { ymd: string; label: string; fields: DailyStructured };

function dailyEntryPreviewText(fields: DailyStructured): string {
  const bits = (Object.keys(DAILY_FIELD_LABELS) as DailyFieldKey[])
    .map(k => fields[k].trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  return bits.join(' · ');
}

function buildDailyReviewsDigest(entries: DailyEntry[]): string {
  const blocks: string[] = [];
  for (const e of entries) {
    const parts: string[] = [];
    for (const k of Object.keys(DAILY_FIELD_LABELS) as DailyFieldKey[]) {
      const v = e.fields[k].trim();
      if (v) parts.push(`${DAILY_FIELD_LABELS[k]}：${v}`);
    }
    if (parts.length === 0) continue;
    blocks.push(`【${e.label}】\n${parts.join('\n')}`);
  }
  return blocks.join('\n\n');
}

function toYmdLocal(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
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

  const [periodStartYmd, setPeriodStartYmd] = useState('');
  const [weekRangeLabel, setWeekRangeLabel] = useState('');
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [dailyPeriodLabel, setDailyPeriodLabel] = useState('');
  const [expandedDailyYmd, setExpandedDailyYmd] = useState<string | null>(null);
  const [dailySavingYmd, setDailySavingYmd] = useState<string | null>(null);

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
      const today = new Date();
      const dow = await getWeeklyReviewConfiguredWeekday();
      setConfiguredDow(dow);

      const rolling =
        dow !== null ? getRollingSevenDayRangeEndingOnNextReviewDay(today, dow) : getRollingSevenDayRange(today);

      setDailyPeriodLabel(
        dow !== null
          ? `${formatRangeLabel(rolling.start, rolling.end)} · 周期终点：${rolling.end.getMonth() + 1}月${rolling.end.getDate()}日（${
              WEEKLY_REVIEW_WEEKDAY_LABELS[dow]
            }）`
          : `${formatRangeLabel(rolling.start, rolling.end)}（尚未设置复盘日时，暂以今日为终点倒推 7 天）`,
      );

      const dailyRows = await listDailyReviewsBetween(rolling.startYmd, rolling.endYmd);
      const byYmd = new Map(dailyRows.map(r => [r.record_date_ymd, parseDailyBody(r.body ?? '')]));
      const nextDaily: DailyEntry[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(rolling.start);
        d.setDate(rolling.start.getDate() + i);
        const ymd = toYmdLocal(d);
        nextDaily.push({
          ymd,
          label: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKLY_REVIEW_WEEKDAY_LABELS[d.getDay()]}`,
          fields: byYmd.get(ymd) ?? createEmptyDailyFields(),
        });
      }
      setDailyEntries(nextDaily);
      setExpandedDailyYmd(rolling.endYmd);

      const allowed = dow !== null && isTodayConfiguredWeeklyReviewDay(dow, today);
      setCanEdit(allowed);

      if (!allowed) {
        setPeriodStartYmd('');
        setWeekRangeLabel('');
        setMetrics(null);
        setSectionSummary('');
        setSectionPlans('');
        setSectionReflect('');
        setSectionLearnings('');
        setSectionNext('');
        setExecutionScore(0);
        setAiCoaching(null);
        setAdjustTasks(false);
        setAdjustSavings(false);
        setAdjustPlans(false);
        return;
      }

      setPeriodStartYmd(rolling.startYmd);
      setWeekRangeLabel(formatRangeLabel(rolling.start, rolling.end));

      const metricsAnchor = new Date(rolling.end.getFullYear(), rolling.end.getMonth(), rolling.end.getDate());
      const [row, m] = await Promise.all([
        getWeeklyReviewJournalByWeek(rolling.startYmd),
        fetchWeeklyReviewMetrics(metricsAnchor, 'rolling-7'),
      ]);
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
      } else {
        setSectionSummary('');
        setSectionPlans('');
        setSectionReflect('');
        setSectionLearnings('');
        setSectionNext('');
        setExecutionScore(0);
        setAiCoaching(null);
        setAdjustTasks(false);
        setAdjustSavings(false);
        setAdjustPlans(false);
      }
    } catch {
      setMetrics(null);
      setDailyEntries([]);
      setDailyPeriodLabel('');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const persistDraft = useCallback(async () => {
    setSaving(true);
    try {
      await upsertWeeklyReviewJournal({
        week_start_ymd: periodStartYmd,
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
    periodStartYmd,
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
    if (!canEdit || !periodStartYmd) {
      Alert.alert('暂不可保存', '仅在已设定的「每周复盘日」当天可填写与保存；请先设置复盘日，并在对应日期打开本页。');
      return;
    }
    await persistDraft();
    Alert.alert('已保存', '复盘草稿已写入本地。');
  }, [canEdit, periodStartYmd, persistDraft]);

  const onGenerateAi = useCallback(async () => {
    if (!canEdit || !periodStartYmd) {
      Alert.alert('暂不可用', '仅在复盘日当天可生成 AI 建议。');
      return;
    }
    if (executionScore < 1 || executionScore > 5) {
      Alert.alert('请先自评', '请为「本周期执行结果」选择 1～5 星后再生成建议。');
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
        dailyReviewsDigest: buildDailyReviewsDigest(dailyEntries),
      });
      await setWeeklyReviewCoachingText(periodStartYmd, coaching);
      setAiCoaching(coaching);
    } catch (e) {
      console.warn('weekly review ai', e);
      Alert.alert('生成失败', '请检查网络；未配置当前所选引擎的 API 密钥时将使用本地规则生成。');
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
    periodStartYmd,
    persistDraft,
    canEdit,
    dailyEntries,
  ]);

  const onSaveAdjustIntent = useCallback(async () => {
    if (!canEdit || !periodStartYmd) {
      Alert.alert('暂不可保存', '仅在复盘日当天可保存调整意向。');
      return;
    }
    try {
      await updateWeeklyReviewAdjustFlags(periodStartYmd, {
        adjust_tasks: adjustTasks,
        adjust_savings: adjustSavings,
        adjust_plans: adjustPlans,
      });
      Alert.alert('已记录', '已保存你的调整意向，可随时回来修改。');
    } catch {
      Alert.alert('保存失败', '请稍后再试');
    }
  }, [canEdit, periodStartYmd, adjustTasks, adjustSavings, adjustPlans]);

  const setDailyFieldForYmd = useCallback((ymd: string, key: DailyFieldKey, value: string) => {
    if (ymd !== todayYmd) return;
    setDailyEntries(prev =>
      prev.map(e => (e.ymd === ymd ? { ...e, fields: { ...e.fields, [key]: value } } : e)),
    );
  }, []);

  const onSaveDaily = useCallback(async (ymd: string, fields: DailyStructured) => {
    if (ymd !== todayYmd) {
      Alert.alert('暂不可保存', '每日复盘仅支持填写与保存「今天」的内容。');
      return;
    }
    setDailySavingYmd(ymd);
    try {
      await upsertDailyReviewJournal(ymd, serializeDailyBody(fields));
      Alert.alert('已保存', `${ymd} 的每日复盘已写入本地。`);
    } catch (e) {
      console.warn('daily review save', e);
      Alert.alert('保存失败', '请稍后再试');
    } finally {
      setDailySavingYmd(null);
    }
  }, [todayYmd]);

  const onPickWeekday = useCallback(async (d: number) => {
    try {
      await setWeeklyReviewConfiguredWeekday(d);
      setConfiguredDow(d);
      setPickerOpen(false);
      Alert.alert('已保存', `已设定每周「${WEEKLY_REVIEW_WEEKDAY_LABELS[d]}」为复盘日。统计区间为该日当天向前连续 7 个自然日（含当天）。`);
      void load();
    } catch {
      Alert.alert('失败', '请稍后再试');
    }
  }, [load]);

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
          <Pressable
            onPress={() => setPickerOpen(true)}
            hitSlop={12}
            accessibilityLabel="设置复盘日"
            style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1, padding: 4 }]}>
            <MaterialIcons name="event-available" size={24} color={primary} />
          </Pressable>
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
            <View
              style={[
                styles.settingsRow,
                {
                  backgroundColor: surface,
                  borderColor: outlineVariant,
                },
              ]}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.settingsLabel, { color: outline }]}>每周复盘日</Text>
                <Text style={[styles.settingsValue, { color: text }]}>
                  {configuredDow === null ? '尚未设置' : `每周${WEEKLY_REVIEW_WEEKDAY_LABELS[configuredDow]}`}
                </Text>
              </View>
              <Pressable
                onPress={() => setPickerOpen(true)}
                style={({ pressed }) => [
                  styles.settingsBtn,
                  { borderColor: outlineVariant, backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,88,190,0.08)', opacity: pressed ? 0.88 : 1 },
                ]}>
                <MaterialIcons name="edit-calendar" size={18} color={primary} />
                <Text style={[styles.settingsBtnText, { color: primary }]}>设置复盘日</Text>
              </Pressable>
            </View>

            {canEdit ? (
              <Text style={[styles.weekTag, { color: outline }]}>近七天 · {weekRangeLabel}</Text>
            ) : (
              <View style={[styles.gateCard, { backgroundColor: isDark ? 'rgba(30,41,59,0.65)' : '#fff7ed', borderColor: outlineVariant }]}>
                <MaterialIcons name="lock-clock" size={22} color={tertiary} />
                <Text style={[styles.gateTitle, { color: text }]}>
                  {configuredDow === null ? '请先设置每周复盘日' : '今天不是复盘日'}
                </Text>
                <Text style={[styles.gateBody, { color: outline }]}>
                  {configuredDow === null
                    ? '指定每周的固定一天进行复盘；仅在当天可填写内容并保存。数据参考为当天向前连续 7 个自然日（含当天）。'
                    : `今天是「${WEEKLY_REVIEW_WEEKDAY_LABELS[new Date().getDay()]}」，已设定为每周「${
                        WEEKLY_REVIEW_WEEKDAY_LABELS[configuredDow]
                      }」复盘。请在对应日期再来填写。`}
                </Text>
              </View>
            )}

            <Text style={[styles.intro, { color: outline }]}>
              {canEdit
                ? '以下由你亲自书写。保存后可一键生成 AI 建议；在「我的」页选择智谱或豆包；智谱可配 EXPO_PUBLIC_ZHIPU_API_KEY，豆包可配 EXPO_PUBLIC_ARK_API_KEY（未设置环境变量时两者均有应用内置密钥兜底）。均不可用时使用本地规则汇总。'
                : '到达复盘日后，可基于近七天数据与五大板块完成书写与保存。'}
            </Text>

            <View style={[styles.dailySectionCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
              <View style={[styles.dailySectionAccent, { backgroundColor: secondary }]} />
              <View style={styles.dailySectionInner}>
                <Text style={[styles.dailySectionTitle, { color: text }]}>每日复盘</Text>
                <Text style={[styles.dailyPeriodLine, { color: primary }]}>{dailyPeriodLabel}</Text>
                <Text style={[styles.dailySectionHint, { color: outline }]}>
                  区间以「下一次每周复盘日」为终点向前 7 天（与周度统计一致）；仅「今天」可填写与保存，其他日期仅可查看已保存内容。生成周度 AI 建议时会参考本周期内各日已填内容。
                </Text>
                {dailyEntries.map(entry => {
                  const open = expandedDailyYmd === entry.ymd;
                  const isTodayEntry = entry.ymd === todayYmd;
                  const previewRaw = dailyEntryPreviewText(entry.fields);
                  const previewShort =
                    previewRaw.length > 48 ? `${previewRaw.slice(0, 48)}…` : previewRaw || '（未填写）';
                  return (
                    <View key={entry.ymd} style={[styles.dailyDayCard, { borderColor: outlineVariant }]}>
                      <Pressable
                        onPress={() => setExpandedDailyYmd(open ? null : entry.ymd)}
                        style={({ pressed }) => [styles.dailyDayHead, { opacity: pressed ? 0.88 : 1 }]}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={[styles.dailyDayTitle, { color: text }]}>{entry.label}</Text>
                            {!isTodayEntry ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <MaterialIcons name="lock-outline" size={16} color={outline} />
                                <Text style={{ fontSize: 11, fontWeight: '800', color: outline }}>仅查看</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={[styles.dailyDayPreview, { color: outline }]} numberOfLines={1}>
                            {previewShort}
                          </Text>
                        </View>
                        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={26} color={primary} />
                      </Pressable>
                      {open ? (
                        <View style={[styles.dailyDayBody, { borderTopColor: outlineVariant }]}>
                          {DAILY_FORM_SECTIONS.map(sec => (
                            <View key={sec.sectionTitle} style={styles.dailyFormSection}>
                              <Text style={[styles.dailyFormSectionTitle, { color: text }]}>{sec.sectionTitle}</Text>
                              {sec.fields.map(f => (
                                <View key={f.key} style={styles.dailyFieldBlock}>
                                  <Text style={[styles.dailyFieldLabel, { color: outline }]}>{f.label}</Text>
                                  <TextInput
                                    value={entry.fields[f.key]}
                                    onChangeText={t => setDailyFieldForYmd(entry.ymd, f.key, t)}
                                    placeholder={f.placeholder}
                                    placeholderTextColor={outline}
                                    multiline
                                    textAlignVertical="top"
                                    editable={isTodayEntry}
                                    style={[
                                      styles.dailyFieldInput,
                                      {
                                        minHeight: f.minH,
                                        backgroundColor: inputSurface,
                                        borderColor: inputBorder,
                                        color: text,
                                        opacity: isTodayEntry ? 1 : 0.72,
                                      },
                                    ]}
                                  />
                                </View>
                              ))}
                            </View>
                          ))}
                          {isTodayEntry ? (
                            <Pressable
                              onPress={() => void onSaveDaily(entry.ymd, entry.fields)}
                              disabled={dailySavingYmd === entry.ymd}
                              style={({ pressed }) => [
                                styles.dailySaveBtn,
                                { backgroundColor: secondary, opacity: pressed || dailySavingYmd === entry.ymd ? 0.75 : 1 },
                              ]}>
                              {dailySavingYmd === entry.ymd ? (
                                <ActivityIndicator color="#fff" />
                              ) : (
                                <Text style={styles.dailySaveBtnText}>保存该日</Text>
                              )}
                            </Pressable>
                          ) : (
                            <View
                              style={[
                                styles.dailySaveBtn,
                                {
                                  backgroundColor: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(194,198,214,0.35)',
                                  opacity: 1,
                                },
                              ]}>
                              <Text style={[styles.dailySaveBtnText, { color: outline }]}>非当日，不可编辑与保存</Text>
                            </View>
                          )}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>

            {canEdit ? (
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
            ) : null}

            {canEdit ? (
              <>
            <SectionTitle color={text} n="一" title="汇总本周事件" />
            <Field
              value={sectionSummary}
              onChangeText={setSectionSummary}
              editable={canEdit}
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
              editable={canEdit}
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
              editable={canEdit}
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
              editable={canEdit}
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
              editable={canEdit}
              placeholder={PLACEHOLDERS.next}
              inputSurface={inputSurface}
              inputBorder={inputBorder}
              textColor={text}
              hintColor={outline}
            />

            <Text style={[styles.scoreTitle, { color: text }]}>本周期执行结果自评</Text>
            <Text style={[styles.scoreHint, { color: outline }]}>1 星偏低，5 星代表整体执行满意</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <Pressable key={n} disabled={!canEdit} onPress={() => setExecutionScore(n)} hitSlop={6}>
                  <MaterialIcons
                    name={executionScore >= n ? 'star' : 'star-border'}
                    size={36}
                    color={!canEdit ? outlineVariant : executionScore >= n ? tertiary : outline}
                  />
                </Pressable>
              ))}
            </View>

            <View style={styles.btnRow}>
              <Pressable
                onPress={() => void onSaveDraft()}
                disabled={saving || !canEdit}
                style={({ pressed }) => [
                  styles.btnSecondary,
                  {
                    borderColor: outlineVariant,
                    opacity: pressed || saving || !canEdit ? 0.55 : 1,
                  },
                ]}>
                {saving ? <ActivityIndicator color={primary} /> : <Text style={[styles.btnSecondaryText, { color: primary }]}>保存草稿</Text>}
              </Pressable>
              <Pressable
                onPress={() => void onGenerateAi()}
                disabled={aiBusy || !canEdit}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  {
                    backgroundColor: primary,
                    opacity: pressed || aiBusy || !canEdit ? 0.55 : 1,
                  },
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
                  onToggle={() => canEdit && setAdjustTasks(v => !v)}
                  label="调整任务安排 / 优先级"
                  textColor={text}
                  outline={outline}
                  primary={primary}
                  disabled={!canEdit}
                />
                <CheckRow
                  checked={adjustSavings}
                  onToggle={() => canEdit && setAdjustSavings(v => !v)}
                  label="检查或修正存钱计划节奏"
                  textColor={text}
                  outline={outline}
                  primary={primary}
                  disabled={!canEdit}
                />
                <CheckRow
                  checked={adjustPlans}
                  onToggle={() => canEdit && setAdjustPlans(v => !v)}
                  label="重新安排时间、兼顾生活与工作"
                  textColor={text}
                  outline={outline}
                  primary={primary}
                  disabled={!canEdit}
                />

                <Pressable
                  onPress={() => void onSaveAdjustIntent()}
                  disabled={!canEdit}
                  style={({ pressed }) => [
                    styles.btnWide,
                    { backgroundColor: secondary, opacity: pressed || !canEdit ? 0.55 : 1 },
                  ]}>
                  <Text style={styles.btnWideText}>保存调整意向</Text>
                </Pressable>

                <View style={styles.linkRow}>
                  <LinkChip label="去任务" onPress={() => router.push('/(tabs)/tasks')} color={primary} />
                  <LinkChip label="存钱计划" onPress={() => router.push('/savings-plan')} color={tertiary} />
                  <LinkChip label="财务日历" onPress={() => router.push('/finance-calendar')} color={primary} />
                </View>
              </View>
            ) : null}
              </>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setPickerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: surface,
                borderColor: outlineVariant,
                paddingBottom: Math.max(insets.bottom, 20),
              },
            ]}>
            <Text style={[styles.modalTitle, { color: text }]}>选择每周复盘日</Text>
            <Text style={[styles.modalHint, { color: outline }]}>
              仅在所选星期的那一天可填写与保存；统计区间为该日向前连续 7 个自然日（含当天）。
            </Text>
            <View style={styles.modalList}>
              {WEEKLY_REVIEW_WEEKDAY_LABELS.map((lab, i) => (
                <Pressable
                  key={lab}
                  onPress={() => void onPickWeekday(i)}
                  style={({ pressed }) => [
                    styles.modalRow,
                    {
                      borderColor: outlineVariant,
                      opacity: pressed ? 0.88 : 1,
                      backgroundColor:
                        configuredDow === i
                          ? isDark
                            ? 'rgba(96,165,250,0.14)'
                            : 'rgba(0,88,190,0.08)'
                          : isDark
                            ? 'rgba(15,23,42,0.4)'
                            : '#f8fafc',
                    },
                  ]}>
                  <Text style={[styles.modalRowText, { color: text }]}>{lab}</Text>
                  {configuredDow === i ? <MaterialIcons name="check-circle" size={22} color={primary} /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
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
                    {metrics.rangeKind === 'rolling-7'
                      ? '周期：复盘日当天起向前连续 7 个自然日（含当天），按本地日期汇总。收入/支出仅含对应类型的记账流水。'
                      : '周期：本周一至周日（本地日期）。收入/支出仅含对应类型的记账流水。'}
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
  editable = true,
  placeholder,
  inputSurface,
  inputBorder,
  textColor,
  hintColor,
}: {
  value: string;
  onChangeText: (t: string) => void;
  editable?: boolean;
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
      editable={editable}
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
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  textColor: string;
  outline: string;
  primary: string;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onToggle} disabled={disabled} style={[styles.checkRow, disabled ? { opacity: 0.45 } : null]}>
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
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  settingsLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  settingsValue: { fontSize: 16, fontWeight: '900' },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  settingsBtnText: { fontSize: 14, fontWeight: '800' },
  gateCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  gateTitle: { fontSize: 16, fontWeight: '900', marginTop: 2 },
  gateBody: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  modalSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 18,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '900' },
  modalHint: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  modalList: { gap: 8, marginTop: 4 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  modalRowText: { fontSize: 16, fontWeight: '800' },
  weekTag: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  intro: { fontSize: 13, lineHeight: 20, fontWeight: '600', marginBottom: 4 },
  dailySectionCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  dailySectionAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    zIndex: 1,
  },
  dailySectionInner: {
    paddingLeft: 18,
    paddingRight: 14,
    paddingVertical: 14,
    gap: 10,
  },
  dailySectionTitle: { fontSize: 17, fontWeight: '900', letterSpacing: -0.2 },
  dailyPeriodLine: { fontSize: 12, fontWeight: '800', lineHeight: 18 },
  dailySectionHint: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  dailyDayCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 2,
  },
  dailyDayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  dailyDayTitle: { fontSize: 15, fontWeight: '900' },
  dailyDayPreview: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  dailyDayBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 10,
    gap: 14,
  },
  dailyFormSection: { gap: 10 },
  dailyFormSectionTitle: { fontSize: 14, fontWeight: '900', marginTop: 2 },
  dailyFieldBlock: { gap: 6 },
  dailyFieldLabel: { fontSize: 12, fontWeight: '800' },
  dailyFieldInput: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  dailySaveBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  dailySaveBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
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
