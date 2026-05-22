import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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




import { getDefaultUser, updateDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';

import { invalidateDailyIntakeAiTargetsCache } from '@/lib/daily-intake-ai-targets';
import {
  buildHealthKitDisplayRows,
  extractProfileMetricsFromHealthKit,
  healthKitAuthStatusHint,
  healthKitReadSummary,
  healthKitSettingsHelpLines,
  healthKitStatusSubtitle,
  type HealthKitDisplayRow,
} from '@/lib/apple-healthkit';
import type { HealthKitAuthorizationRequestStatus, HealthKitSnapshot } from 'zheng-healthkit';
import {
  fetchAppleHealthKitSnapshot,
  getHealthKitAppIdentity,
  getHealthKitAuthorizationRequestStatus,
  getHealthKitBlockReason,
  healthKitBlockReasonMessage,
  isAppleHealthKitSupported,
  requestHealthKitAuthorization,
  type HealthKitBlockReason,
} from 'zheng-healthkit';

const GENDER_OPTIONS = ['男', '女'] as const;
const LIFESTYLE_OPTIONS = ['长期静坐不运动', '健身', '高强度锻炼'] as const;
const GOAL_OPTIONS = ['无', '减脂', '增肌'] as const;
const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const DEFAULT_GENDER: (typeof GENDER_OPTIONS)[number] = '男';
const DEFAULT_LIFESTYLE: (typeof LIFESTYLE_OPTIONS)[number] = '长期静坐不运动';
const DEFAULT_GOAL: (typeof GOAL_OPTIONS)[number] = '无';

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
        typeof d === 'string' && (WEEK_DAYS as readonly string[]).includes(d)
    );
  } catch {
    return [];
  }
}

function serializeWeekDays(days: string[]): string {
  return JSON.stringify(days);
}

function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${month}-${day}`;
}

function formatChineseBirthday(iso: string | null): string {
  if (!iso) return '点击添加生日';
  const d = parseIsoDateLocal(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [user, setUser] = useState<UserRow | null>(null);


  const [name, setName] = useState('默认用户');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [gender, setGender] = useState<(typeof GENDER_OPTIONS)[number]>(DEFAULT_GENDER);
  const [lifestyle, setLifestyle] = useState<(typeof LIFESTYLE_OPTIONS)[number]>(DEFAULT_LIFESTYLE);
  const [goal, setGoal] = useState<(typeof GOAL_OPTIONS)[number]>(DEFAULT_GOAL);
  const [workoutDays, setWorkoutDays] = useState<string[]>([]);
  const [height, setHeight] = useState('0');
  const [weight, setWeight] = useState('0');
  const [birthdayIso, setBirthdayIso] = useState<string | null>(null);
  const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);
  const [birthdayDraft, setBirthdayDraft] = useState(() => new Date(1990, 0, 1));

  const healthKitSupported = isAppleHealthKitSupported();
  const [healthKitLoading, setHealthKitLoading] = useState(false);
  const [healthKitSnapshot, setHealthKitSnapshot] = useState<HealthKitSnapshot | null>(null);
  const [healthKitRows, setHealthKitRows] = useState<HealthKitDisplayRow[]>([]);
  const [healthKitExpanded, setHealthKitExpanded] = useState(false);
  const [healthKitBlockReason, setHealthKitBlockReason] = useState<HealthKitBlockReason | null>(null);
  const [healthKitHelpOpen, setHealthKitHelpOpen] = useState(false);
  const [iosAppDisplayName, setIosAppDisplayName] = useState('小郑的自我修养');
  const [iosBundleIdentifier, setIosBundleIdentifier] = useState('com.myselfManage.appdemo');
  const [healthKitAuthStatus, setHealthKitAuthStatus] =
    useState<HealthKitAuthorizationRequestStatus | null>(null);

  const refreshHealthKitRegistration = async () => {
    if (!healthKitSupported) return;
    const [identity, status] = await Promise.all([
      getHealthKitAppIdentity(),
      getHealthKitAuthorizationRequestStatus(),
    ]);
    setIosAppDisplayName(identity.displayName);
    if (identity.bundleIdentifier) setIosBundleIdentifier(identity.bundleIdentifier);
    setHealthKitAuthStatus(status);
  };

  const openHealthApp = async () => {
    const url = 'x-apple-health://';
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert('提示', '无法打开「健康」App，请从主屏幕手动进入。');
      return;
    }
    await Linking.openURL(url);
  };

  const handleNumericInput = (value: string, setter: (next: string) => void) => {
    setter(value.replace(/\D+/g, ''));
  };


  const showFitnessFields = isFitnessLifestyle(lifestyle);

  const toggleWorkoutDay = (day: string) => {
    setWorkoutDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  };

  const handleLifestyleChange = (option: (typeof LIFESTYLE_OPTIONS)[number]) => {
    setLifestyle(option);
    if (!isFitnessLifestyle(option)) {
      setGoal(DEFAULT_GOAL);
      setWorkoutDays([]);
    }
  };

  const saveProfile = async () => {
    try {
      const fitnessActive = isFitnessLifestyle(lifestyle);
      await updateDefaultUser({
        name,
        avatar_uri: avatarUri,
        gender,
        lifestyle,
        goal: fitnessActive ? goal : DEFAULT_GOAL,
        workout_days: fitnessActive ? serializeWeekDays(workoutDays) : '[]',
        birthday: birthdayIso,
        height: Number(height),
        weight: Number(weight),
      });
      await invalidateDailyIntakeAiTargetsCache();
      Alert.alert('保存成功');
      router.dismissTo('/(tabs)/profile');
    } catch (error) {
      const message = error instanceof Error ? error.message : '请稍后重试';
      Alert.alert('保存失败', message);
    }
  };

  const loadHealthKitData = async (requestAuth = false) => {
    if (!healthKitSupported) return;
    setHealthKitLoading(true);
    try {
      const block = await getHealthKitBlockReason();
      setHealthKitBlockReason(block);
      if (block) {
        setHealthKitSnapshot(null);
        setHealthKitRows([]);
        return;
      }
      if (requestAuth) {
        const statusBefore = await getHealthKitAuthorizationRequestStatus();
        if (statusBefore === 'unnecessary') {
          Alert.alert(
            '不会再弹出授权窗',
            `这是 iOS 正常行为（已向系统登记过）。\n\n请到：设置 → 健康 → 数据访问与设备\n查找「${iosAppDisplayName}」${
              iosBundleIdentifier ? `\n或 Bundle ID：${iosBundleIdentifier}` : ''
            }\n并打开身高、体重、步数等读取开关。`,
            [
              { text: '打开「健康」App', onPress: () => void openHealthApp() },
              { text: '知道了', style: 'cancel' },
            ],
          );
        }
        await requestHealthKitAuthorization();
      }
      const snapshot = await fetchAppleHealthKitSnapshot();
      setHealthKitSnapshot(snapshot);
      setHealthKitRows(buildHealthKitDisplayRows(snapshot));
      if (snapshot.appDisplayName) setIosAppDisplayName(snapshot.appDisplayName);
      if (snapshot.bundleIdentifier) setIosBundleIdentifier(snapshot.bundleIdentifier);
      if (snapshot.requestStatus) setHealthKitAuthStatus(snapshot.requestStatus);
      await refreshHealthKitRegistration();
      if (!snapshot.available && snapshot.errors[0]) {
        setHealthKitBlockReason('healthkit_unavailable');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取健康数据失败';
      Alert.alert('Apple 健康', message);
    } finally {
      setHealthKitLoading(false);
    }
  };

  const applyHealthKitToProfile = () => {
    if (!healthKitSnapshot) return;
    const { heightCm, weightKg } = extractProfileMetricsFromHealthKit(healthKitSnapshot);
    if (heightCm != null && heightCm > 0) setHeight(String(Math.round(heightCm)));
    if (weightKg != null && weightKg > 0) setWeight(String(weightKg));

    const dob = healthKitSnapshot.characteristics.dateOfBirth;
    if (dob) {
      const d = new Date(dob);
      if (!Number.isNaN(d.getTime())) setBirthdayIso(toIsoDate(d));
    }

    const sex = healthKitSnapshot.characteristics.biologicalSex;
    if (sex === '女' || sex === '男') {
      setGender(sex);
    }

    Alert.alert('已填入', '已将 Apple 健康中的身高、体重等可用数据同步到表单（请检查后保存）。');
  };

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '需要相册权限才能选择头像');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setAvatarUri(result.assets[0].uri);
      setUser(prev => (prev ? { ...prev, avatar_uri: result.assets[0].uri } : prev));
    }
  };



  useEffect(() => {
    let mounted = true;
  
    const loadUser = async () => {
      const data = await getDefaultUser();
      if (!mounted) return;
  
      setUser(data);
    };
  
    loadUser();
  
    return () => {
      mounted = false;
    };
  }, []);
  
  useEffect(() => {
    if (!healthKitSupported) return;
    void (async () => {
      const block = await getHealthKitBlockReason();
      setHealthKitBlockReason(block);
      if (!block) await refreshHealthKitRegistration();
    })();
  }, [healthKitSupported]);

  useEffect(() => {
    if (!user) return;
  
    setName(user.name ?? '默认用户');
    setAvatarUri(user.avatar_uri ?? null);
    setGender(
      GENDER_OPTIONS.includes(user.gender as (typeof GENDER_OPTIONS)[number])
        ? (user.gender as (typeof GENDER_OPTIONS)[number])
        : DEFAULT_GENDER
    );
    setLifestyle(
      LIFESTYLE_OPTIONS.includes(user.lifestyle as (typeof LIFESTYLE_OPTIONS)[number])
        ? (user.lifestyle as (typeof LIFESTYLE_OPTIONS)[number])
        : DEFAULT_LIFESTYLE
    );
    setGoal(
      GOAL_OPTIONS.includes(user.goal as (typeof GOAL_OPTIONS)[number])
        ? (user.goal as (typeof GOAL_OPTIONS)[number])
        : DEFAULT_GOAL
    );
    setWorkoutDays(parseWeekDaysJson(user.workout_days));
    setHeight(String(user.height ?? 0));
    setWeight(String(user.weight ?? 0));
    setBirthdayIso(user.birthday ?? null);
  }, [user]);

  const birthdayMaxDate = useMemo(() => new Date(), []);
  const birthdayMinDate = useMemo(() => new Date(1900, 0, 1), []);
  const healthKitSummaryHint = useMemo(
    () => (healthKitSnapshot ? healthKitReadSummary(healthKitSnapshot, iosAppDisplayName) : null),
    [healthKitSnapshot, iosAppDisplayName],
  );
  const healthKitSettingsHelp = useMemo(
    () => healthKitSettingsHelpLines(iosAppDisplayName, healthKitAuthStatus),
    [iosAppDisplayName, healthKitAuthStatus],
  );
  const healthKitRegistrationHint = useMemo(
    () => healthKitAuthStatusHint(healthKitAuthStatus, iosAppDisplayName),
    [healthKitAuthStatus, iosAppDisplayName],
  );
  const healthKitSubline = useMemo(
    () =>
      healthKitLoading
        ? '正在读取…'
        : healthKitBlockReason
          ? healthKitBlockReasonMessage(healthKitBlockReason)
          : healthKitStatusSubtitle(healthKitSnapshot, healthKitAuthStatus, healthKitRows.length),
    [healthKitLoading, healthKitBlockReason, healthKitSnapshot, healthKitAuthStatus, healthKitRows.length],
  );

  const openBirthdayPicker = () => {
    setBirthdayDraft(birthdayIso ? parseIsoDateLocal(birthdayIso) : new Date(1990, 0, 1));
    setShowBirthdayPicker(true);
  };

  const dismissBirthdayPicker = () => setShowBirthdayPicker(false);

  const confirmBirthday = () => {
    setBirthdayIso(toIsoDate(birthdayDraft));
    setShowBirthdayPicker(false);
  };

  const palette = useMemo(
    () => ({
      bg: isDark ? theme.background : '#faf8ff',
      surface: isDark ? theme.surface : '#ffffff',
      text: isDark ? theme.text : '#131b2e',
      outline: isDark ? 'rgba(148,163,184,0.8)' : '#727785',
      outlineVariant: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.35)',
      primary: isDark ? '#60a5fa' : '#0058be',
      secondary: isDark ? '#34d399' : '#006c49',
      topBarBg: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.86)',
    }),
    [isDark, theme],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.topBar,
          {
            backgroundColor: palette.topBarBg,
            paddingTop: Math.max(insets.top, 14),
            borderBottomColor: palette.outlineVariant,
          },
        ]}
      >
        <View style={styles.topBarInner}>
          <View style={styles.topLeft}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.roundBtn, { backgroundColor: pressed ? `${palette.primary}18` : 'transparent' }]}
            >
              <MaterialIcons name="arrow-back" size={22} color={palette.primary} />
            </Pressable>
            <Text style={[styles.topTitle, { color: palette.text }]}>编辑个人资料</Text>
          </View>

        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 18, paddingBottom: Math.max(insets.bottom + 20, 32) }}
      >
        <View style={styles.main}>
          <View style={styles.avatarSection}>
            <View style={styles.avatarWrap}>
              <Pressable
                onPress={pickAvatar}
                style={[
                  styles.avatarRing,
                  { borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(242,243,255,1)' },
                ]}
              >
                <Image
                  source={avatarUri ? { uri: avatarUri } : require('../assets/profile/avatar.png')}
                  style={styles.avatarImg}
                  contentFit="cover"
                />
              </Pressable>
              <Pressable onPress={pickAvatar} style={[styles.cameraBtn, { backgroundColor: palette.primary }]}>
                <MaterialIcons name="photo-camera" size={20} color="#fff" />
              </Pressable>
            </View>

            <Text style={[styles.avatarKicker, { color: palette.outline }]}>账号身份</Text>
            <Text style={[styles.avatarTitle, { color: palette.text }]}>编辑个人资料</Text>
          </View>

          <View style={styles.group}>
            <View style={styles.groupTitleRow}>
              <View style={[styles.groupMark, { backgroundColor: palette.primary }]} />
              <Text style={[styles.groupTitle, { color: palette.outline }]}>基本信息</Text>
            </View>

            <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}> 
              <Text style={[styles.fieldLabel, { color: palette.outline }]}>姓名</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="输入您的姓名"
                placeholderTextColor={isDark ? 'rgba(148,163,184,0.6)' : 'rgba(114,119,133,0.5)'}
                style={[styles.fieldInput, { color: palette.text, borderBottomColor: palette.outlineVariant }]}
              />
            </View>

            <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
              <Text style={[styles.fieldLabel, { color: palette.outline }]}>生日</Text>
              <Pressable onPress={openBirthdayPicker} style={styles.birthdayRow}>
                <Text
                  style={[
                    styles.birthdayValue,
                    { color: birthdayIso ? palette.text : (isDark ? 'rgba(148,163,184,0.6)' : 'rgba(114,119,133,0.55)') },
                  ]}
                >
                  {formatChineseBirthday(birthdayIso)}
                </Text>
                <MaterialIcons name="calendar-today" size={22} color={palette.outline} />
              </Pressable>
            </View>

            <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
              <Text style={[styles.fieldLabel, { color: palette.outline }]}>性别</Text>
              <View style={styles.optionRow}>
                {GENDER_OPTIONS.map(option => {
                  const active = gender === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setGender(option)}
                      style={[
                        styles.optionChip,
                        {
                          borderColor: active ? palette.primary : palette.outlineVariant,
                          backgroundColor: active ? `${palette.primary}16` : 'transparent',
                        },
                      ]}
                    >
                      <Text style={[styles.optionText, { color: active ? palette.primary : palette.text }]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
              <Text style={[styles.fieldLabel, { color: palette.outline }]}>生活习惯</Text>
              <View style={styles.optionWrap}>
                {LIFESTYLE_OPTIONS.map(option => {
                  const active = lifestyle === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => handleLifestyleChange(option)}
                      style={[
                        styles.optionChip,
                        {
                          borderColor: active ? palette.primary : palette.outlineVariant,
                          backgroundColor: active ? `${palette.primary}16` : 'transparent',
                        },
                      ]}
                    >
                      <Text style={[styles.optionText, { color: active ? palette.primary : palette.text }]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {showFitnessFields ? (
              <>
                <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
                  <Text style={[styles.fieldLabel, { color: palette.outline }]}>目标</Text>
                  <View style={styles.optionRow}>
                    {GOAL_OPTIONS.map(option => {
                      const active = goal === option;
                      return (
                        <Pressable
                          key={option}
                          onPress={() => setGoal(option)}
                          style={[
                            styles.optionChip,
                            {
                              borderColor: active ? palette.primary : palette.outlineVariant,
                              backgroundColor: active ? `${palette.primary}16` : 'transparent',
                            },
                          ]}
                        >
                          <Text style={[styles.optionText, { color: active ? palette.primary : palette.text }]}>{option}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
                  <Text style={[styles.fieldLabel, { color: palette.outline }]}>健身日</Text>
                  <View style={styles.weekDayRow}>
                    {WEEK_DAYS.map(day => {
                      const active = workoutDays.includes(day);
                      return (
                        <Pressable
                          key={day}
                          onPress={() => toggleWorkoutDay(day)}
                          style={[
                            styles.weekDayChip,
                            {
                              borderColor: active ? palette.primary : palette.outlineVariant,
                              backgroundColor: active ? `${palette.primary}16` : 'transparent',
                            },
                          ]}
                        >
                          <Text style={[styles.weekDayText, { color: active ? palette.primary : palette.text }]}>{day}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            ) : null}
          </View>

          <View style={styles.group}>
            <View style={styles.groupTitleRow}>
              <View style={[styles.groupMark, { backgroundColor: palette.secondary }]} />
              <Text style={[styles.groupTitle, { color: palette.outline }]}>体征数据</Text>
            </View>

            <View style={styles.metricGrid}>
              <View style={[styles.metricCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
                <Text style={[styles.fieldLabel, { color: palette.outline }]}>身高</Text>
                <View style={styles.metricRow}>
                  <TextInput
                    value={height}
                    onChangeText={(value) => handleNumericInput(value, setHeight)}
                    style={[styles.metricInput, { color: palette.text, borderBottomColor: palette.outlineVariant }]}
                  />
                  <Text style={[styles.metricUnit, { color: palette.outline }]}>cm</Text>
                </View>
              </View>

              <View style={[styles.metricCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
                <Text style={[styles.fieldLabel, { color: palette.outline }]}>体重</Text>
                <View style={styles.metricRow}>
                  <TextInput
                    value={weight}
                    onChangeText={(value) => handleNumericInput(value, setWeight)}
                    style={[styles.metricInput, { color: palette.text, borderBottomColor: palette.outlineVariant }]}
                  />
                  <Text style={[styles.metricUnit, { color: palette.outline }]}>kg</Text>
                </View>
              </View>
            </View>
          </View>

          {healthKitSupported ? (
            <View style={styles.group}>
              <View style={styles.groupTitleRow}>
                <View style={[styles.groupMark, { backgroundColor: '#e11d48' }]} />
                <Text style={[styles.groupTitle, { color: palette.outline }]}>Apple 健康</Text>
              </View>

              <View style={[styles.healthKitCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
                <View style={styles.healthKitHeader}>
                  <MaterialIcons name="favorite" size={22} color="#e11d48" />
                  <View style={styles.healthKitHeaderText}>
                    <Text style={[styles.healthKitTitle, { color: palette.text }]}>健康 App 数据</Text>
                    <Text style={[styles.healthKitSub, { color: palette.outline }]}>{healthKitSubline}</Text>
                  </View>
                </View>

                {!healthKitBlockReason ? (
                  <View
                    style={[
                      styles.healthKitNameBanner,
                      { backgroundColor: isDark ? 'rgba(225,29,72,0.12)' : '#fff1f2', borderColor: '#fecdd3' },
                    ]}
                  >
                    <Text style={[styles.healthKitNameBannerTitle, { color: palette.text }]}>
                      在「健康」里请搜索此名称
                    </Text>
                    <Text style={[styles.healthKitNameBannerValue, { color: '#e11d48' }]}>
                      {iosAppDisplayName || '（未读取到显示名）'}
                    </Text>
                    {iosBundleIdentifier ? (
                      <Text style={[styles.healthKitNameBannerBundle, { color: palette.outline }]}>
                        Bundle ID：{iosBundleIdentifier}
                      </Text>
                    ) : null}
                    <Text style={[styles.healthKitNameBannerSub, { color: palette.outline }]}>
                      在「健康 → 数据访问与设备」里按显示名或 Bundle ID 查找；主屏幕无名字时可在
                      设置 → 主屏幕 检查是否隐藏了 App 名称。
                    </Text>
                  </View>
                ) : null}

                {healthKitRegistrationHint ? (
                  <Text style={[styles.healthKitHintLine, { color: palette.outline }]}>
                    {healthKitRegistrationHint}
                  </Text>
                ) : null}

                <View style={styles.healthKitActions}>
                  <Pressable
                    onPress={() => void loadHealthKitData(true)}
                    disabled={healthKitLoading || Boolean(healthKitBlockReason)}
                    style={[styles.healthKitBtnGhost, { borderColor: palette.outlineVariant, opacity: healthKitBlockReason ? 0.5 : 1 }]}
                  >
                    {healthKitLoading ? (
                      <ActivityIndicator size="small" color={palette.primary} />
                    ) : (
                      <Text style={[styles.healthKitBtnGhostText, { color: palette.primary }]}>
                        {healthKitRows.length ? '刷新' : '读取健康数据'}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={applyHealthKitToProfile}
                    disabled={healthKitLoading || !healthKitRows.length}
                    style={[styles.healthKitBtnPrimary, { backgroundColor: palette.primary, opacity: healthKitRows.length ? 1 : 0.45 }]}
                  >
                    <Text style={styles.healthKitBtnPrimaryText}>填入表单</Text>
                  </Pressable>
                </View>

                {healthKitSummaryHint ? (
                  <Text style={[styles.healthKitHintLine, { color: palette.outline }]}>{healthKitSummaryHint}</Text>
                ) : null}

                {!healthKitBlockReason ? (
                  <View style={styles.healthKitLinkRow}>
                    <Pressable
                      onPress={() => void openHealthApp()}
                      style={[styles.healthKitOpenHealthBtn, { borderColor: palette.outlineVariant, flex: 1 }]}
                    >
                      <MaterialIcons name="favorite" size={18} color={palette.primary} />
                      <Text style={[styles.healthKitOpenHealthText, { color: palette.primary }]}>
                        打开「健康」
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => Linking.openSettings()}
                      style={[styles.healthKitOpenHealthBtn, { borderColor: palette.outlineVariant, flex: 1 }]}
                    >
                      <MaterialIcons name="settings" size={18} color={palette.primary} />
                      <Text style={[styles.healthKitOpenHealthText, { color: palette.primary }]}>
                        本 App 设置
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                <Pressable onPress={() => setHealthKitHelpOpen(v => !v)} style={styles.healthKitHelpToggle}>
                  <Text style={[styles.healthKitHelpToggleText, { color: palette.primary }]}>
                    {healthKitHelpOpen ? '收起' : '在「健康」里找不到本 App？'}
                  </Text>
                  <MaterialIcons
                    name={healthKitHelpOpen ? 'expand-less' : 'help-outline'}
                    size={20}
                    color={palette.primary}
                  />
                </Pressable>
                {healthKitHelpOpen ? (
                  <View style={styles.healthKitHelpBox}>
                    {healthKitSettingsHelp.map((line, index) => (
                      <Text key={index} style={[styles.healthKitHelpItem, { color: palette.outline }]}>
                        · {line}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {healthKitRows.length > 0 ? (
                  <>
                    <Pressable
                      onPress={() => setHealthKitExpanded(v => !v)}
                      style={styles.healthKitToggle}
                    >
                      <Text style={[styles.healthKitToggleText, { color: palette.outline }]}>
                        {healthKitExpanded ? '收起全部' : `展开全部（${healthKitRows.length} 项）`}
                      </Text>
                      <MaterialIcons
                        name={healthKitExpanded ? 'expand-less' : 'expand-more'}
                        size={22}
                        color={palette.outline}
                      />
                    </Pressable>

                    <View style={styles.healthKitList}>
                      {(healthKitExpanded ? healthKitRows : healthKitRows.slice(0, 8)).map(row => (
                        <View
                          key={row.key}
                          style={[styles.healthKitRow, { borderBottomColor: palette.outlineVariant }]}
                        >
                          <Text style={[styles.healthKitRowLabel, { color: palette.outline }]} numberOfLines={1}>
                            {row.label}
                          </Text>
                          <Text style={[styles.healthKitRowValue, { color: palette.text }]} numberOfLines={2}>
                            {row.value}
                          </Text>
                          {row.meta ? (
                            <Text style={[styles.healthKitRowMeta, { color: palette.outline }]} numberOfLines={1}>
                              {row.meta}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  </>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={[styles.healthKitHintCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
              <Text style={[styles.healthKitHint, { color: palette.outline }]}>
                Apple 健康数据仅在 iOS 真机上可用；Android / Web 请手动填写体征。
              </Text>
            </View>
          )}

          <Pressable onPress={saveProfile} style={[styles.submitBtn, { backgroundColor: palette.primary }]}>
            <Text style={styles.submitText}>更新个人资料</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={showBirthdayPicker}
        transparent
        animationType="fade"
        onRequestClose={dismissBirthdayPicker}
      >
        <View style={styles.birthdayModalRoot}>
          <Pressable style={styles.birthdayModalBackdrop} onPress={dismissBirthdayPicker} />
          <View
            style={[
              styles.birthdayModalCard,
              {
                backgroundColor: palette.surface,
                borderColor: palette.outlineVariant,
              },
            ]}
          >
            <Text style={[styles.birthdayModalTitle, { color: palette.text }]}>选择生日</Text>
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
                style={[styles.birthdayModalBtnGhost, { borderColor: palette.outlineVariant }]}
              >
                <Text style={[styles.birthdayModalBtnGhostText, { color: palette.outline }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={confirmBirthday}
                style={[styles.birthdayModalBtnPrimary, { backgroundColor: palette.primary }]}
              >
                <Text style={styles.birthdayModalBtnPrimaryText}>确定</Text>
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
  topBar: { borderBottomWidth: 1 },
  topBarInner: {
    height: 58,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundBtn: {
    width: 38,
    height: 38,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  saveText: { fontSize: 16, fontWeight: '800' },
  main: { paddingHorizontal: 22, gap: 26 },
  avatarSection: { alignItems: 'center', marginTop: 8, marginBottom: 10 },
  avatarWrap: { width: 132, height: 132, position: 'relative' },
  avatarRing: {
    width: '100%',
    height: '100%',
    borderRadius: 66,
    overflow: 'hidden',
    borderWidth: 4,
  },
  avatarImg: { width: '100%', height: '100%' },
  cameraBtn: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#faf8ff',
  },
  avatarKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginTop: 18,
    textTransform: 'uppercase',
  },
  avatarTitle: { fontSize: 28, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 },
  group: { gap: 12 },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupMark: { width: 4, height: 16, borderRadius: 999 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  fieldCard: { borderRadius: 16, padding: 18, borderWidth: 1 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  fieldInput: { borderBottomWidth: 1, paddingBottom: 8, fontSize: 24, fontWeight: '700' },
  birthdayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  birthdayValue: { flex: 1, fontSize: 24, fontWeight: '700' },
  birthdayModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  birthdayModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  birthdayModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 12,
    paddingBottom: 16,
    borderWidth: 1,
  },
  birthdayModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
  },
  birthdayModalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  birthdayModalBtnGhost: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayModalBtnGhostText: { fontSize: 15, fontWeight: '800' },
  birthdayModalBtnPrimary: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayModalBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  optionRow: { flexDirection: 'row', gap: 10 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { fontSize: 14, fontWeight: '700' },
  weekDayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  weekDayChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    minHeight: 34,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekDayText: { fontSize: 13, fontWeight: '700' },
  metricGrid: { gap: 12 },
  metricCard: { borderRadius: 16, padding: 18, borderWidth: 1 },
  metricRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  metricInput: { flex: 1, borderBottomWidth: 1, paddingBottom: 8, fontSize: 30, fontWeight: '900' },
  metricUnit: { fontSize: 14, fontWeight: '800', paddingBottom: 8 },
  submitBtn: {
    marginTop: 6,
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  healthKitCard: { borderRadius: 16, padding: 18, borderWidth: 1, gap: 14 },
  healthKitNameBanner: { borderRadius: 12, padding: 12, borderWidth: 1, gap: 4 },
  healthKitNameBannerTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  healthKitNameBannerValue: { fontSize: 20, fontWeight: '900' },
  healthKitNameBannerBundle: { fontSize: 11, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  healthKitNameBannerSub: { fontSize: 11, fontWeight: '600', lineHeight: 16 },
  healthKitLinkRow: { flexDirection: 'row', gap: 10 },
  healthKitOpenHealthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  healthKitOpenHealthText: { fontSize: 13, fontWeight: '800' },
  healthKitHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  healthKitHeaderText: { flex: 1, gap: 4 },
  healthKitTitle: { fontSize: 17, fontWeight: '800' },
  healthKitSub: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  healthKitActions: { flexDirection: 'row', gap: 10 },
  healthKitBtnGhost: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthKitBtnGhostText: { fontSize: 14, fontWeight: '800' },
  healthKitBtnPrimary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthKitBtnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  healthKitHintLine: { fontSize: 11, fontWeight: '600', lineHeight: 17 },
  healthKitHelpToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  healthKitHelpToggleText: { fontSize: 12, fontWeight: '800' },
  healthKitHelpBox: { gap: 6, paddingBottom: 4 },
  healthKitHelpItem: { fontSize: 11, lineHeight: 17, fontWeight: '600' },
  healthKitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  healthKitToggleText: { fontSize: 12, fontWeight: '800' },
  healthKitList: { gap: 0 },
  healthKitRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  healthKitRowLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  healthKitRowValue: { fontSize: 16, fontWeight: '800' },
  healthKitRowMeta: { fontSize: 11, fontWeight: '600' },
  healthKitHintCard: { borderRadius: 14, padding: 16, borderWidth: 1 },
  healthKitHint: { fontSize: 13, fontWeight: '600', lineHeight: 20 },
});
