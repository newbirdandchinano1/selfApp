import { RecordIntakeSheet, type RecordIntakeConfirmPayload } from '@/components/record-intake-sheet';
import { AppIconButton } from '@/components/ui';
import { HealthNutrientAccents, Layout, Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import React from 'react';

import { getDefaultUser, subscribeDefaultUserUpdates } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';

import {
  createHealthRecord,
  getHealthIntakeTotalsForUserOnDate,
  getHealthRecordsForUserOnDate,
  getHealthRecordsLast7Days,
  deleteHealthRecord,
} from '@/lib/repositories/health/health';
import type { HealthIntakeDayTotals, HealthRecordRow } from '@/lib/repositories/health/health.types';
import {
  globalCarbohydrateTargetG,
  globalHydrationTargetMl,
  globalProteinTargetG,
  globalSodiumTargetMg,
  setGlobalCarbohydrateTargetG,
  setGlobalHydrationTargetMl,
  setGlobalProteinTargetG,
  setGlobalSodiumTargetMg,
} from '@/lib/global-intake-targets';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { ensureDailyAiIntakeTargetsForToday, type DailyAiIntakeTargetsRow } from '@/lib/daily-intake-ai-targets';
import {
  adjustNutritionMetricsForDaySchedule,
  calculateNutritionV2,
  mapGenderToNutritionGender,
  mapGoalToNutritionGoal,
  mapLifestyleToActivityLevel,
} from '@/lib/nutrition-heuristic';
import { getUserDayScheduleKind, getUserDayScheduleLabelZh } from '@/lib/user-workout-schedule';
import {
  analyzeFoodNutritionFromImage,
  getActiveAiLlmApiKey,
  isActiveAiLlmConfigured,
  parseFoodIntakeFromText,
} from '@/lib/zhipu-image-parse';
import {
  createQuickAddItemMap,
  formatQuickAddAmount,
  getDefaultQuickAddItems,
  getQuickAddMetricAmount,
  getQuickAddMetricTypes,
  loadAllQuickAddItems,
  loadSelectedQuickAddItems,
  type QuickAddCardItem,
} from '@/lib/quick-add-cards';

import {
  ActivityIndicator,
  Animated,
  Alert,
  Dimensions,
  Easing,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import Svg, { Circle } from 'react-native-svg';

const { width, height } = Dimensions.get('window');





const nutrientMetricMeta = [
  {
    key: 'hydration' as const,
    label: '水分',
    icon: 'water-drop' as keyof typeof MaterialIcons.glyphMap,
    opacity: 1,
  },
  {
    key: 'protein' as const,
    label: '蛋白质',
    icon: 'restaurant' as keyof typeof MaterialIcons.glyphMap,
    opacity: 0.65,
  },
  {
    key: 'sodium' as const,
    label: '钠',
    icon: 'science' as keyof typeof MaterialIcons.glyphMap,
    opacity: 0.35,
  },
  {
    key: 'carbohydrate' as const,
    label: '碳水',
    icon: 'rice-bowl' as keyof typeof MaterialIcons.glyphMap,
    opacity: 0.5,
  },
];

const weekLabels = ['日', '一', '二', '三', '四', '五', '六'] as const;

function normalizeDate(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatHeaderDate(d: Date) {
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekLabels[d.getDay()]}`;
}

/** 与 health_records.record_date 对齐的本地日历 YYYY-MM-DD */
function formatLocalYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 将拍照/选图的临时 URI 复制到应用目录，便于详情页长期展示 */
async function copyIntakePhotoToDocuments(recordId: string, sourceUri: string | null | undefined): Promise<string | null> {
  const uri = sourceUri?.trim();
  if (!uri) return null;
  try {
    const destDir = new Directory(Paths.document, 'intake_photos');
    if (!destDir.exists) {
      destDir.create({ intermediates: true });
    }
    const src = new File(uri);
    const destFile = new File(destDir, `${recordId}.jpg`);
    if (destFile.exists) {
      destFile.delete();
    }
    src.copy(destFile);
    return destFile.uri;
  } catch {
    return null;
  }
}

/**
 * SQLite `datetime('now')` 等为 UTC 无时区字符串；`new Date(...)` 易被当作本地时刻解析而错位。
 * 无时区后缀时按 UTC 解析，再映射到北京时间展示/比较。
 */
function parseHealthRecordUtcInstant(raw: string): Date {
  const trimmed = raw.trim();
  if (!trimmed) return new Date(NaN);
  let iso = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  if (!/Z$/i.test(iso) && !/[+-]\d{2}:?\d{2}$/.test(iso)) {
    iso = `${iso}Z`;
  }
  return new Date(iso);
}

/** SQLite datetime → 北京时间「HH:mm」 */
function formatRecordTime(createdAt: string): string {
  const d = parseHealthRecordUtcInstant(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
    hourCycle: 'h23',
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '';
  if (!h || !m) return '';
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function formatIntakeAmount(value: number, unit: 'ml' | 'g' | 'mg'): string {
  const formatted = Number(value.toFixed(2)).toString();
  return `${formatted}${unit}`;
}

/** AI 文本一次写入多营时与 createHealthRecord.quick_add_key 对齐 */
const HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY = 'ai_text_intake';

const INTAKE_DISPLAY_TITLE_MAX = 500;
const INTAKE_AI_COMMENT_MAX = 8000;

function clampIntakeDisplayTitle(raw: string | undefined | null): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  return t.length <= INTAKE_DISPLAY_TITLE_MAX ? t : t.slice(0, INTAKE_DISPLAY_TITLE_MAX);
}

function clampIntakeAiComment(raw: string | undefined | null): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  return t.length <= INTAKE_AI_COMMENT_MAX ? t : t.slice(0, INTAKE_AI_COMMENT_MAX);
}

function intakeListAiComment(row: HealthRecordRow): string {
  const c = row.intake_ai_comment?.trim();
  return c ? `AI评价：${c}` : 'AI评价：待分析';
}

function singleIntakeLineTitle(row: HealthRecordRow, fallback: string): string {
  const t = row.intake_display_title?.trim();
  return t || fallback;
}

function positiveNutrientKindsCount(row: HealthRecordRow): number {
  return [row.hydration > 0, row.protein > 0, row.carbohydrate > 0, row.sodium > 0].filter(Boolean).length;
}

function firstPositiveIntakeMetric(row: HealthRecordRow): 'hydration' | 'protein' | 'carbohydrate' | 'sodium' {
  if (row.hydration > 0) return 'hydration';
  if (row.protein > 0) return 'protein';
  if (row.carbohydrate > 0) return 'carbohydrate';
  return 'sodium';
}

function combinedIntakeListTitle(row: HealthRecordRow, quickAddByKey: ReturnType<typeof createQuickAddItemMap>): string {
  const custom = row.intake_display_title?.trim();
  if (custom) return custom;
  if (row.source_image_uri?.trim()) return 'AI 拍照识别';
  if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) return 'AI 记录';
  if (!row.quick_add_key && row.hydration === 0) return 'AI 拍照识别';
  const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
  return qa?.label ?? '合并摄入';
}

function formatCombinedIntakeAmountsLine(row: HealthRecordRow): string {
  const parts: string[] = [];
  if (row.hydration > 0) parts.push(`水 ${formatIntakeAmount(row.hydration, 'ml')}`);
  if (row.protein > 0) parts.push(`蛋白 ${formatIntakeAmount(row.protein, 'g')}`);
  if (row.carbohydrate > 0) parts.push(`碳水 ${formatIntakeAmount(row.carbohydrate, 'g')}`);
  if (row.sodium > 0) parts.push(`钠 ${formatIntakeAmount(row.sodium, 'mg')}`);
  return parts.join(' · ');
}

type IntakeListLine = {
  key: string;
  recordId: string;
  /** 列表行对应的单一营养维度（用于详情页高亮） */
  metric: 'hydration' | 'protein' | 'carbohydrate' | 'sodium';
  title: string;
  timeLine: string;
  amountRight: string;
  note: string;
  aiComment: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  iconBgLight: string;
  iconBgDark: string;
  iconColor: string;
  /** 智谱解析中占位行，不可点进详情、不可滑动删除 */
  isPlaceholder?: boolean;
};

/** 将当日多条库记录展开为列表行（一行可对应水分/蛋白质/钠中一项）。 */
function buildIntakeListLines(rows: HealthRecordRow[], quickAddCatalog: QuickAddCardItem[]): IntakeListLine[] {
  const lines: IntakeListLine[] = [];
  const quickAddByKey = createQuickAddItemMap(quickAddCatalog);
  const orderedRows = [...rows].sort((a, b) => {
    const ta = parseHealthRecordUtcInstant(a.created_at).getTime();
    const tb = parseHealthRecordUtcInstant(b.created_at).getTime();
    if (tb !== ta) return tb - ta;
    return parseHealthRecordUtcInstant(b.updated_at).getTime() - parseHealthRecordUtcInstant(a.updated_at).getTime();
  });
  const getMetricQuickAdd = (qa: QuickAddCardItem | undefined, metric: 'hydration' | 'protein' | 'carbohydrate' | 'sodium') =>
    qa && getQuickAddMetricTypes(qa).includes(metric) ? qa : undefined;

  for (const row of orderedRows) {
    const timeLine = formatRecordTime(row.created_at);
    if (positiveNutrientKindsCount(row) >= 2) {
      lines.push({
        key: `${row.id}-combined`,
        recordId: row.id,
        metric: firstPositiveIntakeMetric(row),
        title: combinedIntakeListTitle(row, quickAddByKey),
        timeLine,
        amountRight: formatCombinedIntakeAmountsLine(row),
        note: '备注：暂无备注',
        aiComment: intakeListAiComment(row),
        icon: row.source_image_uri?.trim() ? 'photo-camera' : 'auto-awesome',
        iconBgLight: 'rgba(16,185,129,0.12)',
        iconBgDark: 'rgba(6,78,59,0.32)',
        iconColor: HealthNutrientAccents.hydration,
      });
      continue;
    }
    const h = row.hydration;
    const p = row.protein;
    const c = row.carbohydrate;
    const s = row.sodium;
    if (h > 0) {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      lines.push({
        key: `${row.id}-h`,
        recordId: row.id,
        metric: 'hydration',
        title: singleIntakeLineTitle(row, qa ? qa.label : '水分'),
        timeLine,
        amountRight: formatIntakeAmount(h, 'ml'),
        note: '备注：暂无备注',
        aiComment: intakeListAiComment(row),
        icon: getMetricQuickAdd(qa, 'hydration')?.icon as keyof typeof MaterialIcons.glyphMap || 'water-drop',
        iconBgLight: 'rgba(16,185,129,0.12)',
        iconBgDark: 'rgba(6,78,59,0.32)',
        iconColor: HealthNutrientAccents.hydration,
      });
    }
    if (p > 0) {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      const metricQa = getMetricQuickAdd(qa, 'protein');
      lines.push({
        key: `${row.id}-p`,
        recordId: row.id,
        metric: 'protein',
        title: singleIntakeLineTitle(row, metricQa ? metricQa.label : '蛋白质'),
        timeLine,
        amountRight: formatIntakeAmount(p, 'g'),
        note: '备注：暂无备注',
        aiComment: intakeListAiComment(row),
        icon: metricQa ? (metricQa.icon as keyof typeof MaterialIcons.glyphMap) : 'restaurant',
        iconBgLight: 'rgba(245,158,11,0.14)',
        iconBgDark: 'rgba(120,53,15,0.32)',
        iconColor: HealthNutrientAccents.protein,
      });
    }
    if (s > 0) {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      const metricQa = getMetricQuickAdd(qa, 'sodium');
      lines.push({
        key: `${row.id}-s`,
        recordId: row.id,
        metric: 'sodium',
        title: singleIntakeLineTitle(row, metricQa ? metricQa.label : '钠'),
        timeLine,
        amountRight: formatIntakeAmount(s, 'mg'),
        note: '备注：暂无备注',
        aiComment: intakeListAiComment(row),
        icon: metricQa ? (metricQa.icon as keyof typeof MaterialIcons.glyphMap) : 'science',
        iconBgLight: 'rgba(168,85,247,0.14)',
        iconBgDark: 'rgba(88,28,135,0.32)',
        iconColor: HealthNutrientAccents.sodium,
      });
    }
    if (c > 0) {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      const metricQa = getMetricQuickAdd(qa, 'carbohydrate');
      lines.push({
        key: `${row.id}-c`,
        recordId: row.id,
        metric: 'carbohydrate',
        title: singleIntakeLineTitle(row, metricQa ? metricQa.label : '碳水'),
        timeLine,
        amountRight: formatIntakeAmount(c, 'g'),
        note: '备注：暂无备注',
        aiComment: intakeListAiComment(row),
        icon: metricQa ? (metricQa.icon as keyof typeof MaterialIcons.glyphMap) : 'rice-bowl',
        iconBgLight: 'rgba(234,179,8,0.14)',
        iconBgDark: 'rgba(113,63,18,0.32)',
        iconColor: HealthNutrientAccents.carbohydrate,
      });
    }
  }
  return lines;
}

async function fetchHomeHealthSlice(
  userId: string | undefined,
  weekAnchor: Date,
  selected: Date
): Promise<{
  week: HealthRecordRow[];
  prevWeek: HealthRecordRow[];
  dayTotals: HealthIntakeDayTotals | null;
  dayRecords: HealthRecordRow[];
}> {
  if (!userId) return { week: [], prevWeek: [], dayTotals: null, dayRecords: [] };
  const endYmd = formatLocalYmd(weekAnchor);
  const prevEndYmd = formatLocalYmd(addDays(weekAnchor, -7));
  const dayYmd = formatLocalYmd(selected);
  const [week, prevWeek, dayTotals, dayRecords] = await Promise.all([
    getHealthRecordsLast7Days(userId, endYmd),
    getHealthRecordsLast7Days(userId, prevEndYmd),
    getHealthIntakeTotalsForUserOnDate(userId, dayYmd),
    getHealthRecordsForUserOnDate(userId, dayYmd),
  ]);
  return { week, prevWeek, dayTotals, dayRecords };
}

/** 插入一条「当日增量」记录；首页与汇总接口按 record_date 对同日多条 SUM。 */
async function appendManualIntakeToDay(params: {
  userId: string;
  recordDateYmd: string;
  type: 'hydration' | 'protein' | 'carbohydrate' | 'sodium';
  amount: number;
  quickAddKey?: string;
  targetHydrationMl: number;
  targetProteinG: number;
  targetCarbohydrateG: number;
  targetSodiumMg: number;
}): Promise<void> {
  const { userId, recordDateYmd, type, amount, quickAddKey, targetHydrationMl, targetProteinG, targetCarbohydrateG, targetSodiumMg } = params;
  if (!Number.isFinite(amount) || amount <= 0) return;
  const id = `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  await createHealthRecord({
    id,
    user_id: userId,
    record_date: recordDateYmd,
    quick_add_key: quickAddKey ?? null,
    hydration: type === 'hydration' ? amount : 0,
    protein: type === 'protein' ? amount : 0,
    carbohydrate: type === 'carbohydrate' ? amount : 0,
    sodium: type === 'sodium' ? amount : 0,
    target_hydration: targetHydrationMl,
    target_protein: targetProteinG,
    target_carbohydrate: targetCarbohydrateG,
    target_sodium: targetSodiumMg,
  });
}

function parseGoalInput(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** 智能建议手动目标：仅数字，最多 4 位 */
function sanitizeAssistantManualGoalInput(raw: string): string {
  return String(raw).replace(/\D/g, '').slice(0, 4);
}

function goalMatchesSuggestion(goal: number, suggestion: number) {
  return Math.round(goal) === Math.round(suggestion);
}

function dailyAiTargetForTab(row: DailyAiIntakeTargetsRow, tab: '水分' | '蛋白质' | '碳水' | '钠'): number {
  if (tab === '水分') return row.hydration_ml;
  if (tab === '蛋白质') return row.protein_g;
  if (tab === '碳水') return row.carbohydrate_g;
  return row.sodium_mg;
}

type AssistantSuggestKind = 'best' | 'avg' | 'community';

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function isFutureDate(d: Date, today: Date) {
  return normalizeDate(d).getTime() > normalizeDate(today).getTime();
}

function getWeekDaysFromAnchor(anchorDate: Date) {
  const start = addDays(anchorDate, -6);
  return Array.from({ length: 7 }).map((_, i) => {
    const date = addDays(start, i);
    return {
      key: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      date,
      day: date.getDate(),
      label: weekLabels[date.getDay()],
    };
  });
}

type WeeklyTrendItem = {
  day: string;
  date: Date;
  hydration: number;
  protein: number;
  carbohydrate: number;
  sodium: number;
  active: boolean;
};

const BAR_MAX_HEIGHT = 130;
const BAR_MIN_VISIBLE_HEIGHT = 4;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const FLOATING_CTA_SIZE = 62;
const FLOATING_CTA_MARGIN = 12;

function trendBarHeight(percent: number) {
  if (percent <= 0) return BAR_MIN_VISIBLE_HEIGHT;
  return (percent / 100) * BAR_MAX_HEIGHT;
}

function hydrationStatusDesc(percent: number) {
  if (percent >= 80) return '目前水分充足，大脑高效运作';
  if (percent >= 50) return '水分尚可，注意适时补充';
  return '水分偏低，建议少量多次饮水';
}

function proteinStatusDesc(percent: number) {
  if (percent >= 90) return '摄入充足，利于肌肉与恢复';
  if (percent >= 60) return '稍有欠缺，建议晚餐增加摄入';
  return '明显不足，请优先补充优质蛋白';
}

function carbohydrateStatusDesc(percent: number) {
  if (percent >= 90) return '碳水补给充足，运动与专注更稳定';
  if (percent >= 60) return '碳水略低，可补充全谷物或水果';
  return '碳水偏低，建议及时补充主食';
}

function sodiumStatusDesc(percent: number) {
  if (percent <= 60) return '保持在理想范围，心血管压力低';
  if (percent <= 90) return '略偏高，注意饮食清淡';
  return '摄入偏高，建议减少加工食品';
}

const CircularProgress = ({
  percentage,
  icon,
  color,
  trackColor = 'rgba(148, 163, 184, 0.26)',
  size = 64,
  strokeWidth = 6,
  opacity = 1,
}: {
  percentage: number;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  trackColor?: string;
  size?: number;
  strokeWidth?: number;
  opacity?: number;
}) => {
  const animatedPercentage = React.useRef(new Animated.Value(Math.max(0, Math.min(100, percentage)))).current;

  React.useEffect(() => {
    Animated.timing(animatedPercentage, {
      toValue: Math.max(0, Math.min(100, percentage)),
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [animatedPercentage, percentage]);

  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = animatedPercentage.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
  });

  return (
    <View style={[styles.progressContainer, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          opacity={opacity}
        />
      </Svg>
      <View style={styles.iconContainer}>
        <MaterialIcons name={icon} size={24} color={color} style={{ opacity }} />
      </View>
    </View>
  );
};

export default function HealthScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { logicalTodayYmd, logicalTodayDate } = useDayBoundary();
  const insets = useSafeAreaInsets();
  const pageInset = Spacing['5xl'] * 2;
  const weekPagerWidth = width - pageInset;
  const cardWidth = (width - pageInset - Spacing.md * 3) / 4;
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  const [assistantTab, setAssistantTab] = React.useState<'水分' | '蛋白质' | '碳水' | '钠'>('水分');
  const [intakeTargetTick, setIntakeTargetTick] = React.useState(0);
  const intakeTargetsSnapshot = React.useMemo(
    () => ({
      hydrationMl: globalHydrationTargetMl,
      proteinG: globalProteinTargetG,
      carbohydrateG: globalCarbohydrateTargetG,
      sodiumMg: globalSodiumTargetMg,
      tick: intakeTargetTick,
    }),
    [intakeTargetTick]
  );
  const [manualGoal, setManualGoal] = React.useState(() =>
    sanitizeAssistantManualGoalInput(String(globalHydrationTargetMl))
  );
  /** 智能建议中选中的推荐项；与 manualGoal 一致时有值，手动输入不匹配任一项时为 null */
  const [assistantSuggestSelection, setAssistantSuggestSelection] = React.useState<AssistantSuggestKind | null>(null);
  /** 每日至多一次 AI 估算的四项目标（本地缓存），用于「今日最佳」行 */
  const [dailyAiTargets, setDailyAiTargets] = React.useState<DailyAiIntakeTargetsRow | null>(null);
  const [dailyAiLoading, setDailyAiLoading] = React.useState(false);
  const today = React.useMemo(() => normalizeDate(logicalTodayDate), [logicalTodayDate]);
  const [selectedDate, setSelectedDate] = React.useState(() => normalizeDate(logicalTodayDate));
  const [weekAnchorDate, setWeekAnchorDate] = React.useState(() => normalizeDate(logicalTodayDate));
  const [quickAddItems, setQuickAddItems] = React.useState<QuickAddCardItem[]>(() => getDefaultQuickAddItems());
  const [quickAddCatalog, setQuickAddCatalog] = React.useState<QuickAddCardItem[]>(() => getDefaultQuickAddItems());

  const weekPagerRef = React.useRef<ScrollView>(null);

  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const translateYAnim = React.useRef(new Animated.Value(18)).current;
  const ctaScaleAnim = React.useRef(new Animated.Value(1)).current;
  const ctaPressAnim = React.useRef(new Animated.Value(1)).current;
  const barGrowAnim = React.useRef(new Animated.Value(0)).current;
  const statusFloatAnim = React.useRef(new Animated.Value(0)).current;
  const selectedDayPopAnim = React.useRef(new Animated.Value(1)).current;
  const bgFloatAnim = React.useRef(new Animated.Value(0)).current;
  const statusShimmerAnim = React.useRef(new Animated.Value(-1)).current;
  const metricCardAnims = React.useRef(nutrientMetricMeta.map(() => new Animated.Value(0))).current;
  const metricImpactAnims = React.useRef(nutrientMetricMeta.map(() => new Animated.Value(0))).current;
  const wheelImpactAnim = React.useRef(new Animated.Value(0)).current;
  const quickAddCardAnimsRef = React.useRef<Animated.Value[]>([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]);
  const sectionEntranceAnims = React.useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const floatingCtaPosition = React.useRef(
    new Animated.ValueXY({
      x: width - FLOATING_CTA_SIZE - FLOATING_CTA_MARGIN,
      y: height - FLOATING_CTA_SIZE - 140,
    })
  ).current;

  const clampFloatingY = React.useCallback((value: number) => {
    const minY = 96;
    const maxY = height - FLOATING_CTA_SIZE - 110;
    return Math.min(maxY, Math.max(minY, value));
  }, []);

  const floatingCtaPanResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4,
      onPanResponderGrant: () => {
        floatingCtaPosition.stopAnimation((current) => {
          floatingCtaPosition.setOffset(current);
          floatingCtaPosition.setValue({ x: 0, y: 0 });
        });
      },
      onPanResponderMove: Animated.event([null, { dx: floatingCtaPosition.x, dy: floatingCtaPosition.y }], {
        useNativeDriver: false,
      }),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => {
        floatingCtaPosition.flattenOffset();
        floatingCtaPosition.stopAnimation((current) => {
          const snapLeft = FLOATING_CTA_MARGIN;
          const snapRight = width - FLOATING_CTA_SIZE - FLOATING_CTA_MARGIN;
          const snapX = current.x + FLOATING_CTA_SIZE / 2 < width / 2 ? snapLeft : snapRight;
          Animated.spring(floatingCtaPosition, {
            toValue: { x: snapX, y: clampFloatingY(current.y) },
            speed: 18,
            bounciness: 8,
            useNativeDriver: false,
          }).start();
        });
      },
    })
  ).current;

  const weekDaysCurrent = React.useMemo(() => getWeekDaysFromAnchor(weekAnchorDate), [weekAnchorDate]);
  const weekDaysPrev = React.useMemo(() => getWeekDaysFromAnchor(addDays(weekAnchorDate, -7)), [weekAnchorDate]);
  const weekDaysNext = React.useMemo(() => getWeekDaysFromAnchor(addDays(weekAnchorDate, 7)), [weekAnchorDate]);



  // 获取用户信息
  const [user, setUser] = React.useState<UserRow | null>(null);
  const loadUser = React.useCallback(async () => {
    const data = await getDefaultUser();
    setUser(data);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const refreshUser = async () => {
        const data = await getDefaultUser();
        if (!cancelled) {
          setUser(data);
        }
      };

      void loadUser();
      const unsubscribe = subscribeDefaultUserUpdates(() => {
        void refreshUser();
      });

      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, [loadUser])
  );

  // 本地库：当前周 7 天记录（助手建议等）+ 选中日在库中的最新一条（首页当前摄入）
  const [healthRecords, setHealthRecords] = React.useState<HealthRecordRow[]>([]);
  const [prevWeekHealthRecords, setPrevWeekHealthRecords] = React.useState<HealthRecordRow[]>([]);
  /** 选中日在本地库中各维度摄入合计（同日多条 health_records 会相加）。 */
  const [selectedDayIntakeTotals, setSelectedDayIntakeTotals] = React.useState<HealthIntakeDayTotals | null>(null);
  /** 选中日的原始记录行（用于摄入时间线）。 */
  const [selectedDayRecords, setSelectedDayRecords] = React.useState<HealthRecordRow[]>([]);
  /** AI/拍照确认后、智谱解析完成前的列表占位 */
  const [pendingIntake, setPendingIntake] = React.useState<{ id: string; kind: 'ai' | 'photo'; label: string } | null>(
    null
  );
  const intakeParseLocked = pendingIntake != null;

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const run = async () => {
        if (!user?.id) {
          if (!cancelled) {
            setHealthRecords([]);
            setPrevWeekHealthRecords([]);
            setSelectedDayIntakeTotals(null);
            setSelectedDayRecords([]);
          }
          return;
        }
        try {
          const { week, prevWeek, dayTotals, dayRecords } = await fetchHomeHealthSlice(user.id, weekAnchorDate, selectedDate);
          if (!cancelled) {
            setHealthRecords(week);
            setPrevWeekHealthRecords(prevWeek);
            setSelectedDayIntakeTotals(dayTotals);
            setSelectedDayRecords(dayRecords);
          }
        } catch {
          if (!cancelled) {
            setHealthRecords([]);
            setPrevWeekHealthRecords([]);
            setSelectedDayIntakeTotals(null);
            setSelectedDayRecords([]);
          }
        }
      };
      void run();
      return () => {
        cancelled = true;
      };
    }, [user?.id, weekAnchorDate, selectedDate])
  );

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const run = async () => {
        if (!user?.id) {
          setDailyAiTargets(null);
          setDailyAiLoading(false);
          return;
        }
        setDailyAiLoading(true);
        try {
          const r = await ensureDailyAiIntakeTargetsForToday({ user, todayYmd: logicalTodayYmd });
          if (cancelled) return;
          if (r.status === 'cached' || r.status === 'fresh') {
            setDailyAiTargets(r.row);
          } else {
            setDailyAiTargets(null);
          }
        } finally {
          if (!cancelled) setDailyAiLoading(false);
        }
      };
      void run();
      return () => {
        cancelled = true;
      };
    }, [logicalTodayYmd, user])
  );

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const run = async () => {
        try {
          const [selectedItems, catalog] = await Promise.all([loadSelectedQuickAddItems(), loadAllQuickAddItems()]);
          if (!cancelled) {
            setQuickAddItems(selectedItems);
            setQuickAddCatalog(catalog);
          }
        } catch {
          if (!cancelled) {
            setQuickAddItems(getDefaultQuickAddItems());
            setQuickAddCatalog(getDefaultQuickAddItems());
          }
        }
      };
      void run();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const dayIntakeDisplay = React.useMemo(() => {
    const hydrationCurrent = selectedDayIntakeTotals?.hydration ?? 0;
    const proteinCurrent = selectedDayIntakeTotals?.protein ?? 0;
    const carbohydrateCurrent = selectedDayIntakeTotals?.carbohydrate ?? 0;
    const sodiumCurrent = selectedDayIntakeTotals?.sodium ?? 0;
    const tH = intakeTargetsSnapshot.hydrationMl;
    const tP = intakeTargetsSnapshot.proteinG;
    const tC = intakeTargetsSnapshot.carbohydrateG;
    const tS = intakeTargetsSnapshot.sodiumMg;
    const pct = (current: number, target: number) =>
      target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    return {
      hydration: { current: hydrationCurrent, target: tH, percent: pct(hydrationCurrent, tH) },
      protein: { current: proteinCurrent, target: tP, percent: pct(proteinCurrent, tP) },
      carbohydrate: { current: carbohydrateCurrent, target: tC, percent: pct(carbohydrateCurrent, tC) },
      sodium: { current: sodiumCurrent, target: tS, percent: pct(sodiumCurrent, tS) },
    };
  }, [selectedDayIntakeTotals, intakeTargetsSnapshot]);

  const weeklyTrend = React.useMemo<WeeklyTrendItem[]>(() => {
    const totalsByYmd = new Map<string, { hydration: number; protein: number; carbohydrate: number; sodium: number }>();
    for (const row of healthRecords) {
      const prev = totalsByYmd.get(row.record_date) ?? { hydration: 0, protein: 0, carbohydrate: 0, sodium: 0 };
      totalsByYmd.set(row.record_date, {
        hydration: prev.hydration + row.hydration,
        protein: prev.protein + row.protein,
        carbohydrate: prev.carbohydrate + row.carbohydrate,
        sodium: prev.sodium + row.sodium,
      });
    }
    const pct = (current: number, target: number) =>
      target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    const activeYmd = formatLocalYmd(selectedDate);
    return weekDaysCurrent.map((day) => {
      const dayYmd = formatLocalYmd(day.date);
      const totals = totalsByYmd.get(dayYmd) ?? { hydration: 0, protein: 0, carbohydrate: 0, sodium: 0 };
      return {
        day: day.label,
        date: day.date,
        hydration: pct(totals.hydration, intakeTargetsSnapshot.hydrationMl),
        protein: pct(totals.protein, intakeTargetsSnapshot.proteinG),
        carbohydrate: pct(totals.carbohydrate, intakeTargetsSnapshot.carbohydrateG),
        sodium: pct(totals.sodium, intakeTargetsSnapshot.sodiumMg),
        active: dayYmd === activeYmd,
      };
    });
  }, [healthRecords, intakeTargetsSnapshot, selectedDate, weekDaysCurrent]);

  const activeTrend = weeklyTrend.find((item) => item.active) ?? weeklyTrend[weeklyTrend.length - 1];

  const weeklyTrendDeltaText = React.useMemo(() => {
    const sumWeekProgress = (rows: HealthRecordRow[]) => {
      if (!rows.length) return 0;
      let hydrationTotal = 0;
      let proteinTotal = 0;
      let carbohydrateTotal = 0;
      let sodiumTotal = 0;
      for (const row of rows) {
        hydrationTotal += row.hydration;
        proteinTotal += row.protein;
        carbohydrateTotal += row.carbohydrate;
        sodiumTotal += row.sodium;
      }
      const targetSum =
        intakeTargetsSnapshot.hydrationMl +
        intakeTargetsSnapshot.proteinG +
        intakeTargetsSnapshot.carbohydrateG +
        intakeTargetsSnapshot.sodiumMg;
      if (targetSum <= 0) return 0;
      const weekProgress = ((hydrationTotal + proteinTotal + carbohydrateTotal + sodiumTotal) / (targetSum * 7)) * 100;
      return Math.max(0, weekProgress);
    };

    const current = sumWeekProgress(healthRecords);
    const previous = sumWeekProgress(prevWeekHealthRecords);
    if (previous <= 0) {
      if (current <= 0) return '0% VS 上周';
      return '+100% VS 上周';
    }
    const delta = ((current - previous) / previous) * 100;
    const rounded = Math.round(delta);
    const sign = rounded > 0 ? '+' : '';
    return `${sign}${rounded}% VS 上周`;
  }, [healthRecords, prevWeekHealthRecords, intakeTargetsSnapshot]);

  const metricPercents = React.useMemo(
    () => ({
      hydration: dayIntakeDisplay.hydration.percent,
      protein: dayIntakeDisplay.protein.percent,
      carbohydrate: dayIntakeDisplay.carbohydrate.percent,
      sodium: dayIntakeDisplay.sodium.percent,
    }),
    [dayIntakeDisplay],
  );

  const playIntakeFeedbackAnimation = React.useCallback(() => {
    metricImpactAnims.forEach((anim) => anim.setValue(0));
    wheelImpactAnim.setValue(0);
    Animated.parallel([
      Animated.stagger(
        60,
        metricImpactAnims.map((anim) =>
          Animated.sequence([
            Animated.timing(anim, {
              toValue: 1,
              duration: 180,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.spring(anim, {
              toValue: 0,
              speed: 20,
              bounciness: 9,
              useNativeDriver: true,
            }),
          ])
        )
      ),
      Animated.sequence([
        Animated.timing(wheelImpactAnim, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(wheelImpactAnim, {
          toValue: 0,
          speed: 18,
          bounciness: 7,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [metricImpactAnims, wheelImpactAnim]);

  const persistManualIntakeDelta = React.useCallback(
    async (type: 'hydration' | 'protein' | 'carbohydrate' | 'sodium', amount: number, quickAddKey?: string) => {
      if (pendingIntake) {
        Alert.alert('请稍候', '当前有一条摄入正在解析，解析完成后再添加。');
        return;
      }
      if (!user?.id || !Number.isFinite(amount) || amount <= 0) return;
      const ymd = formatLocalYmd(selectedDate);
      try {
        await appendManualIntakeToDay({
          userId: user.id,
          recordDateYmd: ymd,
          type,
          amount,
          quickAddKey,
          targetHydrationMl: intakeTargetsSnapshot.hydrationMl,
          targetProteinG: intakeTargetsSnapshot.proteinG,
          targetCarbohydrateG: intakeTargetsSnapshot.carbohydrateG,
          targetSodiumMg: intakeTargetsSnapshot.sodiumMg,
        });
        const { week, prevWeek, dayTotals, dayRecords } = await fetchHomeHealthSlice(user.id, weekAnchorDate, selectedDate);
        setHealthRecords(week);
        setPrevWeekHealthRecords(prevWeek);
        setSelectedDayIntakeTotals(dayTotals);
        setSelectedDayRecords(dayRecords);
        playIntakeFeedbackAnimation();
      } catch {
        /* 忽略写入失败 */
      }
    },
    [user?.id, selectedDate, weekAnchorDate, intakeTargetsSnapshot, playIntakeFeedbackAnimation, pendingIntake]
  );

  const persistFoodPhotoIntake = React.useCallback(
    async (
      protein: number,
      carbohydrate: number,
      sodium: number,
      sourceImageUri?: string | null,
      meta?: { displayTitle?: string; aiComment?: string }
    ): Promise<boolean> => {
      if (!user?.id) return false;
      const p = Math.max(0, Number(protein) || 0);
      const c = Math.max(0, Number(carbohydrate) || 0);
      const s = Math.max(0, Number(sodium) || 0);
      if (p + c + s <= 0) return false;
      const ymd = formatLocalYmd(selectedDate);
      try {
        const id = `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        const storedImageUri = await copyIntakePhotoToDocuments(id, sourceImageUri);
        await createHealthRecord({
          id,
          user_id: user.id,
          record_date: ymd,
          quick_add_key: null,
          source_image_uri: storedImageUri,
          intake_display_title: clampIntakeDisplayTitle(meta?.displayTitle),
          intake_ai_comment: clampIntakeAiComment(meta?.aiComment),
          hydration: 0,
          protein: p,
          carbohydrate: c,
          sodium: s,
          target_hydration: intakeTargetsSnapshot.hydrationMl,
          target_protein: intakeTargetsSnapshot.proteinG,
          target_carbohydrate: intakeTargetsSnapshot.carbohydrateG,
          target_sodium: intakeTargetsSnapshot.sodiumMg,
        });
        const { week, prevWeek, dayTotals, dayRecords } = await fetchHomeHealthSlice(user.id, weekAnchorDate, selectedDate);
        setHealthRecords(week);
        setPrevWeekHealthRecords(prevWeek);
        setSelectedDayIntakeTotals(dayTotals);
        setSelectedDayRecords(dayRecords);
        playIntakeFeedbackAnimation();
        return true;
      } catch {
        return false;
      }
    },
    [user?.id, selectedDate, weekAnchorDate, intakeTargetsSnapshot, playIntakeFeedbackAnimation]
  );

  const persistAiTextIntake = React.useCallback(
    async (
      hydrationMl: number,
      protein: number,
      carbohydrate: number,
      sodium: number,
      meta?: { displayTitle?: string; aiComment?: string }
    ): Promise<boolean> => {
      if (!user?.id) return false;
      const h = Math.max(0, Number(hydrationMl) || 0);
      const p = Math.max(0, Number(protein) || 0);
      const c = Math.max(0, Number(carbohydrate) || 0);
      const s = Math.max(0, Number(sodium) || 0);
      if (h + p + c + s <= 0) return false;
      const ymd = formatLocalYmd(selectedDate);
      try {
        const id = `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        await createHealthRecord({
          id,
          user_id: user.id,
          record_date: ymd,
          quick_add_key: HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY,
          source_image_uri: null,
          intake_display_title: clampIntakeDisplayTitle(meta?.displayTitle),
          intake_ai_comment: clampIntakeAiComment(meta?.aiComment),
          hydration: h,
          protein: p,
          carbohydrate: c,
          sodium: s,
          target_hydration: intakeTargetsSnapshot.hydrationMl,
          target_protein: intakeTargetsSnapshot.proteinG,
          target_carbohydrate: intakeTargetsSnapshot.carbohydrateG,
          target_sodium: intakeTargetsSnapshot.sodiumMg,
        });
        const { week, prevWeek, dayTotals, dayRecords } = await fetchHomeHealthSlice(user.id, weekAnchorDate, selectedDate);
        setHealthRecords(week);
        setPrevWeekHealthRecords(prevWeek);
        setSelectedDayIntakeTotals(dayTotals);
        setSelectedDayRecords(dayRecords);
        playIntakeFeedbackAnimation();
        return true;
      } catch {
        return false;
      }
    },
    [user?.id, selectedDate, weekAnchorDate, intakeTargetsSnapshot, playIntakeFeedbackAnimation]
  );

  const persistQuickAddIntake = React.useCallback(
    async (item: QuickAddCardItem) => {
      const metrics = getQuickAddMetricTypes(item);
      if (!metrics.length) return;
      for (const metric of metrics) {
        await persistManualIntakeDelta(metric, getQuickAddMetricAmount(item, metric), item.key);
      }
    },
    [persistManualIntakeDelta]
  );

  const deleteIntakeRecordNow = React.useCallback(
    async (recordId: string) => {
      if (!user?.id) return;
      try {
        await deleteHealthRecord(recordId);
        const { week, prevWeek, dayTotals, dayRecords } = await fetchHomeHealthSlice(user.id, weekAnchorDate, selectedDate);
        setHealthRecords(week);
        setPrevWeekHealthRecords(prevWeek);
        setSelectedDayIntakeTotals(dayTotals);
        setSelectedDayRecords(dayRecords);
        playIntakeFeedbackAnimation();
      } catch {
        /* 忽略删除失败 */
      }
    },
    [user?.id, selectedDate, weekAnchorDate, playIntakeFeedbackAnimation]
  );

  const confirmDeleteIntakeRecord = React.useCallback(
    (recordId: string) => {
      if (!user?.id) return;
      Alert.alert('删除记录', '确定要删除这条摄入记录吗？删除后将无法恢复。', [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            void deleteIntakeRecordNow(recordId);
          },
        },
      ]);
    },
    [deleteIntakeRecordNow, user?.id]
  );

  const handleRecordIntakeConfirm = React.useCallback(
    async (payload: RecordIntakeConfirmPayload) => {
      if (payload.mode === 'manual') {
        if (payload.amount <= 0 || !payload.type) return;
        await persistManualIntakeDelta(payload.type, payload.amount);
        return;
      }
      if (!user?.id) {
        Alert.alert('无法记录', '请先完成用户资料后再试。');
        return;
      }
      if (pendingIntake) {
        Alert.alert('请稍候', '当前有一条摄入正在解析，请等待完成后再试。');
        return;
      }
      setSheetOpen(false);
      const pendingId = `pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      if (payload.mode === 'ai') {
        const text = payload.text.trim();
        if (!text) return;
        if (payload.parsed) {
          const d = payload.parsed;
          const sum = d.hydration_ml + d.protein_g + d.carbohydrate_g + d.sodium_mg;
          if (!Number.isFinite(sum) || sum <= 0) {
            Alert.alert(
              '无法记录',
              '摄入量需大于 0，请修改预解析数值或写得更具体后重新预解析。'
            );
            return;
          }
          const ok = await persistAiTextIntake(d.hydration_ml, d.protein_g, d.carbohydrate_g, d.sodium_mg, {
            displayTitle: text,
            aiComment: d.ai_evaluation?.trim(),
          });
          if (!ok) Alert.alert('保存失败', '请稍后重试。');
          return;
        }
        setPendingIntake({ id: pendingId, kind: 'ai', label: text });
        void (async () => {
          try {
            const r = await parseFoodIntakeFromText({ apiKey: getActiveAiLlmApiKey(), text });
            if (!r.ok) {
              Alert.alert('解析失败', r.error);
              return;
            }
            const d = r.data;
            const sum = d.hydration_ml + d.protein_g + d.carbohydrate_g + d.sodium_mg;
            if (!Number.isFinite(sum) || sum <= 0) {
              Alert.alert(
                '无法记录',
                '未能估算出有效摄入量，请写得更具体一些（如「一碗牛肉面、一杯牛奶」）。'
              );
              return;
            }
            const ok = await persistAiTextIntake(d.hydration_ml, d.protein_g, d.carbohydrate_g, d.sodium_mg, {
              displayTitle: text,
              aiComment: d.ai_evaluation?.trim(),
            });
            if (!ok) Alert.alert('保存失败', '请稍后重试。');
          } catch (e) {
            Alert.alert('解析失败', e instanceof Error ? e.message : String(e));
          } finally {
            setPendingIntake(null);
          }
        })();
        return;
      }
      if (payload.mode === 'photo') {
        const photoNote = payload.photoNote?.trim() ?? '';
        setPendingIntake({
          id: pendingId,
          kind: 'photo',
          label: photoNote.length > 0 ? photoNote : '拍照记录',
        });
        void (async () => {
          try {
            const r = await analyzeFoodNutritionFromImage({
              apiKey: getActiveAiLlmApiKey(),
              imageBase64: payload.imageBase64,
              imageMimeType: payload.imageMimeType,
              ...(photoNote ? { supplementText: photoNote } : {}),
            });
            if (!r.ok) {
              Alert.alert('识别失败', r.error);
              return;
            }
            const d = r.data;
            const sum = d.protein_g + d.carbohydrate_g + d.sodium_mg;
            if (d.is_food !== 1 || sum <= 0) {
              const hint =
                d.is_food !== 1
                  ? `无法按食物记录（代码 ${d.non_food_code}），请换一张清晰的食物照片。`
                  : '估算营养均为 0，请换一张更清晰的食物照片。';
              Alert.alert('无法记录', hint);
              return;
            }
            const foodName = d.food_name?.trim() ?? '';
            const displayTitleRaw =
              photoNote.length > 0 ? (foodName.length > 0 ? `${photoNote} · ${foodName}` : photoNote) : foodName;
            const ok = await persistFoodPhotoIntake(d.protein_g, d.carbohydrate_g, d.sodium_mg, payload.sourceImageUri, {
              displayTitle: clampIntakeDisplayTitle(displayTitleRaw) ?? undefined,
              aiComment: d.ai_evaluation?.trim(),
            });
            if (!ok) Alert.alert('保存失败', '请稍后重试。');
          } catch (e) {
            Alert.alert('识别失败', e instanceof Error ? e.message : String(e));
          } finally {
            setPendingIntake(null);
          }
        })();
      }
    },
    [user?.id, pendingIntake, persistManualIntakeDelta, persistAiTextIntake, persistFoodPhotoIntake]
  );

  const intakeListPreview = React.useMemo(() => {
    const lines = buildIntakeListLines(selectedDayRecords, quickAddCatalog);
    const placeholderLine: IntakeListLine | null = pendingIntake
      ? {
          key: `${pendingIntake.id}-combined`,
          recordId: pendingIntake.id,
          metric: 'hydration',
          title:
            pendingIntake.label.length > 40 ? `${pendingIntake.label.slice(0, 40)}…` : pendingIntake.label,
          timeLine: '解析中',
          amountRight: '—',
          note: pendingIntake.kind === 'ai' ? '正在解析饮食描述…' : '正在识别食物照片…',
          aiComment: '完成后将自动加入列表',
          icon: 'hourglass-empty',
          iconBgLight: 'rgba(59,130,246,0.14)',
          iconBgDark: 'rgba(30,58,138,0.35)',
          iconColor: colors.primarySoft,
          isPlaceholder: true,
        }
      : null;
    const merged = placeholderLine ? [placeholderLine, ...lines] : lines;
    const max = 8;
    return {
      lines: merged.slice(0, max),
      total: merged.length,
      hasMore: merged.length > max,
      showEmpty: lines.length === 0 && !placeholderLine,
    };
  }, [selectedDayRecords, quickAddCatalog, pendingIntake, colors.primarySoft]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [weekPagerWidth]);

  React.useEffect(() => {
    const anims = quickAddCardAnimsRef.current;
    while (anims.length < quickAddItems.length) {
      anims.push(new Animated.Value(0));
    }
  }, [quickAddItems.length]);

  React.useEffect(() => {
    metricCardAnims.forEach((anim) => anim.setValue(0));
    quickAddCardAnimsRef.current.forEach((anim) => anim.setValue(0));
    sectionEntranceAnims.forEach((anim) => anim.setValue(0));
    fadeAnim.setValue(0);
    translateYAnim.setValue(18);

    const metricStagger = Animated.stagger(
      90,
      metricCardAnims.map((anim) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      )
    );

    const quickAddStagger = Animated.stagger(
      80,
      quickAddCardAnimsRef.current.map((anim) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      )
    );

    const sectionStagger = Animated.stagger(
      120,
      sectionEntranceAnims.map((anim) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      )
    );

    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      metricStagger,
      Animated.parallel([sectionStagger, quickAddStagger]),
    ]).start();
  }, [fadeAnim, translateYAnim, metricCardAnims, quickAddItems.length, sectionEntranceAnims]);

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaScaleAnim, {
          toValue: 1.035,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(ctaScaleAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, [ctaScaleAnim]);

  React.useEffect(() => {
    barGrowAnim.setValue(0);
    Animated.timing(barGrowAnim, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [barGrowAnim]);

  React.useEffect(() => {
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(statusFloatAnim, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(statusFloatAnim, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    float.start();
    return () => float.stop();
  }, [statusFloatAnim]);

  React.useEffect(() => {
    const bgFloat = Animated.loop(
      Animated.sequence([
        Animated.timing(bgFloatAnim, {
          toValue: 1,
          duration: 3600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bgFloatAnim, {
          toValue: 0,
          duration: 3600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    bgFloat.start();
    return () => bgFloat.stop();
  }, [bgFloatAnim]);

  React.useEffect(() => {
    const shimmer = Animated.loop(
      Animated.timing(statusShimmerAnim, {
        toValue: 1,
        duration: 2300,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );

    shimmer.start();
    return () => {
      shimmer.stop();
      statusShimmerAnim.setValue(-1);
    };
  }, [statusShimmerAnim]);

  const assistantTheme = {
    水分: {
      accent: HealthNutrientAccents.hydration,
      unit: 'ml',
      placeholder: '2500',
      best: '2,850',
      avg: '2,400',
      community: '2,200',
    },
    蛋白质: {
      accent: HealthNutrientAccents.protein,
      unit: 'g',
      placeholder: '80',
      best: '75',
      avg: '68',
      community: '70',
    },
    碳水: {
      accent: HealthNutrientAccents.carbohydrate,
      unit: 'g',
      placeholder: '260',
      best: '280',
      avg: '250',
      community: '260',
    },
    钠: {
      accent: HealthNutrientAccents.sodium,
      unit: 'mg',
      placeholder: '2000',
      best: '2,000',
      avg: '2,150',
      community: '2,000',
    },
  } as const;

  const currentAssistant = assistantTheme[assistantTab];

  const communityValue = React.useMemo(() => {
    if (!user) return 0;

    const activityLevel = mapLifestyleToActivityLevel(user.lifestyle);
    const nutritionGoal = mapGoalToNutritionGoal(user.goal);
    const nutritionGender = mapGenderToNutritionGender(user.gender);
    const base = calculateNutritionV2(
      user.weight ?? 0,
      user.height ?? 0,
      user.age ?? 0,
      nutritionGender,
      activityLevel,
      nutritionGoal,
      selectedDayIntakeTotals?.sodium ?? 0
    );
    const metrics = adjustNutritionMetricsForDaySchedule(
      base,
      getUserDayScheduleKind(user, logicalTodayYmd),
    );

    if (assistantTab === '水分') return metrics.Water_ml;
    if (assistantTab === '蛋白质') return metrics.Protein_g;
    if (assistantTab === '碳水') return metrics.Carbohydrate_g;
    return metrics.Sodium_mg;
  }, [assistantTab, user, selectedDayIntakeTotals?.sodium, logicalTodayYmd]);


  const avgValue = React.useMemo(() => {
    if (!healthRecords.length) return 0;

    if (assistantTab === '水分') {
      return healthRecords.reduce((acc, curr) => acc + curr.hydration, 0) / healthRecords.length;
    }
    if (assistantTab === '蛋白质') {

      return healthRecords.reduce((acc, curr) => acc + curr.protein, 0) / healthRecords.length;
    }
    if (assistantTab === '碳水') {
      return healthRecords.reduce((acc, curr) => acc + curr.carbohydrate, 0) / healthRecords.length;
    }
    if (assistantTab === '钠') {
      return healthRecords.reduce((acc, curr) => acc + curr.sodium, 0) / healthRecords.length;
    }
  }, [assistantTab, healthRecords]);

  const bestValue = React.useMemo(() => {
    if (!healthRecords.length || !user) {
      if (!user) return 0;
  
    if (assistantTab === '水分') {
      return user.weight * 35;
    }
    if (assistantTab === '蛋白质') {
      return user.weight * 1.2;
    }
    if (assistantTab === '碳水') {
      return user.weight * 3.5;
    }
    if (assistantTab === '钠') {
      return 2000;
    }
  }

    if (assistantTab === '水分') {
      return ((user.weight * 35)+(healthRecords.reduce((acc, curr) => acc + curr.hydration, 0) / healthRecords.length))/2;
    }
    if (assistantTab === '蛋白质') {

      return ((user.weight * 1.2)+(healthRecords.reduce((acc, curr) => acc + curr.protein, 0) / healthRecords.length))/2;
    }
    if (assistantTab === '碳水') {
      return ((user.weight * 3.5)+(healthRecords.reduce((acc, curr) => acc + curr.carbohydrate, 0) / healthRecords.length))/2;
    }
    if (assistantTab === '钠') {
      return (2000+(healthRecords.reduce((acc, curr) => acc + curr.sodium, 0) / healthRecords.length))/2;
    }
  }, [assistantTab, healthRecords,user]);

  const suggestNumeric = React.useMemo(() => {
    const fallbackBest = Math.round(Number(bestValue) || 0);
    const ai =
      dailyAiTargets != null && !dailyAiLoading
        ? Math.round(dailyAiTargetForTab(dailyAiTargets, assistantTab))
        : null;
    const best = ai != null && ai > 0 ? ai : fallbackBest;
    return {
      best,
      avg: Math.round(Number(avgValue) || 0),
      community: Math.round(Number(communityValue) || 0),
    };
  }, [assistantTab, bestValue, avgValue, communityValue, dailyAiTargets, dailyAiLoading]);

  const todayScheduleLabel = React.useMemo(() => {
    if (!user) return null;
    const kind = getUserDayScheduleKind(user, logicalTodayYmd);
    if (kind === 'sedentary') return null;
    return getUserDayScheduleLabelZh(kind);
  }, [user, logicalTodayYmd]);

  const assistantSuggestRows = React.useMemo(
    () =>
      [
        {
          kind: 'best' as const,
          tag: dailyAiTargets
            ? todayScheduleLabel
              ? `AI 今日建议（今日${todayScheduleLabel}，综合档案与近7日摄入，每日更新一次）`
              : 'AI 今日建议（综合档案与近7日摄入，每日更新一次）'
            : todayScheduleLabel
              ? `今日最佳(今日${todayScheduleLabel}，基于档案与活动指标)`
              : '今日最佳(基于你的活动和身体指标计算)',
        },
        { kind: 'avg' as const, tag: '上周平均(基于您的日常活动指标计算)' },
        {
          kind: 'community' as const,
          tag: todayScheduleLabel
            ? `社群达标(今日${todayScheduleLabel}，基于身体指标与周计划)`
            : '社群达标(基于您的身体指标计算)',
        },
      ] as const,
    [dailyAiTargets, todayScheduleLabel]
  );

  /** 输入框与推荐行双向同步：多行数值相同时保留当前选中项，避免被固定写成「总是 best」 */
  React.useEffect(() => {
    if (!assistantOpen) return;
    const g = parseGoalInput(manualGoal);
    if (g === null) {
      setAssistantSuggestSelection(null);
      return;
    }
    const kinds: AssistantSuggestKind[] = ['best', 'avg', 'community'];
    const matches = kinds.filter((k) => goalMatchesSuggestion(g, suggestNumeric[k]));
    if (matches.length === 0) {
      setAssistantSuggestSelection(null);
      return;
    }
    if (matches.length === 1) {
      setAssistantSuggestSelection(matches[0]);
      return;
    }
    setAssistantSuggestSelection((prev) => (prev && matches.includes(prev) ? prev : matches[0]));
  }, [
    assistantOpen,
    assistantTab,
    manualGoal,
    suggestNumeric,
  ]);

  const onWeekPagerEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;

    if (x < weekPagerWidth * 0.5) {
      const nextAnchor = addDays(weekAnchorDate, -7);
      setWeekAnchorDate(nextAnchor);
      if (selectedDate > weekAnchorDate) {
        setSelectedDate(nextAnchor);
      }
      weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
      return;
    }

    if (x > weekPagerWidth * 1.5) {
      const nextAnchor = addDays(weekAnchorDate, 7);
      if (isFutureDate(nextAnchor, today)) {
        weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
        return;
      }

      setWeekAnchorDate(nextAnchor);
      if (selectedDate < weekAnchorDate) {
        setSelectedDate(nextAnchor);
      }
      weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerScrim,
            borderBottomColor: colors.outline,
            paddingTop: insets.top,
          },
        ]}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerSideSpacer} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>{formatHeaderDate(selectedDate)}</Text>
          <AppIconButton
            icon="calendar-today"
            onPress={() => router.push('/health-calendar')}
            accessibilityLabel="健康日历"
          />
        </View>

        <ScrollView
          ref={weekPagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onWeekPagerEnd}
        >
          {[weekDaysPrev, weekDaysCurrent, weekDaysNext].map((week, pageIndex) => (
            <View key={pageIndex} style={[styles.weekPage, { width: weekPagerWidth }]}>
              <View style={styles.weekStripContent}>
                {week.map((item) => {
                  const normalizedItemDate = normalizeDate(item.date);
                  const isActive = normalizedItemDate.getTime() === selectedDate.getTime();
                  const disabled = isFutureDate(normalizedItemDate, today);

                  return (
                    <TouchableOpacity
                      key={item.key}
                      activeOpacity={0.85}
                      disabled={disabled}
                      onPress={() => {
                        if (disabled) return;
                        Animated.sequence([
                          Animated.spring(selectedDayPopAnim, {
                            toValue: 0.92,
                            speed: 24,
                            bounciness: 0,
                            useNativeDriver: true,
                          }),
                          Animated.spring(selectedDayPopAnim, {
                            toValue: 1,
                            speed: 20,
                            bounciness: 9,
                            useNativeDriver: true,
                          }),
                        ]).start();

                        setSelectedDate(normalizedItemDate);
                        if (pageIndex === 0) {
                          setWeekAnchorDate(addDays(weekAnchorDate, -7));
                          weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
                        }
                        if (pageIndex === 2) {
                          const nextAnchor = addDays(weekAnchorDate, 7);
                          if (!isFutureDate(nextAnchor, today)) {
                            setWeekAnchorDate(nextAnchor);
                            weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
                          }
                        }
                      }}
                      style={[
                        styles.weekDayItem,
                        {
                          backgroundColor: isActive ? colors.primary : 'transparent',
                          borderColor: isActive ? `${colors.primary}00` : colors.outline,
                          opacity: disabled ? 0.45 : 1,
                        },
                      ]}
                    >
                      <Animated.View
                        style={[
                          styles.weekDayContent,
                          isActive ? { transform: [{ scale: selectedDayPopAnim }] } : undefined,
                        ]}
                      >
                        <Text style={[styles.weekDayDate, { color: isActive ? colors.onPrimary : colors.textSecondary }]}>{item.day}</Text>
                        <Text style={[styles.weekDayLabel, { color: isActive ? colors.onPrimary : colors.textSecondary, opacity: isActive ? 1 : 0.8 }]}>{item.label}</Text>
                      </Animated.View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        directionalLockEnabled
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bgOrb,
            styles.bgOrbTop,
            {
              backgroundColor: `${colors.primary}18`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -10],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 8],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bgOrb,
            styles.bgOrbMiddle,
            {
              backgroundColor: `${colors.primary}10`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 12],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -6],
                  }),
                },
              ],
            },
          ]}
        />

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: translateYAnim }],
          }}
        >
        <View style={styles.metricsRow}>
          {nutrientMetricMeta.map((item, index) => {
            const row = dayIntakeDisplay[item.key];
            const displayTarget = row.target;
            const animatedPercent = Math.round(metricPercents[item.key]);

            const openAssistantByCard = () => {
              if (item.key === 'hydration') {
                setAssistantTab('水分');
                setManualGoal(sanitizeAssistantManualGoalInput(String(intakeTargetsSnapshot.hydrationMl)));
                setAssistantOpen(true);
              }
              if (item.key === 'protein') {
                setAssistantTab('蛋白质');
                setManualGoal(sanitizeAssistantManualGoalInput(String(intakeTargetsSnapshot.proteinG)));
                setAssistantOpen(true);
              }
              if (item.key === 'sodium') {
                setAssistantTab('钠');
                setManualGoal(sanitizeAssistantManualGoalInput(String(intakeTargetsSnapshot.sodiumMg)));
                setAssistantOpen(true);
              }
              if (item.key === 'carbohydrate') {
                setAssistantTab('碳水');
                setManualGoal(sanitizeAssistantManualGoalInput(String(intakeTargetsSnapshot.carbohydrateG)));
                setAssistantOpen(true);
              }
            };

            const cardOpacity = metricCardAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1],
            });
            const cardTranslateY = metricCardAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            });
            const cardScale = metricCardAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [0.96, 1],
            });
            const impactScale = metricImpactAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.06],
            });
            const impactLift = metricImpactAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [0, -5],
            });
            const wheelRotate = wheelImpactAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0deg', '14deg'],
            });
            const wheelScale = wheelImpactAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.08],
            });

            const card = (
              <Animated.View
                style={{
                  opacity: cardOpacity,
                  transform: [{ translateY: cardTranslateY }, { translateY: impactLift }, { scale: cardScale }, { scale: impactScale }],
                }}
              >
                <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.outline, width: cardWidth }]}>
                  <View style={[styles.metricCardGlow, { backgroundColor: `${colors.primary}14` }]} />
                  <Animated.View style={{ transform: [{ rotate: wheelRotate }, { scale: wheelScale }] }}>
                    <CircularProgress
                      percentage={animatedPercent}
                      icon={item.icon}
                      color={colors.primary}
                      trackColor={colors.outline}
                      opacity={item.opacity}
                    />
                  </Animated.View>
                  <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>{item.label}</Text>
                  <Text style={[styles.metricValue, { color: colors.text }]}>{animatedPercent}%</Text>
                  <Text style={[styles.metricSubValue, { color: colors.textSecondary }]}> 
                    {row.current.toLocaleString()} / {displayTarget.toLocaleString()}
                  </Text>
                </View>
              </Animated.View>
            );

            return (
              <Pressable key={item.key} delayLongPress={280} onLongPress={openAssistantByCard}>
                {card}
              </Pressable>
            );
          })}
        </View>

        <Animated.View
          style={{
            opacity: sectionEntranceAnims[0],
            transform: [
              {
                translateY: sectionEntranceAnims[0].interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, 0],
                }),
              },
              {
                translateY: statusFloatAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -4],
                }),
              },
            ],
          }}
        >
          <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
            <View style={styles.statusItem}>
              <View style={[styles.statusItemAccent, { backgroundColor: HealthNutrientAccents.hydration }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: colors.text }]}>水分摄入</Text>
                  <Text style={[styles.statusBadge, { color: HealthNutrientAccents.hydration, backgroundColor: `${HealthNutrientAccents.hydration}1A` }]}>
                    {Math.round(metricPercents.hydration)}%
                  </Text>
                </View>
                <Text style={[styles.statusDesc, { color: colors.textSecondary }]}>
                  {hydrationStatusDesc(dayIntakeDisplay.hydration.percent)}
                </Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: HealthNutrientAccents.hydration }]}>
                    {dayIntakeDisplay.hydration.current.toLocaleString()}
                  </Text>
                  <Text style={[styles.statusValueSub, { color: colors.textSecondary }]}>
                    ML / {intakeTargetsSnapshot.hydrationMl.toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statusTrack, { backgroundColor: colors.outline }]}>
                  <View
                    style={[
                      styles.statusTrackFill,
                      { width: `${Math.round(metricPercents.hydration)}%`, backgroundColor: HealthNutrientAccents.hydration },
                    ]}
                  />
                </View>
              </View>
            </View>

            <View style={[styles.statusItem, styles.statusItemSpacing]}>
              <View style={[styles.statusItemAccent, { backgroundColor: HealthNutrientAccents.protein }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: colors.text }]}>蛋白质摄入</Text>
                  <Text style={[styles.statusBadge, { color: HealthNutrientAccents.protein, backgroundColor: `${HealthNutrientAccents.protein}1A` }]}>
                    {Math.round(metricPercents.protein)}%
                  </Text>
                </View>
                <Text style={[styles.statusDesc, { color: colors.textSecondary }]}>
                  {proteinStatusDesc(dayIntakeDisplay.protein.percent)}
                </Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: HealthNutrientAccents.protein }]}>
                    {dayIntakeDisplay.protein.current.toLocaleString()}
                  </Text>
                  <Text style={[styles.statusValueSub, { color: colors.textSecondary }]}>
                    G / {intakeTargetsSnapshot.proteinG.toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statusTrack, { backgroundColor: colors.outline }]}>
                  <View
                    style={[
                      styles.statusTrackFill,
                      { width: `${Math.round(metricPercents.protein)}%`, backgroundColor: HealthNutrientAccents.protein },
                    ]}
                  />
                </View>
              </View>
            </View>

            <View style={[styles.statusItem, styles.statusItemSpacing]}>
              <View style={[styles.statusItemAccent, { backgroundColor: HealthNutrientAccents.carbohydrate }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: colors.text }]}>碳水摄入</Text>
                  <Text style={[styles.statusBadge, { color: HealthNutrientAccents.carbohydrate, backgroundColor: `${HealthNutrientAccents.carbohydrate}1A` }]}>
                    {Math.round(metricPercents.carbohydrate)}%
                  </Text>
                </View>
                <Text style={[styles.statusDesc, { color: colors.textSecondary }]}>
                  {carbohydrateStatusDesc(dayIntakeDisplay.carbohydrate.percent)}
                </Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: HealthNutrientAccents.carbohydrate }]}>
                    {dayIntakeDisplay.carbohydrate.current.toLocaleString()}
                  </Text>
                  <Text style={[styles.statusValueSub, { color: colors.textSecondary }]}>
                    G / {intakeTargetsSnapshot.carbohydrateG.toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statusTrack, { backgroundColor: colors.outline }]}>
                  <View
                    style={[
                      styles.statusTrackFill,
                      { width: `${Math.round(metricPercents.carbohydrate)}%`, backgroundColor: HealthNutrientAccents.carbohydrate },
                    ]}
                  />
                </View>
              </View>
            </View>

            <View style={[styles.statusItem, styles.statusItemSpacing]}>
              <View style={[styles.statusItemAccent, { backgroundColor: HealthNutrientAccents.sodium }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: colors.text }]}>钠含量监控</Text>
                  <Text style={[styles.statusBadge, { color: HealthNutrientAccents.sodium, backgroundColor: `${HealthNutrientAccents.sodium}1A` }]}>
                    {Math.round(metricPercents.sodium)}%
                  </Text>
                </View>
                <Text style={[styles.statusDesc, { color: colors.textSecondary }]}>
                  {sodiumStatusDesc(dayIntakeDisplay.sodium.percent)}
                </Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: HealthNutrientAccents.sodium }]}>
                    {dayIntakeDisplay.sodium.current.toLocaleString()}
                  </Text>
                  <Text style={[styles.statusValueSub, { color: colors.textSecondary }]}>
                    MG / {intakeTargetsSnapshot.sodiumMg.toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statusTrack, { backgroundColor: colors.outline }]}>
                  <View
                    style={[
                      styles.statusTrackFill,
                      { width: `${Math.round(metricPercents.sodium)}%`, backgroundColor: HealthNutrientAccents.sodium },
                    ]}
                  />
                </View>
              </View>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={{
            opacity: sectionEntranceAnims[1],
            transform: [
              {
                translateY: sectionEntranceAnims[1].interpolate({
                  inputRange: [0, 1],
                  outputRange: [18, 0],
                }),
              },
            ],
          }}
        >
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>快速添加</Text>
            <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/quick-add-edit')}>
              <Text style={[styles.editBtn, { color: colors.primary }]}>编辑</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            directionalLockEnabled
            contentContainerStyle={styles.quickAddScrollContent}
            style={styles.quickAddScroll}
          >
            {quickAddItems.map((item, index) => {
              const cardAnim = quickAddCardAnimsRef.current[index] ?? quickAddCardAnimsRef.current[quickAddCardAnimsRef.current.length - 1];
              const itemOpacity = cardAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              });
              const itemTranslateY = cardAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [18, 0],
              });

              return (
                <Animated.View
                  key={item.key}
                  style={{
                    opacity: itemOpacity,
                    transform: [{ translateY: itemTranslateY }],
                  }}
                >
                  <TouchableOpacity
                    style={[styles.quickAddCard, { backgroundColor: colors.surface, borderColor: colors.outline, width: cardWidth, opacity: intakeParseLocked ? 0.45 : 1 }]}
                    activeOpacity={0.82}
                    onPress={() => {
                      if (intakeParseLocked) {
                        Alert.alert('请稍候', '当前有一条摄入正在解析，解析完成后再添加。');
                        return;
                      }
                      void persistQuickAddIntake(item);
                    }}
                  >
                    <MaterialIcons name={item.icon as keyof typeof MaterialIcons.glyphMap} size={30} color={colors.textSecondary} style={styles.quickAddIcon} />
                    <Text style={[styles.quickAddLabel, { color: colors.textSecondary }]}>{item.label}</Text>
                    <Text style={[styles.quickAddValue, { color: colors.text }]}>{formatQuickAddAmount(item)}</Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </ScrollView>

        </View>
        </Animated.View>

        <Animated.View
          style={{
            opacity: sectionEntranceAnims[2],
            transform: [
              {
                translateY: sectionEntranceAnims[2].interpolate({
                  inputRange: [0, 1],
                  outputRange: [18, 0],
                }),
              },
            ],
          }}
        >
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>摄入记录</Text>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() =>
                router.push({
                  pathname: '/intake-history',
                  params: { date: formatLocalYmd(selectedDate) },
                })
              }
            >
              <Text style={[styles.editBtn, { color: colors.primary }]}>查看全部</Text>
            </TouchableOpacity>
          </View>

          {intakeListPreview.showEmpty ? (
            <View
              style={[
                styles.intakeEmptyBox,
                { backgroundColor: colors.surfaceMuted, borderColor: colors.outline },
              ]}
            >
              <Text style={[styles.intakeEmptyText, { color: colors.textSecondary }]}>暂无摄入记录，点击上方添加或记录新摄入</Text>
            </View>
          ) : (
            <View style={styles.intakeList}>
              {intakeListPreview.lines.map((line) => {
                const isCombinedIntake = line.key.endsWith('-combined');
                if (line.isPlaceholder) {
                  return (
                    <View
                      key={line.key}
                      style={[
                        styles.intakeRow,
                        isCombinedIntake && styles.intakeRowStacked,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.outline,
                          opacity: 0.92,
                        },
                      ]}
                    >
                      <View style={styles.intakeRowLeft}>
                        <View
                          style={[
                            styles.intakeIconCircle,
                            { backgroundColor: isDark ? line.iconBgDark : line.iconBgLight },
                          ]}
                        >
                          <ActivityIndicator size="small" color={line.iconColor} />
                        </View>
                        <View style={styles.intakeRowText}>
                          <View style={styles.intakeRowHeader}>
                            <Text style={[styles.intakeRowTitle, { color: colors.text }]} numberOfLines={2}>
                              {line.title}
                            </Text>
                            <Text style={[styles.intakeRowTime, { color: colors.textSecondary }]}>{line.timeLine}</Text>
                          </View>
                          <Text style={[styles.intakeRowMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                            {line.note}
                          </Text>
                          <Text style={[styles.intakeRowMeta, { color: colors.textSecondary }]} numberOfLines={2}>
                            {line.aiComment}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.intakeRowAmountStacked, { color: colors.textSecondary }]}>{line.amountRight}</Text>
                    </View>
                  );
                }
                return (
                <Swipeable
                  key={line.key}
                  overshootRight={false}
                  rightThreshold={44}
                  renderRightActions={() => (
                    <Pressable
                      onPress={() => {
                        void deleteIntakeRecordNow(line.recordId);
                      }}
                      style={[styles.swipeDeleteAction, { backgroundColor: colors.danger }]}
                    >
                      <MaterialIcons name="delete" size={22} color={colors.onPrimary} />
                      <Text style={[styles.swipeDeleteText, { color: colors.onPrimary }]}>删除</Text>
                    </Pressable>
                  )}
                >
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/intake-record-detail',
                        params: {
                          recordId: line.recordId,
                          date: formatLocalYmd(selectedDate),
                          metric: line.metric,
                        },
                      })
                    }
                    onLongPress={() => confirmDeleteIntakeRecord(line.recordId)}
                    delayLongPress={280}
                    style={[
                      styles.intakeRow,
                      isCombinedIntake && styles.intakeRowStacked,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.outline,
                      },
                    ]}
                  >
                    {isCombinedIntake ? (
                      <>
                        <View style={styles.intakeRowTop}>
                          <View style={styles.intakeRowLeft}>
                            <View
                              style={[
                                styles.intakeIconCircle,
                                { backgroundColor: isDark ? line.iconBgDark : line.iconBgLight },
                              ]}
                            >
                              <MaterialIcons name={line.icon} size={22} color={line.iconColor} />
                            </View>
                            <View style={styles.intakeRowText}>
                              <View style={styles.intakeRowHeader}>
                                <Text style={[styles.intakeRowTitle, { color: colors.text }]} numberOfLines={1}>
                                  {line.title}
                                </Text>
                                <Text style={[styles.intakeRowTime, { color: colors.textSecondary }]}>{line.timeLine}</Text>
                              </View>
                              <Text style={[styles.intakeRowMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                                {line.note}
                              </Text>
                              <Text style={[styles.intakeRowMeta, { color: colors.textSecondary }]} numberOfLines={2}>
                                {line.aiComment}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <Text style={[styles.intakeRowAmountStacked, { color: colors.text }]}>{line.amountRight}</Text>
                      </>
                    ) : (
                      <>
                        <View style={styles.intakeRowLeft}>
                          <View
                            style={[
                              styles.intakeIconCircle,
                              { backgroundColor: isDark ? line.iconBgDark : line.iconBgLight },
                            ]}
                          >
                            <MaterialIcons name={line.icon} size={22} color={line.iconColor} />
                          </View>
                          <View style={styles.intakeRowText}>
                            <View style={styles.intakeRowHeader}>
                              <Text style={[styles.intakeRowTitle, { color: colors.text }]}>{line.title}</Text>
                              <Text style={[styles.intakeRowTime, { color: colors.textSecondary }]}>{line.timeLine}</Text>
                            </View>
                            <Text style={[styles.intakeRowMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                              {line.note}
                            </Text>
                            <Text style={[styles.intakeRowMeta, { color: colors.textSecondary }]} numberOfLines={2}>
                              {line.aiComment}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.intakeRowAmount, { color: colors.text }]}>{line.amountRight}</Text>
                      </>
                    )}
                  </Pressable>
                </Swipeable>
              );
              })}
              {intakeListPreview.hasMore ? (
                <Text style={[styles.intakeMoreHint, { color: colors.textSecondary }]}>
                  还有 {intakeListPreview.total - intakeListPreview.lines.length} 条，点「查看全部」浏览
                </Text>
              ) : null}
            </View>
          )}
        </View>
        </Animated.View>

        <Animated.View
          style={{
            opacity: sectionEntranceAnims[3],
            transform: [
              {
                translateY: sectionEntranceAnims[3].interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          }}
        >
        <View style={[styles.trendCard, { backgroundColor: isDark ? colors.surfaceMuted : colors.capsule, borderColor: colors.outline }]}>
          <View style={styles.trendHeader}>
            <Text style={[styles.trendTitle, { color: colors.text }]}>每周趋势</Text>
            <Text style={[styles.trendSub, { color: colors.primary }]}>{weeklyTrendDeltaText}</Text>
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: HealthNutrientAccents.hydration }]} />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>水分</Text>
              <Text style={[styles.legendValue, { color: colors.text }]}>{activeTrend.hydration}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: HealthNutrientAccents.protein }]} />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>蛋白质</Text>
              <Text style={[styles.legendValue, { color: colors.text }]}>{activeTrend.protein}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: HealthNutrientAccents.sodium }]} />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>钠</Text>
              <Text style={[styles.legendValue, { color: colors.text }]}>{activeTrend.sodium}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: HealthNutrientAccents.carbohydrate }]} />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>碳水</Text>
              <Text style={[styles.legendValue, { color: colors.text }]}>{activeTrend.carbohydrate}</Text>
            </View>
          </View>

          <View style={styles.chartContainer}>
            <View style={styles.chartInner}>
              <View style={styles.yAxis}>
                {[100, 75, 50, 25, 0].map((tick) => (
                  <Text key={tick} style={[styles.yTickText, { color: colors.textSecondary }]}>{tick}</Text>
                ))}
              </View>

              <View style={styles.plotArea}>
                {[100, 75, 50, 25, 0].map((tick, index) => (
                  <View
                    key={tick}
                    style={[
                      styles.gridLine,
                      {
                        top: `${index * 25}%`,
                        borderColor: colors.outline,
                      },
                    ]}
                  />
                ))}

                <View style={styles.barsRow}>
                  {weeklyTrend.map((item, index) => {
                    const faded = item.active ? 1 : 0.4;
                    const hydrationHeight = barGrowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, trendBarHeight(item.hydration)],
                    });
                    const proteinHeight = barGrowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, trendBarHeight(item.protein)],
                    });
                    const sodiumHeight = barGrowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, trendBarHeight(item.sodium)],
                    });
                    const carbohydrateHeight = barGrowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, trendBarHeight(item.carbohydrate)],
                    });
                    const barOpacity = barGrowAnim.interpolate({
                      inputRange: [0, 0.2, 1],
                      outputRange: [0, 0.6, 1],
                    });

                    return (
                      <Pressable
                        key={`${item.day}-${index}`}
                        style={styles.barGroup}
                        onPress={() => {
                          Animated.sequence([
                            Animated.spring(selectedDayPopAnim, {
                              toValue: 0.92,
                              speed: 24,
                              bounciness: 0,
                              useNativeDriver: true,
                            }),
                            Animated.spring(selectedDayPopAnim, {
                              toValue: 1,
                              speed: 20,
                              bounciness: 9,
                              useNativeDriver: true,
                            }),
                          ]).start();
                          setSelectedDate(normalizeDate(item.date));
                        }}
                      >
                        <View style={styles.barsInner}>
                          <Animated.View
                            style={[
                              styles.miniBar,
                              {
                                height: hydrationHeight,
                                backgroundColor: `rgba(16,185,129,${faded})`,
                                opacity: barOpacity,
                              },
                            ]}
                          />
                          <Animated.View
                            style={[
                              styles.miniBar,
                              {
                                height: proteinHeight,
                                backgroundColor: `rgba(245,158,11,${faded})`,
                                opacity: barOpacity,
                              },
                            ]}
                          />
                          <Animated.View
                            style={[
                              styles.miniBar,
                              {
                                height: carbohydrateHeight,
                                backgroundColor: `rgba(234,179,8,${faded})`,
                                opacity: barOpacity,
                              },
                            ]}
                          />
                          <Animated.View
                            style={[
                              styles.miniBar,
                              {
                                height: sodiumHeight,
                                backgroundColor: `rgba(168,85,247,${faded})`,
                                opacity: barOpacity,
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.barLabel, { color: item.active ? colors.text : colors.textSecondary, fontWeight: item.active ? '700' : '500' }]}>
                          {item.day}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>
        </View>
        </Animated.View>

        <View style={{ height: 40 }} />
        </Animated.View>
      </ScrollView>

      <Animated.View
        style={[
          styles.floatingCtaWrap,
          {
            transform: [
              { translateX: floatingCtaPosition.x },
              { translateY: floatingCtaPosition.y },
              { scale: Animated.multiply(ctaScaleAnim, ctaPressAnim) },
            ],
          },
        ]}
        {...floatingCtaPanResponder.panHandlers}
      >
        <TouchableOpacity
          style={[
            styles.floatingCtaBtn,
            { backgroundColor: colors.primary, shadowColor: colors.primary, opacity: intakeParseLocked ? 0.42 : 1 },
          ]}
          onPress={() => {
            if (intakeParseLocked) {
              Alert.alert('请稍候', '当前有一条摄入正在解析，解析完成后再添加。');
              return;
            }
            setSheetOpen(true);
          }}
          onPressIn={() => {
            Animated.spring(ctaPressAnim, {
              toValue: 0.965,
              speed: 30,
              bounciness: 0,
              useNativeDriver: false,
            }).start();
          }}
          onPressOut={() => {
            Animated.spring(ctaPressAnim, {
              toValue: 1,
              speed: 24,
              bounciness: 6,
              useNativeDriver: false,
            }).start();
          }}
          activeOpacity={0.9}
        >
          <MaterialIcons name="add" size={30} color={colors.onPrimary} />
        </TouchableOpacity>
      </Animated.View>

      <Modal
        visible={assistantOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAssistantOpen(false)}
      >
        <Pressable style={[styles.assistantOverlay, { backgroundColor: colors.overlay }]} onPress={() => setAssistantOpen(false)}>
          <Pressable
            style={[styles.assistantCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}
            onPress={() => {}}
          >
            <View style={[styles.assistantGlow, { backgroundColor: `${currentAssistant.accent}1A` }]} />
            <View style={styles.assistantHeader}>
              <View>
                <Text style={[styles.assistantTitle, { color: colors.text }]}>智能建议</Text>
                <Text style={[styles.assistantSubTitle, { color: colors.textSecondary }]}>SMART GOAL SETTING</Text>
              </View>
              <TouchableOpacity
                style={[styles.assistantCloseBtn, { backgroundColor: isDark ? colors.input : colors.capsule }]}
                onPress={() => setAssistantOpen(false)}
              >
                <MaterialIcons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.assistantTabs, { backgroundColor: isDark ? colors.input : colors.background }]}>
              {(['水分', '蛋白质', '碳水', '钠'] as const).map((tab) => {
                const active = assistantTab === tab;
                return (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => {
                      setAssistantTab(tab);
                      if (tab === '水分')
                        setManualGoal(sanitizeAssistantManualGoalInput(String(intakeTargetsSnapshot.hydrationMl)));
                      if (tab === '蛋白质')
                        setManualGoal(sanitizeAssistantManualGoalInput(String(intakeTargetsSnapshot.proteinG)));
                      if (tab === '碳水')
                        setManualGoal(sanitizeAssistantManualGoalInput(String(intakeTargetsSnapshot.carbohydrateG)));
                      if (tab === '钠')
                        setManualGoal(sanitizeAssistantManualGoalInput(String(intakeTargetsSnapshot.sodiumMg)));
                    }}
                    style={[
                      styles.assistantTabBtn,
                      active && {
                        backgroundColor: colors.surface,
                        shadowColor: colors.text,
                        shadowOpacity: isDark ? 0 : 0.05,
                        shadowOffset: { width: 0, height: 1 },
                        shadowRadius: 2,
                        elevation: active ? 1 : 0,
                      },
                    ]}
                  >
                    <Text style={[styles.assistantTabText, { color: active ? currentAssistant.accent : colors.textSecondary }]}>{tab}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.suggestIntroRow}>
              <MaterialIcons name="auto-awesome" size={18} color={currentAssistant.accent} />
              <Text style={[styles.suggestIntroText, { color: colors.textSecondary }]}>
                {todayScheduleLabel
                  ? `基于您的历史记录与今日（${todayScheduleLabel}）活动：`
                  : '基于您的历史记录和今日活动：'}
              </Text>
            </View>
            {dailyAiLoading ? (
              <Text style={[styles.suggestAiHint, { color: colors.textSecondary }]}>正在生成今日 AI 摄入建议…</Text>
            ) : null}
            {!dailyAiLoading && dailyAiTargets?.rationale_zh ? (
              <Text style={[styles.suggestAiRationale, { color: colors.text }]}>{dailyAiTargets.rationale_zh}</Text>
            ) : null}
            {!dailyAiLoading && !dailyAiTargets && isActiveAiLlmConfigured() === false ? (
              <Text style={[styles.suggestAiHint, { color: colors.textSecondary }]}>
                未配置 AI 密钥时「今日最佳」使用本地公式；可在「我的」中配置智谱或豆包后获得每日 AI 目标。
              </Text>
            ) : null}

            <View style={styles.suggestList}>
              {assistantSuggestRows.map((row) => {
                const value = suggestNumeric[row.kind];
                const selected = assistantSuggestSelection === row.kind;
                const itemSurface = selected
                  ? {
                      backgroundColor: isDark ? `${currentAssistant.accent}1F` : colors.capsule,
                      borderColor: isDark ? `${currentAssistant.accent}40` : `${currentAssistant.accent}33`,
                    }
                  : {
                      backgroundColor: isDark ? colors.surfaceMuted : colors.background,
                      borderColor: colors.outline,
                    };
                const tagColor = selected ? currentAssistant.accent : colors.textSecondary;
                const valueStyle = selected ? styles.suggestValue : styles.suggestValueAlt;
                const valueColor = selected ? currentAssistant.accent : colors.text;
                return (
                  <TouchableOpacity
                    key={row.kind}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setAssistantSuggestSelection(row.kind);
                      setManualGoal(sanitizeAssistantManualGoalInput(String(value)));
                    }}
                    style={[styles.suggestItem, itemSurface]}
                  >
                    <View>
                      <Text style={[styles.suggestTag, { color: tagColor }]}>{row.tag}</Text>
                      <Text style={[valueStyle, { color: valueColor }]}>
                        {value.toLocaleString()} <Text style={styles.suggestValueUnit}>{currentAssistant.unit}</Text>
                      </Text>
                    </View>
                    {selected ? (
                      <View style={[styles.suggestDone, { backgroundColor: currentAssistant.accent }]}>
                        <MaterialIcons name="check" size={14} color={colors.onPrimary} />
                      </View>
                    ) : (
                      <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.manualWrap, { borderTopColor: colors.outline }]}> 
              <Text style={[styles.manualLabel, { color: colors.textSecondary }]}>手动调整精确值</Text>
              <View style={styles.manualRow}>
                <View style={[styles.manualInputWrap, { backgroundColor: colors.input }]}> 
                  <TextInput
                    value={manualGoal}
                    onChangeText={(text) => setManualGoal(sanitizeAssistantManualGoalInput(text))}
                    keyboardType="default"
                    autoCorrect={false}
                    autoCapitalize="none"
                    placeholder={currentAssistant.placeholder}
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.manualInput, { color: colors.text }]}
                  />
                  <Text style={[styles.manualUnit, { color: colors.textSecondary }]}>{currentAssistant.unit.toUpperCase()}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.sendBtn, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    const n = Number(String(manualGoal).replace(/,/g, '').trim());
                    if (!Number.isFinite(n) || n < 0) return;
                    const rounded = Math.round(n);
                    if (assistantTab === '水分') setGlobalHydrationTargetMl(rounded);
                    if (assistantTab === '蛋白质') setGlobalProteinTargetG(rounded);
                    if (assistantTab === '碳水') setGlobalCarbohydrateTargetG(rounded);
                    if (assistantTab === '钠') setGlobalSodiumTargetMg(rounded);
                    setIntakeTargetTick((t) => t + 1);
                    setAssistantOpen(false);
                  }}
                >
                  <MaterialIcons name="send" size={18} color={colors.onPrimary} />
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <RecordIntakeSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onConfirm={handleRecordIntakeConfirm}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: Spacing['5xl'],
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  headerTopRow: {
    height: Layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  headerSideSpacer: {
    width: Layout.iconButtonSize,
    height: Layout.iconButtonSize,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  weekPage: {
    paddingRight: 0,
    overflow: 'visible',
  },
  weekStripContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    gap: 6,
  },
  weekDayItem: {
    minWidth: 42,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 7,
    alignItems: 'center',
    borderWidth: 1,
    zIndex: 3,
  },
  weekDayContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 26,
  },
  weekDayDate: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
    textAlign: 'center',
  },
  weekDayLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    lineHeight: 12,
    textAlign: 'center',
    marginTop: 1,
  },
  scroll: { flex: 1 },
  scrollContent: {
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: Spacing['5xl'],
    paddingTop: 0,
    paddingBottom: Spacing['6xl'],
  },
  bgOrb: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 999,
    zIndex: 0,
  },
  bgOrbTop: {
    top: 18,
    right: -72,
  },
  bgOrbMiddle: {
    top: 280,
    left: -88,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 24,
  },
  metricCard: {
    borderRadius: Radius['2xl'],
    paddingVertical: Spacing['3xl'],
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  metricCardGlow: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 43,
    top: -24,
    right: -18,
  },
  progressContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  iconContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  metricSubValue: {
    fontSize: 10,
    marginTop: 4,
  },
  statusCard: {
    borderRadius: Radius['2xl'],
    padding: Spacing['4xl'],
    marginBottom: Spacing['4xl'],
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  statusItem: {
    flexDirection: 'row',
    gap: 12,
  },
  statusItemSpacing: {
    marginTop: 14,
  },
  statusItemAccent: {
    width: 4,
    borderRadius: 999,
  },
  statusItemBody: {
    flex: 1,
  },
  statusLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statusItemTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  statusDesc: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  statusValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  statusValueMain: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginRight: 8,
  },
  statusValueSub: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusTrack: {
    height: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    marginTop: Spacing.lg,
  },
  statusTrackFill: {
    height: '100%',
    borderRadius: 999,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  editBtn: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  quickAddScroll: {
    marginBottom: 20,
    marginHorizontal: -Spacing['5xl'],
  },
  quickAddScrollContent: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing['5xl'],
  },
  quickAddCard: {
    borderRadius: Radius['2xl'],
    paddingVertical: Spacing['2xl'],
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  quickAddIcon: {
    marginBottom: 8,
  },
  quickAddLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  quickAddValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  floatingCtaWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 60,
  },
  floatingCtaBtn: {
    width: FLOATING_CTA_SIZE,
    height: FLOATING_CTA_SIZE,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
  },
  intakeEmptyBox: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 4,
  },
  intakeEmptyText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
  },
  intakeList: {
    gap: 12,
    marginBottom: 4,
  },
  intakeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderRadius: Radius.lg,
    paddingVertical: Spacing['2xl'],
    paddingHorizontal: Spacing['3xl'],
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  intakeRowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  intakeRowTop: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'flex-start',
  },
  intakeRowLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  intakeIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intakeRowText: {
    flex: 1,
    minWidth: 0,
  },
  intakeRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  intakeRowTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  intakeRowTime: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 0,
  },
  intakeRowMeta: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 4,
    lineHeight: 16,
  },
  intakeRowAmount: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
    flexShrink: 0,
    alignSelf: 'flex-start',
    maxWidth: '34%',
    textAlign: 'right',
  },
  intakeRowAmountStacked: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    paddingLeft: 52,
  },
  intakeMoreHint: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 4,
  },
  swipeDeleteAction: {
    width: 86,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    marginLeft: Spacing.xl,
    marginVertical: 2,
    gap: 4,
  },
  swipeDeleteText: {
    fontSize: 12,
    fontWeight: '800',
  },
  trendCard: {
    borderRadius: Radius['2xl'],
    padding: Spacing['5xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  trendTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  trendSub: {
    fontSize: 14,
    fontWeight: '600',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  legendText: {
    fontSize: 12,
    fontWeight: '500',
  },
  legendValue: {
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 2,
  },
  chartContainer: {
    height: 196,
  },
  chartInner: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  yAxis: {
    width: 24,
    height: 152,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 22,
  },
  yTickText: {
    fontSize: 10,
    fontWeight: '600',
  },
  plotArea: {
    flex: 1,
    height: 152,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
  barsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  barGroup: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    zIndex: 1,
  },
  barsInner: {
    width: '100%',
    height: 130,
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  miniBar: {
    width: 4,
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
  barLabel: {
    fontSize: 11,
  },
  assistantOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['4xl'],
  },
  assistantCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['5xl'],
    overflow: 'hidden',
  },
  assistantGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 110,
  },
  assistantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  assistantTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  assistantSubTitle: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  assistantCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantTabs: {
    borderRadius: 16,
    padding: 6,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 18,
  },
  assistantTabBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  suggestIntroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  suggestIntroText: {
    fontSize: 13,
    fontWeight: '500',
  },
  suggestAiHint: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: -4,
    marginBottom: 10,
  },
  suggestAiRationale: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: -6,
    marginBottom: 12,
  },
  suggestList: {
    gap: 10,
    marginBottom: 16,
  },
  suggestItem: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestTag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  suggestValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  suggestValueAlt: {
    fontSize: 22,
    fontWeight: '700',
  },
  suggestValueUnit: {
    fontSize: 12,
    fontWeight: '500',
  },
  suggestDone: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualWrap: {
    borderTopWidth: 1,
    paddingTop: 14,
  },
  manualLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  manualInputWrap: {
    flex: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing['2xl'],
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
  },
  manualInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
  },
  manualUnit: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 8,
  },
  sendBtn: {
    width: 54,
    height: 54,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
