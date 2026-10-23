import {
  IntakeAssistantSheet,
  type IntakeAssistantContextRow,
  type IntakeAssistantLocalFormula,
  type IntakeAssistantOtherGoal,
} from '@/components/intake-assistant-sheet';
import {
  RecordIntakeSheet,
  type ManualIntakeType,
  type RecordIntakeConfirmPayload,
  type RecordIntakeRecentManual,
  type RecordIntakeRecentPhoto,
} from '@/components/record-intake-sheet';
import { HealthIntakeDeleteConfirmSheet } from '@/components/health/health-intake-delete-confirm-sheet';
import { HealthMetricPointsSettingsSheet } from '@/components/health/health-metric-points-settings-sheet';
import { HealthPulseDot, HealthShimmerOverlay } from '@/components/health/health-motion';
import {
  HealthIntakeListSkeleton,
  HealthMetricsSkeleton,
  HealthQuickAddSkeleton,
  HealthTrendCardSkeleton,
} from '@/components/skeletons/health';
import { HomeSkeletonShell } from '@/components/home-skeleton-shell';
import { AppIconButton } from '@/components/ui/app-icon-button';
import { HealthNutrientAccents, Layout, Radius, Shadows, Spacing } from '@/constants/design-tokens';
import { useHealthHomeTheme } from '@/constants/health-home-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useHomeSkeletonReveal } from '@/hooks/use-home-skeleton-reveal';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import React from 'react';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { useLocalQuery } from '@/hooks/use-local-query';
import { listUiRefreshTables } from '@/lib/page-api-scope';
import { shouldSkipPageFocusApiRefresh, clearPageLoadedInSession } from '@/lib/page-api-session';

import { toast, toUserMessage } from '@/lib/app-feedback';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { formatStoredDatetimeHm } from '@/lib/api-mysql-datetime';
import { compareDatetimeDesc } from '@/lib/api-read-helpers';
import { addDays, formatYmd } from '@/lib/date';
import { getDefaultUser, subscribeDefaultUserUpdates } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';

import {
  createHealthRecord,
  deleteHealthRecord,
  fetchUserHomeHealthSlice,
} from '@/lib/repositories/health/health';
import type { HealthIntakeDayTotals, HealthRecordRow } from '@/lib/repositories/health/health.types';
import { syncHealthMetricPointsForDay } from '@/lib/repositories/health/health-metric-points-grant';
import {
  getResolvedGlobalIntakeTargets,
  loadPersistedIntakeTargets,
  setGlobalCarbohydrateTargetG,
  setGlobalHydrationTargetMl,
  setGlobalProteinTargetG,
  setGlobalCaloriesTargetKcal,
} from '@/lib/global-intake-targets';
import {
  DEFAULT_HEALTH_METRIC_POINTS_SETTINGS,
  healthMetricThresholdAbsolute,
  loadHealthMetricPointsSettings,
  type HealthMetricPointsSettings,
} from '@/lib/health-metric-points-settings';
import {
  getIntakeAssistantSelection,
  setIntakeAssistantSelection,
  type IntakeAssistantSuggestKind,
  type IntakeAssistantUiTab,
} from '@/lib/intake-assistant-selection';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { refreshAnchorAfterLogicalDayChange } from '@/lib/tasks-logical-day';
import { reportTabBarScroll } from '@/lib/tab-bar-auto-hide';
import { glassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import { ensureDailyAiIntakeTargetsForToday, type DailyAiIntakeTargetsRow } from '@/lib/daily-intake-ai-targets';
import {
  adjustNutritionMetricsForDaySchedule,
  calculateNutritionV2,
  calcCalorieDeficit,
  mapGenderToNutritionGender,
  mapGoalToNutritionGoal,
  mapLifestyleToActivityLevel,
} from '@/lib/nutrition-heuristic';
import { getUserDayScheduleKind, getUserDayScheduleLabelZh } from '@/lib/user-workout-schedule';
import {
  analyzeFoodNutritionFromImage,
  finalizeFoodTextIntakeForRecord,
  getActiveAiLlmApiKey,
  isActiveAiLlmConfigured,
  parseFoodIntakeFromText,
} from '@/lib/zhipu-image-parse';
import {
  createQuickAddItemMap,
  enableQuickAddStarter,
  formatQuickAddAmount,
  getDefaultQuickAddItems,
  getQuickAddMetricAmount,
  getQuickAddMetricTypes,
  loadAllQuickAddItems,
  loadSelectedQuickAddItems,
  QUICK_ADD_STARTER_SUGGESTIONS,
  type QuickAddCardItem,
} from '@/lib/quick-add-cards';

import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Svg, { Circle } from 'react-native-svg';

const { width } = Dimensions.get('window');
const PAGE_API_KEY = 'tabs/index';
const LOCAL_TABLES = listUiRefreshTables(PAGE_API_KEY);

const nutrientMetricMeta = [
  {
    key: 'hydration' as const,
    label: '水分',
    icon: 'water-drop' as keyof typeof MaterialIcons.glyphMap,
    accent: HealthNutrientAccents.hydration,
    unit: 'ml',
  },
  {
    key: 'protein' as const,
    label: '蛋白质',
    icon: 'restaurant' as keyof typeof MaterialIcons.glyphMap,
    accent: HealthNutrientAccents.protein,
    unit: 'g',
  },
  {
    key: 'carbohydrate' as const,
    label: '碳水',
    icon: 'rice-bowl' as keyof typeof MaterialIcons.glyphMap,
    accent: HealthNutrientAccents.carbohydrate,
    unit: 'g',
  },
  {
    key: 'calories' as const,
    label: '热量',
    icon: 'local-fire-department' as keyof typeof MaterialIcons.glyphMap,
    accent: HealthNutrientAccents.calories,
    unit: 'kcal',
  },
];

const weekLabels = ['日', '一', '二', '三', '四', '五', '六'] as const;

function formatIntakeLocale(value: number | null | undefined): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return n.toLocaleString();
}

function intakeAmount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeDate(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatHeaderDate(d: Date) {
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekLabels[d.getDay()]}`;
}

function parseYmdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 最近手动记录时间：今天 / 昨天 / M月D日 + 时分 */
function formatRelativeIntakeTimeLabel(recordDate: string, createdAt: string, todayYmd: string): string {
  const ymd = typeof recordDate === 'string' ? recordDate.slice(0, 10) : '';
  const hm = formatStoredDatetimeHm(createdAt) || formatStoredDatetimeHm(recordDate) || '';
  if (!ymd) return hm || '—';
  if (ymd === todayYmd) return hm ? `今天 ${hm}` : '今天';
  const todayDate = parseYmdToLocalDate(todayYmd);
  if (todayDate) {
    const yesterdayYmd = formatYmd(addDays(todayDate, -1));
    if (ymd === yesterdayYmd) return hm ? `昨天 ${hm}` : '昨天';
  }
  const parts = ymd.split('-').map(Number);
  const datePart = `${parts[1]}月${parts[2]}日`;
  return hm ? `${datePart} ${hm}` : datePart;
}

function manualTypeMetaFromRow(row: HealthRecordRow): {
  type: ManualIntakeType;
  label: string;
  amount: number;
  amountLabel: string;
} | null {
  if (positiveNutrientKindsCount(row) !== 1) return null;
  if (row.hydration > 0) {
    return { type: 'hydration', label: '水分', amount: row.hydration, amountLabel: formatIntakeAmount(row.hydration, 'ml') };
  }
  if (row.protein > 0) {
    return { type: 'protein', label: '蛋白质', amount: row.protein, amountLabel: formatIntakeAmount(row.protein, 'g') };
  }
  if (row.carbohydrate > 0) {
    return {
      type: 'carbohydrate',
      label: '碳水',
      amount: row.carbohydrate,
      amountLabel: formatIntakeAmount(row.carbohydrate, 'g'),
    };
  }
  if (row.calories > 0) {
    return { type: 'calories', label: '热量', amount: row.calories, amountLabel: formatIntakeAmount(row.calories, 'kcal') };
  }
  return null;
}

function nutritionActivityFactor(lifestyle?: string | null): number {
  const level = mapLifestyleToActivityLevel(lifestyle);
  if (level === 'Fitness') return 1.55;
  if (level === 'High-Intensity') return 1.725;
  return 1.2;
}

function estimateBmrKcal(user: UserRow): number {
  const w = Math.max(Number(user.weight) || 0, 40);
  const h = Math.max(Number(user.height) || 0, 140);
  const age = Math.max(Number(user.age) || 0, 18);
  const gender = mapGenderToNutritionGender(user.gender);
  let bmr = 10 * w + 6.25 * h - 5 * age;
  bmr += gender === 'Male' ? 5 : -161;
  return Math.round(bmr);
}

/** 与 health_records.record_date 对齐的本地日历 YYYY-MM-DD */
function formatLocalYmd(d: Date) {
  return formatYmd(d);
}

function sumHealthRecordsDayTotals(rows: HealthRecordRow[]): HealthIntakeDayTotals {
  let hydration = 0;
  let protein = 0;
  let carbohydrate = 0;
  let calories = 0;
  for (const r of rows) {
    hydration += Number(r.hydration ?? 0);
    protein += Number(r.protein ?? 0);
    carbohydrate += Number(r.carbohydrate ?? 0);
    calories += Number(r.calories ?? 0);
  }
  return { hydration, protein, carbohydrate, calories };
}

function pickHealthRecordsForYmd(
  ymd: string,
  week: HealthRecordRow[],
  prevWeek: HealthRecordRow[],
): HealthRecordRow[] {
  return [...week, ...prevWeek]
    .filter((r) => (typeof r.record_date === 'string' ? r.record_date.slice(0, 10) : r.record_date) === ymd)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

type HomeHealthReloadResult = { sliceEmpty: boolean };

function formatIntakeAmount(value: number, unit: 'ml' | 'g' | 'kcal'): string {
  const formatted = Number(value.toFixed(2)).toString();
  return `${formatted} ${unit}`;
}

/** 设计稿 tl-amt：数值与单位分行；合并行则整段作 value */
function splitIntakeAmountRight(amountRight: string): { value: string; unit: string } | null {
  const raw = amountRight.trim();
  if (!raw) return null;
  const m = raw.match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return { value: raw, unit: '' };
  return { value: m[1], unit: (m[2] ?? '').trim() };
}

const HEALTH_MOTION_EASE = Easing.bezier(0.22, 1, 0.36, 1);
const HEALTH_MOTION_SPRING = Easing.bezier(0.34, 1.56, 0.64, 1);

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
  return c ? `AI评价：${c}` : '';
}

function singleIntakeLineTitle(row: HealthRecordRow, fallback: string): string {
  const t = row.intake_display_title?.trim();
  return t || fallback;
}

function positiveNutrientKindsCount(row: HealthRecordRow): number {
  return [row.hydration > 0, row.protein > 0, row.carbohydrate > 0, row.calories > 0].filter(Boolean).length;
}

function firstPositiveIntakeMetric(row: HealthRecordRow): 'hydration' | 'protein' | 'carbohydrate' | 'calories' {
  if (row.hydration > 0) return 'hydration';
  if (row.protein > 0) return 'protein';
  if (row.carbohydrate > 0) return 'carbohydrate';
  return 'calories';
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

/** 设计稿合并行右侧只展示主值（优先热量），单位另起一行，避免挤压中间卡片 */
function formatCombinedListAmountRight(row: HealthRecordRow): string {
  if (row.calories > 0) return formatIntakeAmount(row.calories, 'kcal');
  if (row.hydration > 0) return formatIntakeAmount(row.hydration, 'ml');
  if (row.protein > 0) return `${formatIntakeAmount(row.protein, 'g')} 蛋白`;
  if (row.carbohydrate > 0) return formatIntakeAmount(row.carbohydrate, 'g');
  return '';
}

function formatCombinedListNote(row: HealthRecordRow): string {
  const parts: string[] = [];
  if (row.hydration > 0) parts.push('水');
  if (row.protein > 0) parts.push('蛋白');
  if (row.carbohydrate > 0) parts.push('碳水');
  if (row.calories > 0) parts.push('热量');
  if (parts.length >= 2) return `${parts.join(' / ')} 合并记录`;
  return '合并记录';
}

/** 删除确认预览副文案：时间 · 合并水分 / 蛋白 / … */
function formatDeleteIntakeMergeDetail(row: HealthRecordRow, timeHm: string): string {
  const labels: string[] = [];
  if (row.hydration > 0) labels.push('水分');
  if (row.protein > 0) labels.push('蛋白');
  if (row.carbohydrate > 0) labels.push('碳水');
  if (row.calories > 0) labels.push('热量');
  const merge =
    labels.length >= 2 ? `合并${labels.join(' / ')}` : labels.length === 1 ? labels[0]! : '摄入';
  return timeHm ? `${timeHm} · ${merge}` : merge;
}

function clampIntakeLabel(raw: string, max = 28): string {
  const t = raw.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

type IntakeListLine = {
  key: string;
  recordId: string;
  /** 列表行对应的单一营养维度（用于详情页高亮） */
  metric: 'hydration' | 'protein' | 'carbohydrate' | 'calories';
  title: string;
  timeLine: string;
  amountRight: string;
  note: string;
  aiComment: string;
  /** 来源角标：AI 文本 / 拍照 / 快捷卡 / 手动 */
  sourceTag: string | null;
  icon: keyof typeof MaterialIcons.glyphMap;
  iconBgLight: string;
  iconBgDark: string;
  iconColor: string;
  /** 智谱解析中占位行，不可点进详情、不可滑动删除 */
  isPlaceholder?: boolean;
};

function resolveIntakeSourceTag(row: HealthRecordRow): string | null {
  if (row.source_image_uri?.trim()) return '拍照';
  if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) return 'AI 文本';
  if (row.quick_add_key) return '快捷卡';
  if (row.intake_display_title?.trim()) return '手动';
  return null;
}

/** 将当日多条库记录展开为列表行（一行可对应水分/蛋白质/热量中一项）。 */
function buildIntakeListLines(rows: HealthRecordRow[], quickAddCatalog: QuickAddCardItem[]): IntakeListLine[] {
  const lines: IntakeListLine[] = [];
  const quickAddByKey = createQuickAddItemMap(quickAddCatalog);
  const orderedRows = [...rows].sort((a, b) => {
    const c = compareDatetimeDesc(a.created_at, b.created_at);
    if (c !== 0) return c;
    return compareDatetimeDesc(a.updated_at, b.updated_at);
  });
  const getMetricQuickAdd = (qa: QuickAddCardItem | undefined, metric: 'hydration' | 'protein' | 'carbohydrate' | 'calories') =>
    qa && getQuickAddMetricTypes(qa).includes(metric) ? qa : undefined;

  for (const row of orderedRows) {
    const timeLine = formatStoredDatetimeHm(row.created_at);
    const sourceTag = resolveIntakeSourceTag(row);
    if (positiveNutrientKindsCount(row) >= 2) {
      lines.push({
        key: `${row.id}-combined`,
        recordId: row.id,
        metric: firstPositiveIntakeMetric(row),
        title: combinedIntakeListTitle(row, quickAddByKey),
        timeLine,
        amountRight: formatCombinedListAmountRight(row),
        note: formatCombinedListNote(row),
        aiComment: intakeListAiComment(row),
        sourceTag,
        icon: row.source_image_uri?.trim() ? 'photo-camera' : 'auto-awesome',
        iconBgLight: 'rgba(79,143,168,0.14)',
        iconBgDark: 'rgba(30,64,80,0.35)',
        iconColor: HealthNutrientAccents.hydration,
      });
      continue;
    }
    const h = row.hydration;
    const p = row.protein;
    const c = row.carbohydrate;
    const s = row.calories;
    if (h > 0) {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      lines.push({
        key: `${row.id}-h`,
        recordId: row.id,
        metric: 'hydration',
        title: singleIntakeLineTitle(row, qa ? qa.label : '水分'),
        timeLine,
        amountRight: formatIntakeAmount(h, 'ml'),
        note: sourceTag === '快捷卡' && qa ? `快捷卡 · ${qa.label}` : '',
        aiComment: intakeListAiComment(row),
        sourceTag,
        icon: getMetricQuickAdd(qa, 'hydration')?.icon as keyof typeof MaterialIcons.glyphMap || 'water-drop',
        iconBgLight: 'rgba(79,143,168,0.14)',
        iconBgDark: 'rgba(30,64,80,0.35)',
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
        amountRight: `${formatIntakeAmount(p, 'g')} 蛋白`,
        note: sourceTag === '快捷卡' && metricQa ? `快捷卡 · ${metricQa.label}` : '',
        aiComment: intakeListAiComment(row),
        sourceTag,
        icon: metricQa ? (metricQa.icon as keyof typeof MaterialIcons.glyphMap) : 'restaurant',
        iconBgLight: 'rgba(196,120,82,0.14)',
        iconBgDark: 'rgba(120,53,15,0.32)',
        iconColor: HealthNutrientAccents.protein,
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
        note: sourceTag === '快捷卡' && metricQa ? `快捷卡 · ${metricQa.label}` : '',
        aiComment: intakeListAiComment(row),
        sourceTag,
        icon: metricQa ? (metricQa.icon as keyof typeof MaterialIcons.glyphMap) : 'rice-bowl',
        iconBgLight: 'rgba(196,160,74,0.14)',
        iconBgDark: 'rgba(113,63,18,0.32)',
        iconColor: HealthNutrientAccents.carbohydrate,
      });
    }
    if (s > 0) {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      const metricQa = getMetricQuickAdd(qa, 'calories');
      lines.push({
        key: `${row.id}-s`,
        recordId: row.id,
        metric: 'calories',
        title: singleIntakeLineTitle(row, metricQa ? metricQa.label : '热量'),
        timeLine,
        amountRight: formatIntakeAmount(s, 'kcal'),
        note: sourceTag === '快捷卡' && metricQa ? `快捷卡 · ${metricQa.label}` : '',
        aiComment: intakeListAiComment(row),
        sourceTag,
        icon: metricQa ? (metricQa.icon as keyof typeof MaterialIcons.glyphMap) : 'local-fire-department',
        iconBgLight: 'rgba(95,138,110,0.14)',
        iconBgDark: 'rgba(30,64,48,0.35)',
        iconColor: HealthNutrientAccents.calories,
      });
    }
  }
  return lines;
}

async function loadHomeHealthSliceForUser(
  userId: string,
  weekAnchor: Date,
  selected: Date,
  opts?: { cacheOnly?: boolean },
) {
  return fetchUserHomeHealthSlice(
    userId,
    formatLocalYmd(weekAnchor),
    formatLocalYmd(selected),
    opts,
  );
}

/** 插入一条「当日增量」记录；首页与汇总接口按 record_date 对同日多条 SUM。 */
async function appendManualIntakeToDay(params: {
  userId: string;
  recordDateYmd: string;
  type: 'hydration' | 'protein' | 'carbohydrate' | 'calories';
  amount: number;
  quickAddKey?: string;
  targetHydrationMl: number;
  targetProteinG: number;
  targetCarbohydrateG: number;
  targetCaloriesKcal: number;
}): Promise<void> {
  const { userId, recordDateYmd, type, amount, quickAddKey, targetHydrationMl, targetProteinG, targetCarbohydrateG, targetCaloriesKcal } = params;
  if (!Number.isFinite(amount) || amount <= 0) return;
  const id = makeTimestampEntityId('h_', 8);
  await createHealthRecord({
    id,
    user_id: userId,
    record_date: recordDateYmd,
    quick_add_key: quickAddKey ?? null,
    hydration: type === 'hydration' ? amount : 0,
    protein: type === 'protein' ? amount : 0,
    carbohydrate: type === 'carbohydrate' ? amount : 0,
    calories: type === 'calories' ? amount : 0,
    target_hydration: targetHydrationMl,
    target_protein: targetProteinG,
    target_carbohydrate: targetCarbohydrateG,
    target_calories: targetCaloriesKcal,
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

function dailyAiTargetForTab(row: DailyAiIntakeTargetsRow, tab: '水分' | '蛋白质' | '碳水' | '热量'): number {
  if (tab === '水分') return row.hydration_ml;
  if (tab === '蛋白质') return row.protein_g;
  if (tab === '碳水') return row.carbohydrate_g;
  return row.calories_kcal;
}

type AssistantSuggestKind = IntakeAssistantSuggestKind;

function globalIntakeTargetForTab(tab: IntakeAssistantUiTab): number {
  const targets = getResolvedGlobalIntakeTargets();
  if (tab === '水分') return targets.hydrationMl;
  if (tab === '蛋白质') return targets.proteinG;
  if (tab === '碳水') return targets.carbohydrateG;
  return targets.caloriesKcal;
}

function resolveManualGoalForSelection(
  tab: IntakeAssistantUiTab,
  selection: ReturnType<typeof getIntakeAssistantSelection>,
  suggestNumeric: { best: number; community: number },
): string {
  if (selection.kind === 'manual') {
    const fallback = selection.manualValue ?? globalIntakeTargetForTab(tab);
    return sanitizeAssistantManualGoalInput(String(fallback));
  }
  return sanitizeAssistantManualGoalInput(String(suggestNumeric[selection.kind]));
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

/** 周条导航：`4.28 – 5.4 · 本周` */
function formatWeekNavLabel(days: { date: Date }[], today: Date): string {
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  if (!first || !last) return '';
  const range = `${first.getMonth() + 1}.${first.getDate()} – ${last.getMonth() + 1}.${last.getDate()}`;
  const t = normalizeDate(today).getTime();
  const inWeek = t >= normalizeDate(first).getTime() && t <= normalizeDate(last).getTime();
  return inWeek ? `${range} · 本周` : range;
}

type WeeklyTrendItem = {
  day: string;
  date: Date;
  hydration: number;
  protein: number;
  carbohydrate: number;
  calories: number;
  active: boolean;
};

/** 设计稿 .chart 绘图区高度：gridline 102−14 ≈ 88 */
const BAR_MAX_HEIGHT = 88;
const BAR_MIN_VISIBLE_HEIGHT = 3;
/** 7 天 × 水/蛋白/碳水/热量 */
const TREND_BAR_TOTAL = 28;
const TREND_METRIC_KEYS = ['hydration', 'protein', 'carbohydrate', 'calories'] as const;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const FLOATING_CTA_SIZE = 62;
const FLOATING_CTA_MARGIN = 12;

function trendBarHeight(percent: number) {
  if (percent <= 0) return BAR_MIN_VISIBLE_HEIGHT;
  return (percent / 100) * BAR_MAX_HEIGHT;
}

function trendDayAvgPercent(item: WeeklyTrendItem) {
  return Math.round((item.hydration + item.protein + item.carbohydrate + item.calories) / 4);
}

function metricStatusDesc(
  key: 'hydration' | 'protein' | 'carbohydrate' | 'calories',
  current: number,
  target: number,
  percent: number,
  calorieDeficit: number,
): string {
  const remain = Math.max(0, Math.round(target - current));
  if (key === 'hydration') {
    if (percent >= 80) return `充足 · 还差 ${remain} ml`;
    if (percent >= 50) return `尚可 · 还差 ${remain} ml`;
    return `偏低 · 还差 ${remain} ml`;
  }
  if (key === 'protein') {
    if (percent >= 90) return `达标 · 还差 ${remain} g`;
    if (percent >= 70) return `接近目标 · 还差 ${remain} g`;
    return `不足 · 还差 ${remain} g`;
  }
  if (key === 'carbohydrate') {
    if (percent >= 90) return `充足 · 还差 ${remain} g`;
    if (percent >= 60) return `尚可 · 晚餐可再补 ${remain} g`;
    return `偏低 · 还差 ${remain} g`;
  }
  if (calorieDeficit > 0) return `预算内 · 余 ${calorieDeficit} kcal`;
  if (calorieDeficit === 0) return '已达预算';
  return `超额 · 超 ${Math.abs(calorieDeficit)} kcal`;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/** 设计稿数字滚动：三次缓出 620ms，从旧值滚到新值 */
function AnimatedPercentText({
  value,
  style,
  suffix = '%',
  reduced = false,
}: {
  value: number;
  style?: React.ComponentProps<typeof Text>['style'];
  suffix?: string;
  reduced?: boolean;
}) {
  const target = Math.max(0, Math.min(100, value));
  const anim = React.useRef(new Animated.Value(target)).current;
  const [display, setDisplay] = React.useState(Math.round(target));

  React.useEffect(() => {
    const id = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    if (reduced) {
      anim.setValue(target);
      setDisplay(Math.round(target));
    } else {
      Animated.timing(anim, {
        toValue: target,
        duration: 620,
        easing: HEALTH_MOTION_EASE,
        useNativeDriver: false,
      }).start();
    }
    return () => anim.removeListener(id);
  }, [anim, reduced, target]);

  return (
    <Text style={style}>
      {display}
      {suffix}
    </Text>
  );
}

const CircularProgress = ({
  percentage,
  icon,
  color,
  trackColor = 'rgba(148, 163, 184, 0.26)',
  size = 64,
  strokeWidth = 6,
  centerMode = 'icon',
  percentColor,
  reducedMotion = false,
}: {
  percentage: number;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  trackColor?: string;
  size?: number;
  strokeWidth?: number;
  centerMode?: 'icon' | 'percent';
  percentColor?: string;
  reducedMotion?: boolean;
}) => {
  const target = Math.max(0, Math.min(100, percentage));
  const animatedPercentage = React.useRef(new Animated.Value(target)).current;
  const [displayPct, setDisplayPct] = React.useState(Math.round(target));

  React.useEffect(() => {
    const id = animatedPercentage.addListener(({ value }) => setDisplayPct(Math.round(value)));
    if (reducedMotion) {
      animatedPercentage.setValue(target);
      setDisplayPct(Math.round(target));
    } else {
      Animated.timing(animatedPercentage, {
        toValue: target,
        duration: 620,
        easing: HEALTH_MOTION_EASE,
        useNativeDriver: false,
      }).start();
    }
    return () => animatedPercentage.removeListener(id);
  }, [animatedPercentage, reducedMotion, target]);

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
        />
      </Svg>
      <View style={styles.iconContainer}>
        {centerMode === 'percent' ? (
          <Text style={[styles.progressPercentText, { color: percentColor ?? color, fontSize: Math.round(size * 0.28) }]}>
            {displayPct}
          </Text>
        ) : (
          <MaterialIcons name={icon} size={Math.round(size * 0.38)} color={color} />
        )}
      </View>
    </View>
  );
};

function StatusTrackWithThreshold({
  percent,
  color,
  trackBg,
  thresholdPercent,
  thresholdValueLabel,
  showThreshold,
}: {
  percent: number;
  color: string;
  trackBg: string;
  thresholdPercent: number;
  /** 阈值对应的具体数值文案（非百分比） */
  thresholdValueLabel: string;
  showThreshold: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  const threshold = Math.min(100, Math.max(0, Math.round(thresholdPercent)));
  return (
    <View style={[styles.statusTrackWrap, showThreshold && styles.statusTrackWrapWithMarker]}>
      {showThreshold ? (
        <View
          pointerEvents="none"
          style={[styles.statusThresholdMarker, { left: `${threshold}%` }]}
        >
          <Text style={[styles.statusThresholdLabel, { color }]} numberOfLines={1}>
            {thresholdValueLabel}
          </Text>
          <View style={[styles.statusThresholdLine, { backgroundColor: color }]} />
        </View>
      ) : null}
      <View style={[styles.statusTrack, { backgroundColor: trackBg }]}>
        <View
          style={[
            styles.statusTrackFill,
            { width: `${clamped}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}

export default function HealthScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { hh, fonts: hhFonts } = useHealthHomeTheme();
  const {
    logicalTodayYmd: calendarTodayYmd,
    logicalTodayDate: calendarTodayDate,
    boundary: healthDayBoundary,
  } = usePageDayBoundary('health');
  const insets = useSafeAreaInsets();
  const pageInset = Spacing.md * 2;
  const weekPagerWidth = width - pageInset;
  /** 2×2 指标卡宽度（对齐稿面：纸底直铺，无外层白卡内边距） */
  const metricCardWidth = (width - pageInset - Spacing.md) / 2;
  /** 快速添加横滑卡宽度 */
  const cardWidth = Math.max(76, Math.min(92, (width - pageInset - Spacing.md * 3) / 4.2));
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  const [pointsSettingsOpen, setPointsSettingsOpen] = React.useState(false);
  const [metricPointsSettings, setMetricPointsSettings] = React.useState<HealthMetricPointsSettings>(
    DEFAULT_HEALTH_METRIC_POINTS_SETTINGS,
  );
  const [assistantTab, setAssistantTab] = React.useState<'水分' | '蛋白质' | '碳水' | '热量'>('水分');
  const [intakeTargetTick, setIntakeTargetTick] = React.useState(0);
  const intakeTargetsSnapshot = React.useMemo(
    () => ({
      ...getResolvedGlobalIntakeTargets(),
      tick: intakeTargetTick,
    }),
    [intakeTargetTick]
  );
  const [manualGoal, setManualGoal] = React.useState(() =>
    sanitizeAssistantManualGoalInput(String(getResolvedGlobalIntakeTargets().hydrationMl))
  );
  /** 智能建议中选中的推荐项；持久化于 app_settings */
  const [assistantSuggestSelection, setAssistantSuggestSelection] = React.useState<AssistantSuggestKind>('best');
  /** 每日至多一次 AI 估算的四项目标（本地缓存），用于「今日最佳」行 */
  const [dailyAiTargets, setDailyAiTargets] = React.useState<DailyAiIntakeTargetsRow | null>(null);
  const [dailyAiLoading, setDailyAiLoading] = React.useState(false);
  const today = React.useMemo(() => normalizeDate(calendarTodayDate), [calendarTodayDate]);
  const [selectedDate, setSelectedDate] = React.useState(() => normalizeDate(calendarTodayDate));
  const [weekAnchorDate, setWeekAnchorDate] = React.useState(() => normalizeDate(calendarTodayDate));
  const [quickAddItems, setQuickAddItems] = React.useState<QuickAddCardItem[]>(() => getDefaultQuickAddItems());
  const [quickAddCatalog, setQuickAddCatalog] = React.useState<QuickAddCardItem[]>(() => getDefaultQuickAddItems());
  const [addingStarterKey, setAddingStarterKey] = React.useState<string | null>(null);
  const quickAddEmpty = quickAddItems.length === 0;

  const weekPagerRef = React.useRef<ScrollView>(null);
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  /** 偏好未就绪时按「减少动态」处理，避免第一下按压先缩后弹 */
  const motionReduced = reduceMotion || !motionReady;

  const [ctaScaleAnim] = React.useState(() => new Animated.Value(1));
  const [ctaPressAnim] = React.useState(() => new Animated.Value(1));
  /** 呼吸缩放 × 按压缩放。节点只创建一次，避免每次渲染重建原生乘法节点 */
  const [ctaCombinedScale] = React.useState(() => Animated.multiply(ctaScaleAnim, ctaPressAnim));
  /** 每周趋势 28 柱：按 水→蛋白→碳水→热量 错峰 12ms 生长 */
  const trendBarAnimsRef = React.useRef(
    Array.from({ length: TREND_BAR_TOTAL }, () => new Animated.Value(0)),
  ).current;
  const trendPulseAnim = React.useRef(new Animated.Value(1)).current;
  const [trendDeltaOverride, setTrendDeltaOverride] = React.useState<string | null>(null);
  const [chartTipText, setChartTipText] = React.useState<string | null>(null);
  const [trendPulseIndex, setTrendPulseIndex] = React.useState<number | null>(null);
  const chartTipTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevWeekAnchorYmdForTrendRef = React.useRef(formatLocalYmd(weekAnchorDate));
  const selectedDayPopAnim = React.useRef(new Animated.Value(1)).current;
  const metricImpactAnims = React.useRef(nutrientMetricMeta.map(() => new Animated.Value(0))).current;
  const metricEnterAnims = React.useRef(nutrientMetricMeta.map(() => new Animated.Value(0))).current;
  const wheelImpactAnim = React.useRef(new Animated.Value(0)).current;
  const quickAddCardAnimsRef = React.useRef<Animated.Value[]>([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]);
  const quickAddPressAnimsRef = React.useRef<Animated.Value[]>([]);
  const quickAddIconLiftAnimsRef = React.useRef<Animated.Value[]>([]);
  const timelineEnterAnimsRef = React.useRef<Animated.Value[]>(
    Array.from({ length: 8 }, () => new Animated.Value(0)),
  );
  const [quickAddSuccessKey, setQuickAddSuccessKey] = React.useState<string | null>(null);
  const [quickFloatChip, setQuickFloatChip] = React.useState<{
    id: number;
    label: string;
    left: number;
    top: number;
  } | null>(null);
  const quickFloatAnim = React.useRef(new Animated.Value(0)).current;
  const quickSuccessTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickFloatSeqRef = React.useRef(0);
  const quickAddCardNodesRef = React.useRef<Map<string, View>>(new Map());

  const weekDaysCurrent = React.useMemo(() => getWeekDaysFromAnchor(weekAnchorDate), [weekAnchorDate]);
  const weekDaysPrev = React.useMemo(() => getWeekDaysFromAnchor(addDays(weekAnchorDate, -7)), [weekAnchorDate]);
  const weekDaysNext = React.useMemo(() => getWeekDaysFromAnchor(addDays(weekAnchorDate, 7)), [weekAnchorDate]);

  const { wrapLoad, resetSync } = usePageApiSync(PAGE_API_KEY);
  /** 用户在本页做过写操作后调用，下次聚焦时再从后端全量拉取 */
  const markPageDirty = resetSync;
  const reloadPageRef = React.useRef<((forceRefresh?: boolean) => Promise<void>) | null>(null);
  const weekAnchorYmdRef = React.useRef(formatLocalYmd(weekAnchorDate));
  const emptyLocalEscalatedRef = React.useRef(false);
  const [pageLoadError, setPageLoadError] = React.useState<string | null>(null);
  const [pageLoadRetrying, setPageLoadRetrying] = React.useState(false);
  /** 同步状态行：本地优先 · HH:mm 已同步 */
  const [lastSyncedAt, setLastSyncedAt] = React.useState<Date | null>(null);
  /** 首次数据未就绪前展示骨架屏，避免显示全 0 假数据 */
  const [initialHealthLoadPending, setInitialHealthLoadPending] = React.useState(true);
  /** 云端失败且尚无成功加载过时，保持骨架 + 错误条（设计稿 15） */
  const [forceFailureSkeleton, setForceFailureSkeleton] = React.useState(false);
  const everLoadedHealthRef = React.useRef(false);
  const skeletonPending = initialHealthLoadPending || forceFailureSkeleton;
  const { showSkeleton, skeletonMounted, skeletonOpacity } = useHomeSkeletonReveal(skeletonPending, {
    fadeContent: false,
  });
  const [deleteConfirm, setDeleteConfirm] = React.useState<{
    recordId: string;
    title: string;
    detail: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    iconColor: string;
    pointsDelta: number | null;
  } | null>(null);
  const [deleteConfirming, setDeleteConfirming] = React.useState(false);
  const [parseElapsedSec, setParseElapsedSec] = React.useState(0);

  // 获取用户信息
  const [user, setUser] = React.useState<UserRow | null>(null);
  const loadUser = React.useCallback(async () => {
    const data = await getDefaultUser();
    setUser(data);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void loadPersistedIntakeTargets().then(() => {
        if (!cancelled) setIntakeTargetTick((t) => t + 1);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  /** 从编辑页返回时务必重读快捷卡片（不依赖整页 wrapLoad / 会话标记） */
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const [selectedItems, catalog] = await Promise.all([
            loadSelectedQuickAddItems(),
            loadAllQuickAddItems(),
          ]);
          if (cancelled) return;
          setQuickAddItems(selectedItems);
          setQuickAddCatalog(catalog);
        } catch (e) {
          console.warn('聚焦时加载快捷卡片失败', e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const refreshUser = async () => {
        const data = await getDefaultUser();
        if (!cancelled) {
          setUser(data);
        }
      };

      if (!shouldSkipPageFocusApiRefresh(PAGE_API_KEY)) {
        void loadUser();
      }
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
  /** AI/拍照/快捷卡写入过程中的列表占位 */
  const [pendingIntake, setPendingIntake] = React.useState<{
    id: string;
    kind: 'ai' | 'photo' | 'quick';
    label: string;
    startedAt: number;
  } | null>(null);
  const intakeParseLocked = pendingIntake != null;
  const screenRootRef = React.useRef<View>(null);
  const homeEnterPlayedRef = React.useRef(false);
  const prevSelectedDayYmdRef = React.useRef(formatLocalYmd(selectedDate));

  React.useEffect(() => {
    if (!pendingIntake) {
      setParseElapsedSec(0);
      return;
    }
    const tick = () => {
      setParseElapsedSec(Math.max(0, (Date.now() - pendingIntake.startedAt) / 1000));
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [pendingIntake]);

  const reload = React.useCallback(async (forceRefresh = false): Promise<false | HomeHealthReloadResult> => {
    const currentUser = await getDefaultUser();
    if (!currentUser?.id) {
      setDailyAiTargets(null);
      setDailyAiLoading(false);
      return false;
    }

    let healthLoaded = false;
    let sliceEmpty = true;
    try {
      const applySlice = (slice: Awaited<ReturnType<typeof loadHomeHealthSliceForUser>>) => {
        setHealthRecords(slice.week);
        setPrevWeekHealthRecords(slice.prevWeek);
        setSelectedDayIntakeTotals(slice.dayTotals);
        setSelectedDayRecords(slice.dayRecords);
      };

      const slice = await loadHomeHealthSliceForUser(currentUser.id, weekAnchorDate, selectedDate);
      applySlice(slice);
      sliceEmpty = slice.week.length === 0 && slice.prevWeek.length === 0;
      healthLoaded = true;
    } catch (fallbackError) {
      console.warn('健康数据本地回退失败', fallbackError);
      return false;
    }

    // 下拉刷新只同步摄入/快捷卡片；AI 日目标仅在进入页面时更新，避免刷新 spinner 长时间卡住
    if (!forceRefresh) {
      setDailyAiLoading(true);
      try {
        const r = await ensureDailyAiIntakeTargetsForToday({
          user: currentUser,
          todayYmd: calendarTodayYmd,
          healthRecordsLocalOnly: healthLoaded,
        });
        if (r.status === 'cached' || r.status === 'fresh') {
          setDailyAiTargets(r.row);
        } else {
          setDailyAiTargets(null);
        }
      } finally {
        setDailyAiLoading(false);
      }
    }

    try {
      const [selectedItems, catalog] = await Promise.all([loadSelectedQuickAddItems(), loadAllQuickAddItems()]);
      setQuickAddItems(selectedItems);
      setQuickAddCatalog(catalog);
    } catch (e) {
      console.warn('加载快捷卡片失败，保留当前展示', e);
    }

    return { sliceEmpty };
  }, [calendarTodayYmd, selectedDate, weekAnchorDate]);

  const reloadPage = React.useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setPageLoadRetrying(true);
    try {
      const result = await wrapLoad(async () => reload(forceRefresh), forceRefresh);
      const fnResult = result.fnResult as false | HomeHealthReloadResult | undefined;

      if (!result.ok || fnResult === false) {
        setPageLoadError('云端数据加载失败');
        setInitialHealthLoadPending(false);
        setForceFailureSkeleton(!everLoadedHealthRef.current);
        return;
      }

      everLoadedHealthRef.current = true;
      if (result.restFailed) {
        setPageLoadError('云端数据加载失败');
        setForceFailureSkeleton(false);
      } else {
        setPageLoadError(null);
        setForceFailureSkeleton(false);
        setLastSyncedAt(new Date());
      }
      setInitialHealthLoadPending(false);

      // 本地空库：走 SyncManager bootstrap/pull，禁止页面 REST 冒充同步
      if (!forceRefresh && !result.restFailed && fnResult?.sliceEmpty && !emptyLocalEscalatedRef.current) {
        emptyLocalEscalatedRef.current = true;
        clearPageLoadedInSession(PAGE_API_KEY);
        const { refreshFromUser } = await import('@/lib/sync-manager');
        await refreshFromUser();
        await reloadPage(false);
      }
    } finally {
      if (forceRefresh) setPageLoadRetrying(false);
    }
  }, [reload, wrapLoad]);
  reloadPageRef.current = reloadPage;

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadPage);

  usePageFocusReload(PAGE_API_KEY, () => {
    void reloadPageRef.current?.(false).catch((e) => console.warn('刷新健康页数据失败', e));
  }, { observeLocal: false });
  useLocalQuery(LOCAL_TABLES, () => {
    void reloadPageRef.current?.(false).catch((e) => console.warn('刷新健康页数据失败', e));
  });

  /** 跨有效日界后：锚定「今天」并重载当日健康数据 */
  const prevCalendarTodayYmdRef = React.useRef(calendarTodayYmd);
  const needReloadAfterDayChangeRef = React.useRef(false);
  const selectedDateRef = React.useRef(selectedDate);
  const weekAnchorDateRef = React.useRef(weekAnchorDate);
  selectedDateRef.current = selectedDate;
  weekAnchorDateRef.current = weekAnchorDate;

  React.useEffect(() => {
    const prev = prevCalendarTodayYmdRef.current;
    if (prev === calendarTodayYmd) return;
    prevCalendarTodayYmdRef.current = calendarTodayYmd;
    needReloadAfterDayChangeRef.current = true;
    setSelectedDate(
      normalizeDate(
        refreshAnchorAfterLogicalDayChange(
          selectedDateRef.current,
          healthDayBoundary,
          calendarTodayYmd,
          prev,
        ),
      ),
    );
    setWeekAnchorDate(
      normalizeDate(
        refreshAnchorAfterLogicalDayChange(
          weekAnchorDateRef.current,
          healthDayBoundary,
          calendarTodayYmd,
          prev,
        ),
      ),
    );
    const timer = setTimeout(() => {
      if (!needReloadAfterDayChangeRef.current) return;
      needReloadAfterDayChangeRef.current = false;
      void reloadPageRef.current?.().catch((e) => console.warn('日界切换后刷新健康页失败', e));
    }, 0);
    return () => clearTimeout(timer);
  }, [calendarTodayYmd, healthDayBoundary]);

  React.useEffect(() => {
    if (!needReloadAfterDayChangeRef.current) return;
    needReloadAfterDayChangeRef.current = false;
    void reloadPageRef.current?.().catch((e) => console.warn('日界切换后刷新健康页失败', e));
  }, [selectedDate, weekAnchorDate]);

  /** 切换周视图时重新拉取该周数据（不依赖 focus，避免切 Tab 误触发） */
  React.useEffect(() => {
    if (!user?.id) return;
    const ymd = formatLocalYmd(weekAnchorDate);
    if (weekAnchorYmdRef.current === ymd) return;
    weekAnchorYmdRef.current = ymd;
    if (!shouldSkipPageFocusApiRefresh(PAGE_API_KEY)) return;
    void reloadPageRef.current?.();
  }, [user?.id, weekAnchorDate]);

  /** 切换选中日时从已加载的周数据中切日视图，无需重复请求 REST */
  React.useEffect(() => {
    const ymd = formatLocalYmd(selectedDate);
    const dayRecords = pickHealthRecordsForYmd(ymd, healthRecords, prevWeekHealthRecords);
    setSelectedDayRecords(dayRecords);
    setSelectedDayIntakeTotals(dayRecords.length > 0 ? sumHealthRecordsDayTotals(dayRecords) : null);
  }, [selectedDate, healthRecords, prevWeekHealthRecords]);

  const dayIntakeDisplay = React.useMemo(() => {
    const hydrationCurrent = intakeAmount(selectedDayIntakeTotals?.hydration);
    const proteinCurrent = intakeAmount(selectedDayIntakeTotals?.protein);
    const carbohydrateCurrent = intakeAmount(selectedDayIntakeTotals?.carbohydrate);
    const caloriesCurrent = intakeAmount(selectedDayIntakeTotals?.calories);
    const tH = intakeTargetsSnapshot.hydrationMl;
    const tP = intakeTargetsSnapshot.proteinG;
    const tC = intakeTargetsSnapshot.carbohydrateG;
    const tS = intakeTargetsSnapshot.caloriesKcal;
    const pct = (current: number, target: number) =>
      target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    return {
      hydration: { current: hydrationCurrent, target: tH, percent: pct(hydrationCurrent, tH) },
      protein: { current: proteinCurrent, target: tP, percent: pct(proteinCurrent, tP) },
      carbohydrate: { current: carbohydrateCurrent, target: tC, percent: pct(carbohydrateCurrent, tC) },
      calories: { current: caloriesCurrent, target: tS, percent: pct(caloriesCurrent, tS) },
    };
  }, [selectedDayIntakeTotals, intakeTargetsSnapshot]);

  const weeklyTrend = React.useMemo<WeeklyTrendItem[]>(() => {
    const totalsByYmd = new Map<string, { hydration: number; protein: number; carbohydrate: number; calories: number }>();
    for (const row of healthRecords) {
      const prev = totalsByYmd.get(row.record_date) ?? { hydration: 0, protein: 0, carbohydrate: 0, calories: 0 };
      totalsByYmd.set(row.record_date, {
        hydration: prev.hydration + row.hydration,
        protein: prev.protein + row.protein,
        carbohydrate: prev.carbohydrate + row.carbohydrate,
        calories: prev.calories + row.calories,
      });
    }
    const pct = (current: number, target: number) =>
      target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    const activeYmd = formatLocalYmd(selectedDate);
    return weekDaysCurrent.map((day) => {
      const dayYmd = formatLocalYmd(day.date);
      const totals = totalsByYmd.get(dayYmd) ?? { hydration: 0, protein: 0, carbohydrate: 0, calories: 0 };
      return {
        day: day.label,
        date: day.date,
        hydration: pct(totals.hydration, intakeTargetsSnapshot.hydrationMl),
        protein: pct(totals.protein, intakeTargetsSnapshot.proteinG),
        carbohydrate: pct(totals.carbohydrate, intakeTargetsSnapshot.carbohydrateG),
        calories: pct(totals.calories, intakeTargetsSnapshot.caloriesKcal),
        active: dayYmd === activeYmd,
      };
    });
  }, [healthRecords, intakeTargetsSnapshot, selectedDate, weekDaysCurrent]);

  const weeklyTrendDeltaText = React.useMemo(() => {
    const sumWeekProgress = (rows: HealthRecordRow[]) => {
      if (!rows.length) return 0;
      let hydrationTotal = 0;
      let proteinTotal = 0;
      let carbohydrateTotal = 0;
      let caloriesTotal = 0;
      for (const row of rows) {
        hydrationTotal += row.hydration;
        proteinTotal += row.protein;
        carbohydrateTotal += row.carbohydrate;
        caloriesTotal += row.calories;
      }
      const targetSum =
        intakeTargetsSnapshot.hydrationMl +
        intakeTargetsSnapshot.proteinG +
        intakeTargetsSnapshot.carbohydrateG +
        intakeTargetsSnapshot.caloriesKcal;
      if (targetSum <= 0) return 0;
      const weekProgress = ((hydrationTotal + proteinTotal + carbohydrateTotal + caloriesTotal) / (targetSum * 7)) * 100;
      return Math.max(0, weekProgress);
    };

    const current = sumWeekProgress(healthRecords);
    const previous = sumWeekProgress(prevWeekHealthRecords);
    if (previous <= 0) {
      if (current <= 0) return '完成度 0%';
      return '完成度 +100%';
    }
    const delta = ((current - previous) / previous) * 100;
    const rounded = Math.round(delta);
    const sign = rounded > 0 ? '+' : '';
    return `完成度 ${sign}${rounded}%`;
  }, [healthRecords, prevWeekHealthRecords, intakeTargetsSnapshot]);

  const dayCalorieDeficit = React.useMemo(
    () => calcCalorieDeficit(dayIntakeDisplay.calories.target, dayIntakeDisplay.calories.current),
    [dayIntakeDisplay.calories.current, dayIntakeDisplay.calories.target],
  );

  const metricPercents = React.useMemo(
    () => ({
      hydration: dayIntakeDisplay.hydration.percent,
      protein: dayIntakeDisplay.protein.percent,
      carbohydrate: dayIntakeDisplay.carbohydrate.percent,
      calories: dayIntakeDisplay.calories.percent,
    }),
    [dayIntakeDisplay],
  );

  /** 积分同步用：热量百分比不封顶，以便识别超过 100% */
  const metricPercentsForPoints = React.useMemo(() => {
    const calTarget = dayIntakeDisplay.calories.target;
    const calCurrent = dayIntakeDisplay.calories.current;
    const caloriesUncapped =
      calTarget > 0 ? Math.round((calCurrent / calTarget) * 100) : 0;
    return {
      hydration: dayIntakeDisplay.hydration.percent,
      protein: dayIntakeDisplay.protein.percent,
      carbohydrate: dayIntakeDisplay.carbohydrate.percent,
      calories: caloriesUncapped,
    };
  }, [dayIntakeDisplay]);

  const thresholdValueLabels = React.useMemo(() => {
    const pct = metricPointsSettings.thresholdPercent;
    return {
      hydration: formatIntakeLocale(
        healthMetricThresholdAbsolute(intakeTargetsSnapshot.hydrationMl, pct),
      ),
      protein: `${formatIntakeLocale(
        healthMetricThresholdAbsolute(intakeTargetsSnapshot.proteinG, pct),
      )} g`,
      carbohydrate: `${formatIntakeLocale(
        healthMetricThresholdAbsolute(intakeTargetsSnapshot.carbohydrateG, pct),
      )} g`,
      calories: formatIntakeLocale(
        healthMetricThresholdAbsolute(intakeTargetsSnapshot.caloriesKcal, pct),
      ),
    };
  }, [intakeTargetsSnapshot, metricPointsSettings.thresholdPercent]);

  React.useEffect(() => {
    let cancelled = false;
    void loadHealthMetricPointsSettings()
      .then((settings) => {
        if (cancelled) return;
        setMetricPointsSettings(settings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const ymd = formatLocalYmd(selectedDate);
    const percents = metricPercentsForPoints;
    const settings = metricPointsSettings;
    // 防抖：回前台/重载时 intake 会连跳多次，避免连续打积分接口卡死
    const timer = setTimeout(() => {
      void syncHealthMetricPointsForDay({ ymd, percents, settings }).catch((e) => {
        if (__DEV__) console.warn('[health-metric-points]', e);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [selectedDate, metricPercentsForPoints, metricPointsSettings]);

  const openPointsSettingsModal = React.useCallback(() => {
    setPointsSettingsOpen(true);
  }, []);

  const closePointsSettingsModal = React.useCallback(() => {
    setPointsSettingsOpen(false);
  }, []);

  const pointsSettingsDayMetrics = React.useMemo(
    () => ({
      hydration: {
        current: dayIntakeDisplay.hydration.current,
        target: dayIntakeDisplay.hydration.target,
      },
      protein: {
        current: dayIntakeDisplay.protein.current,
        target: dayIntakeDisplay.protein.target,
      },
      carbohydrate: {
        current: dayIntakeDisplay.carbohydrate.current,
        target: dayIntakeDisplay.carbohydrate.target,
      },
      calories: {
        current: dayIntakeDisplay.calories.current,
        target: dayIntakeDisplay.calories.target,
      },
    }),
    [dayIntakeDisplay],
  );

  const playIntakeFeedbackAnimation = React.useCallback(() => {
    metricImpactAnims.forEach((anim) => anim.setValue(0));
    wheelImpactAnim.setValue(0);
    // 减少动态：不做缩放脉冲，指标直接停在终态
    if (motionReduced) return;
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
  }, [metricImpactAnims, motionReduced, wheelImpactAnim]);

  const persistManualIntakeDelta = React.useCallback(
    async (type: 'hydration' | 'protein' | 'carbohydrate' | 'calories', amount: number, quickAddKey?: string) => {
      if (pendingIntake) {
        toast.info('当前有一条摄入正在解析，解析完成后再添加。');
        return;
      }
      if (!user?.id || !Number.isFinite(amount) || amount <= 0) return;
      const ymd = formatLocalYmd(selectedDate);
      try {
        markPageDirty();
        await appendManualIntakeToDay({
          userId: user.id,
          recordDateYmd: ymd,
          type,
          amount,
          quickAddKey,
          targetHydrationMl: intakeTargetsSnapshot.hydrationMl,
          targetProteinG: intakeTargetsSnapshot.proteinG,
          targetCarbohydrateG: intakeTargetsSnapshot.carbohydrateG,
          targetCaloriesKcal: intakeTargetsSnapshot.caloriesKcal,
        });
        const { week, prevWeek, dayTotals, dayRecords } = await loadHomeHealthSliceForUser(user.id, weekAnchorDate, selectedDate);
        setHealthRecords(week);
        setPrevWeekHealthRecords(prevWeek);
        setSelectedDayIntakeTotals(dayTotals);
        setSelectedDayRecords(dayRecords);
        playIntakeFeedbackAnimation();
      } catch (e) {
        toast.error(toUserMessage(e, '保存失败，请稍后重试。'));
      }
    },
    [user?.id, selectedDate, weekAnchorDate, intakeTargetsSnapshot, playIntakeFeedbackAnimation, pendingIntake, markPageDirty]
  );

  const persistFoodPhotoIntake = React.useCallback(
    async (
      protein: number,
      carbohydrate: number,
      calories: number,
      sourceImageUri?: string | null,
      meta?: { displayTitle?: string; aiComment?: string; hydration?: number }
    ): Promise<boolean> => {
      if (!user?.id) return false;
      const p = Math.max(0, Number(protein) || 0);
      const c = Math.max(0, Number(carbohydrate) || 0);
      const s = Math.max(0, Number(calories) || 0);
      const h = Math.max(0, Number(meta?.hydration) || 0);
      if (p + c + s + h <= 0) return false;
      const ymd = formatLocalYmd(selectedDate);
      try {
        markPageDirty();
        const id = makeTimestampEntityId('h_', 8);
        await createHealthRecord({
          id,
          user_id: user.id,
          record_date: ymd,
          quick_add_key: null,
          source_image_uri: sourceImageUri?.trim() || null,
          intake_display_title: clampIntakeDisplayTitle(meta?.displayTitle),
          intake_ai_comment: clampIntakeAiComment(meta?.aiComment),
          hydration: h,
          protein: p,
          carbohydrate: c,
          calories: s,
          target_hydration: intakeTargetsSnapshot.hydrationMl,
          target_protein: intakeTargetsSnapshot.proteinG,
          target_carbohydrate: intakeTargetsSnapshot.carbohydrateG,
          target_calories: intakeTargetsSnapshot.caloriesKcal,
        });
        const { week, prevWeek, dayTotals, dayRecords } = await loadHomeHealthSliceForUser(user.id, weekAnchorDate, selectedDate);
        setHealthRecords(week);
        setPrevWeekHealthRecords(prevWeek);
        setSelectedDayIntakeTotals(dayTotals);
        setSelectedDayRecords(dayRecords);
        playIntakeFeedbackAnimation();
        return true;
      } catch (e) {
        toast.error(toUserMessage(e, '保存失败，请稍后重试。'));
        return false;
      }
    },
    [user?.id, selectedDate, weekAnchorDate, intakeTargetsSnapshot, playIntakeFeedbackAnimation, markPageDirty]
  );

  const persistAiTextIntake = React.useCallback(
    async (
      hydrationMl: number,
      protein: number,
      carbohydrate: number,
      calories: number,
      meta?: { displayTitle?: string; aiComment?: string }
    ): Promise<boolean> => {
      if (!user?.id) return false;
      const h = Math.max(0, Number(hydrationMl) || 0);
      const p = Math.max(0, Number(protein) || 0);
      const c = Math.max(0, Number(carbohydrate) || 0);
      const s = Math.max(0, Number(calories) || 0);
      if (h + p + c + s <= 0) return false;
      const ymd = formatLocalYmd(selectedDate);
      try {
        markPageDirty();
        const id = makeTimestampEntityId('h_', 8);
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
          calories: s,
          target_hydration: intakeTargetsSnapshot.hydrationMl,
          target_protein: intakeTargetsSnapshot.proteinG,
          target_carbohydrate: intakeTargetsSnapshot.carbohydrateG,
          target_calories: intakeTargetsSnapshot.caloriesKcal,
        });
        const { week, prevWeek, dayTotals, dayRecords } = await loadHomeHealthSliceForUser(user.id, weekAnchorDate, selectedDate);
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
    [user?.id, selectedDate, weekAnchorDate, intakeTargetsSnapshot, playIntakeFeedbackAnimation, markPageDirty]
  );

  const ensureQuickAddPressAnim = React.useCallback((index: number) => {
    while (quickAddPressAnimsRef.current.length <= index) {
      quickAddPressAnimsRef.current.push(new Animated.Value(1));
    }
    while (quickAddIconLiftAnimsRef.current.length <= index) {
      quickAddIconLiftAnimsRef.current.push(new Animated.Value(0));
    }
    return {
      press: quickAddPressAnimsRef.current[index]!,
      iconLift: quickAddIconLiftAnimsRef.current[index]!,
    };
  }, []);

  const playQuickAddSuccessMotion = React.useCallback(
    (item: QuickAddCardItem, index: number, cardRef: View | null) => {
      if (quickSuccessTimerRef.current) {
        clearTimeout(quickSuccessTimerRef.current);
        quickSuccessTimerRef.current = null;
      }
      setQuickAddSuccessKey(item.key);
      quickSuccessTimerRef.current = setTimeout(() => {
        setQuickAddSuccessKey(null);
        quickSuccessTimerRef.current = null;
      }, 600);

      const { iconLift } = ensureQuickAddPressAnim(index);
      if (!motionReduced) {
        iconLift.setValue(0);
        Animated.sequence([
          Animated.timing(iconLift, {
            toValue: 1,
            duration: 120,
            easing: HEALTH_MOTION_SPRING,
            useNativeDriver: true,
          }),
          Animated.timing(iconLift, {
            toValue: 0,
            duration: 180,
            easing: HEALTH_MOTION_EASE,
            useNativeDriver: true,
          }),
        ]).start();
      }

      const floatLabel = `+${Math.round(item.displayAmount)} ${item.displayUnit}`;
      const spawnFloat = (left: number, top: number) => {
        const id = ++quickFloatSeqRef.current;
        setQuickFloatChip({ id, label: floatLabel, left, top });
        quickFloatAnim.setValue(0);
        Animated.timing(quickFloatAnim, {
          toValue: 1,
          duration: motionReduced ? 120 : 1150,
          easing: HEALTH_MOTION_EASE,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setQuickFloatChip((prev) => (prev?.id === id ? null : prev));
        });
      };
      // measureInWindow 为屏幕坐标，浮标挂在页面根节点上，需换算为相对坐标
      if (cardRef && typeof cardRef.measureInWindow === 'function') {
        cardRef.measureInWindow((cx, cy, cw, ch) => {
          const place = (rx: number, ry: number) => spawnFloat(cx + cw / 2 - rx, cy + ch / 2 - ry);
          const root = screenRootRef.current;
          if (root && typeof root.measureInWindow === 'function') {
            root.measureInWindow((rx, ry) => place(rx, ry));
          } else {
            place(0, 0);
          }
        });
      } else {
        spawnFloat(width / 2, 280);
      }
    },
    [ensureQuickAddPressAnim, motionReduced, quickFloatAnim],
  );

  const persistQuickAddIntake = React.useCallback(
    async (item: QuickAddCardItem, index: number, cardRef: View | null) => {
      const metrics = getQuickAddMetricTypes(item);
      if (!metrics.length) return;
      if (pendingIntake) {
        toast.info('当前有一条摄入正在解析，解析完成后再添加。');
        return;
      }
      if (!user?.id) return;

      const pendingId = makeTimestampEntityId('hq_', 8);
      const startedAt = Date.now();
      setPendingIntake({ id: pendingId, kind: 'quick', label: item.label, startedAt });

      // 设计稿：新记录从列表顶部下落插入
      if (!motionReduced) {
        const rowAnim = timelineEnterAnimsRef.current[0];
        if (rowAnim) {
          rowAnim.setValue(0);
          Animated.timing(rowAnim, {
            toValue: 1,
            duration: 420,
            easing: HEALTH_MOTION_EASE,
            useNativeDriver: true,
          }).start();
        }
      }

      playQuickAddSuccessMotion(item, index, cardRef);

      const ymd = formatLocalYmd(selectedDate);
      try {
        markPageDirty();
        for (const metric of metrics) {
          const amount = getQuickAddMetricAmount(item, metric);
          if (!Number.isFinite(amount) || amount <= 0) continue;
          await appendManualIntakeToDay({
            userId: user.id,
            recordDateYmd: ymd,
            type: metric,
            amount,
            quickAddKey: item.key,
            targetHydrationMl: intakeTargetsSnapshot.hydrationMl,
            targetProteinG: intakeTargetsSnapshot.proteinG,
            targetCarbohydrateG: intakeTargetsSnapshot.carbohydrateG,
            targetCaloriesKcal: intakeTargetsSnapshot.caloriesKcal,
          });
        }
        const { week, prevWeek, dayTotals, dayRecords } = await loadHomeHealthSliceForUser(
          user.id,
          weekAnchorDate,
          selectedDate,
        );
        // 设计稿：占位约 950ms 后再转正并刷新概况
        const waitMs = motionReduced ? 0 : Math.max(0, 950 - (Date.now() - startedAt));
        if (waitMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        }
        setPendingIntake(null);
        setHealthRecords(week);
        setPrevWeekHealthRecords(prevWeek);
        setSelectedDayIntakeTotals(dayTotals);
        setSelectedDayRecords(dayRecords);
        playIntakeFeedbackAnimation();

        if (metricPointsSettings.enabled && metricPointsSettings.rewardPoints > 0) {
          const pts = metricPointsSettings.rewardPoints;
          toast.success(`已写入 · 今日积分 +${pts} 分`);
        } else {
          toast.success(`已写入「${item.label}」`);
        }
      } catch (e) {
        setPendingIntake(null);
        toast.error(toUserMessage(e, '保存失败，请稍后重试。'));
      }
    },
    [
      pendingIntake,
      user?.id,
      selectedDate,
      weekAnchorDate,
      intakeTargetsSnapshot,
      playQuickAddSuccessMotion,
      playIntakeFeedbackAnimation,
      markPageDirty,
      metricPointsSettings.enabled,
      metricPointsSettings.rewardPoints,
      motionReduced,
    ],
  );

  const deleteIntakeRecordNow = React.useCallback(
    async (recordId: string) => {
      if (!user?.id) return;
      setDeleteConfirming(true);
      try {
        markPageDirty();
        await deleteHealthRecord(recordId);
        const { week, prevWeek, dayTotals, dayRecords } = await loadHomeHealthSliceForUser(
          user.id,
          weekAnchorDate,
          selectedDate,
        );
        setHealthRecords(week);
        setPrevWeekHealthRecords(prevWeek);
        setSelectedDayIntakeTotals(dayTotals);
        setSelectedDayRecords(dayRecords);
        playIntakeFeedbackAnimation();
        setDeleteConfirm(null);
        toast.success('已删除');
      } catch (e) {
        toast.error(toUserMessage(e, '删除失败，请稍后重试。'));
      } finally {
        setDeleteConfirming(false);
      }
    },
    [user?.id, selectedDate, weekAnchorDate, playIntakeFeedbackAnimation, markPageDirty],
  );

  const confirmDeleteIntakeRecord = React.useCallback(
    (recordId: string) => {
      if (!user?.id) return;
      const row = selectedDayRecords.find((r) => r.id === recordId);
      const quickAddByKey = createQuickAddItemMap(quickAddCatalog);
      const title = row ? combinedIntakeListTitle(row, quickAddByKey) : '这条记录';
      const timeHm = row ? formatStoredDatetimeHm(row.created_at) : '';
      const detail = row ? formatDeleteIntakeMergeDetail(row, timeHm) : '删除后无法恢复';
      const metric = row ? firstPositiveIntakeMetric(row) : 'calories';
      const iconColor = HealthNutrientAccents[metric];
      const icon: keyof typeof MaterialIcons.glyphMap = row?.source_image_uri?.trim()
        ? 'photo-camera'
        : metric === 'hydration'
          ? 'water-drop'
          : metric === 'protein'
            ? 'restaurant'
            : metric === 'carbohydrate'
              ? 'rice-bowl'
              : 'local-fire-department';
      const pointsDelta =
        metricPointsSettings.enabled && metricPointsSettings.rewardPoints > 0
          ? -Math.abs(metricPointsSettings.rewardPoints)
          : null;
      setDeleteConfirm({
        recordId,
        title,
        detail,
        icon,
        iconColor,
        pointsDelta,
      });
    },
    [
      user?.id,
      selectedDayRecords,
      quickAddCatalog,
      metricPointsSettings.enabled,
      metricPointsSettings.rewardPoints,
    ],
  );

  const handleRecordIntakeConfirm = React.useCallback(
    async (payload: RecordIntakeConfirmPayload) => {
      if (payload.mode === 'manual') {
        if (payload.amount <= 0 || !payload.type) return;
        await persistManualIntakeDelta(payload.type, payload.amount);
        return;
      }
      if (!user?.id) {
        toast.warn('请先完成用户资料后再试。');
        return;
      }
      if (pendingIntake) {
        toast.info('当前有一条摄入正在解析，请等待完成后再试。');
        return;
      }
      setSheetOpen(false);
      const pendingId = makeTimestampEntityId('pending_', 7);
      if (payload.mode === 'ai') {
        const text = payload.text.trim();
        if (!text) return;
        if (payload.parsed) {
          const finalized = finalizeFoodTextIntakeForRecord(text, payload.parsed);
          if (!finalized.ok) {
            toast.warn(finalized.error);
            return;
          }
          const d = finalized.data;
          const ok = await persistAiTextIntake(d.hydration_ml, d.protein_g, d.carbohydrate_g, d.calories_kcal, {
            displayTitle: text,
            aiComment: d.ai_evaluation?.trim(),
          });
          if (!ok) toast.error('保存失败，请稍后重试。');
          return;
        }
        setPendingIntake({ id: pendingId, kind: 'ai', label: text, startedAt: Date.now() });
        void (async () => {
          try {
            const r = await parseFoodIntakeFromText({ apiKey: getActiveAiLlmApiKey(), text });
            if (!r.ok) {
              toast.warn(r.error);
              return;
            }
            const d = r.data;
            const ok = await persistAiTextIntake(d.hydration_ml, d.protein_g, d.carbohydrate_g, d.calories_kcal, {
              displayTitle: text,
              aiComment: d.ai_evaluation?.trim(),
            });
            if (!ok) toast.error('保存失败，请稍后重试。');
          } catch (e) {
            toast.error(toUserMessage(e, '解析失败，请稍后重试。'));
          } finally {
            setPendingIntake(null);
          }
        })();
        return;
      }
      if (payload.mode === 'photo') {
        const photoNote = payload.photoNote?.trim() ?? '';
        // Sheet 内已预解析：直接落库（对齐设计稿 04，避免二次识图）
        if (payload.parsed) {
          const d = payload.parsed;
          const sum = d.protein_g + d.carbohydrate_g + d.calories_kcal + (d.hydration_ml || 0);
          if (sum <= 0) {
            toast.warn('营养均为 0，请调整数值或换一张更清晰的食物照片。');
            return;
          }
          const foodName = d.food_name?.trim() ?? '';
          const displayTitleRaw =
            photoNote.length > 0 ? (foodName.length > 0 ? `${photoNote} · ${foodName}` : photoNote) : foodName;
          const ok = await persistFoodPhotoIntake(
            d.protein_g,
            d.carbohydrate_g,
            d.calories_kcal,
            payload.sourceImageUri,
            {
              displayTitle: clampIntakeDisplayTitle(displayTitleRaw) ?? undefined,
              aiComment: d.ai_evaluation?.trim(),
              hydration: d.hydration_ml,
            },
          );
          if (!ok) toast.error('保存失败，请稍后重试。');
          return;
        }
        setPendingIntake({
          id: pendingId,
          kind: 'photo',
          label: photoNote.length > 0 ? photoNote : '拍照记录',
          startedAt: Date.now(),
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
              toast.error(r.error);
              return;
            }
            const d = r.data;
            const sum = d.protein_g + d.carbohydrate_g + d.calories_kcal;
            if (d.is_food !== 1 || sum <= 0) {
              const hint =
                d.is_food !== 1
                  ? `无法按食物记录（代码 ${d.non_food_code}），请换一张清晰的食物照片。`
                  : '估算营养均为 0，请换一张更清晰的食物照片。';
              toast.warn(hint);
              return;
            }
            const foodName = d.food_name?.trim() ?? '';
            const displayTitleRaw =
              photoNote.length > 0 ? (foodName.length > 0 ? `${photoNote} · ${foodName}` : photoNote) : foodName;
            await persistFoodPhotoIntake(d.protein_g, d.carbohydrate_g, d.calories_kcal, payload.sourceImageUri, {
              displayTitle: clampIntakeDisplayTitle(displayTitleRaw) ?? undefined,
              aiComment: d.ai_evaluation?.trim(),
            });
          } catch (e) {
            toast.error(toUserMessage(e, '识别失败，请稍后重试。'));
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
    const nowHm = (() => {
      const d = new Date();
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    })();
    const shortLabel = clampIntakeLabel(pendingIntake?.label ?? '', 22);
    const placeholderLine: IntakeListLine | null = pendingIntake
      ? {
          key: `${pendingIntake.id}-combined`,
          recordId: pendingIntake.id,
          metric: 'hydration',
          title: pendingIntake.kind === 'quick' ? '写入中…' : '解析中…',
          timeLine: nowHm,
          amountRight: '···',
          note:
            pendingIntake.kind === 'quick'
              ? `快捷卡 · ${shortLabel || '快速添加'}`
              : pendingIntake.kind === 'ai'
                ? `${shortLabel || '饮食描述'} · 正在估算四项数值`
                : `${shortLabel || '食物照片'} · 正在识别营养成分`,
          aiComment: '',
          sourceTag: '不可操作',
          icon: pendingIntake.kind === 'quick' ? 'bolt' : 'auto-awesome',
          iconBgLight: 'rgba(224, 179, 90, 0.22)',
          iconBgDark: 'rgba(224, 179, 90, 0.28)',
          iconColor: hh.amber,
          isPlaceholder: true,
        }
      : null;
    const merged = placeholderLine ? [placeholderLine, ...lines] : lines;
    const max = 6;
    return {
      lines: merged.slice(0, max),
      total: merged.length,
      hasMore: merged.length > max,
      showEmpty: lines.length === 0 && !placeholderLine,
    };
  }, [selectedDayRecords, quickAddCatalog, pendingIntake, hh.pine]);

  const recordIntakeSheetContext = React.useMemo(() => {
    const quickAddByKey = createQuickAddItemMap(quickAddCatalog);
    const phraseSeen = new Set<string>();
    const recentPhrases: string[] = [];
    for (const row of selectedDayRecords) {
      const title = combinedIntakeListTitle(row, quickAddByKey).trim();
      if (!title || title === '合并摄入' || title === 'AI 记录' || title === 'AI 拍照识别') continue;
      if (phraseSeen.has(title)) continue;
      phraseSeen.add(title);
      recentPhrases.push(title.length > 16 ? `${title.slice(0, 16)}…` : title);
      if (recentPhrases.length >= 6) break;
    }
    if (recentPhrases.length < 4) {
      for (const item of quickAddItems) {
        const label = item.label?.trim();
        if (!label || phraseSeen.has(label)) continue;
        phraseSeen.add(label);
        recentPhrases.push(label);
        if (recentPhrases.length >= 6) break;
      }
    }

    const recentPhotos: RecordIntakeRecentPhoto[] = [];
    for (const row of selectedDayRecords) {
      const imageUri = row.source_image_uri?.trim() || null;
      if (!imageUri) continue;
      const title = combinedIntakeListTitle(row, quickAddByKey).trim() || '拍照记录';
      const kcal = Math.round(Number(row.calories) || 0);
      recentPhotos.push({
        id: row.id,
        title: title.length > 18 ? `${title.slice(0, 18)}…` : title,
        timeLabel: formatStoredDatetimeHm(row.record_date) || formatStoredDatetimeHm(row.created_at) || '',
        caloriesLabel: kcal > 0 ? `${kcal} kcal` : '',
        imageUri,
      });
      if (recentPhotos.length >= 4) break;
    }

    const recentManuals: RecordIntakeRecentManual[] = [];
    const manualPool = [...healthRecords, ...prevWeekHealthRecords]
      .filter((row) => {
        if (row.source_image_uri?.trim()) return false;
        if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) return false;
        if (row.quick_add_key) return false;
        return positiveNutrientKindsCount(row) === 1;
      })
      .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at));
    for (const row of manualPool) {
      const meta = manualTypeMetaFromRow(row);
      if (!meta) continue;
      recentManuals.push({
        id: row.id,
        type: meta.type,
        label: meta.label,
        amount: meta.amount,
        amountLabel: meta.amountLabel,
        timeLabel: formatRelativeIntakeTimeLabel(row.record_date, row.created_at, calendarTodayYmd),
      });
      if (recentManuals.length >= 3) break;
    }

    const waterCupItem =
      quickAddCatalog.find((item) => getQuickAddMetricTypes(item).includes('hydration')) ??
      quickAddItems.find((item) => getQuickAddMetricTypes(item).includes('hydration'));
    const waterCupMl = waterCupItem ? getQuickAddMetricAmount(waterCupItem, 'hydration') : 250;

    return {
      dateLabel: formatHeaderDate(selectedDate),
      todayRecordCount: selectedDayRecords.length,
      dayTotals: selectedDayIntakeTotals,
      intakeTargets: {
        hydration: intakeTargetsSnapshot.hydrationMl,
        protein: intakeTargetsSnapshot.proteinG,
        carbohydrate: intakeTargetsSnapshot.carbohydrateG,
        calories: intakeTargetsSnapshot.caloriesKcal,
      },
      waterCupMl,
      recentPhrases,
      recentPhotos,
      recentManuals,
    };
  }, [
    selectedDayRecords,
    quickAddCatalog,
    quickAddItems,
    selectedDate,
    selectedDayIntakeTotals,
    healthRecords,
    prevWeekHealthRecords,
    calendarTodayYmd,
    intakeTargetsSnapshot,
  ]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [weekPagerWidth]);

  React.useEffect(() => {
    const anims = quickAddCardAnimsRef.current;
    while (anims.length < quickAddItems.length) {
      anims.push(new Animated.Value(motionReduced ? 1 : 0));
    }
    for (let i = 0; i < quickAddItems.length; i++) {
      ensureQuickAddPressAnim(i);
    }
  }, [quickAddItems.length, ensureQuickAddPressAnim, motionReduced]);

  const playTrendBarGrow = React.useCallback(() => {
    if (motionReduced) {
      trendBarAnimsRef.forEach((a) => a.setValue(1));
      return;
    }
    trendBarAnimsRef.forEach((a) => a.setValue(0));
    // 设计稿动效 13：28 柱 scaleY 生长，水→蛋白→碳水→热量错峰 12ms，总时长 700ms
    Animated.parallel(
      trendBarAnimsRef.map((anim, i) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 700,
          delay: 200 + i * 12,
          easing: HEALTH_MOTION_EASE,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [motionReduced, trendBarAnimsRef]);

  const playTrendBarPulse = React.useCallback(
    (dayIndex: number) => {
      setTrendPulseIndex(dayIndex);
      if (motionReduced) {
        trendPulseAnim.setValue(1);
        return;
      }
      trendPulseAnim.setValue(1);
      Animated.sequence([
        Animated.timing(trendPulseAnim, {
          toValue: 1.08,
          duration: 220,
          easing: HEALTH_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(trendPulseAnim, {
          toValue: 1,
          duration: 230,
          easing: HEALTH_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setTrendPulseIndex(null);
      });
    },
    [motionReduced, trendPulseAnim],
  );

  const playHomeSectionEnterAnimation = React.useCallback(() => {
    const lineCount = 8;
    while (timelineEnterAnimsRef.current.length < lineCount) {
      timelineEnterAnimsRef.current.push(new Animated.Value(1));
    }
    const quickCount = Math.max(1, quickAddCardAnimsRef.current.length);

    if (motionReduced) {
      metricEnterAnims.forEach((a) => a.setValue(1));
      quickAddCardAnimsRef.current.forEach((a) => a.setValue(1));
      timelineEnterAnimsRef.current.forEach((a) => a.setValue(1));
      trendBarAnimsRef.forEach((a) => a.setValue(1));
      return;
    }

    metricEnterAnims.forEach((a) => a.setValue(0));
    quickAddCardAnimsRef.current.forEach((a) => a.setValue(0));
    timelineEnterAnimsRef.current.forEach((a) => a.setValue(0));

    Animated.parallel([
      Animated.stagger(
        70,
        metricEnterAnims.map((anim) =>
          Animated.timing(anim, {
            toValue: 1,
            duration: 500,
            easing: HEALTH_MOTION_EASE,
            useNativeDriver: true,
          }),
        ),
      ),
      Animated.stagger(
        45,
        quickAddCardAnimsRef.current.slice(0, quickCount).map((anim) =>
          Animated.timing(anim, {
            toValue: 1,
            duration: 420,
            delay: 180,
            easing: HEALTH_MOTION_EASE,
            useNativeDriver: true,
          }),
        ),
      ),
      Animated.stagger(
        45,
        timelineEnterAnimsRef.current.slice(0, lineCount).map((anim) =>
          Animated.timing(anim, {
            toValue: 1,
            duration: 400,
            delay: 200,
            easing: HEALTH_MOTION_EASE,
            useNativeDriver: true,
          }),
        ),
      ),
    ]).start();
    playTrendBarGrow();
  }, [motionReduced, metricEnterAnims, trendBarAnimsRef, playTrendBarGrow]);

  React.useEffect(() => {
    if (skeletonPending) return;
    // 首次出骨架：级联入场；之后切日只做数字滚动 + 卡片脉冲（见 playIntakeFeedbackAnimation）
    if (!homeEnterPlayedRef.current) {
      homeEnterPlayedRef.current = true;
      prevSelectedDayYmdRef.current = formatLocalYmd(selectedDate);
      prevWeekAnchorYmdForTrendRef.current = formatLocalYmd(weekAnchorDate);
      playHomeSectionEnterAnimation();
      return;
    }
    const weekYmd = formatLocalYmd(weekAnchorDate);
    if (weekYmd !== prevWeekAnchorYmdForTrendRef.current) {
      prevWeekAnchorYmdForTrendRef.current = weekYmd;
      prevSelectedDayYmdRef.current = formatLocalYmd(selectedDate);
      setTrendDeltaOverride(null);
      setChartTipText(null);
      playTrendBarGrow();
      return;
    }
    const ymd = formatLocalYmd(selectedDate);
    if (ymd === prevSelectedDayYmdRef.current) return;
    prevSelectedDayYmdRef.current = ymd;
    metricEnterAnims.forEach((a) => a.setValue(1));
    quickAddCardAnimsRef.current.forEach((a) => a.setValue(1));
    timelineEnterAnimsRef.current.forEach((a) => a.setValue(1));
    playIntakeFeedbackAnimation();
  }, [
    selectedDate,
    weekAnchorDate,
    skeletonPending,
    playHomeSectionEnterAnimation,
    playIntakeFeedbackAnimation,
    playTrendBarGrow,
    metricEnterAnims,
  ]);

  React.useEffect(() => {
    return () => {
      if (quickSuccessTimerRef.current) clearTimeout(quickSuccessTimerRef.current);
      if (chartTipTimerRef.current) clearTimeout(chartTipTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    // 设计稿 14：解析中 FAB 停跳变灰
    if (!motionReady || reduceMotion || intakeParseLocked) {
      ctaScaleAnim.stopAnimation();
      ctaScaleAnim.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaScaleAnim, {
          toValue: 1.035,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ctaScaleAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => {
      pulse.stop();
      ctaScaleAnim.stopAnimation();
    };
  }, [ctaScaleAnim, intakeParseLocked, motionReady, reduceMotion]);

  const assistantTheme = {
    水分: {
      accent: HealthNutrientAccents.hydration,
      unit: 'ml',
      placeholder: '2500',
      best: '2,850',
      community: '2,200',
    },
    蛋白质: {
      accent: HealthNutrientAccents.protein,
      unit: 'g',
      placeholder: '80',
      best: '75',
      community: '70',
    },
    碳水: {
      accent: HealthNutrientAccents.carbohydrate,
      unit: 'g',
      placeholder: '260',
      best: '280',
      community: '260',
    },
    热量: {
      accent: HealthNutrientAccents.calories,
      unit: 'kcal',
      placeholder: '2000',
      best: '2,000',
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
      selectedDayIntakeTotals?.calories ?? 0
    );
    const metrics = adjustNutritionMetricsForDaySchedule(
      base,
      getUserDayScheduleKind(user, calendarTodayYmd),
    );

    if (assistantTab === '水分') return metrics.Water_ml;
    if (assistantTab === '蛋白质') return metrics.Protein_g;
    if (assistantTab === '碳水') return metrics.Carbohydrate_g;
    return metrics.Calories_kcal;
  }, [assistantTab, user, selectedDayIntakeTotals?.calories, calendarTodayYmd]);


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
      if (assistantTab === '热量') {
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
    if (assistantTab === '热量') {
      return (2000+(healthRecords.reduce((acc, curr) => acc + curr.calories, 0) / healthRecords.length))/2;
    }
    return 0;
  }, [assistantTab, healthRecords, user]);

  const suggestNumeric = React.useMemo(() => {
    const fallbackBest = Math.round(Number(bestValue) || 0);
    const ai =
      dailyAiTargets != null && !dailyAiLoading
        ? Math.round(dailyAiTargetForTab(dailyAiTargets, assistantTab))
        : null;
    const best = ai != null && ai > 0 ? ai : fallbackBest;
    return {
      best,
      community: Math.round(Number(communityValue) || 0),
    };
  }, [assistantTab, bestValue, communityValue, dailyAiTargets, dailyAiLoading]);

  const todayScheduleLabel = React.useMemo(() => {
    if (!user) return null;
    const kind = getUserDayScheduleKind(user, calendarTodayYmd);
    if (kind === 'sedentary') return null;
    return getUserDayScheduleLabelZh(kind);
  }, [user, calendarTodayYmd]);

  const selectedIsToday = formatLocalYmd(selectedDate) === calendarTodayYmd;

  const headerEyebrow = React.useMemo(() => {
    if (intakeParseLocked) return 'HEALTH / PARSING';
    if (skeletonPending || pageLoadError) return 'HEALTH / LOADING';
    if (quickAddEmpty) return 'HEALTH / QUICK ADD';
    if (selectedIsToday) return 'HEALTH / DAILY INTAKE';
    return 'TODAY / CONTINUED';
  }, [intakeParseLocked, skeletonPending, pageLoadError, quickAddEmpty, selectedIsToday]);

  const headerStatusDotColor = React.useMemo(() => {
    if (intakeParseLocked) return '#E0A04A';
    if (pageLoadError) return '#C45C4A';
    return hh.sage;
  }, [intakeParseLocked, pageLoadError, hh.sage]);

  const headerStatusLine = React.useMemo(() => {
    if (intakeParseLocked) {
      return pendingIntake?.kind === 'quick' ? '快捷卡写入中 · 请稍候' : 'AI 正在解析 · 请稍候';
    }
    if (pageLoadError) return '云端数据加载失败 · 本地缓存';
    if (skeletonPending) return '正在同步健康数据…';
    if (quickAddEmpty) return '还没有快捷卡，先建一张';
    const boundaryLabel = `逻辑日 ${pad2(healthDayBoundary.hour)}:${pad2(healthDayBoundary.minute)} 起`;
    if (selectedIsToday) {
      const parts = ['今天'];
      if (todayScheduleLabel) parts.push(todayScheduleLabel);
      parts.push(boundaryLabel);
      return parts.join(' · ');
    }
    return `记录与趋势 · 逻辑日 ${selectedDate.getMonth() + 1}/${selectedDate.getDate()}`;
  }, [
    intakeParseLocked,
    pendingIntake?.kind,
    pageLoadError,
    skeletonPending,
    quickAddEmpty,
    healthDayBoundary.hour,
    healthDayBoundary.minute,
    selectedDate,
    selectedIsToday,
    todayScheduleLabel,
  ]);

  const refreshQuickAddLists = React.useCallback(async () => {
    const [selectedItems, catalog] = await Promise.all([loadSelectedQuickAddItems(), loadAllQuickAddItems()]);
    setQuickAddItems(selectedItems);
    setQuickAddCatalog(catalog);
  }, []);

  const onEnableQuickAddStarter = React.useCallback(
    async (starterKey: string) => {
      if (intakeParseLocked || addingStarterKey) return;
      setAddingStarterKey(starterKey);
      try {
        const item = await enableQuickAddStarter(starterKey);
        await refreshQuickAddLists();
        toast.success(`已添加「${item.label}」`);
      } catch (e) {
        toast.error(toUserMessage(e, '添加失败，请稍后重试'));
      } finally {
        setAddingStarterKey(null);
      }
    },
    [addingStarterKey, intakeParseLocked, refreshQuickAddLists],
  );

  const parseToastLabel = React.useMemo(() => {
    if (!pendingIntake) return '';
    const clipped = clampIntakeLabel(pendingIntake.label, 20);
    if (pendingIntake.kind === 'quick') {
      return clipped ? `正在写入「${clipped}」…` : '正在写入快捷卡…';
    }
    if (pendingIntake.kind === 'photo') {
      return clipped ? `正在识别「${clipped}」…` : '正在识别食物照片…';
    }
    return clipped ? `正在解析「${clipped}」…` : '正在解析饮食描述…';
  }, [pendingIntake]);

  const parseElapsedLabel = React.useMemo(() => {
    if (parseElapsedSec < 10) return `${parseElapsedSec.toFixed(1)}s`;
    return `${Math.round(parseElapsedSec)}s`;
  }, [parseElapsedSec]);

  const weekRecordYmds = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of healthRecords) {
      const ymd = typeof row.record_date === 'string' ? row.record_date.slice(0, 10) : '';
      if (ymd) set.add(ymd);
    }
    return set;
  }, [healthRecords]);

  const assistantContextRows = React.useMemo((): IntakeAssistantContextRow[] => {
    if (!user) return [];
    const rows: IntakeAssistantContextRow[] = [];
    const kind = getUserDayScheduleKind(user, calendarTodayYmd);
    const scheduleLabel = getUserDayScheduleLabelZh(kind);
    rows.push({
      label: '日程类型',
      value: kind === 'sedentary' ? '日常作息' : scheduleLabel,
    });
    const weight = Number(user.weight);
    const goalLabel = user.goal?.trim() || '维持';
    rows.push({
      label: '身体数据',
      value:
        Number.isFinite(weight) && weight > 0
          ? `${weight.toFixed(1)} kg · ${goalLabel}`
          : goalLabel,
    });

    const todayDate = parseYmdToLocalDate(calendarTodayYmd);
    if (todayDate) {
      let proteinSum = 0;
      let dayCount = 0;
      for (let i = 1; i <= 3; i += 1) {
        const ymd = formatYmd(addDays(todayDate, -i));
        const dayRows = pickHealthRecordsForYmd(ymd, healthRecords, prevWeekHealthRecords);
        if (dayRows.length === 0) continue;
        proteinSum += sumHealthRecordsDayTotals(dayRows).protein;
        dayCount += 1;
      }
      const targetP = intakeTargetsSnapshot.proteinG;
      if (dayCount > 0 && targetP > 0) {
        const pct = Math.round((proteinSum / (targetP * dayCount)) * 100);
        rows.push({ label: '近 3 日', value: `蛋白质达成 ${pct}%` });
      }
    }
    return rows;
  }, [user, calendarTodayYmd, healthRecords, prevWeekHealthRecords, intakeTargetsSnapshot.proteinG]);

  const assistantOtherGoals = React.useMemo((): IntakeAssistantOtherGoal[] => {
    const all: { tab: IntakeAssistantUiTab; label: string; value: number; unit: string }[] = [
      { tab: '水分', label: '水分', value: intakeTargetsSnapshot.hydrationMl, unit: 'ml' },
      { tab: '蛋白质', label: '蛋白质', value: intakeTargetsSnapshot.proteinG, unit: 'g' },
      { tab: '碳水', label: '碳水', value: intakeTargetsSnapshot.carbohydrateG, unit: 'g' },
      { tab: '热量', label: '热量', value: intakeTargetsSnapshot.caloriesKcal, unit: 'kcal' },
    ];
    return all
      .filter((item) => item.tab !== assistantTab)
      .map((item) => ({
        label: item.label,
        valueLabel: `${formatIntakeLocale(item.value)} ${item.unit}`,
      }));
  }, [assistantTab, intakeTargetsSnapshot]);

  const assistantLocalFormula = React.useMemo((): IntakeAssistantLocalFormula | null => {
    if (!user) return null;
    if (dailyAiTargets) return null;
    const bmr = estimateBmrKcal(user);
    const factor = nutritionActivityFactor(user.lifestyle);
    const base = calculateNutritionV2(
      user.weight ?? 0,
      user.height ?? 0,
      user.age ?? 0,
      mapGenderToNutritionGender(user.gender),
      mapLifestyleToActivityLevel(user.lifestyle),
      mapGoalToNutritionGoal(user.goal),
      selectedDayIntakeTotals?.calories ?? 0,
    );
    const kind = getUserDayScheduleKind(user, calendarTodayYmd);
    const adjusted = adjustNutritionMetricsForDaySchedule(base, kind);
    const trainDelta = adjusted.Calories_kcal - Math.round(bmr * factor);
    const todayIntake = Math.round(selectedDayIntakeTotals?.calories ?? 0);
    const bestKcal = Math.round(suggestNumeric.best);
    const remain = Math.max(0, bestKcal - todayIntake);
    const trainPart =
      kind === 'workout'
        ? ` + 训练日 ${trainDelta >= 0 ? '+' : ''}${trainDelta} kcal`
        : kind === 'rest'
          ? ` + 休息日微调 ${trainDelta >= 0 ? '+' : ''}${trainDelta} kcal`
          : '';
    return {
      estimateLine: `估算：基础代谢 ${formatIntakeLocale(bmr)} kcal × 活动系数 ${factor}${trainPart}。`,
      intakeRemainLine: `今天已摄入 ${formatIntakeLocale(todayIntake)} kcal，剩余 ${formatIntakeLocale(remain)} kcal。`,
      rows: [
        { label: '基础代谢', value: `${formatIntakeLocale(bmr)} kcal` },
        {
          label: '活动系数',
          value:
            kind === 'workout'
              ? `${factor} · 训练 +${Math.max(0, trainDelta)}`
              : String(factor),
        },
        { label: '今日目标', value: `${formatIntakeLocale(bestKcal)} kcal` },
      ],
    };
  }, [
    user,
    dailyAiTargets,
    calendarTodayYmd,
    selectedDayIntakeTotals?.calories,
    suggestNumeric.best,
  ]);

  const assistantSubtitle = React.useMemo(() => {
    if (!dailyAiTargets && !isActiveAiLlmConfigured()) return '本地估算';
    const d = parseYmdToLocalDate(calendarTodayYmd) ?? selectedDate;
    return formatHeaderDate(d);
  }, [dailyAiTargets, calendarTodayYmd, selectedDate]);

  const assistantRememberedHint = React.useMemo(() => {
    const kindLabel =
      assistantSuggestSelection === 'best'
        ? '今日最佳'
        : assistantSuggestSelection === 'community'
          ? '社群达标'
          : '手动输入';
    return `已记住：${assistantTab} → ${kindLabel}。下次打开会回到这个候选。`;
  }, [assistantSuggestSelection, assistantTab]);

  const openAiConfigFromAssistant = React.useCallback(() => {
    setAssistantOpen(false);
    router.push('/(tabs)/profile' as Href);
  }, [router]);

  const applyAssistantSelectionForTab = React.useCallback(
    (tab: IntakeAssistantUiTab) => {
      const selection = getIntakeAssistantSelection(tab);
      setAssistantSuggestSelection(selection.kind);
      setManualGoal(resolveManualGoalForSelection(tab, selection, suggestNumeric));
    },
    [suggestNumeric],
  );

  React.useEffect(() => {
    if (!assistantOpen) return;
    applyAssistantSelectionForTab(assistantTab);
  }, [assistantOpen, assistantTab, applyAssistantSelectionForTab]);

  const selectAssistantSuggestKind = React.useCallback(
    (kind: AssistantSuggestKind) => {
      setAssistantSuggestSelection(kind);
      if (kind === 'manual') {
        const existing = getIntakeAssistantSelection(assistantTab);
        const fallback =
          existing.kind === 'manual' && existing.manualValue != null
            ? existing.manualValue
            : globalIntakeTargetForTab(assistantTab);
        const sanitized = sanitizeAssistantManualGoalInput(String(fallback));
        setManualGoal(sanitized);
        const n = parseGoalInput(sanitized);
        setIntakeAssistantSelection(assistantTab, {
          kind: 'manual',
          manualValue: n ?? fallback,
        });
        return;
      }
      const value = suggestNumeric[kind];
      setManualGoal(sanitizeAssistantManualGoalInput(String(value)));
      setIntakeAssistantSelection(assistantTab, { kind });
    },
    [assistantTab, suggestNumeric],
  );

  const onAssistantManualGoalChange = React.useCallback(
    (text: string) => {
      const sanitized = sanitizeAssistantManualGoalInput(text);
      setManualGoal(sanitized);
      setAssistantSuggestSelection('manual');
      const n = parseGoalInput(sanitized);
      setIntakeAssistantSelection(assistantTab, {
        kind: 'manual',
        manualValue: n ?? undefined,
      });
    },
    [assistantTab],
  );

  const dismissAssistantModal = React.useCallback(() => {
    setAssistantOpen(false);
  }, []);

  const saveAssistantModal = React.useCallback(() => {
    const n = parseGoalInput(manualGoal);
    if (n !== null) {
      const rounded = Math.round(n);
      if (rounded !== globalIntakeTargetForTab(assistantTab)) {
        markPageDirty();
      }
      if (assistantTab === '水分') setGlobalHydrationTargetMl(rounded);
      if (assistantTab === '蛋白质') setGlobalProteinTargetG(rounded);
      if (assistantTab === '碳水') setGlobalCarbohydrateTargetG(rounded);
      if (assistantTab === '热量') setGlobalCaloriesTargetKcal(rounded);
      if (assistantSuggestSelection === 'manual') {
        setIntakeAssistantSelection(assistantTab, { kind: 'manual', manualValue: rounded });
      }
      setIntakeTargetTick((t) => t + 1);
    }
    setAssistantOpen(false);
  }, [assistantSuggestSelection, assistantTab, manualGoal, markPageDirty]);

  const weekNavLabel = React.useMemo(
    () => formatWeekNavLabel(weekDaysCurrent, today),
    [weekDaysCurrent, today],
  );

  const canGoNextWeek = !isFutureDate(addDays(weekAnchorDate, 7), today);

  const goPrevWeek = React.useCallback(() => {
    const nextAnchor = addDays(weekAnchorDate, -7);
    setWeekAnchorDate(nextAnchor);
    if (selectedDate > weekAnchorDate) {
      setSelectedDate(nextAnchor);
    }
    weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
  }, [weekAnchorDate, selectedDate, weekPagerWidth]);

  const goNextWeek = React.useCallback(() => {
    const nextAnchor = addDays(weekAnchorDate, 7);
    if (isFutureDate(nextAnchor, today)) return;
    setWeekAnchorDate(nextAnchor);
    if (selectedDate < weekAnchorDate) {
      setSelectedDate(nextAnchor);
    }
    weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
  }, [weekAnchorDate, selectedDate, today, weekPagerWidth]);

  const syncStatusLabel = React.useMemo(() => {
    if (!lastSyncedAt) return '本地优先 · 待同步';
    return `本地优先 · ${pad2(lastSyncedAt.getHours())}:${pad2(lastSyncedAt.getMinutes())} 已同步`;
  }, [lastSyncedAt]);

  const onWeekPagerEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;

    if (x < weekPagerWidth * 0.5) {
      goPrevWeek();
      return;
    }

    if (x > weekPagerWidth * 1.5) {
      if (!canGoNextWeek) {
        weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
        return;
      }
      goNextWeek();
    }
  };

  return (
    <View ref={screenRootRef} style={styles.safeArea} collapsable={false}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: hh.paper }]} edges={['left', 'right']}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: hh.paper,
            borderBottomColor: hh.line,
            paddingTop: insets.top,
          },
        ]}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleBlock}>
            <Text style={[styles.headerEyebrow, { color: hh.muted }]}>{headerEyebrow}</Text>
            <Text style={[styles.headerTitle, { color: hh.ink, fontFamily: hhFonts.serif }]}>
              {formatHeaderDate(selectedDate)}
            </Text>
            <View style={styles.headerStatusRow}>
              <HealthPulseDot
                color={headerStatusDotColor}
                active={intakeParseLocked}
                size={6}
                style={styles.headerStatusDot}
              />
              <Text style={[styles.headerStatusText, { color: hh.inkSoft }]} numberOfLines={1}>
                {headerStatusLine}
              </Text>
            </View>
          </View>
          <AppIconButton
            icon="settings"
            onPress={openPointsSettingsModal}
            accessibilityLabel="健康指标积分设置"
          />
        </View>

        <View style={styles.weekNavRow}>
          <Pressable
            onPress={goPrevWeek}
            hitSlop={10}
            style={({ pressed }) => [styles.weekNavBtn, { opacity: pressed ? 0.55 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="上一周"
          >
            <MaterialIcons name="chevron-left" size={18} color={hh.inkSoft} />
          </Pressable>
          <Text style={[styles.weekNavLabel, { color: hh.ink }]} numberOfLines={1}>
            {weekNavLabel}
          </Text>
          <Pressable
            onPress={goNextWeek}
            disabled={!canGoNextWeek}
            hitSlop={10}
            style={({ pressed }) => [
              styles.weekNavBtn,
              { opacity: !canGoNextWeek ? 0.28 : pressed ? 0.55 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="下一周"
            accessibilityState={{ disabled: !canGoNextWeek }}
          >
            <MaterialIcons name="chevron-right" size={18} color={hh.inkSoft} />
          </Pressable>
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
                  const hasRecord = weekRecordYmds.has(formatLocalYmd(normalizedItemDate));

                  return (
                    <TouchableOpacity
                      key={item.key}
                      activeOpacity={0.85}
                      disabled={disabled}
                      onPress={() => {
                        if (disabled) return;
                        if (motionReduced) {
                          selectedDayPopAnim.setValue(1);
                        } else {
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
                        }

                        setSelectedDate(normalizedItemDate);
                        // 周条切日：恢复环比文案（点柱才切换为「某日 · 完成度」）
                        setTrendDeltaOverride(null);
                        setChartTipText(null);
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
                          backgroundColor: isActive ? hh.pine : 'transparent',
                          opacity: disabled ? 0.4 : 1,
                        },
                      ]}
                    >
                      <Animated.View
                        style={[
                          styles.weekDayContent,
                          isActive ? { transform: [{ scale: selectedDayPopAnim }] } : undefined,
                        ]}
                      >
                        <Text style={[styles.weekDayLabel, { color: isActive ? hh.onPine : hh.muted }]}>{item.label}</Text>
                        <Text style={[styles.weekDayDate, { color: isActive ? hh.onPine : hh.ink }]}>{item.day}</Text>
                        <View
                          style={[
                            styles.weekDayDot,
                            {
                              backgroundColor: isActive
                                ? hh.amber
                                : hasRecord
                                  ? hh.sage
                                  : 'transparent',
                            },
                          ]}
                        />
                      </Animated.View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.syncStatusRow}>
          <Pressable
            onPress={() => {
              void (async () => {
                clearPageLoadedInSession(PAGE_API_KEY);
                const { refreshFromUser } = await import('@/lib/sync-manager');
                await refreshFromUser();
                await reloadPage(false);
              })();
            }}
            hitSlop={8}
            style={({ pressed }) => [styles.syncStatusLeft, { opacity: pressed ? 0.65 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="同步健康数据"
          >
            <MaterialIcons name="sync" size={12} color={hh.muted} />
            <Text style={[styles.syncStatusText, { color: hh.muted }]} numberOfLines={1}>
              {syncStatusLabel}
            </Text>
          </Pressable>
          <Text style={[styles.syncStatusHint, { color: hh.faint }]}>下拉刷新</Text>
        </View>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: glassTabBarContentInset(insets.bottom) + 12 },
        ]}
        showsVerticalScrollIndicator={false}
        directionalLockEnabled
        keyboardShouldPersistTaps="handled"
        onScroll={e => reportTabBarScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        {pageLoadError ? (
          <View style={[styles.loadErrorBanner, { backgroundColor: 'rgba(197, 78, 78, 0.1)' }]}>
            <MaterialIcons name="cloud-off" size={20} color="#A54E4E" />
            <View style={styles.loadErrorTextCol}>
              <Text style={[styles.loadErrorTitle, { color: '#A54E4E' }]}>云端数据加载失败</Text>
              <Text style={[styles.loadErrorText, { color: '#A54E4E' }]}>
                已展示本地缓存 · 摄入与快捷卡
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.75}
              disabled={pageLoadRetrying}
              onPress={() => {
                clearPageLoadedInSession(PAGE_API_KEY);
                void (async () => {
                  const { refreshFromUser } = await import('@/lib/sync-manager');
                  await refreshFromUser();
                  await reloadPage(true);
                })();
              }}
              style={[styles.loadErrorRetryBtn, { borderColor: 'rgba(165, 78, 78, 0.45)' }]}
              accessibilityRole="button"
              accessibilityLabel="重试加载健康数据"
            >
              {pageLoadRetrying ? (
                <ActivityIndicator size="small" color="#A54E4E" />
              ) : (
                <Text style={[styles.loadErrorRetryText, { color: '#A54E4E' }]}>重试</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.healthBodyStack}>
          {!skeletonPending ? (
              <View style={styles.sectionStack}>
        <View style={styles.sectionPanel}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={[styles.sectionTitle, { color: hh.ink }]}>今日概况</Text>
            <Text style={[styles.sectionSub, { color: hh.muted }]}>4 项营养 · 目标快照</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.75}
            hitSlop={Layout.hitSlop}
            onPress={() => setAssistantOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="调整今日目标"
            style={styles.sectionActionRow}
          >
            <Text style={[styles.editBtn, { color: hh.pine, marginTop: 0 }]}>目标</Text>
            <MaterialIcons name="chevron-right" size={14} color={hh.pine} />
          </TouchableOpacity>
        </View>
        <View style={styles.metricsGrid}>
          {nutrientMetricMeta.map((item, index) => {
            const row = dayIntakeDisplay[item.key];
            const displayTarget = row.target;
            const targetPercent = metricPercents[item.key];
            const statusDesc = metricStatusDesc(
              item.key,
              row.current,
              displayTarget,
              row.percent,
              dayCalorieDeficit,
            );

            const openAssistantByCard = () => {
              if (item.key === 'hydration') setAssistantTab('水分');
              if (item.key === 'protein') setAssistantTab('蛋白质');
              if (item.key === 'calories') setAssistantTab('热量');
              if (item.key === 'carbohydrate') setAssistantTab('碳水');
              setAssistantOpen(true);
            };

            const impactScale = metricImpactAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.03],
            });
            const impactLift = metricImpactAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [0, -3],
            });
            const enterOpacity = metricEnterAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1],
            });
            const enterTranslateY = metricEnterAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [12, 0],
            });

            return (
              <Pressable
                key={item.key}
                onPress={openAssistantByCard}
                accessibilityRole="button"
                accessibilityLabel={`${item.label}今日概况，点按调整目标`}
                style={({ pressed }) => [{ width: metricCardWidth, opacity: pressed ? 0.9 : 1 }]}
              >
                <Animated.View
                  style={{
                    opacity: enterOpacity,
                    transform: [
                      { translateY: Animated.add(impactLift, enterTranslateY) },
                      { scale: impactScale },
                    ],
                  }}
                >
                  <View
                    style={[
                      styles.metricCard,
                      {
                        backgroundColor: isDark ? hh.cardMuted : hh.card,
                        borderColor: hh.line,
                        width: metricCardWidth,
                      },
                    ]}
                  >
                    <View style={styles.metricCardTop}>
                      <View style={styles.metricLabelRow}>
                        <MaterialIcons name={item.icon} size={16} color={item.accent} />
                        <Text style={[styles.metricLabel, { color: hh.inkSoft }]}>{item.label}</Text>
                      </View>
                      <AnimatedPercentText
                        value={targetPercent}
                        reduced={motionReduced}
                        style={[styles.metricValue, { color: item.accent }]}
                      />
                    </View>
                    <View style={styles.metricCardBody}>
                      <CircularProgress
                        percentage={targetPercent}
                        icon={item.icon}
                        color={item.accent}
                        trackColor={hh.track}
                        size={56}
                        strokeWidth={5}
                        centerMode="percent"
                        percentColor={hh.ink}
                        reducedMotion={motionReduced}
                      />
                      <View style={styles.metricCardTextCol}>
                        <Text style={[styles.metricSubValue, { color: hh.ink }]} numberOfLines={1}>
                          {formatIntakeLocale(row.current)} / {formatIntakeLocale(displayTarget)} {item.unit}
                        </Text>
                        <Text style={[styles.metricStatusHint, { color: hh.muted }]} numberOfLines={2}>
                          {statusDesc}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.metricTrackWrap, styles.metricTrackWrapTall]}>
                      <StatusTrackWithThreshold
                        percent={metricPercents[item.key]}
                        color={item.accent}
                        trackBg={hh.track}
                        thresholdPercent={metricPointsSettings.thresholdPercent}
                        thresholdValueLabel={thresholdValueLabels[item.key]}
                        showThreshold
                      />
                    </View>
                  </View>
                </Animated.View>
              </Pressable>
            );
          })}
        </View>
        </View>

        <View>
        <View
          style={[
            styles.sectionPanel,
            { opacity: intakeParseLocked ? 0.72 : 1 },
          ]}
        >
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.quickAddTitleRow}>
                <Text style={[styles.sectionTitle, { color: hh.ink }]}>快速添加</Text>
                {quickAddEmpty ? (
                  <View style={[styles.quickAddEmptyBadge, { backgroundColor: hh.cardMuted }]}>
                    <Text style={[styles.quickAddEmptyBadgeText, { color: hh.faint }]}>空态</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.sectionSub, { color: intakeParseLocked ? '#C47852' : hh.muted }]}>
                {intakeParseLocked
                  ? '解析完成前不可用'
                  : quickAddEmpty
                    ? '添加后点一下就能记录'
                    : '点一下，立即写入'}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.75}
              disabled={intakeParseLocked}
              onPress={() => {
                if (intakeParseLocked) return;
                router.push('/quick-add-edit');
              }}
              style={styles.quickAddManageBtn}
              accessibilityRole="button"
              accessibilityLabel={quickAddEmpty ? '管理快捷卡' : '编辑快捷卡'}
            >
              <MaterialIcons name="edit" size={14} color={intakeParseLocked ? hh.faint : hh.pine} />
              <Text style={[styles.editBtn, { color: intakeParseLocked ? hh.faint : hh.pine, marginTop: 0 }]}>
                {quickAddEmpty ? '管理' : '编辑'}
              </Text>
            </TouchableOpacity>
          </View>

          {quickAddEmpty ? (
            <View style={styles.quickAddEmptyStack}>
              <Pressable
                onPress={() => {
                  if (intakeParseLocked) return;
                  router.push('/add-item');
                }}
                disabled={intakeParseLocked}
                style={({ pressed }) => [
                  styles.quickAddEmptyBox,
                  {
                    backgroundColor: hh.cardMuted,
                    borderColor: hh.lineStrong,
                    opacity: intakeParseLocked ? 0.55 : pressed ? 0.88 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="新建快捷卡"
              >
                <View style={[styles.quickAddEmptyPlus, { backgroundColor: hh.sageSoft }]}>
                  <MaterialIcons name="add" size={20} color={hh.pine} />
                </View>
                <Text style={[styles.quickAddEmptyText, { color: hh.muted }]}>
                  还没有快捷卡，添加后点一下就能记录
                </Text>
              </Pressable>

              <View style={[styles.quickAddStarterCard, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
                <View style={styles.quickAddStarterHeader}>
                  <Text style={[styles.quickAddStarterTitle, { color: hh.ink }]}>从这三张开始</Text>
                  <Text style={[styles.quickAddStarterSide, { color: hh.faint }]}>常喝 / 常吃</Text>
                </View>
                {QUICK_ADD_STARTER_SUGGESTIONS.map((starter, index) => {
                  const busy = addingStarterKey === starter.starterKey;
                  const locked = intakeParseLocked || Boolean(addingStarterKey);
                  return (
                    <View
                      key={starter.starterKey}
                      style={[
                        styles.quickAddStarterRow,
                        index < QUICK_ADD_STARTER_SUGGESTIONS.length - 1
                          ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: hh.line }
                          : null,
                      ]}
                    >
                      <View style={[styles.quickAddStarterIcon, { backgroundColor: hh.card }]}>
                        <MaterialIcons
                          name={starter.icon as keyof typeof MaterialIcons.glyphMap}
                          size={18}
                          color={hh.pine}
                        />
                      </View>
                      <View style={styles.quickAddStarterText}>
                        <Text style={[styles.quickAddStarterLabel, { color: hh.ink }]} numberOfLines={1}>
                          {starter.label}
                        </Text>
                        <Text style={[styles.quickAddStarterAmount, { color: hh.muted }]}>
                          {starter.amountLabel}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => void onEnableQuickAddStarter(starter.starterKey)}
                        disabled={locked}
                        style={({ pressed }) => [
                          styles.quickAddStarterAddBtn,
                          {
                            backgroundColor: hh.card,
                            borderColor: hh.lineStrong,
                            opacity: locked ? 0.55 : pressed ? 0.82 : 1,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`添加${starter.label}`}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color={hh.pine} />
                        ) : (
                          <Text style={[styles.quickAddStarterAddText, { color: hh.pine }]}>添加</Text>
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              <Pressable
                onPress={() => {
                  if (intakeParseLocked) return;
                  router.push('/add-item');
                }}
                disabled={intakeParseLocked}
                style={({ pressed }) => [
                  styles.quickAddCreateBtn,
                  {
                    backgroundColor: hh.pine,
                    opacity: intakeParseLocked ? 0.5 : pressed ? 0.9 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="新建快捷卡"
              >
                <MaterialIcons name="add" size={18} color={hh.onPine} />
                <Text style={[styles.quickAddCreateBtnText, { color: hh.onPine }]}>新建快捷卡</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              directionalLockEnabled
              contentContainerStyle={styles.quickAddScrollContent}
              style={styles.quickAddScroll}
            >
              {quickAddItems.map((item, index) => {
                const cardAnim =
                  quickAddCardAnimsRef.current[index] ??
                  quickAddCardAnimsRef.current[quickAddCardAnimsRef.current.length - 1];
                const { press: pressAnim, iconLift } = ensureQuickAddPressAnim(index);
                const itemOpacity = cardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 1],
                });
                const itemTranslateY = cardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                });
                const iconTranslateY = iconLift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -4],
                });
                const showCheck = quickAddSuccessKey === item.key;

                return (
                  <View
                    key={item.key}
                    ref={(node) => {
                      if (node) quickAddCardNodesRef.current.set(item.key, node);
                      else quickAddCardNodesRef.current.delete(item.key);
                    }}
                    collapsable={false}
                  >
                    <Animated.View
                      style={{
                        opacity: itemOpacity,
                        transform: [{ translateY: itemTranslateY }, { scale: pressAnim }],
                      }}
                    >
                      <Pressable
                        style={[
                          styles.quickAddCard,
                          {
                            backgroundColor: hh.card,
                            borderColor: hh.line,
                            width: cardWidth,
                            opacity: intakeParseLocked ? 0.45 : 1,
                          },
                        ]}
                        disabled={intakeParseLocked}
                        onPressIn={() => {
                          if (motionReduced) return;
                          Animated.timing(pressAnim, {
                            toValue: 0.96,
                            duration: 100,
                            easing: HEALTH_MOTION_EASE,
                            useNativeDriver: true,
                          }).start();
                        }}
                        onPressOut={() => {
                          Animated.spring(pressAnim, {
                            toValue: 1,
                            speed: 28,
                            bounciness: 8,
                            useNativeDriver: true,
                          }).start();
                        }}
                        onPress={() => {
                          if (intakeParseLocked) {
                            toast.info('当前有一条摄入正在解析，解析完成后再添加。');
                            return;
                          }
                          void persistQuickAddIntake(
                            item,
                            index,
                            quickAddCardNodesRef.current.get(item.key) ?? null,
                          );
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`快速添加${item.label}`}
                      >
                        <View style={styles.quickAddPlus}>
                          {showCheck ? (
                            <MaterialIcons name="check" size={14} color={hh.pine} />
                          ) : (
                            <Text style={[styles.quickAddPlusText, { color: hh.faint }]}>＋</Text>
                          )}
                        </View>
                        <Animated.View
                          style={[
                            styles.quickAddIconWrap,
                            { backgroundColor: hh.cardMuted, transform: [{ translateY: iconTranslateY }] },
                          ]}
                        >
                          <MaterialIcons
                            name={item.icon as keyof typeof MaterialIcons.glyphMap}
                            size={18}
                            color={hh.inkSoft}
                          />
                        </Animated.View>
                        <Text style={[styles.quickAddLabel, { color: hh.inkSoft }]} numberOfLines={1}>
                          {item.label}
                        </Text>
                        <Text style={[styles.quickAddValue, { color: hh.muted }]}>
                          {formatQuickAddAmount(item)}
                        </Text>
                      </Pressable>
                    </Animated.View>
                  </View>
                );
              })}
            </ScrollView>
          )}

        </View>
        </View>

        <View>
        <View style={styles.sectionPanel}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.sectionTitle, { color: hh.ink }]}>摄入记录</Text>
              <Text style={[styles.sectionSub, { color: hh.muted }]}>
                {intakeParseLocked
                  ? '占位行置顶'
                  : pageLoadError
                    ? '本地缓存可读'
                    : quickAddEmpty
                      ? '今天仍然可以记录'
                      : intakeListPreview.showEmpty
                        ? '暂无记录'
                        : `${intakeListPreview.total} 条 · 倒序${
                            intakeListPreview.hasMore
                              ? ` · 还有 ${intakeListPreview.total - intakeListPreview.lines.length} 条`
                              : ''
                          }`}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() =>
                router.push({
                  pathname: '/intake-history',
                  params: { date: formatLocalYmd(selectedDate) },
                })
              }
              style={styles.sectionActionRow}
            >
              <Text style={[styles.editBtn, { color: hh.pine, marginTop: 0 }]}>
                {pageLoadError
                  ? `最近 ${Math.min(3, intakeListPreview.lines.length)} 条`
                  : '查看全部'}
              </Text>
              {!pageLoadError ? (
                <MaterialIcons name="chevron-right" size={14} color={hh.pine} />
              ) : null}
            </TouchableOpacity>
          </View>

          {intakeListPreview.showEmpty ? (
            <View
              style={[
                styles.intakeEmptyBox,
                { backgroundColor: hh.cardMuted, borderColor: hh.line },
              ]}
            >
              <Text style={[styles.intakeEmptyText, { color: hh.muted }]}>
                暂无摄入记录。可点上方快捷卡一键加量，或点右下角 + 手动 / AI / 拍照记录
              </Text>
            </View>
          ) : (
            <View style={styles.intakeList}>
              <View
                pointerEvents="none"
                style={[styles.intakeListRail, { backgroundColor: hh.lineStrong }]}
              />
              {intakeListPreview.lines.map((line, lineIndex) => {
                const amountParts = splitIntakeAmountRight(line.amountRight);
                const rowEnterAnim =
                  timelineEnterAnimsRef.current[lineIndex] ??
                  timelineEnterAnimsRef.current[timelineEnterAnimsRef.current.length - 1];
                const rowOpacity = rowEnterAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 1],
                });
                // 入场自下上浮；快捷写入占位行按设计稿自上落下
                const rowTranslateY = rowEnterAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [line.isPlaceholder ? -14 : 12, 0],
                });
                const rowInner = (
                  <Animated.View
                    style={[
                      styles.intakeTimelineRow,
                      { opacity: rowOpacity, transform: [{ translateY: rowTranslateY }] },
                    ]}
                  >
                    <Text style={[styles.intakeRowTime, { color: hh.muted }]}>{line.timeLine}</Text>
                    <View style={styles.intakeRailCol}>
                      <View
                        style={[
                          styles.intakeRailIcon,
                          {
                            backgroundColor: isDark ? line.iconBgDark : line.iconBgLight,
                            borderColor: hh.paper,
                          },
                        ]}
                      >
                        <MaterialIcons name={line.icon} size={12} color={line.iconColor} />
                      </View>
                    </View>
                    <View
                      style={[
                        styles.intakeRow,
                        {
                          backgroundColor: line.isPlaceholder ? 'rgba(224, 179, 90, 0.14)' : hh.cardMuted,
                          borderColor: line.isPlaceholder ? 'rgba(196, 120, 82, 0.55)' : hh.line,
                          borderStyle: line.isPlaceholder ? 'dashed' : 'solid',
                          borderWidth: line.isPlaceholder ? 1.5 : StyleSheet.hairlineWidth,
                          flex: 1,
                          overflow: 'hidden',
                        },
                      ]}
                    >
                      <View style={styles.intakeRowText}>
                        <View style={styles.intakeRowHeader}>
                          <Text style={[styles.intakeRowTitle, { color: hh.ink }]} numberOfLines={1}>
                            {line.title}
                          </Text>
                          {line.sourceTag ? (
                            <View
                              style={[
                                styles.intakeSourceTag,
                                {
                                  backgroundColor: line.isPlaceholder
                                    ? 'rgba(224, 160, 74, 0.22)'
                                    : hh.aiTagBg,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.intakeSourceTagText,
                                  { color: line.isPlaceholder ? '#C47852' : hh.aiTagText },
                                ]}
                              >
                                {line.sourceTag}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {line.note ? (
                          <Text style={[styles.intakeRowMeta, { color: hh.muted }]} numberOfLines={2}>
                            {line.note}
                          </Text>
                        ) : null}
                        {line.aiComment ? (
                          <Text style={[styles.intakeRowMeta, { color: hh.muted }]} numberOfLines={2}>
                            {line.aiComment}
                          </Text>
                        ) : null}
                      </View>
                      {line.isPlaceholder ? <HealthShimmerOverlay active borderRadius={14} /> : null}
                    </View>
                    {amountParts || line.isPlaceholder ? (
                      <View style={styles.intakeAmtCol}>
                        <Text
                          style={[
                            styles.intakeRowAmount,
                            { color: line.isPlaceholder ? '#B3A58C' : hh.ink },
                          ]}
                          numberOfLines={1}
                        >
                          {amountParts?.value ?? '···'}
                        </Text>
                        {amountParts?.unit ? (
                          <Text style={[styles.intakeRowAmountUnit, { color: hh.muted }]} numberOfLines={1}>
                            {amountParts.unit}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </Animated.View>
                );

                if (line.isPlaceholder) {
                  return <View key={line.key}>{rowInner}</View>;
                }

                return (
                  <Swipeable
                    key={line.key}
                    overshootRight={false}
                    rightThreshold={44}
                    // ReanimatedSwipeable 删除条常驻内容层后方；不透明底避免未左滑时透出
                    childrenContainerStyle={{ backgroundColor: hh.paper }}
                    renderRightActions={() => (
                      <Pressable
                        onPress={() => {
                          confirmDeleteIntakeRecord(line.recordId);
                        }}
                        style={[styles.swipeDeleteAction, { backgroundColor: colors.danger }]}
                        accessibilityRole="button"
                        accessibilityLabel="删除这条摄入记录"
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
                      style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
                    >
                      {rowInner}
                    </Pressable>
                  </Swipeable>
                );
              })}
              {intakeListPreview.hasMore ? (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() =>
                    router.push({
                      pathname: '/intake-history',
                      params: { date: formatLocalYmd(selectedDate) },
                    })
                  }
                  style={[styles.intakeMoreBtn, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}
                >
                  <Text style={[styles.intakeMoreHint, { color: hh.pine }]}>
                    还有 {intakeListPreview.total - intakeListPreview.lines.length} 条 · 查看全部 ›
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
        </View>

        <View style={styles.sectionPanel}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.sectionTitle, { color: hh.ink }]}>每周趋势</Text>
              <Text style={[styles.sectionSub, { color: hh.muted }]}>近 7 天 · 按当日目标快照</Text>
            </View>
            <View style={[styles.trendDeltaBadge, { backgroundColor: hh.sageSoft }]}>
              <Text style={[styles.trendDeltaBadgeText, { color: hh.pine }]} numberOfLines={1}>
                {trendDeltaOverride ?? weeklyTrendDeltaText}
              </Text>
            </View>
          </View>

          <View style={styles.trendBody}>
            <View style={[styles.trendChart, { borderColor: 'transparent' }]}>
              {chartTipText ? (
                <View style={[styles.chartTip, { backgroundColor: hh.card, borderColor: hh.line }]}>
                  <Text style={[styles.chartTipText, { color: hh.inkSoft }]}>{chartTipText}</Text>
                </View>
              ) : null}

              {/* 设计稿 gridline：自底向上 0→100，刻度叠在线左侧 */}
              {(
                [
                  { pct: 0, bottom: 14 },
                  { pct: 25, bottom: 14 + BAR_MAX_HEIGHT * 0.25 },
                  { pct: 50, bottom: 14 + BAR_MAX_HEIGHT * 0.5 },
                  { pct: 75, bottom: 14 + BAR_MAX_HEIGHT * 0.75 },
                  { pct: 100, bottom: 14 + BAR_MAX_HEIGHT },
                ] as const
              ).map((g) => (
                <View
                  key={g.pct}
                  pointerEvents="none"
                  style={[styles.trendGridline, { bottom: g.bottom, backgroundColor: hh.line }]}
                >
                  <Text style={[styles.trendGridLabel, { color: hh.faint, backgroundColor: hh.card }]}>
                    {g.pct}
                  </Text>
                </View>
              ))}

              <View style={styles.trendBarsRow}>
                {weeklyTrend.map((item, dayIndex) => {
                  const metricPercents = [
                    item.hydration,
                    item.protein,
                    item.carbohydrate,
                    item.calories,
                  ] as const;
                  const metricColors = [
                    HealthNutrientAccents.hydration,
                    HealthNutrientAccents.protein,
                    HealthNutrientAccents.carbohydrate,
                    HealthNutrientAccents.calories,
                  ] as const;
                  const pulsing = trendPulseIndex === dayIndex;

                  return (
                    <Pressable
                      key={`${item.day}-${dayIndex}`}
                      style={[
                        styles.trendBarGroup,
                        item.active && { backgroundColor: hh.chartBand },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${formatHeaderDate(item.date)}完成度${trendDayAvgPercent(item)}%`}
                      onPress={() => {
                        const avg = trendDayAvgPercent(item);
                        const label = formatHeaderDate(item.date);
                        setSelectedDate(normalizeDate(item.date));
                        setTrendDeltaOverride(`${label} · ${avg}%`);
                        setChartTipText(`${label} 完成度 ${avg}%`);
                        if (chartTipTimerRef.current) clearTimeout(chartTipTimerRef.current);
                        chartTipTimerRef.current = setTimeout(() => setChartTipText(null), 2200);
                        playTrendBarPulse(dayIndex);
                      }}
                    >
                      <Animated.View
                        style={[
                          styles.trendBarsInner,
                          pulsing
                            ? {
                                transform: [
                                  {
                                    translateY: trendPulseAnim.interpolate({
                                      inputRange: [1, 1.08],
                                      outputRange: [0, (-BAR_MAX_HEIGHT * 0.08) / 2],
                                    }),
                                  },
                                  { scaleY: trendPulseAnim },
                                ],
                              }
                            : null,
                        ]}
                      >
                        {TREND_METRIC_KEYS.map((metricKey, metricIndex) => {
                          const anim = trendBarAnimsRef[dayIndex * 4 + metricIndex]!;
                          const h = trendBarHeight(metricPercents[metricIndex]!);
                          const scaleY = anim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.04, 1],
                          });
                          const opacity = anim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.4, 1],
                          });
                          // scaleY 默认中心缩放，用 translateY 补偿到底部生长
                          const translateY = anim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [(h * (1 - 0.04)) / 2, 0],
                          });
                          return (
                            <Animated.View
                              key={metricKey}
                              style={[
                                styles.trendMiniBar,
                                {
                                  height: h,
                                  backgroundColor: metricColors[metricIndex],
                                  opacity,
                                  transform: [{ translateY }, { scaleY }],
                                },
                              ]}
                            />
                          );
                        })}
                      </Animated.View>
                      <Text
                        style={[
                          styles.trendBarLabel,
                          {
                            color: item.active ? hh.pine : hh.muted,
                            fontWeight: item.active ? '700' : '500',
                          },
                        ]}
                      >
                        {item.day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.legendRow}>
              {(
                [
                  { label: '水分', color: HealthNutrientAccents.hydration },
                  { label: '蛋白', color: HealthNutrientAccents.protein },
                  { label: '碳水', color: HealthNutrientAccents.carbohydrate },
                  { label: '热量', color: HealthNutrientAccents.calories },
                ] as const
              ).map((leg) => (
                <View key={leg.label} style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: leg.color }]} />
                  <Text style={[styles.legendText, { color: hh.muted }]}>{leg.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <Text style={[styles.syncFooterHint, { color: hh.faint }]}>
          下拉只同步摄入与快捷卡；AI 目标每天至多请求一次，避免重复卡顿。
        </Text>
        <View style={{ height: 40 }} />
        </View>
          ) : null}

          {showSkeleton ? (
            <HomeSkeletonShell
              pending={skeletonPending}
              mounted={skeletonMounted}
              opacity={skeletonOpacity}
              backgroundColor={hh.paper}
              style={{ gap: Spacing.xl }}
            >
              <View style={styles.sectionPanel}>
                <View style={styles.sectionHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.sectionTitle, { color: hh.ink }]}>今日概况</Text>
                    <Text style={[styles.sectionSub, { color: hh.muted }]}>骨架占位</Text>
                  </View>
                  <Text style={[styles.editBtn, { color: hh.faint }]}>等待同步...</Text>
                </View>
                <HealthMetricsSkeleton cardWidth={metricCardWidth} colors={colors} />
              </View>
              <View style={styles.sectionPanel}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={[styles.sectionTitle, { color: hh.ink }]}>快速添加</Text>
                    <Text style={[styles.sectionSub, { color: hh.muted }]}>骨架占位</Text>
                  </View>
                </View>
                <HealthQuickAddSkeleton cardWidth={cardWidth} colors={colors} />
              </View>
              <View style={styles.sectionPanel}>
                <View style={styles.sectionHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.sectionTitle, { color: hh.ink }]}>摄入记录</Text>
                    <Text style={[styles.sectionSub, { color: hh.muted }]}>
                      {pageLoadError ? '本地缓存可读' : '骨架占位'}
                    </Text>
                  </View>
                  <Text style={[styles.editBtn, { color: hh.faint }]}>最近 3 条</Text>
                </View>
                <HealthIntakeListSkeleton colors={colors} />
              </View>
              <View style={styles.sectionPanel}>
                <HealthTrendCardSkeleton colors={colors} isDark={isDark} />
              </View>
              <Text style={[styles.syncFooterHint, { color: hh.faint }]}>
                下拉只同步摄入与快捷卡；AI 目标每天至多请求一次，避免重复卡顿。
              </Text>
              <View style={{ height: 40 }} />
            </HomeSkeletonShell>
          ) : null}
        </View>
      </ScrollView>

      {quickFloatChip ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.quickFloatChip,
            {
              left: quickFloatChip.left,
              top: quickFloatChip.top,
              opacity: quickFloatAnim.interpolate({
                inputRange: [0, 0.25, 1],
                outputRange: [0, 1, 0],
              }),
              transform: [
                {
                  translateX: -28,
                },
                {
                  translateY: quickFloatAnim.interpolate({
                    inputRange: [0, 0.25, 1],
                    outputRange: [4, -4, -42],
                  }),
                },
                {
                  scale: quickFloatAnim.interpolate({
                    inputRange: [0, 0.25, 1],
                    outputRange: [0.9, 1, 0.96],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.quickFloatChipText}>{quickFloatChip.label}</Text>
        </Animated.View>
      ) : null}

      {intakeParseLocked ? (
        <View
          pointerEvents="none"
          style={[
            styles.parseToastBar,
            {
              backgroundColor: hh.pine,
              bottom: glassTabBarContentInset(insets.bottom) + 78,
              shadowColor: hh.shadow,
            },
          ]}
        >
          <MaterialIcons name="auto-awesome" size={16} color={hh.amber} />
          <Text style={[styles.parseToastText, { color: hh.onPine }]} numberOfLines={1}>
            {parseToastLabel}
          </Text>
          <Text style={[styles.parseToastTimer, { color: hh.amber }]}>{parseElapsedLabel}</Text>
        </View>
      ) : null}

      <Animated.View
        style={[
          styles.floatingCtaWrap,
          {
            right: FLOATING_CTA_MARGIN,
            bottom: glassTabBarContentInset(insets.bottom) + 8,
            transform: [{ scale: ctaCombinedScale }],
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.floatingCtaBtn,
            { backgroundColor: hh.pine, shadowColor: hh.shadow, opacity: intakeParseLocked ? 0.42 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="记录新摄入"
          onPress={() => {
            if (intakeParseLocked) {
              toast.info('当前有一条摄入正在解析，解析完成后再添加。');
              return;
            }
            setSheetOpen(true);
          }}
          onPressIn={() => {
            if (motionReduced) {
              ctaPressAnim.setValue(1);
              return;
            }
            Animated.spring(ctaPressAnim, {
              toValue: 0.965,
              speed: 30,
              bounciness: 0,
              useNativeDriver: true,
            }).start();
          }}
          onPressOut={() => {
            if (motionReduced) {
              ctaPressAnim.setValue(1);
              return;
            }
            Animated.spring(ctaPressAnim, {
              toValue: 1,
              speed: 24,
              bounciness: 6,
              useNativeDriver: true,
            }).start();
          }}
          activeOpacity={0.9}
        >
          <MaterialIcons name="add" size={30} color={hh.onPine} />
          <View style={[styles.floatingCtaDot, { backgroundColor: hh.amber }]} />
        </TouchableOpacity>
      </Animated.View>

      <IntakeAssistantSheet
        visible={assistantOpen}
        onClose={dismissAssistantModal}
        onSave={saveAssistantModal}
        onConfigureAi={openAiConfigFromAssistant}
        tab={assistantTab}
        onTabChange={setAssistantTab}
        subtitle={assistantSubtitle}
        selection={assistantSuggestSelection}
        onSelectKind={selectAssistantSuggestKind}
        bestValue={suggestNumeric.best}
        communityValue={suggestNumeric.community}
        unit={currentAssistant.unit}
        manualGoal={manualGoal}
        onManualGoalChange={onAssistantManualGoalChange}
        dailyAiLoading={dailyAiLoading}
        hasAiTargets={Boolean(dailyAiTargets)}
        aiConfigured={isActiveAiLlmConfigured()}
        rationaleZh={dailyAiTargets?.rationale_zh ?? null}
        contextRows={assistantContextRows}
        otherGoals={assistantOtherGoals}
        localFormula={assistantLocalFormula}
        rememberedHint={assistantRememberedHint}
      />

      <HealthMetricPointsSettingsSheet
        visible={pointsSettingsOpen}
        onClose={closePointsSettingsModal}
        onSaved={setMetricPointsSettings}
        initialSettings={metricPointsSettings}
        dayMetrics={pointsSettingsDayMetrics}
      />

      <RecordIntakeSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onConfirm={handleRecordIntakeConfirm}
        dateLabel={recordIntakeSheetContext.dateLabel}
        todayRecordCount={recordIntakeSheetContext.todayRecordCount}
        dayTotals={recordIntakeSheetContext.dayTotals}
        intakeTargets={recordIntakeSheetContext.intakeTargets}
        metricPointsSettings={metricPointsSettings}
        waterCupMl={recordIntakeSheetContext.waterCupMl}
        recentPhrases={recordIntakeSheetContext.recentPhrases}
        recentPhotos={recordIntakeSheetContext.recentPhotos}
        recentManuals={recordIntakeSheetContext.recentManuals}
      />

      <HealthIntakeDeleteConfirmSheet
        visible={deleteConfirm != null}
        preview={
          deleteConfirm
            ? {
                title: deleteConfirm.title,
                detail: deleteConfirm.detail,
                icon: deleteConfirm.icon,
                iconColor: deleteConfirm.iconColor,
                pointsDelta: deleteConfirm.pointsDelta,
              }
            : null
        }
        confirming={deleteConfirming}
        onClose={() => {
          if (deleteConfirming) return;
          setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (!deleteConfirm) return;
          void deleteIntakeRecordNow(deleteConfirm.recordId);
        }}
      />
    </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    gap: 12,
  },
  headerTitleBlock: {
    flex: 1,
    minWidth: 0,
    paddingTop: 4,
  },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 34,
  },
  headerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  headerStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerStatusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  weekNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    paddingHorizontal: 2,
    gap: 8,
  },
  weekNavBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekNavLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  syncStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingHorizontal: 2,
    gap: 10,
  },
  syncStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
    minWidth: 0,
  },
  syncStatusText: {
    fontSize: 11,
    fontWeight: '500',
    flexShrink: 1,
  },
  syncStatusHint: {
    fontSize: 11,
    fontWeight: '500',
  },
  weekPage: {
    paddingRight: 0,
    overflow: 'visible',
  },
  weekStripContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    gap: 4,
  },
  weekDayItem: {
    flex: 1,
    minWidth: 40,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    zIndex: 3,
  },
  weekDayContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 26,
    gap: 2,
  },
  weekDayDate: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
  weekDayLabel: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 13,
    textAlign: 'center',
  },
  weekDayDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 2,
  },
  scroll: { flex: 1 },
  scrollContent: {
    width: '100%',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing['6xl'],
  },
  loadErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: Spacing.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.lg,
  },
  loadErrorTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  loadErrorTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  loadErrorText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  loadErrorRetryBtn: {
    minWidth: 56,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  loadErrorRetryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  syncFooterHint: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 12,
    marginTop: 4,
  },
  parseToastBar: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md + 64,
    zIndex: 20,
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  parseToastText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  parseToastTimer: {
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  healthBodyStack: {
    position: 'relative',
  },
  sectionStack: {
    gap: Spacing['3xl'],
  },
  /** 对齐稿面：分区直铺纸底，不套外层白卡 */
  sectionPanel: {
    overflow: 'visible',
  },
  sectionActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    marginTop: 2,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  metricCard: {
    borderRadius: 16,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  metricCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metricCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metricCardTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  progressContainer: {
    position: 'relative',
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
  progressPercentText: {
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  metricSubValue: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  statusTrack: {
    height: 5,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  statusTrackWrap: {
    marginTop: Spacing.lg,
    position: 'relative',
  },
  statusTrackWrapWithMarker: {
    paddingTop: 14,
  },
  statusThresholdMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 48,
    marginLeft: -24,
    alignItems: 'center',
    zIndex: 2,
  },
  statusThresholdLabel: {
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
    marginBottom: 1,
    maxWidth: 48,
    textAlign: 'center',
  },
  statusThresholdLine: {
    width: 2,
    flex: 1,
    borderRadius: 1,
    opacity: 0.9,
  },
  statusTrackFill: {
    height: '100%',
    borderRadius: 999,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.xl,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  sectionSub: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
    lineHeight: 15,
  },
  editBtn: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginTop: 2,
  },
  quickAddScroll: {
    marginBottom: 0,
    marginHorizontal: -Spacing.md,
  },
  quickAddScrollContent: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  quickAddCard: {
    borderRadius: 14,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 8,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
    minHeight: 90,
  },
  quickAddPlus: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  quickAddPlusText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 14,
  },
  quickAddIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickAddIcon: {
    marginBottom: 8,
  },
  quickAddLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
    maxWidth: '100%',
  },
  quickAddValue: {
    fontSize: 11,
    fontWeight: '600',
  },
  quickFloatChip: {
    position: 'absolute',
    zIndex: 80,
    elevation: 80,
    backgroundColor: '#2F5A4C',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    shadowColor: '#23443A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
  },
  quickFloatChipText: {
    color: '#F7F0E2',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  floatingCtaWrap: {
    position: 'absolute',
    zIndex: 60,
  },
  floatingCtaBtn: {
    width: FLOATING_CTA_SIZE,
    height: FLOATING_CTA_SIZE,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.composer,
  },
  floatingCtaDot: {
    position: 'absolute',
    top: 10,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  metricStatusHint: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  metricTrackWrap: {
    width: '100%',
    marginTop: Spacing.md,
  },
  metricTrackWrapTall: {
    marginTop: Spacing.lg,
  },
  quickAddTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  quickAddEmptyBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  quickAddEmptyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  quickAddManageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  quickAddEmptyStack: {
    gap: Spacing.lg,
  },
  quickAddEmptyBox: {
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    paddingVertical: 28,
    paddingHorizontal: 18,
    alignItems: 'center',
    gap: 10,
  },
  quickAddEmptyPlus: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAddEmptyText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 19,
  },
  quickAddStarterCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  quickAddStarterHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  quickAddStarterTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  quickAddStarterSide: {
    fontSize: 11,
    fontWeight: '600',
  },
  quickAddStarterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  quickAddStarterIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAddStarterText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  quickAddStarterLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  quickAddStarterAmount: {
    fontSize: 12,
    fontWeight: '500',
  },
  quickAddStarterAddBtn: {
    minWidth: 56,
    height: 32,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  quickAddStarterAddText: {
    fontSize: 13,
    fontWeight: '700',
  },
  quickAddCreateBtn: {
    height: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  quickAddCreateBtnText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  assistantFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: Spacing['3xl'],
  },
  assistantFooterBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: Radius.lg,
  },
  assistantFooterBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  intakeEmptyBox: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 0,
  },
  intakeEmptyText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
  },
  intakeList: {
    gap: 0,
    marginBottom: 0,
    position: 'relative',
  },
  intakeListRail: {
    position: 'absolute',
    // 时间列 36 + gap 7 + 图标中心 11
    left: 54,
    top: 14,
    bottom: 18,
    width: 1,
    zIndex: 0,
  },
  intakeTimelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingVertical: 4,
    position: 'relative',
  },
  intakeRailCol: {
    width: 22,
    alignItems: 'center',
    paddingTop: 2,
  },
  intakeRailIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    zIndex: 1,
  },
  intakeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 0,
  },
  intakeRowText: {
    flex: 1,
    minWidth: 0,
  },
  intakeRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  intakeRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
    flexShrink: 1,
    minWidth: 0,
  },
  intakeSourceTag: {
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  intakeSourceTagText: {
    fontSize: 9,
    fontWeight: '700',
  },
  intakeRowTime: {
    width: 36,
    textAlign: 'right',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
    paddingTop: 6,
  },
  intakeRowMeta: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 14,
  },
  intakeAmtCol: {
    width: 56,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'flex-end',
    paddingTop: 5,
  },
  intakeRowAmount: {
    width: '100%',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  intakeRowAmountUnit: {
    width: '100%',
    fontSize: 9,
    fontWeight: '500',
    textAlign: 'right',
    marginTop: 1,
  },
  intakeMoreBtn: {
    alignSelf: 'center',
    marginTop: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  intakeMoreHint: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  trendDeltaBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 168,
  },
  trendDeltaBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  swipeDeleteAction: {
    width: 76,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    marginVertical: 4,
    gap: 4,
  },
  swipeDeleteText: {
    fontSize: 12,
    fontWeight: '800',
  },
  trendBody: {
    gap: 6,
  },
  /** 设计稿 .chart：总高 104 = 绘图 88 + 日标签区 16 */
  trendChart: {
    height: 104,
    marginTop: 2,
    position: 'relative',
    paddingHorizontal: 2,
  },
  chartTip: {
    position: 'absolute',
    right: 2,
    top: 0,
    zIndex: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  chartTipText: {
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  trendGridline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  trendGridLabel: {
    position: 'absolute',
    left: 0,
    top: -7,
    fontSize: 9,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingRight: 3,
  },
  trendBarsRow: {
    position: 'absolute',
    left: 2,
    right: 2,
    top: 104 - 14 - BAR_MAX_HEIGHT,
    height: BAR_MAX_HEIGHT + 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 3,
    zIndex: 1,
  },
  trendBarGroup: {
    flex: 1,
    height: BAR_MAX_HEIGHT + 14,
    alignItems: 'center',
    borderRadius: 6,
  },
  trendBarsInner: {
    height: BAR_MAX_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 1.5,
  },
  trendMiniBar: {
    width: 4,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  trendBarLabel: {
    marginTop: 2,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    lineHeight: 12,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendSwatch: {
    width: 4,
    height: 8,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '500',
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
  suggestItemManual: {
    alignItems: 'flex-start',
  },
  suggestItemBody: {
    flex: 1,
    marginRight: 10,
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
  suggestManualInputWrap: {
    marginTop: 4,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing['2xl'],
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  suggestManualInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
  },
  suggestManualUnit: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 8,
  },
});
