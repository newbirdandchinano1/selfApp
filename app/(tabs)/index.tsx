import { RecordIntakeSheet, type RecordIntakeConfirmPayload } from '@/components/record-intake-sheet';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
import {
  analyzeFoodNutritionFromImage,
  getActiveAiLlmApiKey,
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
import { SafeAreaView } from 'react-native-safe-area-context';
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
        iconColor: '#10b981',
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
        iconColor: '#10b981',
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
        iconColor: '#f59e0b',
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
        iconColor: '#a855f7',
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
        iconColor: '#eab308',
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

type NutritionV2ActivityLevel = 'Sedentary' | 'Fitness' | 'High-Intensity';
type NutritionV2Goal = 'None' | 'Fat Loss' | 'Muscle Gain';
type NutritionV2Gender = 'Male' | 'Female';

function mapLifestyleToActivityLevel(lifestyle?: string | null): NutritionV2ActivityLevel {
  if (lifestyle === '健身') return 'Fitness';
  if (lifestyle === '高强度锻炼') return 'High-Intensity';
  return 'Sedentary';
}

function mapGoalToNutritionGoal(goal?: string | null): NutritionV2Goal {
  if (goal === '减脂') return 'Fat Loss';
  if (goal === '增肌') return 'Muscle Gain';
  return 'None';
}

function mapGenderToNutritionGender(gender?: string | null): NutritionV2Gender {
  return gender === '男' ? 'Male' : 'Female';
}

function calculateNutritionV2(
  weight: number,
  height: number,
  age: number,
  gender: NutritionV2Gender,
  activityLevel: NutritionV2ActivityLevel,
  goal: NutritionV2Goal,
  actualSodium: number
) {
  void height;
  const PROTEIN_MULTIPLIER_CAP = 1.8;
  const PROTEIN_GRAMS_CAP = 130;
  const WATER_ML_CAP = 4000;
  const SODIUM_MG_CAP = 2500;
  const CARBOHYDRATE_G_CAP = 420;

  let proteinMultiplier = 1.0;
  if (activityLevel === 'Fitness') proteinMultiplier = 1.5;
  if (activityLevel === 'High-Intensity') proteinMultiplier = 2.0;

  if (age >= 65) proteinMultiplier += 0.2;
  if (goal === 'Fat Loss') proteinMultiplier += 0.2;
  if (goal === 'Muscle Gain') proteinMultiplier += 0.3;
  proteinMultiplier = Math.min(proteinMultiplier, PROTEIN_MULTIPLIER_CAP);

  const totalProteinG = Math.min(weight * proteinMultiplier, PROTEIN_GRAMS_CAP);
  let carbohydrateMultiplier = 3.2;
  if (activityLevel === 'Fitness') carbohydrateMultiplier = 4.0;
  if (activityLevel === 'High-Intensity') carbohydrateMultiplier = 4.8;
  if (goal === 'Fat Loss') carbohydrateMultiplier -= 0.35;
  if (goal === 'Muscle Gain') carbohydrateMultiplier += 0.4;
  carbohydrateMultiplier = Math.max(2.2, carbohydrateMultiplier);
  const totalCarbohydrateG = Math.min(weight * carbohydrateMultiplier, CARBOHYDRATE_G_CAP);

  const baseSodium = 1500;
  let sodiumActivityBonus = activityLevel === 'Sedentary' ? 0 : activityLevel === 'Fitness' ? 500 : 1000;
  if (activityLevel === 'High-Intensity' && gender === 'Male') {
    sodiumActivityBonus += 200;
  }
  const sodiumGoalBonus = goal === 'Muscle Gain' ? 200 : 0;
  const totalSodiumMg = Math.min(baseSodium + sodiumActivityBonus + sodiumGoalBonus, SODIUM_MG_CAP);

  const waterMultiplier = age < 30 ? 35 : age <= 55 ? 30 : 25;
  let totalWaterMl = weight * waterMultiplier;
  if (activityLevel === 'Fitness') totalWaterMl += 300;
  if (activityLevel === 'High-Intensity') totalWaterMl += 600;
  if (goal === 'Fat Loss') totalWaterMl += 300;
  if (goal === 'Muscle Gain') totalWaterMl += 200;
  if (actualSodium > totalSodiumMg) {
    const excessSodium = actualSodium - totalSodiumMg;
    totalWaterMl += excessSodium * 0.282;
  }
  totalWaterMl = Math.min(totalWaterMl, WATER_ML_CAP);

  return {
    Water_ml: Math.round(totalWaterMl),
    Protein_g: Math.round(totalProteinG),
    Carbohydrate_g: Math.round(totalCarbohydrateG),
    Sodium_mg: Math.round(totalSodiumMg),
  };
}

const CircularProgress = ({
  percentage,
  icon,
  color,
  size = 64,
  strokeWidth = 6,
  opacity = 1,
}: {
  percentage: number;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
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
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(148, 163, 184, 0.26)" strokeWidth={strokeWidth} fill="none" />
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
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
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
  const today = React.useMemo(() => normalizeDate(new Date()), []);
  const [selectedDate, setSelectedDate] = React.useState(() => normalizeDate(new Date()));
  const [weekAnchorDate, setWeekAnchorDate] = React.useState(() => normalizeDate(new Date()));
  const [quickAddItems, setQuickAddItems] = React.useState<QuickAddCardItem[]>(() => getDefaultQuickAddItems().slice(0, 4));
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
  const quickAddCardAnims = React.useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
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
        try {
          const [selectedItems, catalog] = await Promise.all([loadSelectedQuickAddItems(), loadAllQuickAddItems()]);
          if (!cancelled) {
            setQuickAddItems(selectedItems.slice(0, 4));
            setQuickAddCatalog(catalog);
          }
        } catch {
          if (!cancelled) {
            setQuickAddItems(getDefaultQuickAddItems().slice(0, 4));
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

  const metricPercentAnims = React.useRef({
    hydration: new Animated.Value(0),
    protein: new Animated.Value(0),
    carbohydrate: new Animated.Value(0),
    sodium: new Animated.Value(0),
  }).current;
  const [animatedMetricPercents, setAnimatedMetricPercents] = React.useState({
    hydration: 0,
    protein: 0,
    carbohydrate: 0,
    sodium: 0,
  });

  React.useEffect(() => {
    const hydrationId = metricPercentAnims.hydration.addListener(({ value }) =>
      setAnimatedMetricPercents((prev) => ({ ...prev, hydration: value }))
    );
    const proteinId = metricPercentAnims.protein.addListener(({ value }) =>
      setAnimatedMetricPercents((prev) => ({ ...prev, protein: value }))
    );
    const carbohydrateId = metricPercentAnims.carbohydrate.addListener(({ value }) =>
      setAnimatedMetricPercents((prev) => ({ ...prev, carbohydrate: value }))
    );
    const sodiumId = metricPercentAnims.sodium.addListener(({ value }) =>
      setAnimatedMetricPercents((prev) => ({ ...prev, sodium: value }))
    );
    return () => {
      metricPercentAnims.hydration.removeListener(hydrationId);
      metricPercentAnims.protein.removeListener(proteinId);
      metricPercentAnims.carbohydrate.removeListener(carbohydrateId);
      metricPercentAnims.sodium.removeListener(sodiumId);
    };
  }, [metricPercentAnims]);

  React.useEffect(() => {
    const nextHydration = dayIntakeDisplay.hydration.percent;
    const nextProtein = dayIntakeDisplay.protein.percent;
    const nextCarbohydrate = dayIntakeDisplay.carbohydrate.percent;
    const nextSodium = dayIntakeDisplay.sodium.percent;
    Animated.parallel([
      Animated.timing(metricPercentAnims.hydration, {
        toValue: nextHydration,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(metricPercentAnims.protein, {
        toValue: nextProtein,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(metricPercentAnims.carbohydrate, {
        toValue: nextCarbohydrate,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(metricPercentAnims.sodium, {
        toValue: nextSodium,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [dayIntakeDisplay, metricPercentAnims]);

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
        setPendingIntake({ id: pendingId, kind: 'photo', label: '拍照记录' });
        void (async () => {
          try {
            const r = await analyzeFoodNutritionFromImage({
              apiKey: getActiveAiLlmApiKey(),
              imageBase64: payload.imageBase64,
              imageMimeType: payload.imageMimeType,
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
            const ok = await persistFoodPhotoIntake(d.protein_g, d.carbohydrate_g, d.sodium_mg, payload.sourceImageUri, {
              displayTitle: d.food_name?.trim() || undefined,
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
            pendingIntake.kind === 'ai'
              ? pendingIntake.label.length > 40
                ? `${pendingIntake.label.slice(0, 40)}…`
                : pendingIntake.label
              : '拍照记录',
          timeLine: '解析中',
          amountRight: '—',
          note: pendingIntake.kind === 'ai' ? '正在解析饮食描述…' : '正在识别食物照片…',
          aiComment: '完成后将自动加入列表',
          icon: 'hourglass-empty',
          iconBgLight: 'rgba(59,130,246,0.14)',
          iconBgDark: 'rgba(30,58,138,0.35)',
          iconColor: '#3b82f6',
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
  }, [selectedDayRecords, quickAddCatalog, pendingIntake]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [weekPagerWidth]);

  React.useEffect(() => {
    metricCardAnims.forEach((anim) => anim.setValue(0));
    quickAddCardAnims.forEach((anim) => anim.setValue(0));
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
      quickAddCardAnims.map((anim) =>
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
  }, [fadeAnim, translateYAnim, metricCardAnims, quickAddCardAnims, sectionEntranceAnims]);

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

  const weekPagerWidth = width - 48;
  const cardWidth = (width - 48 - 24) / 4;

  const assistantTheme = {
    水分: {
      accent: '#10b981',
      unit: 'ml',
      placeholder: '2500',
      best: '2,850',
      avg: '2,400',
      community: '2,200',
    },
    蛋白质: {
      accent: '#f59e0b',
      unit: 'g',
      placeholder: '80',
      best: '75',
      avg: '68',
      community: '70',
    },
    碳水: {
      accent: '#eab308',
      unit: 'g',
      placeholder: '260',
      best: '280',
      avg: '250',
      community: '260',
    },
    钠: {
      accent: '#a855f7',
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
    const metrics = calculateNutritionV2(
      user.weight ?? 0,
      user.height ?? 0,
      user.age ?? 0,
      nutritionGender,
      activityLevel,
      nutritionGoal,
      selectedDayIntakeTotals?.sodium ?? 0
    );

    if (assistantTab === '水分') return metrics.Water_ml;
    if (assistantTab === '蛋白质') return metrics.Protein_g;
    if (assistantTab === '碳水') return metrics.Carbohydrate_g;
    return metrics.Sodium_mg;
  }, [assistantTab, user, selectedDayIntakeTotals?.sodium]);


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

  const suggestNumeric = React.useMemo(
    () => ({
      best: Math.round(Number(bestValue) || 0),
      avg: Math.round(Number(avgValue) || 0),
      community: Math.round(Number(communityValue) || 0),
    }),
    [bestValue, avgValue, communityValue]
  );

  const assistantSuggestRows = React.useMemo(
    () =>
      [
        { kind: 'best' as const, tag: '今日最佳(基于你的活动和身体指标计算)' },
        { kind: 'avg' as const, tag: '上周平均(基于您的日常活动指标计算)' },
        { kind: 'community' as const, tag: '社群达标(基于您的身体指标计算)' },
      ] as const,
    []
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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(248, 250, 252, 0.92)' }]}>
        <View style={styles.headerTopRow}>
          <View style={{ width: 32 }} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>{formatHeaderDate(selectedDate)}</Text>
          <TouchableOpacity
            style={styles.calendarBtn}
            activeOpacity={0.75}
            onPress={() => router.push('/health-calendar')}
          >
            <MaterialIcons name="calendar-today" size={22} color={theme.text} />
          </TouchableOpacity>
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
                          backgroundColor: isActive ? theme.primary : 'transparent',
                          borderColor: isActive ? `${theme.primary}00` : isDark ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.18)',
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
                        <Text style={[styles.weekDayDate, { color: isActive ? '#fff' : theme.textSecondary }]}>{item.day}</Text>
                        <Text style={[styles.weekDayLabel, { color: isActive ? '#fff' : `${theme.textSecondary}CC` }]}>{item.label}</Text>
                      </Animated.View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bgOrb,
            styles.bgOrbTop,
            {
              backgroundColor: `${theme.primary}18`,
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
              backgroundColor: `${theme.primary}10`,
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
            const animatedPercent = Math.round(animatedMetricPercents[item.key]);

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
                <View style={[styles.metricCard, { backgroundColor: theme.surface, width: cardWidth }]}>
                  <View style={[styles.metricCardGlow, { backgroundColor: `${theme.primary}14` }]} />
                  <Animated.View style={{ transform: [{ rotate: wheelRotate }, { scale: wheelScale }] }}>
                    <CircularProgress
                      percentage={animatedPercent}
                      icon={item.icon}
                      color={theme.primary}
                      opacity={item.opacity}
                    />
                  </Animated.View>
                  <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                  <Text style={[styles.metricValue, { color: theme.text }]}>{animatedPercent}%</Text>
                  <Text style={[styles.metricSubValue, { color: theme.textSecondary }]}> 
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
          <View style={[styles.statusCard, { backgroundColor: theme.surface }]}> 
            <View style={styles.statusItem}>
              <View style={[styles.statusItemAccent, { backgroundColor: '#10b981' }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: theme.text }]}>水分摄入</Text>
                  <Text style={[styles.statusBadge, { color: '#10b981', backgroundColor: '#10b9811A' }]}>
                    {Math.round(animatedMetricPercents.hydration)}%
                  </Text>
                </View>
                <Text style={[styles.statusDesc, { color: theme.textSecondary }]}>
                  {hydrationStatusDesc(dayIntakeDisplay.hydration.percent)}
                </Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: '#10b981' }]}>
                    {dayIntakeDisplay.hydration.current.toLocaleString()}
                  </Text>
                  <Text style={[styles.statusValueSub, { color: theme.textSecondary }]}>
                    ML / {intakeTargetsSnapshot.hydrationMl.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.statusTrack}>
                  <View
                    style={[
                      styles.statusTrackFill,
                      { width: `${Math.round(animatedMetricPercents.hydration)}%`, backgroundColor: '#10b981' },
                    ]}
                  />
                </View>
              </View>
            </View>

            <View style={[styles.statusItem, styles.statusItemSpacing]}>
              <View style={[styles.statusItemAccent, { backgroundColor: '#f59e0b' }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: theme.text }]}>蛋白质摄入</Text>
                  <Text style={[styles.statusBadge, { color: '#f59e0b', backgroundColor: '#f59e0b1A' }]}>
                    {Math.round(animatedMetricPercents.protein)}%
                  </Text>
                </View>
                <Text style={[styles.statusDesc, { color: theme.textSecondary }]}>
                  {proteinStatusDesc(dayIntakeDisplay.protein.percent)}
                </Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: '#f59e0b' }]}>
                    {dayIntakeDisplay.protein.current.toLocaleString()}
                  </Text>
                  <Text style={[styles.statusValueSub, { color: theme.textSecondary }]}>
                    G / {intakeTargetsSnapshot.proteinG.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.statusTrack}>
                  <View
                    style={[
                      styles.statusTrackFill,
                      { width: `${Math.round(animatedMetricPercents.protein)}%`, backgroundColor: '#f59e0b' },
                    ]}
                  />
                </View>
              </View>
            </View>

            <View style={[styles.statusItem, styles.statusItemSpacing]}>
              <View style={[styles.statusItemAccent, { backgroundColor: '#eab308' }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: theme.text }]}>碳水摄入</Text>
                  <Text style={[styles.statusBadge, { color: '#eab308', backgroundColor: '#eab3081A' }]}>
                    {Math.round(animatedMetricPercents.carbohydrate)}%
                  </Text>
                </View>
                <Text style={[styles.statusDesc, { color: theme.textSecondary }]}>
                  {carbohydrateStatusDesc(dayIntakeDisplay.carbohydrate.percent)}
                </Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: '#eab308' }]}>
                    {dayIntakeDisplay.carbohydrate.current.toLocaleString()}
                  </Text>
                  <Text style={[styles.statusValueSub, { color: theme.textSecondary }]}>
                    G / {intakeTargetsSnapshot.carbohydrateG.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.statusTrack}>
                  <View
                    style={[
                      styles.statusTrackFill,
                      { width: `${Math.round(animatedMetricPercents.carbohydrate)}%`, backgroundColor: '#eab308' },
                    ]}
                  />
                </View>
              </View>
            </View>

            <View style={[styles.statusItem, styles.statusItemSpacing]}>
              <View style={[styles.statusItemAccent, { backgroundColor: '#a855f7' }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: theme.text }]}>钠含量监控</Text>
                  <Text style={[styles.statusBadge, { color: '#a855f7', backgroundColor: '#a855f71A' }]}>
                    {Math.round(animatedMetricPercents.sodium)}%
                  </Text>
                </View>
                <Text style={[styles.statusDesc, { color: theme.textSecondary }]}>
                  {sodiumStatusDesc(dayIntakeDisplay.sodium.percent)}
                </Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: '#a855f7' }]}>
                    {dayIntakeDisplay.sodium.current.toLocaleString()}
                  </Text>
                  <Text style={[styles.statusValueSub, { color: theme.textSecondary }]}>
                    MG / {intakeTargetsSnapshot.sodiumMg.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.statusTrack}>
                  <View
                    style={[
                      styles.statusTrackFill,
                      { width: `${Math.round(animatedMetricPercents.sodium)}%`, backgroundColor: '#a855f7' },
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
            <Text style={[styles.sectionTitle, { color: theme.text }]}>快速添加</Text>
            <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/quick-add-edit')}>
              <Text style={[styles.editBtn, { color: theme.primary }]}>编辑</Text>
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.quickAddRow,
              quickAddItems.length < 4 ? styles.quickAddRowCentered : null,
            ]}
          >
            {quickAddItems.map((item, index) => {
              const cardAnim = quickAddCardAnims[index] ?? quickAddCardAnims[quickAddCardAnims.length - 1];
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
                    style={[styles.quickAddCard, { backgroundColor: theme.surface, width: cardWidth, opacity: intakeParseLocked ? 0.45 : 1 }]}
                    activeOpacity={0.82}
                    onPress={() => {
                      if (intakeParseLocked) {
                        Alert.alert('请稍候', '当前有一条摄入正在解析，解析完成后再添加。');
                        return;
                      }
                      void persistQuickAddIntake(item);
                    }}
                  >
                    <MaterialIcons name={item.icon as keyof typeof MaterialIcons.glyphMap} size={30} color={theme.textSecondary} style={styles.quickAddIcon} />
                    <Text style={[styles.quickAddLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                    <Text style={[styles.quickAddValue, { color: theme.text }]}>{formatQuickAddAmount(item)}</Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>

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
            <Text style={[styles.sectionTitle, { color: theme.text }]}>摄入记录</Text>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() =>
                router.push({
                  pathname: '/intake-history',
                  params: { date: formatLocalYmd(selectedDate) },
                })
              }
            >
              <Text style={[styles.editBtn, { color: theme.primary }]}>查看全部</Text>
            </TouchableOpacity>
          </View>

          {intakeListPreview.showEmpty ? (
            <View
              style={[
                styles.intakeEmptyBox,
                { backgroundColor: theme.surface, borderColor: isDark ? 'rgba(148,163,184,0.14)' : '#e2e8f0' },
              ]}
            >
              <Text style={[styles.intakeEmptyText, { color: theme.textSecondary }]}>暂无摄入记录，点击上方添加或记录新摄入</Text>
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
                          backgroundColor: theme.surface,
                          borderColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(226,232,240,0.9)',
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
                            <Text style={[styles.intakeRowTitle, { color: theme.text }]} numberOfLines={2}>
                              {line.title}
                            </Text>
                            <Text style={[styles.intakeRowTime, { color: theme.textSecondary }]}>{line.timeLine}</Text>
                          </View>
                          <Text style={[styles.intakeRowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                            {line.note}
                          </Text>
                          <Text style={[styles.intakeRowMeta, { color: theme.textSecondary }]} numberOfLines={2}>
                            {line.aiComment}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.intakeRowAmountStacked, { color: theme.textSecondary }]}>{line.amountRight}</Text>
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
                      style={styles.swipeDeleteAction}
                    >
                      <MaterialIcons name="delete" size={22} color="#fff" />
                      <Text style={styles.swipeDeleteText}>删除</Text>
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
                        backgroundColor: theme.surface,
                        borderColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(226,232,240,0.9)',
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
                                <Text style={[styles.intakeRowTitle, { color: theme.text }]} numberOfLines={1}>
                                  {line.title}
                                </Text>
                                <Text style={[styles.intakeRowTime, { color: theme.textSecondary }]}>{line.timeLine}</Text>
                              </View>
                              <Text style={[styles.intakeRowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                                {line.note}
                              </Text>
                              <Text style={[styles.intakeRowMeta, { color: theme.textSecondary }]} numberOfLines={2}>
                                {line.aiComment}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <Text style={[styles.intakeRowAmountStacked, { color: theme.text }]}>{line.amountRight}</Text>
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
                              <Text style={[styles.intakeRowTitle, { color: theme.text }]}>{line.title}</Text>
                              <Text style={[styles.intakeRowTime, { color: theme.textSecondary }]}>{line.timeLine}</Text>
                            </View>
                            <Text style={[styles.intakeRowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                              {line.note}
                            </Text>
                            <Text style={[styles.intakeRowMeta, { color: theme.textSecondary }]} numberOfLines={2}>
                              {line.aiComment}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.intakeRowAmount, { color: theme.text }]}>{line.amountRight}</Text>
                      </>
                    )}
                  </Pressable>
                </Swipeable>
              );
              })}
              {intakeListPreview.hasMore ? (
                <Text style={[styles.intakeMoreHint, { color: theme.textSecondary }]}>
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
        <View style={[styles.trendCard, { backgroundColor: isDark ? 'rgba(30, 41, 59, 0.54)' : '#f1f5f9' }]}>
          <View style={styles.trendHeader}>
            <Text style={[styles.trendTitle, { color: theme.text }]}>每周趋势</Text>
            <Text style={[styles.trendSub, { color: theme.primary }]}>{weeklyTrendDeltaText}</Text>
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>水分</Text>
              <Text style={[styles.legendValue, { color: theme.text }]}>{activeTrend.hydration}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>蛋白质</Text>
              <Text style={[styles.legendValue, { color: theme.text }]}>{activeTrend.protein}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#a855f7' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>钠</Text>
              <Text style={[styles.legendValue, { color: theme.text }]}>{activeTrend.sodium}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#eab308' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>碳水</Text>
              <Text style={[styles.legendValue, { color: theme.text }]}>{activeTrend.carbohydrate}</Text>
            </View>
          </View>

          <View style={styles.chartContainer}>
            <View style={styles.chartInner}>
              <View style={styles.yAxis}>
                {[100, 75, 50, 25, 0].map((tick) => (
                  <Text key={tick} style={[styles.yTickText, { color: theme.textSecondary }]}>{tick}</Text>
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
                        borderColor: isDark ? 'rgba(148,163,184,0.24)' : 'rgba(148,163,184,0.32)',
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
                        <Text style={[styles.barLabel, { color: item.active ? theme.text : theme.textSecondary, fontWeight: item.active ? '700' : '500' }]}>
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
          style={[styles.floatingCtaBtn, { backgroundColor: theme.primary, opacity: intakeParseLocked ? 0.42 : 1 }]}
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
          <MaterialIcons name="add" size={30} color="#fff" />
        </TouchableOpacity>
      </Animated.View>

      <Modal
        visible={assistantOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAssistantOpen(false)}
      >
        <Pressable style={styles.assistantOverlay} onPress={() => setAssistantOpen(false)}>
          <Pressable
            style={[styles.assistantCard, { backgroundColor: theme.surface, borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.85)' }]}
            onPress={() => {}}
          >
            <View style={[styles.assistantGlow, { backgroundColor: `${currentAssistant.accent}1A` }]} />
            <View style={styles.assistantHeader}>
              <View>
                <Text style={[styles.assistantTitle, { color: theme.text }]}>智能建议</Text>
                <Text style={[styles.assistantSubTitle, { color: theme.textSecondary }]}>SMART GOAL SETTING</Text>
              </View>
              <TouchableOpacity
                style={[styles.assistantCloseBtn, { backgroundColor: isDark ? 'rgba(51,65,85,0.8)' : '#f1f5f9' }]}
                onPress={() => setAssistantOpen(false)}
              >
                <MaterialIcons name="close" size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.assistantTabs, { backgroundColor: isDark ? 'rgba(51,65,85,0.48)' : '#f8fafc' }]}>
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
                        backgroundColor: isDark ? 'rgba(51,65,85,0.9)' : '#fff',
                        shadowColor: '#000',
                        shadowOpacity: isDark ? 0 : 0.05,
                        shadowOffset: { width: 0, height: 1 },
                        shadowRadius: 2,
                        elevation: active ? 1 : 0,
                      },
                    ]}
                  >
                    <Text style={[styles.assistantTabText, { color: active ? currentAssistant.accent : theme.textSecondary }]}>{tab}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.suggestIntroRow}>
              <MaterialIcons name="auto-awesome" size={18} color={currentAssistant.accent} />
              <Text style={[styles.suggestIntroText, { color: theme.textSecondary }]}>基于您的历史记录和今日活动：</Text>
            </View>

            <View style={styles.suggestList}>
              {assistantSuggestRows.map((row) => {
                const value = suggestNumeric[row.kind];
                const selected = assistantSuggestSelection === row.kind;
                const itemSurface = selected
                  ? {
                      backgroundColor: isDark ? `${currentAssistant.accent}1F` : '#f8fafc',
                      borderColor: isDark ? `${currentAssistant.accent}40` : `${currentAssistant.accent}33`,
                    }
                  : {
                      backgroundColor: isDark ? 'rgba(51,65,85,0.45)' : '#f8fafc',
                      borderColor: isDark ? 'rgba(148,163,184,0.18)' : '#e2e8f0',
                    };
                const tagColor = selected ? currentAssistant.accent : theme.textSecondary;
                const valueStyle = selected ? styles.suggestValue : styles.suggestValueAlt;
                const valueColor = selected ? currentAssistant.accent : theme.text;
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
                        <MaterialIcons name="check" size={14} color="#fff" />
                      </View>
                    ) : (
                      <MaterialIcons name="chevron-right" size={18} color={theme.textSecondary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.manualWrap, { borderTopColor: isDark ? 'rgba(148,163,184,0.18)' : '#e2e8f0' }]}> 
              <Text style={[styles.manualLabel, { color: theme.textSecondary }]}>手动调整精确值</Text>
              <View style={styles.manualRow}>
                <View style={[styles.manualInputWrap, { backgroundColor: isDark ? 'rgba(51,65,85,0.7)' : '#f1f5f9' }]}> 
                  <TextInput
                    value={manualGoal}
                    onChangeText={(text) => setManualGoal(sanitizeAssistantManualGoalInput(text))}
                    keyboardType="default"
                    autoCorrect={false}
                    autoCapitalize="none"
                    placeholder={currentAssistant.placeholder}
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.manualInput, { color: theme.text }]}
                  />
                  <Text style={[styles.manualUnit, { color: theme.textSecondary }]}>{currentAssistant.unit.toUpperCase()}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.sendBtn, { backgroundColor: isDark ? '#fff' : '#0f172a' }]}
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
                  <MaterialIcons name="send" size={18} color={isDark ? '#0f172a' : '#fff'} />
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
  header: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 12, zIndex: 10 },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  calendarBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
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
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
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
    fontWeight: '700',
  },
  metricSubValue: {
    fontSize: 10,
    marginTop: 4,
  },
  statusCard: {
    borderRadius: 24,
    padding: 18,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.10)',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
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
    fontWeight: '700',
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
    borderRadius: 999,
    backgroundColor: 'rgba(148,163,184,0.16)',
    overflow: 'hidden',
    marginTop: 10,
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
    fontWeight: '700',
  },
  editBtn: {
    fontSize: 14,
    fontWeight: '600',
  },
  quickAddRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 20,
  },
  quickAddRowCentered: {
    justifyContent: 'center',
  },
  quickAddCard: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.10)',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
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
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  intakeEmptyBox: {
    borderRadius: 18,
    borderWidth: 1,
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
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
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
    fontWeight: '700',
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
    backgroundColor: '#ef4444',
    borderRadius: 18,
    marginLeft: 12,
    marginVertical: 2,
    gap: 4,
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  trendCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
  },
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  trendTitle: {
    fontSize: 16,
    fontWeight: '700',
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
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  assistantCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 34,
    borderWidth: 1,
    padding: 20,
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
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
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
    borderRadius: 16,
    paddingHorizontal: 14,
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
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
