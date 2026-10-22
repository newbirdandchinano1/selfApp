import { useHealthHomeTheme } from '@/constants/health-home-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import {
  isCaloriesPenaltyEligible,
  isIntakeMetricRewardEligible,
  type HealthMetricPointsSettings,
} from '@/lib/health-metric-points-settings';
import { resolveStoredImageDisplayUri } from '@/lib/stored-images';
import { MotionPressable } from '@/components/ui/motion-pressable';
import {
  analyzeFoodNutritionFromImage,
  getActiveAiLlmApiKey,
  parseAiIntakeNumericValue,
  parseFoodIntakeFromText,
  type FoodTextIntakeJson,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
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

const AI_TEXT_MAX = 500;

/** 对齐设计稿 Token：`--ease` / `--spring` */
const HEALTH_MOTION_EASE = Easing.bezier(0.22, 1, 0.36, 1);
const HEALTH_MOTION_SPRING = Easing.bezier(0.34, 1.56, 0.64, 1);
/** AI 评价流式：22ms/字（设计稿 03） */
const AI_EVAL_STREAM_MS = 22;
/** 四项数值错峰：45ms（设计稿 03 / N08） */
const NUTRIENT_POP_STAGGER_MS = 45;
const WAND_IDLE_SPIN_MS = 2400;
const WAND_BUSY_SPIN_MS = 1000;
const WAND_SPARK_COUNT = 10;
const SAVE_BURST_COUNT = 12;
/** 拍照扫描线往返（设计稿 04 / 8.1） */
const PHOTO_SCAN_LOOP_MS = 2400;
/** 非食物错误卡轻抖（设计稿 04） */
const PHOTO_ERR_SHAKE_MS = 300;
const PHOTO_SCAN_GLOW = '#F4D9A8';
const PHOTO_NOT_FOOD_CODE = 'E_NOT_FOOD';
/** 手动 Tab：键盘/类型错峰入场（设计稿 anim-item / riseIn） */
const MANUAL_ENTER_MS = 420;
const MANUAL_ENTER_STAGGER_MS = 45;
const MANUAL_ENTER_RISE_PX = 12;
/** 切营养类型：指示器弹簧位移（设计稿 05 / N10） */
const MANUAL_TYPE_INDICATOR_MS = 220;
/** 数字块 bump（设计稿 bignumBump / N09） */
const BIGNUM_BUMP_MS = 220;
/** 光标闪烁（设计稿 05） */
const CARET_BLINK_MS = 1100;

type TabKey = 'ai' | 'photo' | 'manual';
export type ManualIntakeType = 'hydration' | 'protein' | 'carbohydrate' | 'calories';
type ManualType = ManualIntakeType;
type ConfirmUnit = 'ml' | 'g' | 'kcal';

const MANUAL_TYPE_ORDER: ManualType[] = ['hydration', 'protein', 'carbohydrate', 'calories'];
/** 切类型时回落默认值（设计稿 MAN.def / N10） */
const MANUAL_DEFAULTS: Record<ManualType, string> = {
  hydration: '250',
  protein: '20',
  carbohydrate: '30',
  calories: '420',
};

export type RecordIntakeTargets = {
  hydration: number;
  protein: number;
  carbohydrate: number;
  calories: number;
};

export type RecordIntakeRecentManual = {
  id: string;
  type: ManualIntakeType;
  label: string;
  amount: number;
  amountLabel: string;
  timeLabel: string;
};

type AiIntakeFieldTexts = {
  food_summary: string;
  hydration_ml: string;
  protein_g: string;
  carbohydrate_g: string;
  calories_kcal: string;
  ai_evaluation: string;
};

/** 拍照预解析可编辑字段（设计稿 04；水分由用户补录，识图 API 不返回） */
type PhotoIntakeFieldTexts = {
  food_name: string;
  hydration_ml: string;
  protein_g: string;
  carbohydrate_g: string;
  calories_kcal: string;
  ai_evaluation: string;
};

export type PhotoIntakeParsedPayload = {
  food_name: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  calories_kcal: number;
  ai_evaluation: string;
};

export type RecordIntakeDayTotals = {
  hydration: number;
  protein: number;
  carbohydrate: number;
  calories: number;
};

export type RecordIntakeRecentPhoto = {
  id: string;
  title: string;
  timeLabel: string;
  caloriesLabel: string;
  imageUri: string | null;
};

const AI_TIPS = [
  { label: '份量', example: '「半碗 / 一杯 / 120g」' },
  { label: '烹饪', example: '「少油 / 无糖 / 加冰」' },
  { label: '时段', example: '「午饭 / 训练后」' },
] as const;

const PHOTO_TIPS = [
  { label: '尽量俯拍', detail: '让食物完整入镜' },
  { label: '保持光线', detail: '避免逆光与重阴影' },
  { label: '单独拍摄', detail: '不要与餐具混在一起' },
] as const;

const UNIT_HINTS = [
  '1 杯 ≈ 250 ml',
  '1 碗 ≈ 150 g',
  '1 个鸡蛋 ≈ 6 g 蛋白',
  '1 千卡 = 4.18 kJ',
] as const;

function foodTextIntakeFromFieldTexts(fields: AiIntakeFieldTexts): FoodTextIntakeJson {
  return {
    food_summary: fields.food_summary.trim(),
    hydration_ml: parseNonNegMetricInput(fields.hydration_ml),
    protein_g: parseNonNegMetricInput(fields.protein_g),
    carbohydrate_g: parseNonNegMetricInput(fields.carbohydrate_g),
    calories_kcal: parseNonNegMetricInput(fields.calories_kcal),
    ai_evaluation: fields.ai_evaluation.trim(),
  };
}

function aiIntakeFieldTextsFromData(data: FoodTextIntakeJson): AiIntakeFieldTexts {
  return {
    food_summary: data.food_summary ?? '',
    hydration_ml: String(data.hydration_ml ?? 0),
    protein_g: String(data.protein_g ?? 0),
    carbohydrate_g: String(data.carbohydrate_g ?? 0),
    calories_kcal: String(data.calories_kcal ?? 0),
    ai_evaluation: data.ai_evaluation ?? '',
  };
}

function parseNonNegMetricInput(raw: string): number {
  return parseAiIntakeNumericValue(raw);
}

function formatMetricNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function editableMetricCount(fields: AiIntakeFieldTexts | PhotoIntakeFieldTexts): number {
  let n = 0;
  if (parseNonNegMetricInput(fields.hydration_ml) > 0) n += 1;
  if (parseNonNegMetricInput(fields.protein_g) > 0) n += 1;
  if (parseNonNegMetricInput(fields.carbohydrate_g) > 0) n += 1;
  if (parseNonNegMetricInput(fields.calories_kcal) > 0) n += 1;
  return n;
}

function photoIntakeFromFieldTexts(fields: PhotoIntakeFieldTexts): PhotoIntakeParsedPayload {
  return {
    food_name: fields.food_name.trim(),
    hydration_ml: parseNonNegMetricInput(fields.hydration_ml),
    protein_g: parseNonNegMetricInput(fields.protein_g),
    carbohydrate_g: parseNonNegMetricInput(fields.carbohydrate_g),
    calories_kcal: parseNonNegMetricInput(fields.calories_kcal),
    ai_evaluation: fields.ai_evaluation.trim(),
  };
}

export type RecordIntakeConfirmPayload =
  /** 无 parsed 时由首页后台请求 AI 解析；有 parsed 时直接落库 */
  | { mode: 'ai'; text: string; parsed?: FoodTextIntakeJson }
  | { mode: 'manual'; amount: number; unit: ConfirmUnit; type: ManualType }
  | {
      mode: 'photo';
      imageBase64: string;
      imageMimeType: string;
      sourceImageUri: string | null;
      /** 选填，与图片一并交给识别模型 */
      photoNote?: string;
      /** 有预解析时直接落库，跳过首页后台再识别 */
      parsed?: PhotoIntakeParsedPayload;
    };

function getUnitByType(type: ManualType): ConfirmUnit {
  if (type === 'hydration') return 'ml';
  if (type === 'protein') return 'g';
  if (type === 'carbohydrate') return 'g';
  return 'kcal';
}

function getManualMeta(type: ManualType, waterCupMl?: number | null) {
  if (type === 'hydration') {
    const cup = waterCupMl != null && waterCupMl > 0 ? waterCupMl : 250;
    return {
      label: '水分',
      icon: 'water-drop' as const,
      unitText: 'ml',
      unitUpper: 'ML',
      convertHint: (n: number) => {
        const cups = Math.max(1, Math.round(n / cup));
        const base = `约 ${(n / 1000).toFixed(2)} 升 · 约 ${cups} 杯`;
        if (waterCupMl != null && waterCupMl > 0) {
          return `${base} · 与快捷卡「一杯水」同源`;
        }
        return base;
      },
      limit: 5000,
    };
  }
  if (type === 'protein') {
    return {
      label: '蛋白质',
      icon: 'egg' as const,
      unitText: 'g',
      unitUpper: 'G',
      convertHint: (n: number) => (n >= 1000 ? `约 ${(n / 1000).toFixed(2)} kg` : `${n} 克`),
      limit: 500,
    };
  }
  if (type === 'carbohydrate') {
    return {
      label: '碳水',
      icon: 'rice-bowl' as const,
      unitText: 'g',
      unitUpper: 'G',
      convertHint: (n: number) => (n >= 1000 ? `约 ${(n / 1000).toFixed(2)} kg` : `${n} 克`),
      limit: 800,
    };
  }
  return {
    label: '热量',
    icon: 'local-fire-department' as const,
    unitText: 'kcal',
    unitUpper: 'KCAL',
    convertHint: (n: number) => `${n} 千卡`,
    limit: 5000,
  };
}

function formatPreviewNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('zh-CN');
}

function previewPointsImpact(params: {
  type: ManualType;
  before: number;
  after: number;
  target: number;
  settings: HealthMetricPointsSettings | null | undefined;
}): string | null {
  const settings = params.settings;
  if (!settings?.enabled || settings.rewardPoints === 0) return null;
  const target = params.target;
  if (!(target > 0)) return null;
  const beforePct = (params.before / target) * 100;
  const afterPct = (params.after / target) * 100;
  const pts = settings.rewardPoints;
  const thr = settings.thresholdPercent;

  if (params.type === 'calories') {
    const beforeHit = isCaloriesPenaltyEligible(beforePct, settings);
    const afterHit = isCaloriesPenaltyEligible(afterPct, settings);
    if (!beforeHit && afterHit) return `将超 ${thr}% 阈值 · −${pts} 分`;
    if (afterHit) return `已超 ${thr}% 阈值 · 本次不另扣`;
    return `未超 ${thr}% 阈值 · 0 分`;
  }

  const beforeHit = isIntakeMetricRewardEligible(beforePct, settings);
  const afterHit = isIntakeMetricRewardEligible(afterPct, settings);
  if (!beforeHit && afterHit) return `已超 ${thr}% 阈值 · +${pts} 分`;
  if (afterHit) return `已超 ${thr}% 阈值 · 本次不加分`;
  return `未达 ${thr}% 阈值 · 0 分`;
}

const TABS: { key: TabKey; label: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }[] = [
  { key: 'ai', label: 'AI 记录', icon: 'auto-awesome' },
  { key: 'photo', label: '拍照记录', icon: 'photo-camera' },
  { key: 'manual', label: '手动记录', icon: 'edit' },
];

type NutrientTileItem = {
  key: string;
  label: string;
  unit: string;
  value: string;
  accent: string;
  soft: string;
};

type SparkSpec = { id: string; dx: number; dy: number; color: string };

/** 设计稿 itemPop：scale .86 → 1.04 → 1，错峰 45ms */
function StaggerPop({
  index,
  animate,
  animKey,
  reduceMotion,
  children,
}: {
  index: number;
  animate: boolean;
  animKey: number;
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  const progress = React.useRef(new Animated.Value(animate && !reduceMotion ? 0 : 1)).current;

  React.useEffect(() => {
    if (!animate || reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 340,
      delay: index * NUTRIENT_POP_STAGGER_MS,
      easing: HEALTH_MOTION_SPRING,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, animKey, index, progress, reduceMotion]);

  const scale = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.86, 1.04, 1],
  });

  return (
    <Animated.View style={{ opacity: progress, transform: [{ scale }], width: '48%', flexGrow: 1 }}>
      {children}
    </Animated.View>
  );
}

/** 设计稿 riseIn / anim-item：opacity + translateY(12→0)，错峰 45ms */
function StaggerRiseItem({
  index,
  animKey,
  reduceMotion,
  style,
  children,
}: {
  index: number;
  animKey: number;
  reduceMotion: boolean;
  style?: React.ComponentProps<typeof Animated.View>['style'];
  children: React.ReactNode;
}) {
  const progress = React.useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  React.useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: MANUAL_ENTER_MS,
      delay: index * MANUAL_ENTER_STAGGER_MS,
      easing: HEALTH_MOTION_EASE,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animKey, index, progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [MANUAL_ENTER_RISE_PX, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function NutrientTiles({
  items,
  editable,
  onChange,
  staggerIn,
  staggerKey = 0,
  reduceMotion = false,
}: {
  items: NutrientTileItem[];
  editable?: boolean;
  onChange?: (key: string, value: string) => void;
  /** 解析成功后四项 45ms 错峰弹入 */
  staggerIn?: boolean;
  staggerKey?: number;
  reduceMotion?: boolean;
}) {
  return (
    <View style={styles.metricGrid}>
      {items.map((item, index) => {
        const tile = (
          <View style={[styles.metricTile, { backgroundColor: item.soft, width: '100%' }]}>
            {editable && onChange ? (
              <TextInput
                value={item.value}
                onChangeText={(v) => onChange(item.key, v)}
                keyboardType="decimal-pad"
                style={[styles.metricValueInput, { color: item.accent }]}
                placeholder="0"
                placeholderTextColor={`${item.accent}88`}
              />
            ) : (
              <Text style={[styles.metricValue, { color: item.accent }]}>{item.value}</Text>
            )}
            <Text style={[styles.metricLabel, { color: item.accent }]}>
              {item.label} {item.unit}
            </Text>
          </View>
        );
        if (!staggerIn) {
          return (
            <View key={item.key} style={{ width: '48%', flexGrow: 1 }}>
              {tile}
            </View>
          );
        }
        return (
          <StaggerPop
            key={`${item.key}-${staggerKey}`}
            index={index}
            animate
            animKey={staggerKey}
            reduceMotion={reduceMotion}
          >
            {tile}
          </StaggerPop>
        );
      })}
    </View>
  );
}

/** 金色粒子外扩（设计稿 N08 / N13） */
function SparkBurstOverlay({
  sparks,
  origin,
  onDone,
}: {
  sparks: SparkSpec[];
  origin: { x: number; y: number };
  onDone: () => void;
}) {
  React.useEffect(() => {
    if (sparks.length === 0) return;
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [onDone, sparks]);

  if (sparks.length === 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {sparks.map((spark, i) => (
        <SparkDot key={spark.id} spark={spark} origin={origin} delay={i * 22} />
      ))}
    </View>
  );
}

function SparkDot({
  spark,
  origin,
  delay,
}: {
  spark: SparkSpec;
  origin: { x: number; y: number };
  delay: number;
}) {
  const progress = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 800,
      delay,
      easing: HEALTH_MOTION_EASE,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [delay, progress]);

  return (
    <Animated.View
      style={[
        styles.sparkDot,
        {
          backgroundColor: spark.color,
          left: origin.x - 2,
          top: origin.y - 2,
          opacity: progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, spark.dx],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, spark.dy],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 0.25, 1],
                outputRange: [0.4, 1, 1],
              }),
            },
          ],
        },
      ]}
    />
  );
}

function SuccessRing({ origin, color }: { origin: { x: number; y: number }; color: string }) {
  const progress = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 800,
      easing: HEALTH_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.successRing,
        {
          borderColor: color,
          left: origin.x - 27,
          top: origin.y - 27,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
          transform: [
            {
              scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.4] }),
            },
          ],
        },
      ]}
    />
  );
}

function buildRadialSparks(count: number, color: string): SparkSpec[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const R = 26 + (i % 3) * 10;
    return {
      id: `sp-${i}-${Math.round(a * 1000)}`,
      dx: Math.cos(a) * R,
      dy: Math.sin(a) * R,
      color,
    };
  });
}

function RecentPhotoThumb({ uri }: { uri: string | null }) {
  const [displayUri, setDisplayUri] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await resolveStoredImageDisplayUri(uri);
      if (!cancelled) setDisplayUri(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [uri]);
  if (!displayUri) {
    return (
      <View style={styles.recentPhotoThumbFallback}>
        <MaterialIcons name="restaurant" size={16} color="#7E877F" />
      </View>
    );
  }
  return <Image source={{ uri: displayUri }} style={styles.recentPhotoThumb} contentFit="cover" />;
}

export function RecordIntakeSheet({
  visible,
  onClose,
  onConfirm,
  dateLabel,
  todayRecordCount = 0,
  dayTotals,
  intakeTargets,
  metricPointsSettings,
  waterCupMl,
  recentPhrases = [],
  recentPhotos = [],
  recentManuals = [],
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm?: (payload: RecordIntakeConfirmPayload) => void | Promise<void>;
  /** 如「5月3日 周六」 */
  dateLabel?: string;
  todayRecordCount?: number;
  dayTotals?: RecordIntakeDayTotals | null;
  /** 当日四项目标，用于写入后预览 */
  intakeTargets?: RecordIntakeTargets | null;
  metricPointsSettings?: HealthMetricPointsSettings | null;
  /** 快捷卡「一杯水」容量，用于换算文案 */
  waterCupMl?: number | null;
  recentPhrases?: string[];
  recentPhotos?: RecordIntakeRecentPhoto[];
  recentManuals?: RecordIntakeRecentManual[];
}) {
  const { hh, isDark, nutrients, fonts } = useHealthHomeTheme();
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const motionReduced = !motionReady || reduceMotion;

  const [shouldRender, setShouldRender] = React.useState(visible);
  const [tab, setTab] = React.useState<TabKey>('ai');
  const [text, setText] = React.useState('');
  const [manualType, setManualType] = React.useState<ManualType>('hydration');
  const [amountText, setAmountText] = React.useState(MANUAL_DEFAULTS.hydration);
  /** 进入手动 Tab 时递增，驱动键盘/类型错峰入场 */
  const [manualEnterKey, setManualEnterKey] = React.useState(0);
  const [manualTypeRowWidth, setManualTypeRowWidth] = React.useState(0);
  const [photoUri, setPhotoUri] = React.useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = React.useState<string | null>(null);
  const [photoMime, setPhotoMime] = React.useState('image/jpeg');
  const [photoNote, setPhotoNote] = React.useState('');
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [photoNotFood, setPhotoNotFood] = React.useState(false);
  const [photoFieldTexts, setPhotoFieldTexts] = React.useState<PhotoIntakeFieldTexts | null>(null);
  const [photoRevealKey, setPhotoRevealKey] = React.useState(0);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [aiResolved, setAiResolved] = React.useState<{ text: string; data: FoodTextIntakeJson } | null>(null);
  const [aiFieldTexts, setAiFieldTexts] = React.useState<AiIntakeFieldTexts | null>(null);
  const [aiParseSeconds, setAiParseSeconds] = React.useState<number | null>(null);
  /** 解析成功后触发四项错峰弹入 */
  const [aiRevealKey, setAiRevealKey] = React.useState(0);
  /** AI 评价逐字流式展示（流式期间不可编辑） */
  const [aiEvalStream, setAiEvalStream] = React.useState<{ full: string; shown: string } | null>(null);
  const [wandSparks, setWandSparks] = React.useState<SparkSpec[]>([]);
  const [wandSparkOrigin, setWandSparkOrigin] = React.useState({ x: 0, y: 0 });
  const [saveBurst, setSaveBurst] = React.useState<{
    sparks: SparkSpec[];
    origin: { x: number; y: number };
  } | null>(null);
  const [confirmSaving, setConfirmSaving] = React.useState(false);

  const translateY = React.useRef(new Animated.Value(screenHeight)).current;
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;
  const scanAnim = React.useRef(new Animated.Value(0)).current;
  const photoShakeX = React.useRef(new Animated.Value(0)).current;
  const photoErrCodeOpacity = React.useRef(new Animated.Value(1)).current;
  const wandSpin = React.useRef(new Animated.Value(0)).current;
  const resultDim = React.useRef(new Animated.Value(0)).current;
  const confirmScale = React.useRef(new Animated.Value(1)).current;
  const amountBumpScale = React.useRef(new Animated.Value(1)).current;
  const caretOpacity = React.useRef(new Animated.Value(1)).current;
  const convertSweep = React.useRef(new Animated.Value(0)).current;
  const manualTypeIndicatorX = React.useRef(new Animated.Value(0)).current;
  const sheetOverlayRef = React.useRef<View>(null);
  const wandBtnRef = React.useRef<View>(null);
  const confirmBtnRef = React.useRef<View>(null);
  const aiEvalStreamTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const aiParseGenRef = React.useRef(0);
  const photoParseGenRef = React.useRef(0);

  const clearAiEvalStream = React.useCallback(() => {
    if (aiEvalStreamTimerRef.current) {
      clearInterval(aiEvalStreamTimerRef.current);
      aiEvalStreamTimerRef.current = null;
    }
    setAiEvalStream(null);
  }, []);

  const startAiEvalStream = React.useCallback(
    (fullRaw: string) => {
      clearAiEvalStream();
      const full = fullRaw.trim();
      if (!full) return;
      if (motionReduced) {
        setAiEvalStream(null);
        return;
      }
      setAiEvalStream({ full, shown: '' });
      let i = 0;
      aiEvalStreamTimerRef.current = setInterval(() => {
        i += 1;
        const shown = full.slice(0, i);
        setAiEvalStream({ full, shown });
        if (i >= full.length) {
          clearAiEvalStream();
        }
      }, AI_EVAL_STREAM_MS);
    },
    [clearAiEvalStream, motionReduced],
  );

  const open = React.useCallback(() => {
    translateY.setValue(screenHeight);
    backdropOpacity.setValue(0);
    // 设计稿：遮罩 250ms；面板 spring 450ms
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: motionReduced ? 120 : 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: motionReduced ? 120 : 450,
        easing: motionReduced ? Easing.out(Easing.quad) : HEALTH_MOTION_SPRING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, motionReduced, translateY]);

  const close = React.useCallback(
    (after?: () => void) => {
      // 设计稿：关闭 200ms 下移 + 淡出
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: motionReduced ? 120 : 200,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: screenHeight,
          duration: motionReduced ? 120 : 200,
          easing: HEALTH_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) after?.();
      });
    },
    [backdropOpacity, motionReduced, translateY],
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

  React.useEffect(() => {
    if (!visible) return;
    setText('');
    setTab('ai');
    setManualType('hydration');
    setAmountText(MANUAL_DEFAULTS.hydration);
    setManualEnterKey(0);
    setPhotoUri(null);
    setPhotoBase64(null);
    setPhotoMime('image/jpeg');
    setPhotoNote('');
    setPhotoError(null);
    setPhotoBusy(false);
    setPhotoNotFood(false);
    setPhotoFieldTexts(null);
    setPhotoRevealKey(0);
    photoParseGenRef.current += 1;
    photoShakeX.setValue(0);
    photoErrCodeOpacity.setValue(1);
    setAiBusy(false);
    setAiError(null);
    setAiResolved(null);
    setAiFieldTexts(null);
    setAiParseSeconds(null);
    setAiRevealKey(0);
    clearAiEvalStream();
    setWandSparks([]);
    setSaveBurst(null);
    setConfirmSaving(false);
    confirmScale.setValue(1);
    resultDim.setValue(0);
  }, [clearAiEvalStream, confirmScale, photoErrCodeOpacity, photoShakeX, resultDim, visible]);

  React.useEffect(() => {
    if (!visible) return;
    if (aiResolved && text.trim() !== aiResolved.text) {
      setAiResolved(null);
      setAiFieldTexts(null);
      setAiError(null);
      setAiParseSeconds(null);
      clearAiEvalStream();
    }
  }, [text, visible, aiResolved, clearAiEvalStream]);

  React.useEffect(() => {
    return () => clearAiEvalStream();
  }, [clearAiEvalStream]);

  const bumpAmountBlock = React.useCallback(() => {
    if (motionReduced) {
      amountBumpScale.setValue(1);
      return;
    }
    amountBumpScale.stopAnimation();
    amountBumpScale.setValue(1);
    Animated.sequence([
      Animated.timing(amountBumpScale, {
        toValue: 1.03,
        duration: Math.round(BIGNUM_BUMP_MS * 0.4),
        easing: HEALTH_MOTION_SPRING,
        useNativeDriver: true,
      }),
      Animated.timing(amountBumpScale, {
        toValue: 1,
        duration: Math.round(BIGNUM_BUMP_MS * 0.6),
        easing: HEALTH_MOTION_SPRING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [amountBumpScale, motionReduced]);

  const playConvertSweep = React.useCallback(() => {
    if (motionReduced) {
      convertSweep.setValue(0);
      return;
    }
    convertSweep.stopAnimation();
    convertSweep.setValue(0);
    Animated.timing(convertSweep, {
      toValue: 1,
      duration: 180,
      easing: HEALTH_MOTION_EASE,
      useNativeDriver: true,
    }).start(() => convertSweep.setValue(0));
  }, [convertSweep, motionReduced]);

  const selectManualType = React.useCallback(
    (next: ManualType) => {
      if (next === manualType) return;
      setManualType(next);
      setAmountText(MANUAL_DEFAULTS[next]);
      bumpAmountBlock();
      playConvertSweep();
    },
    [bumpAmountBlock, manualType, playConvertSweep],
  );

  // 进入手动 Tab：重播键盘/类型错峰入场（设计稿 prepMotion numkeys / mtype）
  React.useEffect(() => {
    if (!visible || tab !== 'manual') return;
    setManualEnterKey((k) => k + 1);
    amountBumpScale.setValue(1);
    convertSweep.setValue(0);
  }, [amountBumpScale, convertSweep, tab, visible]);

  // 光标 1.1s 闪烁（设计稿 05 caret）
  React.useEffect(() => {
    if (motionReduced || !visible || tab !== 'manual') {
      caretOpacity.stopAnimation();
      caretOpacity.setValue(1);
      return;
    }
    caretOpacity.setValue(1);
    const half = Math.round(CARET_BLINK_MS / 2);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(half),
        Animated.timing(caretOpacity, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(half),
        Animated.timing(caretOpacity, { toValue: 1, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      caretOpacity.setValue(1);
    };
  }, [caretOpacity, motionReduced, tab, visible]);

  // 营养类型指示器弹簧位移（设计稿 05 / N10）
  React.useEffect(() => {
    if (manualTypeRowWidth <= 0) return;
    const gap = 8;
    const count = MANUAL_TYPE_ORDER.length;
    const slot = (manualTypeRowWidth - gap * (count - 1)) / count;
    const index = Math.max(0, MANUAL_TYPE_ORDER.indexOf(manualType));
    const x = index * (slot + gap);
    if (motionReduced) {
      manualTypeIndicatorX.setValue(x);
      return;
    }
    Animated.timing(manualTypeIndicatorX, {
      toValue: x,
      duration: MANUAL_TYPE_INDICATOR_MS,
      easing: HEALTH_MOTION_SPRING,
      useNativeDriver: true,
    }).start();
  }, [manualType, manualTypeIndicatorX, manualTypeRowWidth, motionReduced]);

  // 魔法棒：静置 2.4s 常转；解析中 1s 加速（设计稿 8.1 / N08）
  React.useEffect(() => {
    if (motionReduced || !visible || tab !== 'ai') {
      wandSpin.stopAnimation();
      wandSpin.setValue(0);
      return;
    }
    wandSpin.setValue(0);
    const duration = aiBusy ? WAND_BUSY_SPIN_MS : WAND_IDLE_SPIN_MS;
    const loop = Animated.loop(
      Animated.timing(wandSpin, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      wandSpin.setValue(0);
    };
  }, [aiBusy, motionReduced, tab, visible, wandSpin]);

  // 解析中：结果区模糊降透明（设计稿 N08）
  React.useEffect(() => {
    Animated.timing(resultDim, {
      toValue: aiBusy ? 1 : 0,
      duration: motionReduced ? 0 : 200,
      easing: HEALTH_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [aiBusy, motionReduced, resultDim]);

  // 设计稿 04：识别中扫描线 2.4s 上下往返 + 辉光；成功/失败后停止
  React.useEffect(() => {
    const scanning = Boolean(visible && tab === 'photo' && photoUri && photoBusy);
    if (!scanning || motionReduced) {
      scanAnim.stopAnimation();
      scanAnim.setValue(0);
      return;
    }
    const half = PHOTO_SCAN_LOOP_MS / 2;
    scanAnim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, {
          toValue: 1,
          duration: half,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scanAnim, {
          toValue: 0,
          duration: half,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [motionReduced, photoBusy, photoUri, scanAnim, tab, visible]);

  const playPhotoErrMotion = React.useCallback(() => {
    if (motionReduced) {
      photoShakeX.setValue(0);
      photoErrCodeOpacity.setValue(1);
      return;
    }
    photoShakeX.setValue(0);
    photoErrCodeOpacity.setValue(0);
    const step = Math.round(PHOTO_ERR_SHAKE_MS / 5);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(photoShakeX, { toValue: -6, duration: step, easing: HEALTH_MOTION_EASE, useNativeDriver: true }),
        Animated.timing(photoShakeX, { toValue: 5, duration: step, easing: HEALTH_MOTION_EASE, useNativeDriver: true }),
        Animated.timing(photoShakeX, { toValue: -3, duration: step, easing: HEALTH_MOTION_EASE, useNativeDriver: true }),
        Animated.timing(photoShakeX, { toValue: 2, duration: step, easing: HEALTH_MOTION_EASE, useNativeDriver: true }),
        Animated.timing(photoShakeX, { toValue: 0, duration: step, easing: HEALTH_MOTION_EASE, useNativeDriver: true }),
      ]),
      Animated.timing(photoErrCodeOpacity, {
        toValue: 1,
        duration: PHOTO_ERR_SHAKE_MS,
        easing: HEALTH_MOTION_EASE,
        useNativeDriver: true,
      }),
    ]).start();
  }, [motionReduced, photoErrCodeOpacity, photoShakeX]);

  const measureInOverlay = React.useCallback((node: View | null, cb: (origin: { x: number; y: number }) => void) => {
    const overlay = sheetOverlayRef.current;
    if (!node || !overlay) {
      cb({ x: 40, y: 120 });
      return;
    }
    node.measureInWindow((nx, ny, nw, nh) => {
      overlay.measureInWindow((ox, oy) => {
        cb({ x: nx - ox + nw / 2, y: ny - oy + nh / 2 });
      });
    });
  }, []);

  const runAiIntakeParse = React.useCallback(async () => {
    const t = text.trim();
    if (!t || aiBusy) return;
    const gen = ++aiParseGenRef.current;
    setAiBusy(true);
    setAiError(null);
    clearAiEvalStream();

    if (!motionReduced) {
      measureInOverlay(wandBtnRef.current, (origin) => {
        setWandSparkOrigin(origin);
        setWandSparks(buildRadialSparks(WAND_SPARK_COUNT, '#F1C17D'));
      });
    }

    const started = Date.now();
    try {
      const r = await parseFoodIntakeFromText({ apiKey: getActiveAiLlmApiKey(), text: t });
      if (gen !== aiParseGenRef.current) return;
      if (!r.ok) {
        setAiError(r.error);
        setAiResolved(null);
        setAiFieldTexts(null);
        setAiParseSeconds(null);
        return;
      }
      const fields = aiIntakeFieldTextsFromData(r.data);
      setAiResolved({ text: t, data: r.data });
      setAiFieldTexts(fields);
      setAiParseSeconds(Math.max(0.1, (Date.now() - started) / 1000));
      setAiRevealKey((k) => k + 1);
      startAiEvalStream(fields.ai_evaluation);
    } catch (e) {
      if (gen !== aiParseGenRef.current) return;
      setAiError(e instanceof Error ? e.message : String(e));
      setAiResolved(null);
      setAiFieldTexts(null);
      setAiParseSeconds(null);
    } finally {
      if (gen === aiParseGenRef.current) setAiBusy(false);
    }
  }, [aiBusy, clearAiEvalStream, measureInOverlay, motionReduced, startAiEvalStream, text]);

  const clearAiInput = React.useCallback(() => {
    aiParseGenRef.current += 1;
    setText('');
    setAiResolved(null);
    setAiFieldTexts(null);
    setAiError(null);
    setAiParseSeconds(null);
    setAiBusy(false);
    clearAiEvalStream();
  }, [clearAiEvalStream]);

  const runPhotoParse = React.useCallback(
    async (base64: string, mime: string, note: string) => {
      const gen = ++photoParseGenRef.current;
      setPhotoBusy(true);
      setPhotoError(null);
      setPhotoNotFood(false);
      setPhotoFieldTexts(null);
      try {
        const r = await analyzeFoodNutritionFromImage({
          apiKey: getActiveAiLlmApiKey(),
          imageBase64: base64,
          imageMimeType: mime,
          ...(note.trim() ? { supplementText: note.trim() } : {}),
        });
        if (gen !== photoParseGenRef.current) return;
        if (!r.ok) {
          setPhotoError(r.error || '识别失败，请稍后重试');
          playPhotoErrMotion();
          return;
        }
        const d = r.data;
        const sum = d.protein_g + d.carbohydrate_g + d.calories_kcal;
        if (d.is_food !== 1 || sum <= 0) {
          setPhotoNotFood(true);
          setPhotoError(
            d.is_food !== 1
              ? `非食物图片无法识别（${PHOTO_NOT_FOOD_CODE}），请重新拍摄食物或改用手动记录。`
              : '估算营养均为 0，请换一张更清晰的食物照片。',
          );
          playPhotoErrMotion();
          return;
        }
        setPhotoFieldTexts({
          food_name: d.food_name?.trim() || '',
          hydration_ml: '0',
          protein_g: String(d.protein_g ?? 0),
          carbohydrate_g: String(d.carbohydrate_g ?? 0),
          calories_kcal: String(d.calories_kcal ?? 0),
          ai_evaluation: d.ai_evaluation ?? '',
        });
        setPhotoRevealKey((k) => k + 1);
        if (d.food_name?.trim() && !note.trim()) {
          setPhotoNote(d.food_name.trim());
        }
      } catch (e) {
        if (gen !== photoParseGenRef.current) return;
        setPhotoError(e instanceof Error ? e.message : String(e));
        playPhotoErrMotion();
      } finally {
        if (gen === photoParseGenRef.current) setPhotoBusy(false);
      }
    },
    [playPhotoErrMotion],
  );

  const applyPhotoAsset = React.useCallback(
    (uri: string, base64: string | null | undefined, mime: string) => {
      if (!base64) {
        setPhotoUri(uri);
        setPhotoBase64(null);
        setPhotoFieldTexts(null);
        setPhotoNotFood(false);
        setPhotoBusy(false);
        setPhotoError('无法读取图片数据，请重试或压缩后重选');
        playPhotoErrMotion();
        return;
      }
      const nextMime = mime.trim() || 'image/jpeg';
      setPhotoUri(uri);
      setPhotoBase64(base64);
      setPhotoMime(nextMime);
      setPhotoError(null);
      setPhotoNotFood(false);
      setPhotoFieldTexts(null);
      void runPhotoParse(base64, nextMime, photoNote);
    },
    [photoNote, playPhotoErrMotion, runPhotoParse],
  );

  const pickFromLibrary = React.useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhotoError('需要相册权限才能选图');
      playPhotoErrMotion();
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.85,
      base64: true,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset?.uri) return;
    applyPhotoAsset(asset.uri, asset.base64, asset.mimeType?.trim() || 'image/jpeg');
  }, [applyPhotoAsset, playPhotoErrMotion]);

  const takePhoto = React.useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setPhotoError('需要相机权限才能拍照');
      playPhotoErrMotion();
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.85,
      base64: true,
    });
    const asset = shot.assets?.[0];
    if (shot.canceled || !asset?.uri) return;
    applyPhotoAsset(asset.uri, asset.base64, asset.mimeType?.trim() || 'image/jpeg');
  }, [applyPhotoAsset, playPhotoErrMotion]);

  const playConfirmBurstThen = React.useCallback(
    async (action: () => void | Promise<void>) => {
      if (confirmSaving) return;
      setConfirmSaving(true);
      if (!motionReduced) {
        confirmScale.setValue(1);
        Animated.sequence([
          Animated.timing(confirmScale, {
            toValue: 0.97,
            duration: 80,
            easing: HEALTH_MOTION_EASE,
            useNativeDriver: true,
          }),
          Animated.timing(confirmScale, {
            toValue: 1,
            duration: 180,
            easing: HEALTH_MOTION_SPRING,
            useNativeDriver: true,
          }),
        ]).start();
        measureInOverlay(confirmBtnRef.current, (origin) => {
          setSaveBurst({
            sparks: buildRadialSparks(SAVE_BURST_COUNT, '#F1C17D'),
            origin,
          });
        });
      }
      try {
        await Promise.resolve(action());
      } finally {
        const wait = motionReduced ? 120 : 700;
        setTimeout(() => {
          setConfirmSaving(false);
          setSaveBurst(null);
          onClose();
        }, wait);
      }
    },
    [confirmSaving, confirmScale, measureInOverlay, motionReduced, onClose],
  );

  if (!shouldRender) return null;

  const amount = Number.isFinite(Number(amountText)) ? Number(amountText) : 0;
  const amountDisplay = amountText === '' ? '0' : amountText;
  const manualMeta = getManualMeta(manualType, waterCupMl);
  const manualAccent =
    manualType === 'hydration'
      ? nutrients.hydration
      : manualType === 'protein'
        ? nutrients.protein
        : manualType === 'carbohydrate'
          ? nutrients.carbohydrate
          : nutrients.calories;
  const clampedAmount = Math.min(Math.max(0, amount), manualMeta.limit);
  const photoReady = Boolean(photoFieldTexts && !photoBusy && !photoNotFood);
  const photoConfirmDisabled =
    tab === 'photo' && (!photoBase64 || photoBusy || photoNotFood);
  const aiConfirmDisabled = tab === 'ai' && !text.trim();
  const confirmDisabled = (tab === 'manual' && amount <= 0) || photoConfirmDisabled || aiConfirmDisabled;
  const aiReady = Boolean(aiResolved && aiResolved.text === text.trim() && aiFieldTexts && !aiBusy);

  const currentMetricTotal =
    manualType === 'hydration'
      ? dayTotals?.hydration ?? 0
      : manualType === 'protein'
        ? dayTotals?.protein ?? 0
        : manualType === 'carbohydrate'
          ? dayTotals?.carbohydrate ?? 0
          : dayTotals?.calories ?? 0;
  const targetForManual =
    manualType === 'hydration'
      ? intakeTargets?.hydration ?? 0
      : manualType === 'protein'
        ? intakeTargets?.protein ?? 0
        : manualType === 'carbohydrate'
          ? intakeTargets?.carbohydrate ?? 0
          : intakeTargets?.calories ?? 0;
  const afterMetricTotal = currentMetricTotal + clampedAmount;
  const pointsImpactLabel = previewPointsImpact({
    type: manualType,
    before: currentMetricTotal,
    after: afterMetricTotal,
    target: targetForManual,
    settings: metricPointsSettings,
  });

  const projectedDayTotals: RecordIntakeDayTotals = {
    hydration: (dayTotals?.hydration ?? 0) + (manualType === 'hydration' ? clampedAmount : 0),
    protein: (dayTotals?.protein ?? 0) + (manualType === 'protein' ? clampedAmount : 0),
    carbohydrate: (dayTotals?.carbohydrate ?? 0) + (manualType === 'carbohydrate' ? clampedAmount : 0),
    calories: (dayTotals?.calories ?? 0) + (manualType === 'calories' ? clampedAmount : 0),
  };

  const headerTitle =
    tab === 'photo' ? '拍照记录' : tab === 'manual' ? '手动记录' : '记录新摄入';
  const headerSubtitle =
    tab === 'photo'
      ? '识别结果同样可编辑'
      : tab === 'manual'
        ? '只填一项，四种营养独立结算'
        : `${dateLabel?.trim() || '今日'} · 今日已有 ${todayRecordCount} 条`;

  const confirmLabel =
    tab === 'ai' ? '确认写入并结算积分' : tab === 'photo' ? '写入这条记录' : '写入记录';

  const softHydration = isDark ? 'rgba(79,143,168,0.18)' : 'rgba(79,143,168,0.14)';
  const softProtein = isDark ? 'rgba(196,120,82,0.18)' : 'rgba(196,120,82,0.14)';
  const softCarb = isDark ? 'rgba(196,160,74,0.18)' : 'rgba(196,160,74,0.14)';
  const softCal = isDark ? 'rgba(95,138,110,0.18)' : 'rgba(95,138,110,0.14)';

  const dayTotalTiles = [
    {
      key: 'hydration',
      label: '水分',
      unit: 'ml',
      value: formatMetricNumber(dayTotals?.hydration ?? 0),
      accent: nutrients.hydration,
      soft: softHydration,
    },
    {
      key: 'protein',
      label: '蛋白',
      unit: 'g',
      value: formatMetricNumber(dayTotals?.protein ?? 0),
      accent: nutrients.protein,
      soft: softProtein,
    },
    {
      key: 'carbohydrate',
      label: '碳水',
      unit: 'g',
      value: formatMetricNumber(dayTotals?.carbohydrate ?? 0),
      accent: nutrients.carbohydrate,
      soft: softCarb,
    },
    {
      key: 'calories',
      label: '热量',
      unit: 'kcal',
      value: formatMetricNumber(dayTotals?.calories ?? 0),
      accent: nutrients.calories,
      soft: softCal,
    },
  ];

  const projectedDayTotalTiles = [
    {
      key: 'hydration',
      label: '水分',
      unit: 'ml',
      value: formatMetricNumber(projectedDayTotals.hydration),
      accent: nutrients.hydration,
      soft: softHydration,
    },
    {
      key: 'protein',
      label: '蛋白',
      unit: 'g',
      value: formatMetricNumber(projectedDayTotals.protein),
      accent: nutrients.protein,
      soft: softProtein,
    },
    {
      key: 'carbohydrate',
      label: '碳水',
      unit: 'g',
      value: formatMetricNumber(projectedDayTotals.carbohydrate),
      accent: nutrients.carbohydrate,
      soft: softCarb,
    },
    {
      key: 'calories',
      label: '热量',
      unit: 'kcal',
      value: formatMetricNumber(projectedDayTotals.calories),
      accent: nutrients.calories,
      soft: softCal,
    },
  ];

  const reuseManual = (item: RecordIntakeRecentManual) => {
    setManualType(item.type);
    const raw = Number.isFinite(item.amount) ? String(item.amount) : '0';
    setAmountText(raw.includes('.') ? raw : String(Math.round(item.amount)));
    bumpAmountBlock();
    playConvertSweep();
  };

  const handleConfirm = async () => {
    if (confirmSaving) return;
    if (tab === 'manual' && clampedAmount <= 0) return;
    if (tab === 'photo' && photoConfirmDisabled) return;
    if (tab === 'ai') {
      const t = text.trim();
      if (!t) return;
      const hasParsedPreview = aiResolved?.text === t && aiFieldTexts != null;
      // 设计稿 03 / N13：按钮压 .97 → 已保存 ✓ + 粒子光环 → 再收起
      await playConfirmBurstThen(() =>
        onConfirm?.({
          mode: 'ai',
          text: t,
          ...(hasParsedPreview ? { parsed: foodTextIntakeFromFieldTexts(aiFieldTexts) } : {}),
        }),
      );
      return;
    }
    if (tab === 'photo' && photoBase64) {
      const note = photoNote.trim();
      const hasParsedPreview = photoReady && photoFieldTexts != null;
      await playConfirmBurstThen(() =>
        onConfirm?.({
          mode: 'photo',
          imageBase64: photoBase64,
          imageMimeType: photoMime,
          sourceImageUri: photoUri,
          ...(note ? { photoNote: note } : {}),
          ...(hasParsedPreview ? { parsed: photoIntakeFromFieldTexts(photoFieldTexts) } : {}),
        }),
      );
      return;
    }
    // 手动 Tab 无底部确认条粒子锚点，直接写入关闭
    await Promise.resolve(
      onConfirm?.({
        mode: 'manual',
        amount: clampedAmount,
        unit: getUnitByType(manualType),
        type: manualType,
      }),
    );
    onClose();
  };

  const onPressDigit = (digit: string) => {
    setAmountText((prev) => {
      const nextPrev = prev === '' ? '0' : prev;
      if (nextPrev.includes('.')) {
        const [, decimals = ''] = nextPrev.split('.');
        if (decimals.length >= 2) return nextPrev;
        if (nextPrev.length >= 7) return nextPrev;
        return `${nextPrev}${digit}`;
      }
      if (nextPrev === '0') return digit;
      if (nextPrev.length >= 5) return nextPrev;
      return `${nextPrev}${digit}`;
    });
    bumpAmountBlock();
    playConvertSweep();
  };

  const onPressDot = () => {
    setAmountText((prev) => {
      const nextPrev = prev === '' ? '0' : prev;
      if (nextPrev.includes('.')) return nextPrev;
      if (nextPrev.length >= 6) return nextPrev;
      return `${nextPrev}.`;
    });
    bumpAmountBlock();
  };

  const onPressBackspace = () => {
    setAmountText((prev) => {
      const nextPrev = prev === '' ? '0' : prev;
      if (nextPrev.length <= 1) return '0';
      const next = nextPrev.slice(0, -1);
      if (next === '' || next === '-') return '0';
      return next;
    });
    bumpAmountBlock();
    playConvertSweep();
  };

  const appendPhrase = (phrase: string) => {
    const p = phrase.trim();
    if (!p) return;
    setText((prev) => {
      const cur = prev.trim();
      if (!cur) return p.slice(0, AI_TEXT_MAX);
      const next = `${cur}，${p}`;
      return next.slice(0, AI_TEXT_MAX);
    });
  };

  const scanTranslateY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 152],
  });
  const scanLineOpacity = scanAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 1, 0.3],
  });
  const wandSpinRotate = wandSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const resultDimOpacity = resultDim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.18],
  });
  const aiEvalStreaming = Boolean(aiEvalStream);
  const aiEvalShownText = aiEvalStream?.shown ?? aiFieldTexts?.ai_evaluation ?? '';
  const wandLabel = aiReady ? '重新预解析' : '魔法棒预解析';
  const photoCaptionTitle = photoBusy
    ? `${photoNote.trim() || '食物照片'} · 识别中`
    : photoNotFood
      ? '无法识别 · 非食物'
      : photoReady
        ? `${photoFieldTexts?.food_name?.trim() || photoNote.trim() || '食物照片'} · 待确认`
        : `${photoNote.trim() || '食物照片'} · 待写入识别`;
  const photoCaptionSub = photoBusy
    ? '已上传 1 张 · 正在估算营养'
    : photoNotFood
      ? `错误码 ${PHOTO_NOT_FOOD_CODE}`
      : photoReady
        ? `识别到 ${editableMetricCount(photoFieldTexts!)} 项 · 可编辑后写入`
        : '已上传 1 张 · 写入后后台解析';

  return (
    <Modal transparent visible onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay} ref={sheetOverlayRef} collapsable={false}>
        <Pressable style={styles.backdropPressable} onPress={onClose}>
          <Animated.View
            style={[
              styles.backdrop,
              { opacity: backdropOpacity, backgroundColor: isDark ? 'rgba(0,0,0,0.62)' : 'rgba(30,42,36,0.38)' },
            ]}
          />
        </Pressable>
        <SparkBurstOverlay
          sparks={wandSparks}
          origin={wandSparkOrigin}
          onDone={() => setWandSparks([])}
        />
        {saveBurst ? (
          <>
            <SparkBurstOverlay
              sparks={saveBurst.sparks}
              origin={saveBurst.origin}
              onDone={() => setSaveBurst(null)}
            />
            <SuccessRing origin={saveBurst.origin} color="#9FD3B4" />
          </>
        ) : null}

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View
            style={[styles.sheet, { backgroundColor: hh.paper, transform: [{ translateY }] }]}
          >
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: isDark ? 'rgba(230,221,206,0.22)' : 'rgba(30,57,50,0.16)' }]} />
            </View>

            <View style={styles.header}>
              <View style={styles.headerTextCol}>
                <Text style={[styles.title, { color: hh.ink, fontFamily: fonts.serif }]}>{headerTitle}</Text>
                <Text style={[styles.subtitle, { color: hh.muted }]} numberOfLines={1}>
                  {headerSubtitle}
                </Text>
              </View>
              <Pressable
                style={[styles.closeBtn, { backgroundColor: hh.card, borderColor: hh.line }]}
                onPress={onClose}
                accessibilityLabel="关闭"
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
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setTab(item.key)}
                      style={[
                        styles.tabBtn,
                        active && {
                          backgroundColor: hh.card,
                          shadowColor: hh.shadow,
                          shadowOpacity: isDark ? 0.25 : 0.08,
                          shadowRadius: 8,
                          shadowOffset: { width: 0, height: 2 },
                          elevation: 2,
                        },
                      ]}
                    >
                      <MaterialIcons name={item.icon} size={15} color={active ? hh.pine : hh.muted} />
                      <Text style={[styles.tabText, { color: active ? hh.pine : hh.muted }]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {tab === 'ai' ? (
                <View style={styles.sectionStack}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.sectionLabel, { color: hh.ink }]}>吃了什么</Text>
                    <Text style={[styles.sectionHint, { color: hh.faint }]}>描述越具体，解析越准</Text>
                  </View>

                  <View style={[styles.textareaWrap, { backgroundColor: hh.card, borderColor: hh.line }]}>
                    <TextInput
                      value={text}
                      onChangeText={(v) => setText(v.slice(0, AI_TEXT_MAX))}
                      multiline
                      editable={!aiBusy}
                      placeholder="午饭吃了番茄牛腩一碗，米饭半碗，另外来一杯冰美式。"
                      placeholderTextColor={hh.faint}
                      style={[styles.textarea, { color: hh.ink }]}
                      textAlignVertical="top"
                    />
                    <Text style={[styles.charCount, { color: hh.faint }]}>
                      {text.length} / {AI_TEXT_MAX}
                    </Text>
                    {aiBusy ? (
                      <View
                        style={[
                          styles.aiBusyOverlay,
                          { backgroundColor: isDark ? 'rgba(18,26,22,0.55)' : 'rgba(245,243,232,0.72)' },
                        ]}
                      >
                        <Text style={[styles.aiBusyText, { color: hh.ink }]}>解析中 · 正在识别 4 项营养…</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.aiActionRow}>
                    <View ref={wandBtnRef} collapsable={false} style={{ flex: 1 }}>
                      <Pressable
                        disabled={!text.trim() || aiBusy}
                        onPress={() => void runAiIntakeParse()}
                        style={({ pressed }) => [
                          styles.primaryActionBtn,
                          {
                            backgroundColor: hh.pine,
                            opacity: !text.trim() ? 0.45 : pressed || aiBusy ? 0.92 : 1,
                            transform: [{ scale: pressed && !aiBusy ? 0.97 : 1 }],
                          },
                        ]}
                      >
                        <Animated.View style={{ transform: [{ rotate: wandSpinRotate }] }}>
                          <MaterialIcons name="auto-awesome" size={18} color="#F1C17D" />
                        </Animated.View>
                        <Text style={[styles.primaryActionText, { color: hh.onPine }]}>
                          {aiBusy ? '解析中…' : wandLabel}
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={clearAiInput}
                      disabled={aiBusy}
                      style={({ pressed }) => [
                        styles.secondaryActionBtn,
                        {
                          backgroundColor: hh.card,
                          borderColor: hh.lineStrong,
                          opacity: aiBusy ? 0.5 : pressed ? 0.9 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.secondaryActionText, { color: hh.inkSoft }]}>清空</Text>
                    </Pressable>
                  </View>

                  {aiError ? <Text style={styles.errorText}>{aiError}</Text> : null}

                  {aiBusy && !aiFieldTexts ? (
                    <View style={styles.statusRow}>
                      <View style={[styles.statusDot, { backgroundColor: hh.amber }]} />
                      <Text style={[styles.statusText, { color: hh.amber }]}>解析中 · 正在识别 4 项营养…</Text>
                    </View>
                  ) : null}

                  {aiFieldTexts && (aiReady || aiBusy) ? (
                    <>
                      <View style={styles.statusRow}>
                        <View
                          style={[
                            styles.statusDot,
                            { backgroundColor: aiBusy ? hh.amber : nutrients.calories },
                          ]}
                        />
                        <Text
                          style={[styles.statusText, { color: aiBusy ? hh.amber : nutrients.calories }]}
                        >
                          {aiBusy
                            ? '解析中 · 正在识别 4 项营养…'
                            : `已预解析 · ${editableMetricCount(aiFieldTexts)} 项数值可编辑${
                                aiParseSeconds != null ? ` · 用时 ${aiParseSeconds.toFixed(1)}s` : ''
                              }`}
                        </Text>
                      </View>

                      <Animated.View
                        style={[
                          styles.resultCard,
                          {
                            backgroundColor: hh.card,
                            borderColor: hh.line,
                            opacity: resultDimOpacity,
                          },
                        ]}
                      >
                        <View style={styles.resultCardHeader}>
                          <Text style={[styles.resultCardTitle, { color: hh.ink }]}>识别结果</Text>
                          <View style={[styles.editableBadge, { backgroundColor: hh.aiTagBg }]}>
                            <Text style={[styles.editableBadgeText, { color: hh.aiTagText }]}>可编辑</Text>
                          </View>
                        </View>
                        <NutrientTiles
                          editable={!aiBusy && !aiEvalStreaming}
                          reduceMotion={motionReduced}
                          staggerIn={aiReady}
                          staggerKey={aiRevealKey}
                          onChange={(key, value) =>
                            setAiFieldTexts((prev) => (prev ? { ...prev, [key]: value } : prev))
                          }
                          items={[
                            {
                              key: 'hydration_ml',
                              label: '水分',
                              unit: 'ml',
                              value: aiFieldTexts.hydration_ml,
                              accent: nutrients.hydration,
                              soft: softHydration,
                            },
                            {
                              key: 'protein_g',
                              label: '蛋白',
                              unit: 'g',
                              value: aiFieldTexts.protein_g,
                              accent: nutrients.protein,
                              soft: softProtein,
                            },
                            {
                              key: 'carbohydrate_g',
                              label: '碳水',
                              unit: 'g',
                              value: aiFieldTexts.carbohydrate_g,
                              accent: nutrients.carbohydrate,
                              soft: softCarb,
                            },
                            {
                              key: 'calories_kcal',
                              label: '热量',
                              unit: 'kcal',
                              value: aiFieldTexts.calories_kcal,
                              accent: nutrients.calories,
                              soft: softCal,
                            },
                          ]}
                        />
                        <View style={[styles.aiEvalBox, { backgroundColor: hh.sageSoft }]}>
                          <Text style={[styles.aiEvalLabel, { color: hh.pineSoft }]}>AI 评价</Text>
                          {aiEvalStreaming ? (
                            <Text style={[styles.aiEvalInput, { color: hh.inkSoft }]}>
                              {aiEvalShownText}
                              <Text style={{ color: hh.pineSoft }}>▍</Text>
                            </Text>
                          ) : (
                            <TextInput
                              value={aiFieldTexts.ai_evaluation}
                              onChangeText={(v) =>
                                setAiFieldTexts((prev) => (prev ? { ...prev, ai_evaluation: v } : prev))
                              }
                              multiline
                              editable={!aiBusy}
                              placeholder="预解析后可编辑评价"
                              placeholderTextColor={hh.faint}
                              style={[styles.aiEvalInput, { color: hh.inkSoft }]}
                            />
                          )}
                        </View>
                      </Animated.View>
                    </>
                  ) : null}

                  {recentPhrases.length > 0 ? (
                    <View style={styles.helperBlock}>
                      <Text style={[styles.helperTitle, { color: hh.ink }]}>最近常用</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                        {recentPhrases.map((phrase) => (
                          <Pressable
                            key={phrase}
                            onPress={() => appendPhrase(phrase)}
                            style={({ pressed }) => [
                              styles.chip,
                              {
                                backgroundColor: hh.card,
                                borderColor: hh.line,
                                opacity: pressed ? 0.88 : 1,
                              },
                            ]}
                          >
                            <Text style={[styles.chipText, { color: hh.inkSoft }]}>{phrase}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}

                  <View style={[styles.tipsCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                    <Text style={[styles.helperTitle, { color: hh.ink }]}>AI 记录小贴士</Text>
                    {AI_TIPS.map((tip) => (
                      <View key={tip.label} style={[styles.tipRow, { borderTopColor: hh.line }]}>
                        <Text style={[styles.tipLabel, { color: hh.inkSoft }]}>{tip.label}</Text>
                        <Text style={[styles.tipExample, { color: hh.muted }]}>{tip.example}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={[styles.todayCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                    <View style={styles.todayHeader}>
                      <Text style={[styles.helperTitle, { color: hh.ink, marginBottom: 0 }]}>今日已记录</Text>
                      <Text style={[styles.todayHint, { color: hh.faint }]}>写入前的总量</Text>
                    </View>
                    <NutrientTiles items={dayTotalTiles} />
                  </View>
                </View>
              ) : tab === 'photo' ? (
                <View style={styles.sectionStack}>
                  <View
                    style={[
                      styles.photoStage,
                      {
                        backgroundColor: isDark ? 'rgba(127,166,149,0.16)' : '#E4EEE7',
                        borderColor: isDark ? 'rgba(169,199,185,0.35)' : 'rgba(90,130,110,0.45)',
                      },
                    ]}
                  >
                    {photoUri ? (
                      <Image source={{ uri: photoUri }} style={styles.photoStageImage} contentFit="cover" />
                    ) : (
                      <View style={styles.photoStageEmpty}>
                        <View style={[styles.photoCamCircle, { backgroundColor: hh.card }]}>
                          <MaterialIcons name="photo-camera" size={28} color={hh.pine} />
                        </View>
                        <Text style={[styles.photoStageTitle, { color: hh.ink }]}>拍摄或选择食物照片</Text>
                        <Text style={[styles.photoStageSub, { color: hh.muted }]}>识别后可在写入前核对数值</Text>
                      </View>
                    )}
                    {photoUri ? (
                      <>
                        {photoBusy ? (
                          <>
                            <Animated.View
                              pointerEvents="none"
                              style={[
                                styles.scanGlow,
                                {
                                  backgroundColor: PHOTO_SCAN_GLOW,
                                  opacity: scanLineOpacity,
                                  transform: [{ translateY: scanTranslateY }],
                                },
                              ]}
                            />
                            <Animated.View
                              pointerEvents="none"
                              style={[
                                styles.scanLine,
                                {
                                  backgroundColor: PHOTO_SCAN_GLOW,
                                  opacity: scanLineOpacity,
                                  transform: [{ translateY: scanTranslateY }],
                                  shadowColor: PHOTO_SCAN_GLOW,
                                },
                              ]}
                            />
                          </>
                        ) : null}
                        <View style={styles.photoStageCaption}>
                          <Text style={[styles.photoStageTitle, { color: hh.onPine }]}>{photoCaptionTitle}</Text>
                          <Text style={[styles.photoStageSub, { color: 'rgba(247,245,236,0.82)' }]}>
                            {photoCaptionSub}
                          </Text>
                        </View>
                      </>
                    ) : null}
                  </View>

                  <View style={styles.photoActionRow}>
                    <View style={[styles.photoActionBtnWrap, photoBusy && { opacity: 0.55 }]}>
                      <MotionPressable
                        onPress={() => void pickFromLibrary()}
                        disabled={photoBusy}
                        pressScale={0.96}
                        pressOpacity={1}
                        style={[
                          styles.photoActionBtn,
                          { backgroundColor: hh.card, borderColor: hh.lineStrong },
                        ]}
                      >
                        <MaterialIcons name="photo-library" size={18} color={hh.pine} />
                        <Text style={[styles.photoActionText, { color: hh.ink }]}>相册选择</Text>
                      </MotionPressable>
                    </View>
                    <View style={[styles.photoActionBtnWrap, photoBusy && { opacity: 0.55 }]}>
                      <MotionPressable
                        onPress={() => void takePhoto()}
                        disabled={photoBusy}
                        pressScale={0.96}
                        pressOpacity={1}
                        style={[
                          styles.photoActionBtn,
                          { backgroundColor: hh.card, borderColor: hh.lineStrong },
                        ]}
                      >
                        <MaterialIcons name="photo-camera" size={18} color={hh.pine} />
                        <Text style={[styles.photoActionText, { color: hh.ink }]}>直接拍照</Text>
                      </MotionPressable>
                    </View>
                  </View>

                  <Animated.View
                    style={[
                      styles.warnBanner,
                      {
                        backgroundColor: isDark ? 'rgba(196,120,82,0.16)' : '#F8E8E4',
                        borderColor: isDark ? 'rgba(196,120,82,0.35)' : '#EBCBBB',
                        borderWidth: StyleSheet.hairlineWidth,
                        transform: [{ translateX: photoShakeX }],
                      },
                    ]}
                  >
                    <MaterialIcons name="warning-amber" size={18} color={nutrients.protein} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.warnTitle, { color: hh.ink }]}>
                        {photoNotFood ? '非食物图片无法识别' : '非食物图片将无法识别'}
                      </Text>
                      <Text style={[styles.warnBody, { color: hh.inkSoft }]}>
                        {photoError
                          ? photoError
                          : '若识别失败会返回错误码，请重新拍摄食物或改用手动记录。'}
                      </Text>
                      <Animated.Text
                        style={[
                          styles.warnCode,
                          { color: nutrients.protein, opacity: photoErrCodeOpacity },
                        ]}
                      >
                        {PHOTO_NOT_FOOD_CODE}
                      </Animated.Text>
                    </View>
                  </Animated.View>

                  {photoFieldTexts ? (
                    <View style={[styles.resultCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                      <View style={styles.resultCardHeader}>
                        <Text style={[styles.resultCardTitle, { color: hh.ink }]}>
                          识别到 {editableMetricCount(photoFieldTexts)} 项
                        </Text>
                        <View style={[styles.editableBadge, { backgroundColor: hh.aiTagBg }]}>
                          <Text style={[styles.editableBadgeText, { color: hh.aiTagText }]}>待确认</Text>
                        </View>
                      </View>
                      <NutrientTiles
                        editable={photoReady}
                        reduceMotion={motionReduced}
                        staggerIn={photoReady}
                        staggerKey={photoRevealKey}
                        onChange={(key, value) =>
                          setPhotoFieldTexts((prev) => (prev ? { ...prev, [key]: value } : prev))
                        }
                        items={[
                          {
                            key: 'hydration_ml',
                            label: '水分',
                            unit: 'ml',
                            value: photoFieldTexts.hydration_ml,
                            accent: nutrients.hydration,
                            soft: softHydration,
                          },
                          {
                            key: 'protein_g',
                            label: '蛋白',
                            unit: 'g',
                            value: photoFieldTexts.protein_g,
                            accent: nutrients.protein,
                            soft: softProtein,
                          },
                          {
                            key: 'carbohydrate_g',
                            label: '碳水',
                            unit: 'g',
                            value: photoFieldTexts.carbohydrate_g,
                            accent: nutrients.carbohydrate,
                            soft: softCarb,
                          },
                          {
                            key: 'calories_kcal',
                            label: '热量',
                            unit: 'kcal',
                            value: photoFieldTexts.calories_kcal,
                            accent: nutrients.calories,
                            soft: softCal,
                          },
                        ]}
                      />
                      {photoFieldTexts.ai_evaluation.trim() ? (
                        <View style={[styles.aiEvalBox, { backgroundColor: hh.sageSoft }]}>
                          <Text style={[styles.aiEvalLabel, { color: hh.pineSoft }]}>AI 评价</Text>
                          <TextInput
                            value={photoFieldTexts.ai_evaluation}
                            onChangeText={(v) =>
                              setPhotoFieldTexts((prev) => (prev ? { ...prev, ai_evaluation: v } : prev))
                            }
                            multiline
                            editable={photoReady}
                            style={[styles.aiEvalInput, { color: hh.inkSoft }]}
                          />
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={[styles.photoNoteWrap, { backgroundColor: hh.card, borderColor: hh.line }]}>
                    <Text style={[styles.photoNoteLabel, { color: hh.muted }]}>文字说明（选填）</Text>
                    <TextInput
                      value={photoNote}
                      onChangeText={setPhotoNote}
                      multiline
                      editable={!photoBusy}
                      placeholder="例如：半份、两人分食、菜名补充…"
                      placeholderTextColor={hh.faint}
                      style={[styles.photoNoteInput, { color: hh.ink }]}
                      textAlignVertical="top"
                    />
                  </View>

                  <View style={[styles.tipsCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                    <View style={styles.todayHeader}>
                      <Text style={[styles.helperTitle, { color: hh.ink, marginBottom: 0 }]}>拍摄建议</Text>
                      <Text style={[styles.todayHint, { color: hh.faint }]}>识别率更高</Text>
                    </View>
                    {PHOTO_TIPS.map((tip) => (
                      <View key={tip.label} style={[styles.tipRow, { borderTopColor: hh.line }]}>
                        <Text style={[styles.tipLabel, { color: hh.inkSoft }]}>{tip.label}</Text>
                        <Text style={[styles.tipExample, { color: hh.muted }]}>{tip.detail}</Text>
                      </View>
                    ))}
                  </View>

                  {recentPhotos.length > 0 ? (
                    <View style={[styles.tipsCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                      <View style={styles.todayHeader}>
                        <Text style={[styles.helperTitle, { color: hh.ink, marginBottom: 0 }]}>最近拍照</Text>
                        <Text style={[styles.todayHint, { color: hh.faint }]}>可再次识别</Text>
                      </View>
                      {recentPhotos.map((item) => (
                        <View key={item.id} style={[styles.recentPhotoRow, { borderTopColor: hh.line }]}>
                          <RecentPhotoThumb uri={item.imageUri} />
                          <View style={styles.recentPhotoMeta}>
                            <Text style={[styles.recentPhotoTitle, { color: hh.ink }]} numberOfLines={1}>
                              {item.title}
                            </Text>
                            <Text style={[styles.recentPhotoSub, { color: hh.muted }]}>
                              {item.timeLabel}
                              {item.caloriesLabel ? ` · ${item.caloriesLabel}` : ''}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => {
                              setPhotoNote(item.title);
                              void takePhoto();
                            }}
                            style={({ pressed }) => [
                              styles.againBtn,
                              {
                                backgroundColor: hh.cardMuted,
                                borderColor: hh.line,
                                opacity: pressed ? 0.88 : 1,
                              },
                            ]}
                          >
                            <Text style={[styles.againBtnText, { color: hh.pine }]}>再来一次</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.sectionStack}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.sectionLabel, { color: hh.ink }]}>营养类型</Text>
                    <Text style={[styles.sectionHint, { color: hh.faint }]}>一次只记录一种</Text>
                  </View>
                  <View
                    style={styles.manualTypeRow}
                    onLayout={(e) => {
                      const w = e.nativeEvent.layout.width;
                      if (w > 0 && Math.abs(w - manualTypeRowWidth) > 0.5) setManualTypeRowWidth(w);
                    }}
                  >
                    {manualTypeRowWidth > 0 ? (
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          styles.manualTypeIndicator,
                          {
                            width: (manualTypeRowWidth - 8 * (MANUAL_TYPE_ORDER.length - 1)) / MANUAL_TYPE_ORDER.length,
                            backgroundColor: hh.pine,
                            transform: [{ translateX: manualTypeIndicatorX }],
                          },
                        ]}
                      />
                    ) : null}
                    {(
                      [
                        { key: 'hydration' as const, label: '水分', icon: 'water-drop' as const, accent: nutrients.hydration },
                        { key: 'protein' as const, label: '蛋白质', icon: 'egg' as const, accent: nutrients.protein },
                        { key: 'carbohydrate' as const, label: '碳水', icon: 'rice-bowl' as const, accent: nutrients.carbohydrate },
                        { key: 'calories' as const, label: '热量', icon: 'local-fire-department' as const, accent: nutrients.calories },
                      ] as const
                    ).map((item, index) => {
                      const selected = manualType === item.key;
                      return (
                        <StaggerRiseItem
                          key={item.key}
                          index={index}
                          animKey={manualEnterKey}
                          reduceMotion={motionReduced}
                          style={styles.manualTypeCardWrap}
                        >
                          <Pressable
                            onPress={() => selectManualType(item.key)}
                            style={({ pressed }) => [
                              styles.manualTypeCard,
                              selected
                                ? { backgroundColor: 'transparent', borderColor: 'transparent' }
                                : { backgroundColor: hh.card, borderColor: hh.line },
                              pressed && { transform: [{ scale: 0.94 }] },
                            ]}
                          >
                            <MaterialIcons
                              name={item.icon}
                              size={18}
                              color={selected ? hh.onPine : item.accent}
                            />
                            <Text style={[styles.manualTypeText, { color: selected ? hh.onPine : hh.inkSoft }]}>
                              {item.label}
                            </Text>
                          </Pressable>
                        </StaggerRiseItem>
                      );
                    })}
                  </View>

                  <View style={[styles.valuePanel, { backgroundColor: hh.card, borderColor: hh.line }]}>
                    <View style={styles.valuePanelTop}>
                      <Text style={[styles.valueLabel, { color: hh.muted }]}>数值</Text>
                      <Text style={[styles.valueLimit, { color: hh.faint }]}>
                        上限 {manualMeta.limit.toLocaleString('zh-CN')}
                      </Text>
                    </View>
                    <Animated.View style={[styles.valueMainRow, { transform: [{ scale: amountBumpScale }] }]}>
                      <Text style={[styles.valueNumber, { color: manualAccent }]}>{amountDisplay}</Text>
                      <Text style={[styles.valueUnit, { color: manualAccent }]}>{manualMeta.unitText}</Text>
                      <Animated.View
                        style={[styles.valueCursor, { backgroundColor: hh.amber, opacity: caretOpacity }]}
                      />
                    </Animated.View>
                    <View style={styles.convertHintWrap}>
                      <Text style={[styles.valueHintText, { color: hh.muted }]}>
                        {manualMeta.convertHint(clampedAmount)}
                      </Text>
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          styles.convertUnderline,
                          {
                            backgroundColor: hh.amber,
                            opacity: convertSweep.interpolate({
                              inputRange: [0, 0.15, 0.85, 1],
                              outputRange: [0, 1, 1, 0],
                            }),
                            transform: [
                              {
                                scaleX: convertSweep.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0.12, 1],
                                }),
                              },
                            ],
                          },
                        ]}
                      />
                    </View>

                    <View style={styles.keypadGrid}>
                      {(
                        [
                          { id: '1', kind: 'digit' as const, label: '1' },
                          { id: '2', kind: 'digit' as const, label: '2' },
                          { id: '3', kind: 'digit' as const, label: '3' },
                          { id: '4', kind: 'digit' as const, label: '4' },
                          { id: '5', kind: 'digit' as const, label: '5' },
                          { id: '6', kind: 'digit' as const, label: '6' },
                          { id: '7', kind: 'digit' as const, label: '7' },
                          { id: '8', kind: 'digit' as const, label: '8' },
                          { id: '9', kind: 'digit' as const, label: '9' },
                          { id: 'del', kind: 'del' as const, label: '' },
                          { id: '0', kind: 'digit' as const, label: '0' },
                          { id: 'dot', kind: 'dot' as const, label: '.' },
                        ] as const
                      ).map((key, index) => (
                        <StaggerRiseItem
                          key={`${key.id}-${manualEnterKey}`}
                          index={index}
                          animKey={manualEnterKey}
                          reduceMotion={motionReduced}
                          style={styles.keypadBtnWrap}
                        >
                          <Pressable
                            onPress={() => {
                              if (key.kind === 'digit') onPressDigit(key.label);
                              else if (key.kind === 'dot') onPressDot();
                              else onPressBackspace();
                            }}
                            style={({ pressed }) => [
                              styles.keypadBtn,
                              key.kind === 'del'
                                ? { backgroundColor: hh.paperAlt, borderColor: hh.lineStrong }
                                : { backgroundColor: hh.cardMuted, borderColor: hh.line },
                              pressed && { transform: [{ scale: 0.92 }] },
                            ]}
                          >
                            {key.kind === 'del' ? (
                              <MaterialIcons name="backspace" size={20} color={hh.inkSoft} />
                            ) : (
                              <Text style={[styles.keypadBtnText, { color: hh.ink }]}>{key.label}</Text>
                            )}
                          </Pressable>
                        </StaggerRiseItem>
                      ))}
                    </View>
                  </View>

                  <View style={[styles.impactCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                    <View style={styles.impactRow}>
                      <Text style={[styles.impactLabel, { color: hh.muted }]}>写入后今日{manualMeta.label}</Text>
                      <Text style={[styles.impactValue, { color: hh.ink }]}>
                        {formatPreviewNumber(currentMetricTotal)}
                        <Text style={{ color: hh.faint }}> → </Text>
                        <Text
                          style={{
                            color:
                              manualType === 'hydration'
                                ? nutrients.hydration
                                : manualType === 'protein'
                                  ? nutrients.protein
                                  : manualType === 'carbohydrate'
                                    ? nutrients.carbohydrate
                                    : nutrients.calories,
                          }}
                        >
                          {formatPreviewNumber(afterMetricTotal)}
                        </Text>
                        {targetForManual > 0 ? (
                          <Text style={{ color: hh.faint }}>
                            {' '}
                            / {formatPreviewNumber(targetForManual)} {manualMeta.unitText}
                          </Text>
                        ) : (
                          <Text style={{ color: hh.faint }}> {manualMeta.unitText}</Text>
                        )}
                      </Text>
                    </View>
                    {pointsImpactLabel ? (
                      <View style={[styles.impactRow, { borderTopColor: hh.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 }]}>
                        <Text style={[styles.impactLabel, { color: hh.muted }]}>积分影响</Text>
                        <Text style={[styles.impactValue, { color: hh.pine }]}>{pointsImpactLabel}</Text>
                      </View>
                    ) : null}
                  </View>

                  <Pressable
                    disabled={confirmDisabled}
                    onPress={() => {
                      void handleConfirm();
                    }}
                    style={({ pressed }) => [
                      styles.confirmBtn,
                      {
                        backgroundColor: hh.pine,
                        opacity: confirmDisabled ? 0.42 : pressed ? 0.94 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.confirmText, { color: hh.onPine }]}>{confirmLabel}</Text>
                  </Pressable>

                  <View style={styles.helperBlock}>
                    <View style={styles.labelRow}>
                      <Text style={[styles.sectionLabel, { color: hh.ink }]}>单位换算</Text>
                      <Text style={[styles.sectionHint, { color: hh.faint }]}>常用参照</Text>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                      {UNIT_HINTS.map((hint) => (
                        <View
                          key={hint}
                          style={[styles.chip, { backgroundColor: hh.card, borderColor: hh.line }]}
                        >
                          <Text style={[styles.chipText, { color: hh.muted }]}>{hint}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  </View>

                  {recentManuals.length > 0 ? (
                    <View style={[styles.tipsCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                      <View style={styles.todayHeader}>
                        <Text style={[styles.helperTitle, { color: hh.ink, marginBottom: 0 }]}>最近手动记录</Text>
                        <Text style={[styles.todayHint, { color: hh.faint }]}>点一下复用</Text>
                      </View>
                      {recentManuals.map((item) => {
                        const meta = getManualMeta(item.type, waterCupMl);
                        const accent =
                          item.type === 'hydration'
                            ? nutrients.hydration
                            : item.type === 'protein'
                              ? nutrients.protein
                              : item.type === 'carbohydrate'
                                ? nutrients.carbohydrate
                                : nutrients.calories;
                        return (
                          <Pressable
                            key={item.id}
                            onPress={() => reuseManual(item)}
                            style={({ pressed }) => [
                              styles.recentManualRow,
                              { borderTopColor: hh.line, opacity: pressed ? 0.85 : 1 },
                            ]}
                          >
                            <View style={[styles.recentManualIcon, { backgroundColor: `${accent}22` }]}>
                              <MaterialIcons name={meta.icon} size={18} color={accent} />
                            </View>
                            <View style={styles.recentPhotoMeta}>
                              <Text style={[styles.recentPhotoTitle, { color: hh.ink }]}>
                                {item.label} · {item.amountLabel}
                              </Text>
                              <Text style={[styles.recentPhotoSub, { color: hh.muted }]}>{item.timeLabel}</Text>
                            </View>
                            <MaterialIcons name="replay" size={18} color={hh.sage} />
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}

                  <View style={[styles.todayCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                    <View style={styles.todayHeader}>
                      <Text style={[styles.helperTitle, { color: hh.ink, marginBottom: 0 }]}>今日四项总量</Text>
                      <Text style={[styles.todayHint, { color: hh.faint }]}>写入后测算</Text>
                    </View>
                    <NutrientTiles items={projectedDayTotalTiles} />
                    <Text style={[styles.manualFootnote, { color: hh.faint }]}>
                      手动、快捷卡、AI 文本与拍照记录写入同一健康流水，仅 source / quick_add_key 区分来源。
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {tab !== 'manual' ? (
              <View style={[styles.confirmFooter, { borderTopColor: hh.line, backgroundColor: hh.paper }]}>
                <Animated.View ref={confirmBtnRef} collapsable={false} style={{ transform: [{ scale: confirmScale }] }}>
                  <Pressable
                    disabled={confirmDisabled || confirmSaving}
                    onPress={() => {
                      void handleConfirm();
                    }}
                    style={({ pressed }) => [
                      styles.confirmBtn,
                      {
                        backgroundColor: confirmSaving ? '#2F7A5C' : hh.pine,
                        opacity: confirmDisabled ? 0.42 : pressed && !confirmSaving ? 0.94 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.confirmText, { color: hh.onPine }]}>
                      {confirmSaving ? '已保存 ✓' : confirmLabel}
                    </Text>
                  </Pressable>
                </Animated.View>
                {tab === 'ai' ? (
                  <View style={styles.footerHintRow}>
                    <MaterialIcons name="schedule" size={14} color={hh.faint} />
                    <Text style={[styles.footerHint, { color: hh.faint }]}>
                      未预解析时也可直接写入，系统会在后台解析并插入「解析中」占位行。
                    </Text>
                  </View>
                ) : tab === 'photo' ? (
                  <View style={styles.footerHintRow}>
                    <MaterialIcons name="photo-camera" size={14} color={hh.faint} />
                    <Text style={[styles.footerHint, { color: hh.faint }]}>
                      {photoBusy
                        ? '正在识别营养成分，完成后可编辑再写入。'
                        : photoReady
                          ? '识别结果可编辑；写入后不再重复识图。'
                          : '选图后自动识别；识别失败可换图或改用手动记录。'}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
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
    maxHeight: Math.min(880, screenHeight - 28),
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
  contentScroll: { maxHeight: screenHeight - 220, flexGrow: 0, flexShrink: 1 },
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
  sectionStack: { gap: 12 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  sectionLabel: { fontSize: 15, fontWeight: '800' },
  sectionHint: { fontSize: 11, fontWeight: '600' },
  textareaWrap: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    minHeight: 148,
    position: 'relative',
  },
  textarea: { fontSize: 15, lineHeight: 22, minHeight: 108, padding: 0 },
  charCount: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '600', marginTop: 6 },
  aiBusyOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  aiBusyText: { fontSize: 13, fontWeight: '700' },
  aiActionRow: { flexDirection: 'row', gap: 10 },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    paddingVertical: 14,
  },
  primaryActionText: { fontSize: 15, fontWeight: '800' },
  sparkDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    zIndex: 40,
  },
  successRing: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1.5,
    zIndex: 33,
  },
  secondaryActionBtn: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: { fontSize: 14, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  resultCard: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  resultCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultCardTitle: { fontSize: 14, fontWeight: '800' },
  editableBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  editableBadgeText: { fontSize: 11, fontWeight: '700' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricTile: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 4,
  },
  metricValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  metricValueInput: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, padding: 0 },
  metricLabel: { fontSize: 11, fontWeight: '700' },
  aiEvalBox: { borderRadius: 14, padding: 12, gap: 6 },
  aiEvalLabel: { fontSize: 12, fontWeight: '800' },
  aiEvalInput: { fontSize: 13, lineHeight: 20, fontWeight: '600', minHeight: 44, padding: 0 },
  helperBlock: { gap: 8 },
  helperTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontSize: 12, fontWeight: '700' },
  tipsCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tipLabel: { fontSize: 13, fontWeight: '700' },
  tipExample: { fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  todayCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  todayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  todayHint: { fontSize: 11, fontWeight: '600' },
  photoStage: {
    height: 210,
    borderRadius: 22,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoStageImage: { ...StyleSheet.absoluteFill },
  photoStageEmpty: { alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  photoCamCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  photoStageTitle: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  photoStageSub: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  photoStageCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(30,57,50,0.55)',
    gap: 4,
  },
  scanLine: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    height: 2,
    borderRadius: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 2,
  },
  scanGlow: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    height: 10,
    marginTop: -4,
    borderRadius: 5,
    opacity: 0.35,
  },
  photoActionRow: { flexDirection: 'row', gap: 10 },
  photoActionBtnWrap: { flex: 1 },
  photoActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  photoActionText: { fontSize: 14, fontWeight: '800' },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 16,
    padding: 12,
  },
  warnTitle: { fontSize: 13, fontWeight: '800', marginBottom: 4 },
  warnBody: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  warnCode: { marginTop: 6, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  photoNoteWrap: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
  },
  photoNoteLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3, marginBottom: 8 },
  photoNoteInput: { fontSize: 14, lineHeight: 20, minHeight: 64, paddingVertical: 0 },
  recentPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recentPhotoThumb: { width: 44, height: 44, borderRadius: 12 },
  recentPhotoThumbFallback: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,166,149,0.18)',
  },
  recentPhotoMeta: { flex: 1, minWidth: 0, gap: 2 },
  recentPhotoTitle: { fontSize: 14, fontWeight: '800' },
  recentPhotoSub: { fontSize: 11, fontWeight: '600' },
  againBtn: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  againBtnText: { fontSize: 12, fontWeight: '800' },
  errorText: { fontSize: 12, fontWeight: '600', lineHeight: 18, color: '#C45C4A' },
  manualTypeRow: { flexDirection: 'row', gap: 8, position: 'relative' },
  manualTypeIndicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 16,
  },
  manualTypeCardWrap: { flex: 1 },
  manualTypeCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
  },
  manualTypeText: { fontSize: 11, fontWeight: '800' },
  valuePanel: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  valuePanelTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  valueLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  valueLimit: { fontSize: 11, fontWeight: '600' },
  valueMainRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, justifyContent: 'center' },
  valueNumber: { fontSize: 48, fontWeight: '900', letterSpacing: -1.2, lineHeight: 56 },
  valueUnit: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  valueCursor: { width: 2, height: 36, borderRadius: 1, marginBottom: 12, marginLeft: 2 },
  convertHintWrap: { alignItems: 'center', gap: 4, overflow: 'hidden' },
  convertUnderline: { height: 6, borderRadius: 3, width: '72%', alignSelf: 'center' },
  valueHintText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  impactCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 0,
  },
  impactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 2,
  },
  impactLabel: { fontSize: 12, fontWeight: '700', flexShrink: 0 },
  impactValue: { fontSize: 12, fontWeight: '700', flex: 1, textAlign: 'right', lineHeight: 18 },
  recentManualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recentManualIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualFootnote: { fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 4 },
  keypadGrid: {
    width: '100%',
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  keypadBtnWrap: { width: '31%' },
  keypadBtn: {
    width: '100%',
    aspectRatio: 1.55,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keypadBtnText: { fontSize: 24, fontWeight: '800' },
  confirmFooter: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 18 : 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  confirmBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    paddingVertical: 16,
  },
  confirmText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  footerHintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 2 },
  footerHint: { flex: 1, fontSize: 11, fontWeight: '600', lineHeight: 16 },
});
