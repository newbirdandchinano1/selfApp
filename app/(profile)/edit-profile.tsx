/**
 * 「我的 · 编辑资料」：基本信息 / 画像 / 体征与饮食 + 未保存拦截。
 * 对齐设计稿 03–06 与动效规范（Tab 指示器、脏数据条、条件展开、弹窗 pop）。
 */
import { EditProfileUnsavedDialog } from '@/components/profile/EditProfileUnsavedDialog';
import {
  FoldCountUpText,
  FoldRiseIn,
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { getMinTouchTarget, Layout, Spacing } from '@/constants/design-tokens';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { invalidateDailyIntakeAiTargetsCache } from '@/lib/daily-intake-ai-targets';
import { formatYmd, parseYmd } from '@/lib/date';
import {
  DEFAULT_DIETARY_PREFS,
  DIETARY_PRESET_TAGS,
  loadDietaryPrefs,
  normalizeDietaryPrefs,
  saveDietaryPrefs,
  type DietaryPrefs,
} from '@/lib/dietary-prefs';
import {
  listWeightLogsLastNDays,
  localYmdFromDate,
  upsertWeightLog,
  type WeightLogRow,
} from '@/lib/repositories/health/weight-log';
import { getDefaultUser, updateDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
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
import Svg, { Circle } from 'react-native-svg';

const MIN_TOUCH = getMinTouchTarget(Platform.OS);

const GENDER_OPTIONS = ['女', '男'] as const;
const LIFESTYLE_OPTIONS = ['长期静坐不运动', '健身', '高强度锻炼'] as const;
const LIFESTYLE_LABELS: Record<(typeof LIFESTYLE_OPTIONS)[number], string> = {
  长期静坐不运动: '久坐少动',
  健身: '规律健身',
  高强度锻炼: '高强度',
};
const GOAL_OPTIONS = ['无', '减脂', '增肌'] as const;
const GOAL_LABELS: Record<(typeof GOAL_OPTIONS)[number], string> = {
  无: '维持',
  减脂: '减脂',
  增肌: '增肌',
};
const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const WEEK_DAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'] as const;
const DEFAULT_GENDER: (typeof GENDER_OPTIONS)[number] = '男';
const DEFAULT_LIFESTYLE: (typeof LIFESTYLE_OPTIONS)[number] = '长期静坐不运动';
const DEFAULT_GOAL: (typeof GOAL_OPTIONS)[number] = '无';
const PERSONA_PORTRAIT_MAX = 500;

const PERSONA_INSERTS = [
  { label: '我正在努力成为', text: '我正在努力成为：' },
  { label: '身体限制', text: '我的身体限制是：' },
  { label: '饮食偏好', text: '我喜欢的饮食是：' },
  { label: '易放弃时刻', text: '最容易放弃的时刻是：' },
] as const;

const PERSONA_KEYWORD_POOL = [
  '久坐',
  '肩颈',
  '外食',
  '早睡',
  '周末',
  '伏案',
  '咖啡',
  '食堂',
  '减脂',
  '增肌',
  '健身',
  '熬夜',
  '加班',
  '步行',
] as const;

const AVATAR_TONES = [
  { key: 'pine', label: '松绿' },
  { key: 'amber', label: '琥珀' },
  { key: 'clay', label: '陶土' },
] as const;
type AvatarTone = (typeof AVATAR_TONES)[number]['key'];

type ProfileTab = 'basic' | 'persona' | 'body';

type FormSnapshot = {
  name: string;
  personaPortrait: string;
  gender: (typeof GENDER_OPTIONS)[number];
  lifestyle: (typeof LIFESTYLE_OPTIONS)[number];
  goal: (typeof GOAL_OPTIONS)[number];
  workoutDays: string[];
  height: string;
  weight: string;
  birthdayIso: string | null;
  dietary: DietaryPrefs;
};

const TABS: { key: ProfileTab; label: string; sub: string }[] = [
  { key: 'basic', label: '基本信息', sub: '基本信息 · 影响饮食与训练日' },
  { key: 'persona', label: '画像', sub: '人物画像 · 让建议更像你' },
  { key: 'body', label: '体征与饮食', sub: '体征与饮食 · 决定摄入目标' },
];

const FIELD_LABELS: Record<keyof FormSnapshot, string> = {
  name: '姓名',
  personaPortrait: '人物画像',
  gender: '性别',
  lifestyle: '生活习惯',
  goal: '目标',
  workoutDays: '健身日',
  height: '身高',
  weight: '体重',
  birthdayIso: '生日',
  dietary: '饮食偏好',
};

function parseInitialTab(raw: string | string[] | undefined): ProfileTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'persona' || value === 'body' || value === 'basic') return value;
  return 'basic';
}

function isFitnessLifestyle(lifestyle: (typeof LIFESTYLE_OPTIONS)[number]): boolean {
  return lifestyle === '健身' || lifestyle === '高强度锻炼';
}

function parseWeekDaysJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is (typeof WEEK_DAYS)[number] =>
        typeof d === 'string' && (WEEK_DAYS as readonly string[]).includes(d),
    );
  } catch {
    return [];
  }
}

function serializeWeekDays(days: string[]): string {
  return JSON.stringify(days);
}

function normalizeWorkoutDays(days: string[]): string[] {
  return WEEK_DAYS.filter((d) => days.includes(d));
}

function parseIsoDateLocal(iso: string): Date {
  return parseYmd(iso) ?? new Date();
}

function toIsoDate(d: Date): string {
  return formatYmd(d);
}

function formatBirthdayDisplay(iso: string | null): string {
  if (!iso) return '未设置';
  return iso;
}

function monogramFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '我';
  return trimmed.slice(0, 1);
}

function normalizeHeightInput(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, 3);
}

function normalizeWeightInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot < 0) return cleaned.slice(0, 3);
  const intPart = cleaned.slice(0, dot).replace(/\D+/g, '').slice(0, 3);
  const decPart = cleaned
    .slice(dot + 1)
    .replace(/\D+/g, '')
    .slice(0, 1);
  return `${intPart}.${decPart}`;
}

function snapshotFromUser(user: UserRow, dietary: DietaryPrefs): FormSnapshot {
  const genderRaw = user.gender;
  const gender: (typeof GENDER_OPTIONS)[number] =
    genderRaw === '女' || genderRaw === '男' ? genderRaw : DEFAULT_GENDER;
  return {
    name: user.name ?? '默认用户',
    personaPortrait: user.persona_portrait ?? '',
    gender,
    lifestyle: LIFESTYLE_OPTIONS.includes(user.lifestyle as (typeof LIFESTYLE_OPTIONS)[number])
      ? (user.lifestyle as (typeof LIFESTYLE_OPTIONS)[number])
      : DEFAULT_LIFESTYLE,
    goal: GOAL_OPTIONS.includes(user.goal as (typeof GOAL_OPTIONS)[number])
      ? (user.goal as (typeof GOAL_OPTIONS)[number])
      : DEFAULT_GOAL,
    workoutDays: normalizeWorkoutDays(parseWeekDaysJson(user.workout_days)),
    height: String(user.height ?? 0),
    weight: user.weight > 0 ? String(user.weight) : '0',
    birthdayIso: user.birthday ?? null,
    dietary: normalizeDietaryPrefs(dietary),
  };
}

function buildCurrentSnapshot(input: FormSnapshot): FormSnapshot {
  const height = normalizeHeightInput(input.height) || '0';
  const weightRaw = normalizeWeightInput(input.weight);
  const weight = weightRaw === '' || weightRaw === '.' ? '0' : weightRaw;
  return {
    ...input,
    name: input.name.trim() || '默认用户',
    personaPortrait: input.personaPortrait.trim().slice(0, PERSONA_PORTRAIT_MAX),
    workoutDays: normalizeWorkoutDays(input.workoutDays),
    height,
    weight,
    dietary: normalizeDietaryPrefs(input.dietary),
  };
}

function snapshotsEqual(a: FormSnapshot, b: FormSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function describeDirtyChanges(base: FormSnapshot, next: FormSnapshot): string {
  const keys = Object.keys(FIELD_LABELS) as (keyof FormSnapshot)[];
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(base[key]) !== JSON.stringify(next[key])) {
      changed.push(FIELD_LABELS[key]);
    }
  }
  if (changed.length === 0) return '未保存 · 请选择离开方式';
  return `${changed.length} 处修改 · ${changed.slice(0, 3).join(' / ')}`;
}

function calcBmi(heightCm: number, weightKg: number): number | null {
  if (!(heightCm > 0) || !(weightKg > 0)) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

function bmiMeta(bmi: number | null): { label: string; tone: 'ok' | 'warn' | 'muted'; pct: number } {
  if (bmi == null) return { label: '待完善', tone: 'muted', pct: 0 };
  if (bmi < 18.5) return { label: '偏瘦', tone: 'warn', pct: 22 };
  if (bmi < 24) return { label: '健康', tone: 'ok', pct: 46 };
  if (bmi < 28) return { label: '超重', tone: 'warn', pct: 68 };
  return { label: '肥胖', tone: 'warn', pct: 88 };
}

function formatSavedAt(iso: string | null | undefined): string {
  if (!iso) return '尚未保存';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '尚未保存';
  return `最后保存 ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function extractPersonaKeywords(text: string): string[] {
  const hits = PERSONA_KEYWORD_POOL.filter((k) => text.includes(k));
  return hits.slice(0, 6);
}

function weightSparkHeights(logs: WeightLogRow[]): number[] {
  if (logs.length === 0) return Array.from({ length: 12 }, () => 28);
  const sampled: WeightLogRow[] = [];
  const step = Math.max(1, Math.floor(logs.length / 12));
  for (let i = 0; i < logs.length; i += step) {
    sampled.push(logs[i]!);
    if (sampled.length >= 12) break;
  }
  while (sampled.length < 12 && logs.length > 0) {
    sampled.push(logs[logs.length - 1]!);
  }
  const values = sampled.map((r) => r.weight_kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.4, max - min);
  return values.map((v) => 28 + ((v - min) / span) * 60);
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  const { fold } = useFoldTheme();
  return (
    <View style={styles.fieldLabelRow}>
      <Text style={[styles.fieldLabel, { color: fold.ink2 }]}>{label}</Text>
      {hint ? <Text style={[styles.fieldHint, { color: fold.faint }]}>{hint}</Text> : null}
    </View>
  );
}

function PillOption<T extends string>({
  label,
  active,
  onPress,
  flex,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  flex?: number;
}) {
  const { fold } = useFoldTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.pill2,
        {
          flex: flex ?? 1,
          backgroundColor: active ? fold.pineButton : '#F7F3E9',
          borderColor: active ? fold.pineButton : fold.line,
        },
        pressed && { transform: [{ scale: 0.96 }] },
      ]}>
      <Text
        style={[
          styles.pill2Label,
          { color: active ? fold.onPineButton : fold.muted, fontWeight: active ? '800' : '600' },
        ]}
        numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function CharRing({ ratio, animate }: { ratio: number; animate: boolean }) {
  const { fold } = useFoldTheme();
  const clamped = Math.max(0, Math.min(1, ratio));
  const circumference = 2 * Math.PI * 14;
  const offsetAnim = useRef(new Animated.Value(circumference)).current;

  useEffect(() => {
    const target = circumference * (1 - clamped);
    if (!animate) {
      offsetAnim.setValue(target);
      return;
    }
    Animated.timing(offsetAnim, {
      toValue: target,
      duration: 280,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start();
  }, [animate, circumference, clamped, offsetAnim]);

  const [dashOffset, setDashOffset] = useState(circumference * (1 - clamped));
  useEffect(() => {
    const id = offsetAnim.addListener(({ value }) => setDashOffset(value));
    return () => offsetAnim.removeListener(id);
  }, [offsetAnim]);

  const pct = Math.round(clamped * 100);

  return (
    <View style={styles.charRing}>
      <Svg width={34} height={34} viewBox="0 0 34 34" style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={17} cy={17} r={14} stroke={fold.line} strokeWidth={3} fill="none" />
        <Circle
          cx={17}
          cy={17}
          r={14}
          stroke={fold.amber}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
        />
      </Svg>
      <Text style={[styles.charRingPct, { color: '#8A6222', fontFamily: foldFonts.mono }]}>{pct}%</Text>
    </View>
  );
}

function WeightSpark({
  heights,
  animate,
}: {
  heights: number[];
  animate: boolean;
}) {
  const { fold } = useFoldTheme();
  const progresses = useRef(heights.map(() => new Animated.Value(animate ? 0 : 1))).current;

  useEffect(() => {
    if (!animate) {
      progresses.forEach((p) => p.setValue(1));
      return;
    }
    progresses.forEach((p) => p.setValue(0));
    Animated.stagger(
      35,
      progresses.map((p) =>
        Animated.timing(p, {
          toValue: 1,
          duration: 420,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: false,
        }),
      ),
    ).start();
  }, [animate, heights.join(','), progresses]);

  return (
    <View style={styles.sparkRow}>
      {heights.map((h, i) => {
        const height = progresses[i]!.interpolate({
          inputRange: [0, 1],
          outputRange: [4, h],
        });
        const isNow = i === heights.length - 1;
        return (
          <Animated.View
            key={`spark-${i}`}
            style={[
              styles.sparkBar,
              {
                height,
                backgroundColor: isNow ? fold.pine : fold.sage2,
                opacity: isNow ? 1 : 0.85,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function FitnessCollapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: 400,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start();
  }, [open, progress]);

  const maxHeight = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 280],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, 0.4, 1],
  });

  return (
    <Animated.View style={{ maxHeight, opacity, overflow: 'hidden' }}>{children}</Animated.View>
  );
}

export default function EditProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { fold, isDark } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>(() => parseInitialTab(params.tab));
  const [loadedSnapshot, setLoadedSnapshot] = useState<FormSnapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [weightLogs, setWeightLogs] = useState<WeightLogRow[]>([]);
  const [avatarTone, setAvatarTone] = useState<AvatarTone>('pine');

  const [name, setName] = useState('默认用户');
  const [personaPortrait, setPersonaPortrait] = useState('');
  const [gender, setGender] = useState<(typeof GENDER_OPTIONS)[number]>(DEFAULT_GENDER);
  const [lifestyle, setLifestyle] = useState<(typeof LIFESTYLE_OPTIONS)[number]>(DEFAULT_LIFESTYLE);
  const [goal, setGoal] = useState<(typeof GOAL_OPTIONS)[number]>(DEFAULT_GOAL);
  const [workoutDays, setWorkoutDays] = useState<string[]>([]);
  const [height, setHeight] = useState('0');
  const [weight, setWeight] = useState('0');
  const [birthdayIso, setBirthdayIso] = useState<string | null>(null);
  const [dietary, setDietary] = useState<DietaryPrefs>(DEFAULT_DIETARY_PREFS);
  const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);
  const [birthdayDraft, setBirthdayDraft] = useState(() => new Date(1990, 0, 1));
  const [unsavedVisible, setUnsavedVisible] = useState(false);
  const leaveActionRef = useRef<(() => void) | null>(null);

  const [skipRemoveGuard, setSkipRemoveGuard] = useState(false);
  const exitingRef = useRef(false);

  const tabIndex = TABS.findIndex((t) => t.key === activeTab);
  const tabIndicator = useRef(new Animated.Value(Math.max(0, tabIndex))).current;
  const [tabBarWidth, setTabBarWidth] = useState(0);
  /** 按需挂载：立刻换页，仅做轻微淡入（不先淡出到 0，避免闪白） */
  const panelOpacity = useRef(new Animated.Value(1)).current;
  const panelY = useRef(new Animated.Value(0)).current;
  const playedPersonaMotion = useRef(false);
  const playedBodyMotion = useRef(false);

  useEffect(() => {
    setActiveTab(parseInitialTab(params.tab));
  }, [params.tab]);

  useEffect(() => {
    Animated.timing(tabIndicator, {
      toValue: Math.max(0, tabIndex),
      duration: motionOn ? 300 : 1,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [motionOn, tabIndex, tabIndicator]);

  useEffect(() => {
    if (activeTab === 'persona') playedPersonaMotion.current = true;
    if (activeTab === 'body') playedBodyMotion.current = true;
  }, [activeTab]);

  const switchTab = useCallback(
    (next: ProfileTab) => {
      if (next === activeTab) return;
      setActiveTab(next);
      if (!motionOn) {
        panelOpacity.setValue(1);
        panelY.setValue(0);
        return;
      }
      panelOpacity.setValue(0.92);
      panelY.setValue(6);
      Animated.parallel([
        Animated.timing(panelOpacity, {
          toValue: 1,
          duration: 160,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(panelY, {
          toValue: 0,
          duration: 160,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [activeTab, motionOn, panelOpacity, panelY],
  );

  const personaMotionOn = motionOn && !playedPersonaMotion.current;
  const bodyMotionOn = motionOn && !playedBodyMotion.current;

  const applySnapshot = useCallback((snap: FormSnapshot) => {
    setName(snap.name);
    setPersonaPortrait(snap.personaPortrait);
    setGender(snap.gender);
    setLifestyle(snap.lifestyle);
    setGoal(snap.goal);
    setWorkoutDays(snap.workoutDays);
    setHeight(snap.height);
    setWeight(snap.weight);
    setBirthdayIso(snap.birthdayIso);
    setDietary(snap.dietary);
  }, []);

  const loadUser = useCallback(async () => {
    setLoading(true);
    try {
      const [data, dietaryPrefs, logs] = await Promise.all([
        getDefaultUser(),
        loadDietaryPrefs(),
        listWeightLogsLastNDays(30).catch(() => [] as WeightLogRow[]),
      ]);
      const snap = snapshotFromUser(data, dietaryPrefs);
      setLoadedSnapshot(snap);
      applySnapshot(snap);
      setUpdatedAt(data.updated_at ?? null);
      setWeightLogs(logs);
    } catch (e) {
      if (__DEV__) console.warn('[edit-profile] load user failed', e);
      setLoadedSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const { refreshControl } = usePullToRefresh(loadUser);

  const currentSnapshot = useMemo(
    () =>
      buildCurrentSnapshot({
        name,
        personaPortrait,
        gender,
        lifestyle,
        goal,
        workoutDays,
        height,
        weight,
        birthdayIso,
        dietary,
      }),
    [birthdayIso, dietary, gender, goal, height, lifestyle, name, personaPortrait, weight, workoutDays],
  );

  const isDirty = useMemo(() => {
    if (!loadedSnapshot || loading) return false;
    return !snapshotsEqual(loadedSnapshot, currentSnapshot);
  }, [currentSnapshot, loadedSnapshot, loading]);

  const dirtySummary = useMemo(() => {
    if (!loadedSnapshot) return '未保存 · 请选择离开方式';
    return describeDirtyChanges(loadedSnapshot, currentSnapshot);
  }, [currentSnapshot, loadedSnapshot]);

  const showFitnessFields = isFitnessLifestyle(lifestyle);
  const heightNum = Number(currentSnapshot.height) || 0;
  const weightNum = Number(currentSnapshot.weight) || 0;
  const bmi = calcBmi(heightNum, weightNum);
  const bmiInfo = bmiMeta(bmi);
  const personaRatio = Math.min(1, personaPortrait.length / PERSONA_PORTRAIT_MAX);
  const personaKeywords = useMemo(() => extractPersonaKeywords(personaPortrait), [personaPortrait]);
  const sparkHeights = useMemo(() => weightSparkHeights(weightLogs), [weightLogs]);
  const weightDelta = useMemo(() => {
    if (weightLogs.length < 2) return null;
    const first = weightLogs[0]!.weight_kg;
    const last = weightLogs[weightLogs.length - 1]!.weight_kg;
    return Math.round((last - first) * 10) / 10;
  }, [weightLogs]);

  const activeSub =
    isDirty && activeTab === 'basic'
      ? '基本信息 · 有未保存修改'
      : (TABS.find((t) => t.key === activeTab)?.sub ?? TABS[0]!.sub);

  const avatarBg =
    avatarTone === 'amber' ? fold.amber : avatarTone === 'clay' ? fold.clay : fold.pineButton;
  const avatarFg = avatarTone === 'amber' || avatarTone === 'clay' ? '#FFF8EE' : fold.onPineButton;

  const toggleWorkoutDay = (day: string) => {
    setWorkoutDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const toggleDietaryTag = (tag: string) => {
    setDietary((prev) => {
      const has = prev.tags.includes(tag);
      return {
        ...prev,
        tags: has ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
      };
    });
  };

  const handleLifestyleChange = (option: (typeof LIFESTYLE_OPTIONS)[number]) => {
    setLifestyle(option);
    if (!isFitnessLifestyle(option)) {
      setGoal(DEFAULT_GOAL);
      setWorkoutDays([]);
    }
  };

  const birthdayMaxDate = useMemo(() => new Date(), []);
  const birthdayMinDate = useMemo(() => new Date(1900, 0, 1), []);

  const openBirthdayPicker = () => {
    setBirthdayDraft(birthdayIso ? parseIsoDateLocal(birthdayIso) : new Date(1990, 0, 1));
    setShowBirthdayPicker(true);
  };

  const dismissBirthdayPicker = () => setShowBirthdayPicker(false);

  const confirmBirthday = () => {
    setBirthdayIso(toIsoDate(birthdayDraft));
    setShowBirthdayPicker(false);
  };

  const insertPersonaChip = (text: string) => {
    setPersonaPortrait((prev) => {
      const next = `${prev.trim()}${prev.trim() ? '\n' : ''}${text}`.slice(0, PERSONA_PORTRAIT_MAX);
      return next;
    });
  };

  const persistProfile = useCallback(async (): Promise<boolean> => {
    if (saving || loading) return false;
    setSaving(true);
    try {
      const snap = currentSnapshot;
      const fitnessActive = isFitnessLifestyle(snap.lifestyle);
      await updateDefaultUser({
        name: snap.name,
        persona_portrait: snap.personaPortrait || null,
        gender: snap.gender,
        lifestyle: snap.lifestyle,
        goal: fitnessActive ? snap.goal : DEFAULT_GOAL,
        workout_days: fitnessActive ? serializeWeekDays(snap.workoutDays) : '[]',
        birthday: snap.birthdayIso,
        height: Number(snap.height),
        weight: Number(snap.weight),
      });
      await saveDietaryPrefs(snap.dietary);
      await invalidateDailyIntakeAiTargetsCache();
      setLoadedSnapshot(snap);
      setUpdatedAt(new Date().toISOString());
      const logs = await listWeightLogsLastNDays(30).catch(() => [] as WeightLogRow[]);
      setWeightLogs(logs);
      toast.success('已保存 · 饮食与训练日建议已更新');
      return true;
    } catch (error) {
      toast.error(toUserMessage(error, '保存失败，请稍后重试'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [currentSnapshot, loading, saving]);

  const performLeave = useCallback(
    (leaveAction?: () => void) => {
      if (exitingRef.current || saving) return;
      exitingRef.current = true;
      setSkipRemoveGuard(true);
      setUnsavedVisible(false);
      if (leaveAction) leaveAction();
      else router.dismissTo('/(tabs)/profile');
    },
    [router, saving],
  );

  const promptUnsavedChanges = useCallback((onLeave: () => void) => {
    leaveActionRef.current = onLeave;
    setUnsavedVisible(true);
  }, []);

  const handleBackPress = useCallback(() => {
    if (saving || loading) return;
    if (!isDirty) {
      performLeave(() => router.back());
      return;
    }
    promptUnsavedChanges(() => performLeave(() => router.back()));
  }, [isDirty, loading, performLeave, promptUnsavedChanges, router, saving]);

  const handleSavePress = useCallback(() => {
    if (saving || loading || !isDirty) return;
    void persistProfile();
  }, [isDirty, loading, persistProfile, saving]);

  const handleRecordWeight = useCallback(async () => {
    const kg = Number(currentSnapshot.weight);
    if (!(kg > 0)) {
      toast.error('请先填写有效体重');
      return;
    }
    try {
      await upsertWeightLog(localYmdFromDate(), kg);
      await updateDefaultUser({
        name: currentSnapshot.name,
        persona_portrait: currentSnapshot.personaPortrait || null,
        gender: currentSnapshot.gender,
        lifestyle: currentSnapshot.lifestyle,
        goal: isFitnessLifestyle(currentSnapshot.lifestyle) ? currentSnapshot.goal : DEFAULT_GOAL,
        workout_days: isFitnessLifestyle(currentSnapshot.lifestyle)
          ? serializeWeekDays(currentSnapshot.workoutDays)
          : '[]',
        birthday: currentSnapshot.birthdayIso,
        height: Number(currentSnapshot.height),
        weight: kg,
      });
      const logs = await listWeightLogsLastNDays(30).catch(() => [] as WeightLogRow[]);
      setWeightLogs(logs);
      toast.success(`记录新体重 ${kg} kg`);
    } catch (e) {
      toast.error(toUserMessage(e, '记录失败'));
    }
  }, [currentSnapshot]);

  const handleRewriteTone = useCallback(async () => {
    if (!personaPortrait.trim()) {
      toast.error('先写一段画像再试');
      return;
    }
    try {
      await invalidateDailyIntakeAiTargetsCache();
      toast.success('已按画像重写建议语气');
    } catch {
      toast.success('已按画像重写建议语气');
    }
  }, [personaPortrait]);

  const preventRemove =
    isFocused && isDirty && !loading && !skipRemoveGuard && !exitingRef.current && !unsavedVisible;

  usePreventRemove(preventRemove, ({ data }) => {
    promptUnsavedChanges(() => performLeave(() => navigation.dispatch(data.action)));
  });

  const indicatorWidth = tabBarWidth > 0 ? (tabBarWidth - 6) / 3 : 0;
  const indicatorX = tabIndicator.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0, indicatorWidth, indicatorWidth * 2],
  });

  const dirtyBarOpacity = useRef(new Animated.Value(0)).current;
  const dirtyBarY = useRef(new Animated.Value(-5)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(dirtyBarOpacity, {
        toValue: isDirty ? 1 : 0,
        duration: motionOn ? 200 : 1,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(dirtyBarY, {
        toValue: isDirty ? 0 : -5,
        duration: motionOn ? 240 : 1,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
    ]).start();
  }, [dirtyBarOpacity, dirtyBarY, isDirty, motionOn]);

  const placeholderColor = fold.faint;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: !isDirty }} />

      {/* AppBar */}
      <View style={[styles.appBar, { paddingTop: insets.top + 4, borderBottomColor: fold.line }]}>
        <Pressable
          onPress={handleBackPress}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="arrow-back" size={20} color={fold.ink} />
        </Pressable>
        <View style={styles.appBarTitleWrap}>
          <Text style={[styles.appTitle, { color: fold.ink }]}>编辑资料</Text>
          <Text style={[styles.appSub, { color: fold.muted }]} numberOfLines={1}>
            {activeSub}
          </Text>
        </View>
        <Pressable
          onPress={handleSavePress}
          disabled={saving || loading || !isDirty}
          accessibilityRole="button"
          accessibilityLabel="保存"
          style={({ pressed }) => [
            styles.pillBtn,
            {
              backgroundColor: isDirty ? fold.pineButton : fold.paper2,
              borderColor: isDirty ? fold.pineButton : fold.line,
            },
            pressed && isDirty && { opacity: 0.9 },
            (!isDirty || saving || loading) && { opacity: 0.55 },
          ]}>
          <Text
            style={[
              styles.pillBtnLabel,
              { color: isDirty ? fold.onPineButton : fold.muted },
            ]}>
            {saving ? '保存中' : '保存'}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <ScrollView
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing['6xl'],
            },
          ]}>
          {/* Tabs */}
          <FoldRiseIn animate={motionOn} index={0} staggerMs={40} fromY={8}>
            <View
              style={[styles.ftabs, { backgroundColor: '#E9E4D9' }]}
              onLayout={(e) => setTabBarWidth(e.nativeEvent.layout.width)}>
              {indicatorWidth > 0 ? (
                <Animated.View
                  style={[
                    styles.ftabInd,
                    {
                      width: indicatorWidth,
                      backgroundColor: fold.card,
                      transform: [{ translateX: indicatorX }],
                    },
                  ]}
                />
              ) : null}
              {TABS.map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => switchTab(tab.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={styles.ftabItem}>
                    <Text
                      style={[
                        styles.ftabLabel,
                        { color: active ? fold.pine : '#8B948D', fontWeight: active ? '800' : '700' },
                      ]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </FoldRiseIn>

          {/* Dirty bar */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.dirtyBar,
              {
                backgroundColor: '#FBEEDC',
                borderColor: '#E7CFA6',
                opacity: dirtyBarOpacity,
                transform: [{ translateY: dirtyBarY }],
                marginBottom: isDirty ? 8 : 0,
                height: isDirty ? 28 : 0,
              },
            ]}>
            <View style={[styles.dirtyDot, { backgroundColor: fold.amber }]} />
            <Text style={styles.dirtyText}>有未保存的修改</Text>
          </Animated.View>

          <Animated.View
            style={{
              opacity: panelOpacity,
              transform: [{ translateY: panelY }],
            }}>
            {activeTab === 'basic' ? (
              <View style={styles.tabPanel}>
                  <View style={styles.avatarRow}>
                    <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
                      <Text style={[styles.avatarGlyph, { color: avatarFg, fontFamily: foldFonts.serif }]}>
                        {monogramFromName(name)}
                      </Text>
                    </View>
                    <View style={styles.avatarMeta}>
                      <Text style={[styles.avatarTitle, { color: fold.ink2 }]}>头像字标</Text>
                      <Text style={[styles.avatarSub, { color: fold.faint }]}>取名字首字，可换配色</Text>
                    </View>
                    {AVATAR_TONES.map((tone) => {
                      const on = avatarTone === tone.key;
                      return (
                        <Pressable
                          key={tone.key}
                          onPress={() => setAvatarTone(tone.key)}
                          style={[
                            styles.tonePill,
                            {
                              backgroundColor: on ? fold.sage2 : fold.paper2,
                              borderColor: on ? fold.sage : fold.line,
                            },
                          ]}>
                          <Text
                            style={[
                              styles.tonePillLabel,
                              { color: on ? fold.pine : fold.muted, fontWeight: on ? '800' : '600' },
                            ]}>
                            {tone.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={styles.field}>
                    <FieldLabel label="姓名" hint="显示在问候语与海报上" />
                    <View style={[styles.inputRow, { backgroundColor: fold.card, borderColor: fold.line }]}>
                      <TextInput
                        value={name}
                        onChangeText={setName}
                        placeholder="输入姓名"
                        placeholderTextColor={placeholderColor}
                        style={[styles.inputText, { color: fold.ink }]}
                        returnKeyType="done"
                      />
                      <AppIcon name="edit" size={16} color={fold.faint} />
                    </View>
                  </View>

                  <View style={styles.field}>
                    <FieldLabel label="生日" hint="用于年龄与代谢估算" />
                    <Pressable
                      onPress={openBirthdayPicker}
                      style={({ pressed }) => [
                        styles.inputRow,
                        { backgroundColor: fold.card, borderColor: fold.line },
                        pressed && { opacity: 0.9 },
                      ]}>
                      <Text
                        style={[
                          styles.inputText,
                          { color: birthdayIso ? fold.ink : fold.faint },
                        ]}>
                        {formatBirthdayDisplay(birthdayIso)}
                      </Text>
                      <AppIcon name="calendar-today" size={16} color={fold.faint} />
                    </Pressable>
                  </View>

                  <View style={styles.field}>
                    <FieldLabel label="性别" />
                    <View style={styles.pillRow}>
                      {GENDER_OPTIONS.map((opt) => (
                        <PillOption
                          key={opt}
                          label={opt}
                          active={gender === opt}
                          onPress={() => setGender(opt)}
                        />
                      ))}
                    </View>
                  </View>

                  <View style={styles.field}>
                    <FieldLabel label="生活习惯" hint="决定是否需要目标与健身日" />
                    <View style={styles.pillRowWrap}>
                      {LIFESTYLE_OPTIONS.map((opt) => (
                        <Pressable
                          key={opt}
                          onPress={() => handleLifestyleChange(opt)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: lifestyle === opt }}
                          style={({ pressed }) => [
                            styles.pill2,
                            styles.pill2Wrap,
                            {
                              backgroundColor:
                                lifestyle === opt ? fold.pineButton : '#F7F3E9',
                              borderColor: lifestyle === opt ? fold.pineButton : fold.line,
                            },
                            pressed && { transform: [{ scale: 0.96 }] },
                          ]}>
                          <Text
                            style={[
                              styles.pill2Label,
                              {
                                color: lifestyle === opt ? fold.onPineButton : fold.muted,
                                fontWeight: lifestyle === opt ? '800' : '600',
                              },
                            ]}>
                            {LIFESTYLE_LABELS[opt]}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                <FitnessCollapse open={showFitnessFields}>
                  <View style={styles.field}>
                    <FieldLabel label="目标" hint="训练日按此调整蛋白与热量" />
                    <View style={styles.pillRow}>
                      {GOAL_OPTIONS.map((opt) => (
                        <PillOption
                          key={opt}
                          label={GOAL_LABELS[opt]}
                          active={goal === opt}
                          onPress={() => setGoal(opt)}
                        />
                      ))}
                    </View>
                  </View>
                  <View style={styles.field}>
                    <FieldLabel
                      label="健身日"
                      hint={
                        workoutDays.length > 0
                          ? `已选 ${workoutDays.length} 天 · 训练日标记`
                          : '选择每周训练日'
                      }
                    />
                    <View style={styles.pillRow}>
                      {WEEK_DAYS.map((day, index) => (
                        <PillOption
                          key={day}
                          label={WEEK_DAY_SHORT[index]!}
                          active={workoutDays.includes(day)}
                          onPress={() => toggleWorkoutDay(day)}
                        />
                      ))}
                    </View>
                  </View>
                </FitnessCollapse>

                <View style={[styles.noteCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
                  <AppIcon name="lightbulb-outline" size={14} color={fold.amber} />
                  <Text style={[styles.noteText, { color: fold.muted }]}>
                    保存后：饮食建议会避开忌口，蛋白目标按训练日上调；历史记录仍使用当天目标快照。
                  </Text>
                </View>

                <Pressable
                  onPress={handleSavePress}
                  disabled={saving || loading || !isDirty}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: fold.pineButton },
                    pressed && { opacity: 0.92 },
                    (!isDirty || saving || loading) && { opacity: 0.45 },
                  ]}>
                  <Text style={[styles.primaryBtnLabel, { color: fold.onPineButton }]}>
                    {saving ? '保存中…' : '保存修改'}
                  </Text>
                </Pressable>
                <View style={styles.formFoot}>
                  <View style={[styles.dirtyDot, { backgroundColor: fold.sage }]} />
                  <Text style={[styles.formFootText, { color: fold.faint }]}>
                    本地已加密 · {formatSavedAt(updatedAt)}
                  </Text>
                </View>
              </View>
            ) : null}

            {activeTab === 'persona' ? (
              <View style={styles.tabPanel}>
                <View style={[styles.personaCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
                  <View style={styles.personaHead}>
                    <Text style={[styles.personaHeadTitle, { color: fold.ink2 }]}>
                      我是谁 · 我在做什么 · 我想成为谁
                    </Text>
                    <CharRing ratio={personaRatio} animate={personaMotionOn} />
                  </View>
                  <TextInput
                    value={personaPortrait}
                    onChangeText={(value) => setPersonaPortrait(value.slice(0, PERSONA_PORTRAIT_MAX))}
                    placeholder="用一段话介绍自己：节奏、限制、想成为谁…"
                    placeholderTextColor={placeholderColor}
                    multiline
                    textAlignVertical="top"
                    maxLength={PERSONA_PORTRAIT_MAX}
                    style={[
                      styles.personaInput,
                      { color: fold.ink, backgroundColor: isDark ? fold.paper2 : '#FBF7EE' },
                    ]}
                  />
                  <View style={styles.personaMeta}>
                    <Text style={[styles.personaCounter, { color: fold.faint }]}>
                      {personaPortrait.length} / {PERSONA_PORTRAIT_MAX} 字
                    </Text>
                  </View>
                </View>

                <View style={styles.field}>
                  <FieldLabel label="不会写？插入一段结构" hint="点一下追加" />
                  <View style={styles.chipWrap}>
                    {PERSONA_INSERTS.map((chip) => (
                      <Pressable
                        key={chip.label}
                        onPress={() => insertPersonaChip(chip.text)}
                        style={({ pressed }) => [
                          styles.tpill,
                          { backgroundColor: '#F8F4EA', borderColor: fold.line },
                          pressed && { transform: [{ scale: 0.96 }] },
                        ]}>
                        <Text style={[styles.tpillLabel, { color: fold.ink2 }]}>{chip.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={[styles.keywordCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
                  <View style={styles.keywordHead}>
                    <Text style={[styles.keywordTitle, { color: fold.ink2 }]}>关键词摘录</Text>
                    <View style={[styles.tagAmber, { backgroundColor: fold.amber2 }]}>
                      <Text style={[styles.tagAmberText, { color: '#8B6126' }]}>本机</Text>
                    </View>
                  </View>
                  <View style={styles.chipWrap}>
                    {(personaKeywords.length
                      ? personaKeywords
                      : ['写得越多，摘录越准']
                    ).map((kw) => {
                      const active = personaKeywords.includes(kw);
                      return (
                        <View
                          key={kw}
                          style={[
                            styles.tpill,
                            active
                              ? { backgroundColor: '#E7EFE9', borderColor: '#BFD4C6' }
                              : { backgroundColor: '#F8F4EA', borderColor: fold.line },
                          ]}>
                          <Text
                            style={[
                              styles.tpillLabel,
                              { color: active ? '#3C5C4D' : fold.muted, fontWeight: active ? '800' : '600' },
                            ]}>
                            {active ? `✓ ${kw}` : kw}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.miniNote}>
                    <AppIcon name="auto-awesome" size={12} color={fold.amber} />
                    <Text style={[styles.miniNoteText, { color: fold.muted }]}>
                      画像只用于本机建议生成，不同步到任何社交场景。
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => void handleRewriteTone()}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: fold.pineButton },
                    pressed && { opacity: 0.92 },
                  ]}>
                  <Text style={[styles.primaryBtnLabel, { color: fold.onPineButton }]}>
                    用画像重写建议语气
                  </Text>
                </Pressable>
                <View style={styles.formFoot}>
                  <View style={[styles.dirtyDot, { backgroundColor: fold.sage }]} />
                  <Text style={[styles.formFootText, { color: fold.faint }]}>
                    建议每 3 个月更新一次画像
                  </Text>
                </View>
              </View>
            ) : null}

            {activeTab === 'body' ? (
              <View style={styles.tabPanel}>
                <View style={styles.bodyGrid}>
                  {[
                    { label: '身高 cm', value: heightNum, editable: true, kind: 'height' as const },
                    { label: '体重 kg', value: weightNum, editable: true, kind: 'weight' as const },
                    { label: 'BMI', value: bmi ?? 0, editable: false, kind: 'bmi' as const },
                  ].map((cell) => (
                    <View
                      key={cell.kind}
                      style={[styles.bodyCell, { backgroundColor: fold.card, borderColor: fold.line }]}>
                      {cell.kind === 'height' ? (
                        <TextInput
                          value={height === '0' ? '' : height}
                          onChangeText={(v) => setHeight(normalizeHeightInput(v))}
                          placeholder="0"
                          placeholderTextColor={placeholderColor}
                          keyboardType="number-pad"
                          style={[styles.bodyCellInput, { color: fold.ink, fontFamily: foldFonts.mono }]}
                        />
                      ) : cell.kind === 'weight' ? (
                        <TextInput
                          value={weight === '0' ? '' : weight}
                          onChangeText={(v) => setWeight(normalizeWeightInput(v))}
                          placeholder="0"
                          placeholderTextColor={placeholderColor}
                          keyboardType="decimal-pad"
                          style={[styles.bodyCellInput, { color: fold.ink, fontFamily: foldFonts.mono }]}
                        />
                      ) : (
                        <FoldCountUpText
                          value={bmi ?? 0}
                          animate={bodyMotionOn && bmi != null}
                          duration={650}
                          formatter={(n) => (bmi == null ? '—' : n.toFixed(1))}
                          textStyle={[
                            styles.bodyCellValue,
                            { color: fold.ink, fontFamily: foldFonts.mono },
                          ]}
                        />
                      )}
                      <Text style={[styles.bodyCellLabel, { color: fold.muted }]}>{cell.label}</Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.bmiCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
                  <View style={styles.bmiHead}>
                    <Text style={[styles.bmiHeadText, { color: fold.muted }]}>
                      {bmi == null ? 'BMI · 完善身高体重后计算' : `BMI ${bmi.toFixed(1)} · ${bmiInfo.label}范围`}
                    </Text>
                    <View
                      style={[
                        styles.bmiTag,
                        {
                          backgroundColor: bmiInfo.tone === 'ok' ? fold.sage2 : fold.amber2,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.bmiTagText,
                          { color: bmiInfo.tone === 'ok' ? fold.pine : '#8B6126' },
                        ]}>
                        {bmiInfo.label}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.bmiTrack, { backgroundColor: fold.paper2 }]}>
                    <View
                      style={[
                        styles.bmiFill,
                        {
                          width: `${bmiInfo.pct}%`,
                          backgroundColor: bmiInfo.tone === 'ok' ? fold.sage : fold.amber,
                        },
                      ]}
                    />
                  </View>
                  <WeightSpark heights={sparkHeights} animate={bodyMotionOn} />
                  <View style={styles.sparkMeta}>
                    <Text style={[styles.sparkMetaLeft, { color: fold.faint }]}>近 30 天</Text>
                    <Text
                      style={[
                        styles.sparkMetaRight,
                        {
                          color: weightDelta == null ? fold.faint : weightDelta <= 0 ? '#3E7A5E' : fold.clay,
                          fontFamily: foldFonts.mono,
                        },
                      ]}>
                      {weightDelta == null
                        ? '暂无趋势'
                        : `${weightDelta > 0 ? '+' : ''}${weightDelta} kg`}
                    </Text>
                  </View>
                </View>

                <View style={styles.field}>
                  <FieldLabel
                    label="饮食标签"
                    hint={dietary.tags.length > 0 ? `已选 ${dietary.tags.length} 个` : '点选偏好'}
                  />
                  <View style={styles.chipWrap}>
                    {DIETARY_PRESET_TAGS.map((tag) => {
                      const active = dietary.tags.includes(tag);
                      return (
                        <Pressable
                          key={tag}
                          onPress={() => toggleDietaryTag(tag)}
                          style={({ pressed }) => [
                            styles.tpill,
                            active
                              ? { backgroundColor: '#E7EFE9', borderColor: '#BFD4C6' }
                              : { backgroundColor: '#F8F4EA', borderColor: fold.line },
                            pressed && { transform: [{ scale: 0.96 }] },
                          ]}>
                          <Text
                            style={[
                              styles.tpillLabel,
                              {
                                color: active ? '#3C5C4D' : fold.muted,
                                fontWeight: active ? '800' : '600',
                              },
                            ]}>
                            {active ? `✓ ${tag}` : tag}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.field}>
                  <FieldLabel label="过敏" hint="命中时建议会高亮" />
                  <View style={[styles.inputRow, { backgroundColor: fold.card, borderColor: fold.line }]}>
                    <TextInput
                      value={dietary.allergies}
                      onChangeText={(value) =>
                        setDietary((prev) => ({ ...prev, allergies: value.slice(0, 200) }))
                      }
                      placeholder="花生、芒果"
                      placeholderTextColor={placeholderColor}
                      style={[styles.inputText, { color: fold.ink }]}
                    />
                    <AppIcon name="add" size={16} color={fold.faint} />
                  </View>
                </View>

                <View style={styles.field}>
                  <FieldLabel label="忌口" hint="不吃的食物" />
                  <View style={[styles.inputRow, { backgroundColor: fold.card, borderColor: fold.line }]}>
                    <TextInput
                      value={dietary.avoidFoods}
                      onChangeText={(value) =>
                        setDietary((prev) => ({ ...prev, avoidFoods: value.slice(0, 200) }))
                      }
                      placeholder="香菜、内脏、油炸"
                      placeholderTextColor={placeholderColor}
                      style={[styles.inputText, { color: fold.ink }]}
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <FieldLabel label="补充说明" hint="自由描述" />
                  <TextInput
                    value={dietary.notes}
                    onChangeText={(value) =>
                      setDietary((prev) => ({ ...prev, notes: value.slice(0, 300) }))
                    }
                    placeholder="工作日中午只能吃食堂，尽量少油少盐。"
                    placeholderTextColor={placeholderColor}
                    multiline
                    textAlignVertical="top"
                    style={[
                      styles.textarea,
                      { color: fold.ink, backgroundColor: fold.card, borderColor: fold.line },
                    ]}
                  />
                </View>

                <Pressable
                  onPress={() => void handleRecordWeight()}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    { borderColor: fold.line, backgroundColor: fold.card },
                    pressed && { opacity: 0.9 },
                  ]}>
                  <AppIcon name="add" size={16} color={fold.pine} />
                  <Text style={[styles.ghostBtnLabel, { color: fold.pine }]}>记录今天体重</Text>
                </Pressable>

                <Pressable
                  onPress={handleSavePress}
                  disabled={saving || loading || !isDirty}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: fold.pineButton, marginTop: 8 },
                    pressed && { opacity: 0.92 },
                    (!isDirty || saving || loading) && { opacity: 0.45 },
                  ]}>
                  <Text style={[styles.primaryBtnLabel, { color: fold.onPineButton }]}>
                    {saving ? '保存中…' : '保存修改'}
                  </Text>
                </Pressable>
                <View style={styles.formFoot}>
                  <View style={[styles.dirtyDot, { backgroundColor: fold.sage }]} />
                  <Text style={[styles.formFootText, { color: fold.faint }]}>
                    体征变化会重算每日目标
                  </Text>
                </View>
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      <EditProfileUnsavedDialog
        visible={unsavedVisible}
        summary={dirtySummary}
        saving={saving}
        onCancel={() => {
          setUnsavedVisible(false);
          leaveActionRef.current = null;
        }}
        onDiscard={() => {
          const leave = leaveActionRef.current;
          leaveActionRef.current = null;
          setUnsavedVisible(false);
          if (leave) leave();
          else performLeave();
        }}
        onSaveAndLeave={() => {
          void (async () => {
            const ok = await persistProfile();
            if (!ok) return;
            const leave = leaveActionRef.current;
            leaveActionRef.current = null;
            if (leave) leave();
            else performLeave();
          })();
        }}
      />

      <Modal
        visible={showBirthdayPicker}
        transparent
        animationType="fade"
        onRequestClose={dismissBirthdayPicker}>
        <View style={styles.birthdayModalRoot}>
          <Pressable
            style={[styles.birthdayModalBackdrop, { backgroundColor: 'rgba(24,32,28,0.42)' }]}
            onPress={dismissBirthdayPicker}
          />
          <View
            style={[
              styles.birthdayModalCard,
              { backgroundColor: fold.card, borderColor: fold.line },
            ]}>
            <Text style={[styles.birthdayModalTitle, { color: fold.pine, fontFamily: foldFonts.serif }]}>
              选择生日
            </Text>
            <DateTimePicker
              value={birthdayDraft}
              mode="date"
              display="spinner"
              themeVariant={isDark ? 'dark' : 'light'}
              locale={Platform.OS === 'ios' ? 'zh_CN' : undefined}
              maximumDate={birthdayMaxDate}
              minimumDate={birthdayMinDate}
              onChange={(_, date) => {
                if (date) setBirthdayDraft(date);
              }}
            />
            <View style={styles.birthdayModalActions}>
              <Pressable
                onPress={dismissBirthdayPicker}
                style={[styles.birthdayModalBtnGhost, { borderColor: fold.line }]}>
                <Text style={[styles.birthdayModalBtnLabel, { color: fold.muted }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={confirmBirthday}
                style={[styles.birthdayModalBtnPrimary, { backgroundColor: fold.pineButton }]}>
                <Text style={[styles.birthdayModalBtnLabel, { color: fold.onPineButton }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0 },
  appTitle: { fontSize: 17, fontWeight: '800' },
  appSub: { marginTop: 1, fontSize: 11, fontWeight: '600' },
  pillBtn: {
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBtnLabel: { fontSize: 13, fontWeight: '800' },
  scrollContent: {
    paddingTop: 12,
    paddingHorizontal: 15,
    maxWidth: Layout.contentMaxWidthWide,
    width: '100%',
    alignSelf: 'center',
  },
  ftabs: {
    height: 38,
    borderRadius: 12,
    padding: 3,
    flexDirection: 'row',
    position: 'relative',
    marginBottom: 8,
  },
  ftabInd: {
    position: 'absolute',
    left: 3,
    top: 3,
    height: 32,
    borderRadius: 9,
    ...Platform.select({
      ios: {
        shadowColor: '#23443A',
        shadowOpacity: 0.09,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  ftabItem: {
    flex: 1,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH - 8,
  },
  ftabLabel: { fontSize: 12 },
  dirtyBar: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dirtyDot: { width: 6, height: 6, borderRadius: 3 },
  dirtyText: { fontSize: 12, fontWeight: '700', color: '#8B5A1E' },
  tabPanel: { gap: 10, paddingBottom: 8 },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: { fontSize: 20, fontWeight: '700' },
  avatarMeta: { flex: 1, minWidth: 0 },
  avatarTitle: { fontSize: 12, fontWeight: '800' },
  avatarSub: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  tonePill: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tonePillLabel: { fontSize: 11 },
  field: { marginBottom: 2 },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  fieldLabel: { fontSize: 12, fontWeight: '800' },
  fieldHint: { fontSize: 11, fontWeight: '500' },
  inputRow: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
  pillRow: { flexDirection: 'row', gap: 6 },
  pillRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill2: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill2Label: { fontSize: 12 },
  pill2Wrap: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  primaryBtn: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnLabel: { fontSize: 15, fontWeight: '800' },
  formFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  formFootText: { fontSize: 11, fontWeight: '600' },
  personaCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
  },
  personaHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  personaHeadTitle: { flex: 1, fontSize: 12, fontWeight: '800' },
  charRing: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  charRingPct: {
    position: 'absolute',
    fontSize: 8,
    fontWeight: '700',
  },
  personaInput: {
    minHeight: 140,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
  },
  personaMeta: { flexDirection: 'row', justifyContent: 'flex-end' },
  personaCounter: { fontSize: 11, fontWeight: '600' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tpill: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tpillLabel: { fontSize: 12 },
  keywordCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
  },
  keywordHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  keywordTitle: { fontSize: 12, fontWeight: '800' },
  tagAmber: {
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagAmberText: { fontSize: 10, fontWeight: '800' },
  miniNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  miniNoteText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '500' },
  bodyGrid: { flexDirection: 'row', gap: 7, marginBottom: 2 },
  bodyCell: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 4,
  },
  bodyCellInput: {
    width: '100%',
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '800',
    padding: 0,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
  bodyCellValue: { fontSize: 20, fontWeight: '800' },
  bodyCellLabel: { fontSize: 11, fontWeight: '600' },
  bmiCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 8,
  },
  bmiHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bmiHeadText: { fontSize: 12, fontWeight: '600', flex: 1 },
  bmiTag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bmiTagText: { fontSize: 10, fontWeight: '800' },
  bmiTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  bmiFill: { height: '100%', borderRadius: 2 },
  sparkRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    paddingTop: 4,
  },
  sparkBar: {
    flex: 1,
    borderRadius: 3,
    minHeight: 4,
  },
  sparkMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sparkMetaLeft: { fontSize: 11, fontWeight: '600' },
  sparkMetaRight: { fontSize: 12, fontWeight: '800' },
  textarea: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  ghostBtn: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 2,
  },
  ghostBtnLabel: { fontSize: 13, fontWeight: '800' },
  birthdayModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing['6xl'],
  },
  birthdayModalBackdrop: { ...StyleSheet.absoluteFill },
  birthdayModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    paddingTop: 18,
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  birthdayModalTitle: { textAlign: 'center', fontSize: 17, fontWeight: '600', marginBottom: 4 },
  birthdayModalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  birthdayModalBtnGhost: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayModalBtnPrimary: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayModalBtnLabel: { fontSize: 15, fontWeight: '800' },
});
