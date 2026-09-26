import { AppCard, AppIcon, AppText, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
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
import { getDefaultUser, updateDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

const GENDER_OPTIONS = ['男', '女'] as const;
const LIFESTYLE_OPTIONS = ['长期静坐不运动', '健身', '高强度锻炼'] as const;
const GOAL_OPTIONS = ['无', '减脂', '增肌'] as const;
const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const WEEK_DAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'] as const;
const DEFAULT_GENDER: (typeof GENDER_OPTIONS)[number] = '男';
const DEFAULT_LIFESTYLE: (typeof LIFESTYLE_OPTIONS)[number] = '长期静坐不运动';
const DEFAULT_GOAL: (typeof GOAL_OPTIONS)[number] = '无';
const PERSONA_PORTRAIT_MAX = 500;

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

const TABS: { key: ProfileTab; label: string }[] = [
  { key: 'basic', label: '基本信息' },
  { key: 'persona', label: '画像' },
  { key: 'body', label: '体征' },
];

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

function formatChineseBirthday(iso: string | null): string {
  if (!iso) return '未设置';
  const d = parseIsoDateLocal(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function snapshotFromUser(user: UserRow, dietary: DietaryPrefs): FormSnapshot {
  return {
    name: user.name ?? '默认用户',
    personaPortrait: user.persona_portrait ?? '',
    gender: GENDER_OPTIONS.includes(user.gender as (typeof GENDER_OPTIONS)[number])
      ? (user.gender as (typeof GENDER_OPTIONS)[number])
      : DEFAULT_GENDER,
    lifestyle: LIFESTYLE_OPTIONS.includes(user.lifestyle as (typeof LIFESTYLE_OPTIONS)[number])
      ? (user.lifestyle as (typeof LIFESTYLE_OPTIONS)[number])
      : DEFAULT_LIFESTYLE,
    goal: GOAL_OPTIONS.includes(user.goal as (typeof GOAL_OPTIONS)[number])
      ? (user.goal as (typeof GOAL_OPTIONS)[number])
      : DEFAULT_GOAL,
    workoutDays: normalizeWorkoutDays(parseWeekDaysJson(user.workout_days)),
    height: String(user.height ?? 0),
    weight: String(user.weight ?? 0),
    birthdayIso: user.birthday ?? null,
    dietary: normalizeDietaryPrefs(dietary),
  };
}

function buildCurrentSnapshot(input: FormSnapshot): FormSnapshot {
  return {
    ...input,
    name: input.name.trim() || '默认用户',
    personaPortrait: input.personaPortrait.trim().slice(0, PERSONA_PORTRAIT_MAX),
    workoutDays: normalizeWorkoutDays(input.workoutDays),
    height: input.height.replace(/\D+/g, '') || '0',
    weight: input.weight.replace(/\D+/g, '') || '0',
    dietary: normalizeDietaryPrefs(input.dietary),
  };
}

function snapshotsEqual(a: FormSnapshot, b: FormSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function SettingsRow({
  label,
  last,
  children,
  onPress,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const content = (
    <View
      style={[
        styles.settingsRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline },
      ]}>
      <AppText variant="body" chrome style={[styles.settingsLabel, { color: colors.text }]}>
        {label}
      </AppText>
      <View style={styles.settingsValue}>{children}</View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [pressed && { opacity: 0.88 }]}>
        {content}
      </Pressable>
    );
  }
  return content;
}

function SettingsBlock({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.block}>
      {title ? (
        <AppText variant="caption" chrome style={[styles.blockTitle, { color: colors.textSecondary }]}>
          {title}
        </AppText>
      ) : null}
      <AppCard padded={false} style={styles.groupCard}>
        {children}
      </AppCard>
      {hint ? (
        <AppText variant="caption" chrome style={[styles.blockHint, { color: colors.textSecondary }]}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

function OptionSegment<T extends string>({
  options,
  value,
  onChange,
  wrap,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  wrap?: boolean;
}) {
  const { colors, shadows } = useAppTheme();
  return (
    <View
      style={[
        styles.segmented,
        wrap && styles.segmentedWrap,
        { backgroundColor: colors.capsule },
      ]}>
      {options.map((option) => {
        const active = value === option;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.segmentItem,
              wrap && styles.segmentItemWrap,
              active && [{ backgroundColor: colors.surface }, shadows.card],
              pressed && { opacity: 0.88 },
            ]}>
            <Text
              style={[
                Typography.bodyStrong,
                styles.segmentLabel,
                { color: active ? colors.primary : colors.textSecondary },
              ]}
              numberOfLines={1}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function EditProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>(() => parseInitialTab(params.tab));
  const [loadedSnapshot, setLoadedSnapshot] = useState<FormSnapshot | null>(null);

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

  const [skipRemoveGuard, setSkipRemoveGuard] = useState(false);
  const exitingRef = useRef(false);

  useEffect(() => {
    setActiveTab(parseInitialTab(params.tab));
  }, [params.tab]);

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
      const [data, dietaryPrefs] = await Promise.all([getDefaultUser(), loadDietaryPrefs()]);
      const snap = snapshotFromUser(data, dietaryPrefs);
      setLoadedSnapshot(snap);
      applySnapshot(snap);
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

  const showFitnessFields = isFitnessLifestyle(lifestyle);
  const displayName = name.trim() || '给自己起个名字';

  const handleNumericInput = (value: string, setter: (next: string) => void) => {
    setter(value.replace(/\D+/g, '').slice(0, 3));
  };

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
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '请稍后重试';
      Alert.alert('保存失败', message);
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
      if (leaveAction) leaveAction();
      else router.dismissTo('/(tabs)/profile');
    },
    [router, saving],
  );

  const promptUnsavedChanges = useCallback(
    (onLeave: () => void) => {
      Alert.alert('未保存的更改', '是否保存本次修改？', [
        { text: '取消', style: 'cancel' },
        { text: '不保存', style: 'destructive', onPress: onLeave },
        {
          text: '保存',
          onPress: () =>
            void (async () => {
              const ok = await persistProfile();
              if (!ok) return;
              onLeave();
            })(),
        },
      ]);
    },
    [persistProfile],
  );

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
    void (async () => {
      const ok = await persistProfile();
      if (!ok) return;
      performLeave();
    })();
  }, [isDirty, loading, performLeave, persistProfile, saving]);

  const preventRemove =
    isFocused && isDirty && !loading && !skipRemoveGuard && !exitingRef.current;

  usePreventRemove(preventRemove, ({ data }) => {
    promptUnsavedChanges(() => performLeave(() => navigation.dispatch(data.action)));
  });

  const placeholderColor = colors.textMuted;
  const rowInputStyle = [
    Typography.body,
    styles.rowInput,
    { color: colors.text },
    Platform.OS === 'android' ? { includeFontPadding: false, textAlignVertical: 'center' as const } : null,
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: !isDirty }} />
      <ScreenHeader
        title="编辑资料"
        onBack={handleBackPress}
        right={
          <Pressable
            onPress={handleSavePress}
            disabled={saving || loading || !isDirty}
            hitSlop={Layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="保存"
            style={({ pressed }) => [
              styles.headerSaveBtn,
              pressed && isDirty && !saving ? { opacity: 0.85 } : null,
              (!isDirty || saving || loading) && { opacity: 0.38 },
            ]}>
            <Text style={[Typography.bodyStrong, { color: colors.primary }]}>
              {saving ? '保存中' : '保存'}
            </Text>
          </Pressable>
        }
      />

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
              paddingHorizontal: Layout.pagePaddingX,
            },
          ]}>
          <View style={styles.identityStrip}>
            <AppText variant="h3" style={{ color: colors.text }} numberOfLines={1}>
              {displayName}
            </AppText>
            <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
              {isDirty ? '有未保存的修改' : '完善资料，饮食与健康建议会更准'}
            </AppText>
          </View>

          <View style={[styles.tabBar, { backgroundColor: colors.capsule }]}>
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  style={({ pressed }) => [
                    styles.tabItem,
                    active && [{ backgroundColor: colors.surface }, shadows.card],
                    pressed && { opacity: 0.9 },
                  ]}>
                  <Text
                    style={[
                      Typography.bodyStrong,
                      styles.tabLabel,
                      { color: active ? colors.primary : colors.textSecondary },
                    ]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {activeTab === 'basic' ? (
            <View style={styles.tabPanel}>
              <SettingsBlock title="个人">
                <SettingsRow label="姓名">
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="输入姓名"
                    placeholderTextColor={placeholderColor}
                    style={rowInputStyle}
                    returnKeyType="done"
                  />
                </SettingsRow>
                <SettingsRow label="生日" onPress={openBirthdayPicker}>
                  <View style={styles.valueWithIcon}>
                    <AppText
                      variant="body"
                      chrome
                      style={{
                        color: birthdayIso ? colors.text : colors.textMuted,
                        textAlign: 'right',
                      }}>
                      {formatChineseBirthday(birthdayIso)}
                    </AppText>
                    <AppIcon name="chevron-right" size={18} color={colors.textSecondary} />
                  </View>
                </SettingsRow>
                <SettingsRow label="性别" last>
                  <OptionSegment options={GENDER_OPTIONS} value={gender} onChange={setGender} />
                </SettingsRow>
              </SettingsBlock>

              <SettingsBlock title="生活与目标" hint={showFitnessFields ? '健身日用于安排训练相关建议' : undefined}>
                <View style={styles.stackField}>
                  <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                    生活习惯
                  </AppText>
                  <OptionSegment
                    options={LIFESTYLE_OPTIONS}
                    value={lifestyle}
                    onChange={handleLifestyleChange}
                    wrap
                  />
                </View>
                {showFitnessFields ? (
                  <>
                    <View style={[styles.divider, { backgroundColor: colors.outline }]} />
                    <View style={styles.stackField}>
                      <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                        目标
                      </AppText>
                      <OptionSegment options={GOAL_OPTIONS} value={goal} onChange={setGoal} />
                    </View>
                    <View style={[styles.divider, { backgroundColor: colors.outline }]} />
                    <View style={[styles.stackField, styles.stackFieldLast]}>
                      <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                        健身日
                      </AppText>
                      <View style={styles.weekRow}>
                        {WEEK_DAYS.map((day, index) => {
                          const active = workoutDays.includes(day);
                          return (
                            <Pressable
                              key={day}
                              onPress={() => toggleWorkoutDay(day)}
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                              accessibilityLabel={day}
                              style={({ pressed }) => [
                                styles.weekDay,
                                {
                                  backgroundColor: active ? colors.primaryMuted : colors.input,
                                  borderColor: active ? colors.primary : colors.outline,
                                },
                                pressed && { opacity: 0.88 },
                              ]}>
                              <Text
                                style={[
                                  Typography.caption,
                                  {
                                    color: active ? colors.primary : colors.textSecondary,
                                    fontWeight: '800',
                                  },
                                ]}>
                                {WEEK_DAY_SHORT[index]}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </>
                ) : null}
              </SettingsBlock>
            </View>
          ) : null}

          {activeTab === 'persona' ? (
            <View style={styles.tabPanel}>
              <SettingsBlock
                title="人物画像"
                hint="写性格、兴趣、日常节奏等，帮助助手更懂你">
                <View style={styles.personaWrap}>
                  <TextInput
                    value={personaPortrait}
                    onChangeText={(value) => setPersonaPortrait(value.slice(0, PERSONA_PORTRAIT_MAX))}
                    placeholder="用一段话介绍自己…"
                    placeholderTextColor={placeholderColor}
                    multiline
                    textAlignVertical="top"
                    maxLength={PERSONA_PORTRAIT_MAX}
                    style={[
                      Typography.body,
                      styles.personaInput,
                      {
                        color: colors.text,
                        backgroundColor: isDark ? colors.surfaceSubtle : colors.input,
                      },
                    ]}
                  />
                  <AppText
                    variant="caption"
                    chrome
                    style={[styles.personaCounter, { color: colors.textSecondary }]}>
                    {personaPortrait.length}/{PERSONA_PORTRAIT_MAX}
                  </AppText>
                </View>
              </SettingsBlock>
            </View>
          ) : null}

          {activeTab === 'body' ? (
            <View style={styles.tabPanel}>
              <SettingsBlock title="体征数据" hint="保存体重时会写入本地趋势（仅本机）">
                <View style={styles.metricRow}>
                  <View style={styles.metricCell}>
                    <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                      身高
                    </AppText>
                    <View style={styles.metricInputRow}>
                      <TextInput
                        value={height === '0' ? '' : height}
                        onChangeText={(value) => handleNumericInput(value, setHeight)}
                        placeholder="0"
                        placeholderTextColor={placeholderColor}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        style={[
                          Typography.h2,
                          styles.metricInput,
                          { color: colors.text },
                          Platform.OS === 'android'
                            ? { includeFontPadding: false, textAlignVertical: 'center' as const }
                            : null,
                        ]}
                      />
                      <AppText variant="body" chrome style={{ color: colors.textSecondary }}>
                        cm
                      </AppText>
                    </View>
                  </View>
                  <View style={[styles.metricDivider, { backgroundColor: colors.outline }]} />
                  <View style={styles.metricCell}>
                    <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                      体重
                    </AppText>
                    <View style={styles.metricInputRow}>
                      <TextInput
                        value={weight === '0' ? '' : weight}
                        onChangeText={(value) => handleNumericInput(value, setWeight)}
                        placeholder="0"
                        placeholderTextColor={placeholderColor}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        style={[
                          Typography.h2,
                          styles.metricInput,
                          { color: colors.text },
                          Platform.OS === 'android'
                            ? { includeFontPadding: false, textAlignVertical: 'center' as const }
                            : null,
                        ]}
                      />
                      <AppText variant="body" chrome style={{ color: colors.textSecondary }}>
                        kg
                      </AppText>
                    </View>
                  </View>
                </View>
              </SettingsBlock>

              <SettingsBlock title="饮食偏好与禁忌" hint="影响菜谱与摄入 AI 建议，经设置同步">
                <View style={styles.stackField}>
                  <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                    常用标签
                  </AppText>
                  <View style={styles.tagWrap}>
                    {DIETARY_PRESET_TAGS.map((tag) => {
                      const active = dietary.tags.includes(tag);
                      return (
                        <Pressable
                          key={tag}
                          onPress={() => toggleDietaryTag(tag)}
                          style={({ pressed }) => [
                            styles.tagChip,
                            {
                              backgroundColor: active ? colors.primaryMuted : colors.input,
                              borderColor: active ? colors.primary : colors.outline,
                            },
                            pressed && { opacity: 0.88 },
                          ]}>
                          <Text
                            style={[
                              Typography.caption,
                              { color: active ? colors.primary : colors.textSecondary, fontWeight: '800' },
                            ]}>
                            {tag}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View style={[styles.divider, { backgroundColor: colors.outline }]} />
                <View style={styles.stackField}>
                  <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                    过敏
                  </AppText>
                  <TextInput
                    value={dietary.allergies}
                    onChangeText={(value) =>
                      setDietary((prev) => ({ ...prev, allergies: value.slice(0, 200) }))
                    }
                    placeholder="例如：花生、海鲜"
                    placeholderTextColor={placeholderColor}
                    style={[styles.dietaryInput, { color: colors.text, backgroundColor: colors.input }]}
                  />
                </View>
                <View style={[styles.divider, { backgroundColor: colors.outline }]} />
                <View style={styles.stackField}>
                  <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                    忌口 / 不吃
                  </AppText>
                  <TextInput
                    value={dietary.avoidFoods}
                    onChangeText={(value) =>
                      setDietary((prev) => ({ ...prev, avoidFoods: value.slice(0, 200) }))
                    }
                    placeholder="例如：香菜、内脏"
                    placeholderTextColor={placeholderColor}
                    style={[styles.dietaryInput, { color: colors.text, backgroundColor: colors.input }]}
                  />
                </View>
                <View style={[styles.divider, { backgroundColor: colors.outline }]} />
                <View style={[styles.stackField, styles.stackFieldLast]}>
                  <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                    补充说明
                  </AppText>
                  <TextInput
                    value={dietary.notes}
                    onChangeText={(value) =>
                      setDietary((prev) => ({ ...prev, notes: value.slice(0, 300) }))
                    }
                    placeholder="其他饮食习惯…"
                    placeholderTextColor={placeholderColor}
                    multiline
                    textAlignVertical="top"
                    style={[
                      styles.dietaryInput,
                      styles.dietaryNotes,
                      { color: colors.text, backgroundColor: colors.input },
                    ]}
                  />
                </View>
              </SettingsBlock>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showBirthdayPicker}
        transparent
        animationType="fade"
        onRequestClose={dismissBirthdayPicker}>
        <View style={styles.birthdayModalRoot}>
          <Pressable
            style={[styles.birthdayModalBackdrop, { backgroundColor: colors.overlay }]}
            onPress={dismissBirthdayPicker}
          />
          <View
            style={[
              styles.birthdayModalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.outline,
              },
              shadows.sheet,
            ]}>
            <AppText variant="title" style={[styles.birthdayModalTitle, { color: colors.text }]}>
              选择生日
            </AppText>
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
                style={[styles.birthdayModalBtnGhost, { borderColor: colors.outline }]}>
                <AppText variant="bodyStrong" chrome style={{ color: colors.textSecondary }}>
                  取消
                </AppText>
              </Pressable>
              <Pressable
                onPress={confirmBirthday}
                style={[styles.birthdayModalBtnPrimary, { backgroundColor: colors.primary }]}>
                <AppText variant="bodyStrong" chrome style={{ color: colors.onPrimary }}>
                  确定
                </AppText>
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
  scrollContent: {
    paddingTop: Spacing['3xl'],
    gap: Spacing['3xl'],
    maxWidth: Layout.contentMaxWidthWide,
    width: '100%',
    alignSelf: 'center',
  },
  headerSaveBtn: {
    minHeight: Layout.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  identityStrip: {
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  tabBar: {
    flexDirection: 'row',
    padding: Spacing.xs,
    borderRadius: Radius.md,
    gap: Spacing.xs,
  },
  tabItem: {
    flex: 1,
    minHeight: Layout.minTouchTarget,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  tabLabel: {
    fontSize: 13,
  },
  tabPanel: {
    gap: Spacing['3xl'],
  },
  block: {
    gap: Spacing.md,
  },
  blockTitle: {
    marginLeft: Spacing.md,
    letterSpacing: 0.2,
    textTransform: 'none',
  },
  blockHint: {
    marginLeft: Spacing.md,
    marginRight: Spacing.md,
    fontWeight: '600',
  },
  groupCard: {
    overflow: 'hidden',
  },
  settingsRow: {
    minHeight: 52,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
  },
  settingsLabel: {
    width: 72,
    fontWeight: '700',
  },
  settingsValue: {
    flex: 1,
    minWidth: 0,
    alignItems: 'stretch',
  },
  rowInput: {
    padding: 0,
    margin: 0,
    textAlign: 'right',
    fontWeight: '600',
  },
  valueWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.xs,
  },
  segmented: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: Radius.sm,
    gap: 3,
  },
  segmentedWrap: {
    flexWrap: 'wrap',
  },
  segmentItem: {
    flex: 1,
    minHeight: 34,
    borderRadius: Radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  segmentItemWrap: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
  },
  segmentLabel: {
    fontSize: 13,
  },
  stackField: {
    paddingHorizontal: Spacing['3xl'],
    paddingTop: Spacing['3xl'],
    paddingBottom: Spacing['3xl'],
    gap: Spacing.xl,
  },
  stackFieldLast: {
    paddingBottom: Spacing['4xl'],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing['3xl'],
  },
  weekRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  weekDay: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tagChip: {
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dietaryInput: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    fontSize: 15,
    fontWeight: '600',
    minHeight: 44,
  },
  dietaryNotes: {
    minHeight: 88,
  },
  personaWrap: {
    padding: Spacing['3xl'],
    gap: Spacing.md,
  },
  personaInput: {
    minHeight: 168,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
    lineHeight: 22,
    fontWeight: '600',
  },
  personaCounter: {
    textAlign: 'right',
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: Spacing['3xl'],
    paddingHorizontal: Spacing.xl,
  },
  metricCell: {
    flex: 1,
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: Spacing.sm,
  },
  metricInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  metricInput: {
    flex: 1,
    padding: 0,
    margin: 0,
    fontWeight: '800',
  },
  birthdayModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing['6xl'],
  },
  birthdayModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  birthdayModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius['2xl'],
    paddingTop: Spacing['4xl'],
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  birthdayModalTitle: {
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  birthdayModalActions: {
    flexDirection: 'row',
    gap: Spacing.xl,
    marginTop: Spacing.sm,
  },
  birthdayModalBtnGhost: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayModalBtnPrimary: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
