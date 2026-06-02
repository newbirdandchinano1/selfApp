import { Colors } from '@/constants/theme';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { VisionSubGoalsSection } from '@/components/vision-sub-goals/VisionSubGoalsSection';
import { createGoalDimension, listGoalDimensions } from '@/lib/repositories/goal-dimensions/goal-dimension';
import type { GoalDimensionRow } from '@/lib/repositories/goal-dimensions/goal-dimension.types';
import {
  formatVisionAmountStored,
  parseVisionAmountInput,
  sanitizeVisionAmountInput,
} from '@/lib/repositories/visions/vision-amount';
import { createVision } from '@/lib/repositories/visions/vision';
import type { VisionExtraPayload, VisionSubGoal } from '@/lib/repositories/visions/vision.types';
import { serializeVisionSubGoalsForExtra } from '@/lib/repositories/visions/vision.types';
import { visionTrackKindFromCreateTab } from '@/lib/repositories/visions/vision.types';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addLocalDays(base: Date, delta: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date | null {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : startOfLocalDay(dt);
}

/** 倒数日：仅今天之后；正数日：仅今天之前 */
function clampEndDateToKind(iso: string, kind: 'countdown' | 'countup'): string {
  const today = startOfLocalDay(new Date());
  const parsed = parseYmd(iso);
  if (kind === 'countdown') {
    const min = addLocalDays(today, 1);
    if (!parsed || parsed <= today) return formatYmd(min);
    return formatYmd(parsed);
  }
  const max = addLocalDays(today, -1);
  if (!parsed || parsed >= today) return formatYmd(max);
  return formatYmd(parsed);
}

function defaultEndDateForKind(kind: 'countdown' | 'countup'): string {
  const today = startOfLocalDay(new Date());
  return kind === 'countdown' ? formatYmd(addLocalDays(today, 1)) : formatYmd(addLocalDays(today, -1));
}

type BackgroundOption =
  | {
      kind: 'image';
      source: number;
      selectedRing?: boolean;
      alt?: string;
    }
  | { kind: 'custom' };

const PAGE_API_KEY = 'vision-create';

export default function VisionCreateScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{ dimensionId?: string }>();
  const dimensionIdFromRoute =
    typeof params.dimensionId === 'string'
      ? params.dimensionId
      : Array.isArray(params.dimensionId)
        ? params.dimensionId[0]
        : undefined;
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';
  const visionPrimary = '#0058be';

  const [visionName, setVisionName] = useState('');
  const [details, setDetails] = useState('');
  const [selectedBgIdx, setSelectedBgIdx] = useState(0);
  /** 自定义封面相册 URI（与「自定义」槽位 `bgOptions.length - 1` 配套写入 extra.customBgUri） */
  const [customCoverUri, setCustomCoverUri] = useState<string | null>(null);

  // 追踪方式：进度 / 倒数日 / 目标
  const [trackType, setTrackType] = useState<0 | 1 | 2>(0);
  // 方向：正向增长 / 反向减少
  const [direction, setDirection] = useState<'positive' | 'negative'>('positive');

  const [goalTotal, setGoalTotal] = useState('100');
  const [currentAmount, setCurrentAmount] = useState('0');
  const [unit, setUnit] = useState('');

  // 倒数日配置
  const [countdownKind, setCountdownKind] = useState<'countdown' | 'countup'>('countdown');
  const [endDate, setEndDate] = useState(() => defaultEndDateForKind('countdown'));
  const [dateFormat, setDateFormat] = useState<'ymd' | 'year' | 'month' | 'week' | 'day'>('ymd');
  const [endDatePickerVisible, setEndDatePickerVisible] = useState(false);
  const [endDateDraft, setEndDateDraft] = useState(() => parseYmd(defaultEndDateForKind('countdown'))!);

  const endPickerMinDate = useMemo(() => {
    const today = startOfLocalDay(new Date());
    if (countdownKind === 'countdown') return addLocalDays(today, 1);
    const past = new Date();
    past.setFullYear(past.getFullYear() - 120);
    return startOfLocalDay(past);
  }, [countdownKind]);

  const endPickerMaxDate = useMemo(() => {
    const today = startOfLocalDay(new Date());
    if (countdownKind === 'countup') return addLocalDays(today, -1);
    const fut = new Date();
    fut.setFullYear(fut.getFullYear() + 50);
    return startOfLocalDay(fut);
  }, [countdownKind]);

  /** 「目标」追踪：拆分为多个小目标 */
  const [subGoals, setSubGoals] = useState<VisionSubGoal[]>([]);

  const [goalDimensions, setGoalDimensions] = useState<GoalDimensionRow[]>([]);
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(null);
  const [newDimModalVisible, setNewDimModalVisible] = useState(false);
  const [newDimTitle, setNewDimTitle] = useState('');
  const [newDimBusy, setNewDimBusy] = useState(false);

  const reload = useCallback(async (forceApi = false) => {
    await wrapLoad(async () => {
      try {
        const rows = await listGoalDimensions();
        setGoalDimensions(rows);
      } catch {
        setGoalDimensions([]);
      }
    }, forceApi);
  }, [wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    const id = dimensionIdFromRoute?.trim();
    if (!id) return;
    setSelectedDimensionId(prev => {
      if (goalDimensions.some(d => d.id === id)) return id;
      return prev;
    });
  }, [dimensionIdFromRoute, goalDimensions]);

  const openEndDatePicker = useCallback(() => {
    const today = startOfLocalDay(new Date());
    const parsed = parseYmd(endDate);
    if (countdownKind === 'countdown') {
      const min = addLocalDays(today, 1);
      setEndDateDraft(parsed && parsed > today ? parsed : min);
    } else {
      const max = addLocalDays(today, -1);
      setEndDateDraft(parsed && parsed < today ? parsed : max);
    }
    setEndDatePickerVisible(true);
  }, [countdownKind, endDate]);

  const confirmEndDatePicker = useCallback(() => {
    setEndDate(clampEndDateToKind(formatYmd(endDateDraft), countdownKind));
    setEndDatePickerVisible(false);
  }, [countdownKind, endDateDraft]);

  const confirmCreateDimension = useCallback(async () => {
    const t = newDimTitle.trim();
    if (!t) {
      Alert.alert('提示', '请填写维度名称');
      return;
    }
    setNewDimBusy(true);
    try {
      const id = makeTimestampEntityId('gd_', 8);
      await createGoalDimension({ id, title: t });
      await loadGoalDimensions();
      setSelectedDimensionId(id);
      setNewDimModalVisible(false);
      setNewDimTitle('');
    } catch (e) {
      console.warn('createGoalDimension failed', e);
      Alert.alert('保存失败', '无法创建维度，请稍后重试。');
    } finally {
      setNewDimBusy(false);
    }
  }, [loadGoalDimensions, newDimTitle]);

  useEffect(() => {
    if (trackType !== 1) return;
    setEndDate(prev => clampEndDateToKind(prev, countdownKind));
  }, [trackType, countdownKind]);

  const bgOptions: BackgroundOption[] = useMemo(
    () => [
      {
        kind: 'image',
        selectedRing: true,
        source: require('../assets/vision-bg/bg1.png'),
        alt: '自定义背景1',
      },
      {
        kind: 'image',
        source: require('../assets/vision-bg/bg2.png'),
        alt: '自定义背景2',
      },
      {
        kind: 'image',
        source: require('../assets/vision-bg/bg3.png'),
        alt: '自定义背景3',
      },
      { kind: 'custom' },
    ],
    []
  );

  const customBgSlotIndex = bgOptions.length - 1;

  const openCustomCoverPicker = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要相册权限', '请在系统设置中允许访问相册，以便选择自定义封面。');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.85,
      });
      if (result.canceled) return;
      const uri = result.assets[0]?.uri;
      if (!uri) return;
      setCustomCoverUri(uri);
      setSelectedBgIdx(customBgSlotIndex);
    } catch (e) {
      console.warn('openCustomCoverPicker', e);
      Alert.alert('选择失败', '无法打开相册，请稍后重试。');
    }
  }, [customBgSlotIndex]);

  const onSave = async () => {
    const title = visionName.trim();
    if (!title) {
      Alert.alert('提示', '请填写总目标名称');
      return;
    }

    const dimId = selectedDimensionId?.trim();
    const dimRow = dimId ? goalDimensions.find(d => d.id === dimId) : undefined;
    if (!dimRow) {
      Alert.alert('提示', '请先选择所属维度，或新建一个维度（例如：财富、健康、事业、技能）。');
      return;
    }

    if (trackType === 2) {
      const emptyNames = subGoals.some(
        sg => !sg.name.trim() && (sg.description?.trim() || (sg.linkedProjects?.length ?? 0) > 0)
      );
      if (emptyNames) {
        Alert.alert('提示', '已填写简介或绑定项目的小目标须填写名称。');
        return;
      }
    }

    let progressCurrentStored: string | undefined;
    if (trackType === 0) {
      const parsed = parseVisionAmountInput(currentAmount);
      if (parsed === null) {
        Alert.alert('提示', '当前完成值需为不小于 0 的数字，最多两位小数。');
        return;
      }
      progressCurrentStored = formatVisionAmountStored(parsed);
    }

    const id = makeTimestampEntityId('vn_', 8);
    const track_kind = visionTrackKindFromCreateTab(trackType);
    const directionForDb = trackType === 0 || trackType === 2 ? direction : null;

    const extra: VisionExtraPayload = {
      dimensionId: dimRow.id,
      dimensionName: dimRow.title.trim(),
      goalTotal,
      unit,
      countdownKind,
      endDate,
      dateFormat,
      ...(trackType === 0
        ? { currentAmount: progressCurrentStored! }
        : trackType === 2
          ? { currentAmount: '0' }
          : {}),
    };
    if (trackType === 2) {
      const serialized = serializeVisionSubGoalsForExtra(subGoals);
      if (serialized.length > 0) {
        extra.subGoals = serialized;
      }
    }

    if (selectedBgIdx === customBgSlotIndex) {
      const u = customCoverUri?.trim();
      if (!u) {
        Alert.alert('提示', '请选择自定义封面图片');
        return;
      }
      extra.customBgUri = u;
    }

    try {
      await createVision({
        id,
        title,
        description: details.trim() || null,
        track_kind,
        direction: directionForDb,
        bg_option_idx: selectedBgIdx,
        extra,
      });
      router.back();
    } catch (e) {
      console.warn('createVision failed', e);
      Alert.alert('保存失败', '无法写入本地数据库，请稍后重试。');
    }
  };

  const placeholderColor = isDark ? 'rgba(148,163,184,0.55)' : 'rgba(114,119,133,0.55)';
  const textColor = theme.text;
  const outline = 'rgba(114,119,133,0.95)';

  return (
    <>
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.85)' }]}>
        <View style={styles.headerTitleWrap} pointerEvents="none">
          <Text style={[styles.headerTitle, { color: textColor }]} numberOfLines={1}>
            新建总目标
          </Text>
        </View>
        <View style={styles.headerBar}>
          <View style={styles.headerLeading}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
            >
              <MaterialIcons name="close" size={20} color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'} />
            </Pressable>
          </View>
          <View style={styles.headerSpacer} />
          <View style={styles.headerTrailing}>
            <Pressable
              onPress={onSave}
              style={({ pressed }) => [styles.headerCreateBtn, pressed && { opacity: 0.88 }]}
            >
              <Text style={styles.headerCreateBtnText}>创建</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          alwaysBounceVertical={false}
        >
          <View style={{ gap: 18 }}>
            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: outline }]}>总目标名称</Text>
              <TextInput
                value={visionName}
                onChangeText={setVisionName}
                placeholder="输入总目标名称..."
                placeholderTextColor={placeholderColor}
                style={[styles.input, { color: textColor, backgroundColor: 'rgba(234,237,255,0.9)' }]}
              />
            </View>

            <View style={{ gap: 10 }}>
              <Text style={[styles.label, { color: outline }]}>所属维度</Text>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '600',
                  color: isDark ? 'rgba(148,163,184,0.85)' : 'rgba(114,119,133,0.85)',
                  lineHeight: 17,
                }}
              >
                先创建维度（如财富、健康、事业、技能），再选择总目标所属维度。
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                {goalDimensions.map(d => {
                  const sel = selectedDimensionId === d.id;
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => setSelectedDimensionId(d.id)}
                      style={({ pressed }) => [
                        styles.dimChip,
                        {
                          backgroundColor: sel
                            ? visionPrimary
                            : isDark
                              ? 'rgba(30,41,59,0.55)'
                              : 'rgba(234,237,255,0.95)',
                          borderColor: sel ? visionPrimary : isDark ? 'rgba(148,163,184,0.25)' : 'rgba(194,198,214,0.45)',
                          opacity: pressed ? 0.88 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: '800',
                          color: sel ? '#fff' : textColor,
                        }}
                        numberOfLines={1}
                      >
                        {d.title}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => {
                    setNewDimTitle('');
                    setNewDimModalVisible(true);
                  }}
                  style={({ pressed }) => [
                    styles.dimChip,
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(255,255,255,0.9)',
                      borderColor: isDark ? 'rgba(148,163,184,0.35)' : 'rgba(194,198,214,0.55)',
                      borderStyle: 'dashed',
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}
                >
                  <MaterialIcons name="add" size={18} color={visionPrimary} />
                  <Text style={{ fontSize: 13, fontWeight: '800', color: visionPrimary }}>新建维度</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: outline }]}>详细描述</Text>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="添加备注或详细描述..."
                placeholderTextColor={placeholderColor}
                style={[
                  styles.textarea,
                  { color: textColor, backgroundColor: 'rgba(234,237,255,0.9)' },
                ]}
                multiline
                numberOfLines={3}
              />
            </View>
          </View>

          {/* 背景选择 */}
          <View style={{ gap: 10, marginTop: 18 }}>
            <Text style={[styles.label, { color: outline }]}>背景选择</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 2 }}>
              {bgOptions.map((opt, idx) => {
                const isSelected = idx === selectedBgIdx;

                if (opt.kind === 'custom') {
                  const hasCustom = !!customCoverUri?.trim();
                  return (
                    <Pressable
                      key={idx}
                      onPress={openCustomCoverPicker}
                      style={({ pressed }) => [
                        hasCustom ? styles.bgCard : styles.customBg,
                        isSelected && (hasCustom ? { borderColor: theme.primary, borderWidth: 2 } : styles.customBgSelected),
                        pressed && { opacity: 0.9 },
                      ]}
                    >
                      {hasCustom ? (
                        <>
                          <Image source={{ uri: customCoverUri! }} style={styles.bgImg} contentFit="cover" transition={120} />
                          {isSelected && (
                            <View style={styles.bgSelectedOverlay}>
                              <MaterialIcons name="check-circle" size={20} color={theme.primary} />
                            </View>
                          )}
                        </>
                      ) : (
                        <>
                          <MaterialIcons name="add-a-photo" size={22} color={outline} />
                          <Text style={[styles.customBgText, { color: outline }]}>自定义</Text>
                        </>
                      )}
                    </Pressable>
                  );
                }

                return (
                  <Pressable
                    key={idx}
                    onPress={() => setSelectedBgIdx(idx)}
                    style={({ pressed }) => [
                      styles.bgCard,
                      pressed && { opacity: 0.9 },
                      isSelected && { borderColor: theme.primary, borderWidth: 2 },
                    ]}
                  >
                    <Image source={opt.source} style={styles.bgImg} contentFit="cover" transition={120} />
                    {isSelected && (
                      <View style={styles.bgSelectedOverlay}>
                        <MaterialIcons name="check-circle" size={20} color={theme.primary} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* 追踪方式 Tabs */}
          <View style={{ gap: 10, marginTop: 18 }}>
            <Text style={[styles.label, { color: outline }]}>追踪方式</Text>
            <View style={styles.trackTabs}>
              <TabButton active={trackType === 0} text="进度" onPress={() => setTrackType(0)} />
              <TabButton active={trackType === 1} text="倒数日" onPress={() => setTrackType(1)} />
              <TabButton active={trackType === 2} text="目标" onPress={() => setTrackType(2)} />
            </View>
          </View>

          {/* 配置区域：仅在对应 tab 展示对应内容 */}
          {trackType === 1 ? (
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(255,255,255,0.95)',
                  borderColor: 'rgba(194,198,214,0.35)',
                },
              ]}
            >
              <Text style={[styles.panelTitle, { color: textColor, marginBottom: 16 }]}>倒数日设置</Text>

              <View style={{ gap: 10 }}>
                <Text style={[styles.label, { color: outline }]}>类型</Text>
                <View style={styles.directionTabs}>
                  <Pressable
                    onPress={() => setCountdownKind('countdown')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      { flex: 1, alignItems: 'center' },
                      countdownKind === 'countdown' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        countdownKind === 'countdown' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      倒数日
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCountdownKind('countup')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      { flex: 1, alignItems: 'center' },
                      countdownKind === 'countup' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        countdownKind === 'countup' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      正数日
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={{ marginTop: 18, gap: 8 }}>
                <Text style={[styles.label, { color: outline }]}>结束日期</Text>
                <Pressable
                  onPress={openEndDatePicker}
                  style={({ pressed }) => [
                    styles.endDateField,
                    {
                      backgroundColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(234,237,255,0.9)',
                      borderColor: 'rgba(194,198,214,0.45)',
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}
                >
                  <MaterialIcons name="event" size={22} color={visionPrimary} />
                  <Text style={[styles.endDateFieldText, { color: textColor }]}>{endDate}</Text>
                  <MaterialIcons name="expand-more" size={22} color={outline} />
                </Pressable>
                <Text style={[styles.endDateHint, { color: outline }]}>
                  {countdownKind === 'countdown' ? '倒数日须选择今天之后的日期。' : '正数日须选择今天之前的日期。'}
                </Text>
              </View>

              <View style={{ marginTop: 18, gap: 10 }}>
                <Text style={[styles.label, { color: outline }]}>显示格式</Text>
                <View style={[styles.directionTabs, { gap: 4 }]}>
                  {[
                    { key: 'ymd' as const, label: '年月天' },
                    { key: 'year' as const, label: '年' },
                    { key: 'month' as const, label: '月' },
                    { key: 'week' as const, label: '周' },
                    { key: 'day' as const, label: '天' },
                  ].map((item) => (
                    <Pressable
                      key={item.key}
                      onPress={() => setDateFormat(item.key)}
                      style={({ pressed }) => [
                        styles.directionBtn,
                        { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
                        dateFormat === item.key && { backgroundColor: visionPrimary },
                        pressed && { opacity: 0.9 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.directionBtnText,
                          { fontSize: 11 },
                          dateFormat === item.key ? { color: '#fff' } : { color: outline },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          ) : trackType === 2 ? (
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(255,255,255,0.95)',
                  borderColor: 'rgba(194,198,214,0.35)',
                  gap: 16,
                },
              ]}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: 12,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: 'rgba(194,198,214,0.45)',
                }}
              >
                <View style={{ gap: 4 }}>
                  <Text style={[styles.panelTitle, { color: textColor }]}>小目标</Text>
                  <Text style={[styles.panelSub, { color: outline }]}>
                    将总目标拆分为多个小目标；绑定项目后按各项目任务完成情况汇总总进度
                  </Text>
                </View>
                <MaterialIcons name="track-changes" size={18} color={visionPrimary} />
              </View>

              <VisionSubGoalsSection
                subGoals={subGoals}
                onChange={setSubGoals}
                textColor={textColor}
                outline={outline}
                placeholderColor={placeholderColor}
                isDark={isDark}
              />
            </View>
          ) : (
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: 'rgba(234,237,255,0.5)',
                  borderColor: 'rgba(194,198,214,0.35)',
                },
              ]}
            >
              <View style={styles.sectionHeader}>
                <View style={{ gap: 6 }}>
                  <Text style={[styles.panelTitle, { color: textColor }]}>方向</Text>
                  <Text style={[styles.panelSub, { color: outline }]}>定义进度的演变方式</Text>
                </View>

                <View style={styles.directionTabs}>
                  <Pressable
                    onPress={() => setDirection('positive')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      direction === 'positive' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        direction === 'positive' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      正向增长
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDirection('negative')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      direction === 'negative' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        direction === 'negative' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      反向减少
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.grid2}>
                <View style={styles.grid2LabelsRow}>
                  <Text style={[styles.grid2Label, { color: outline }]}>目标总量</Text>
                  <Text style={[styles.grid2Label, { color: outline }]}>当前完成值</Text>
                </View>
                <View style={styles.grid2InputsRow}>
                  <TextInput
                    value={goalTotal}
                    onChangeText={setGoalTotal}
                    keyboardType="numeric"
                    placeholder=""
                    placeholderTextColor={placeholderColor}
                    style={[styles.grid2Input, { color: textColor }]}
                  />
                  <TextInput
                    value={currentAmount}
                    onChangeText={t => setCurrentAmount(sanitizeVisionAmountInput(t))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={placeholderColor}
                    style={[styles.grid2Input, { color: textColor }]}
                  />
                </View>
              </View>

              <View style={{ marginTop: 18 }}>
                <Text style={[styles.label, { color: outline }]}>度量单位</Text>
                <TextInput
                  value={unit}
                  onChangeText={setUnit}
                  placeholder="例如：公里, 页数, 小时..."
                  placeholderTextColor={placeholderColor}
                  style={[
                    styles.input,
                    { color: textColor, backgroundColor: 'rgba(234,237,255,0.9)' },
                  ]}
                />
              </View>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>

    <Modal
      visible={newDimModalVisible}
      animationType="fade"
      transparent
      onRequestClose={() => !newDimBusy && setNewDimModalVisible(false)}
    >
      <View style={styles.dateModalRoot}>
        <Pressable style={styles.dateModalBackdrop} onPress={() => !newDimBusy && setNewDimModalVisible(false)} />
        <View
          style={[
            styles.dateModalCard,
            {
              backgroundColor: theme.background,
              borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.5)',
              marginBottom: Math.max(insets.bottom, 16) + 8,
            },
          ]}
        >
          <Text style={[styles.dateModalTitle, { color: textColor }]}>新建维度</Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: outline, marginBottom: 10 }}>
            例如：财富、健康、事业、技能
          </Text>
          <TextInput
            value={newDimTitle}
            onChangeText={setNewDimTitle}
            placeholder="维度名称"
            placeholderTextColor={placeholderColor}
            editable={!newDimBusy}
            style={[
              styles.input,
              { color: textColor, backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(234,237,255,0.9)' },
            ]}
          />
          <View style={[styles.dateModalActions, { marginTop: 16 }]}>
            <Pressable
              onPress={() => !newDimBusy && setNewDimModalVisible(false)}
              style={[
                styles.dateModalBtnGhost,
                { borderColor: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(194,198,214,0.65)' },
              ]}
            >
              <Text style={[styles.dateModalBtnGhostText, { color: outline }]}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => void confirmCreateDimension()}
              disabled={newDimBusy}
              style={[styles.dateModalBtnPrimary, { backgroundColor: visionPrimary, opacity: newDimBusy ? 0.65 : 1 }]}
            >
              {newDimBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.dateModalBtnPrimaryText}>创建</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>

    <Modal
      visible={endDatePickerVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setEndDatePickerVisible(false)}
    >
      <View style={styles.dateModalRoot}>
        <Pressable style={styles.dateModalBackdrop} onPress={() => setEndDatePickerVisible(false)} />
        <View
          style={[
            styles.dateModalCard,
            {
              backgroundColor: theme.background,
              borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.5)',
              marginBottom: Math.max(insets.bottom, 16) + 8,
            },
          ]}
        >
          <Text style={[styles.dateModalTitle, { color: textColor }]}>
            {countdownKind === 'countdown' ? '选择结束日期（倒数日）' : '选择结束日期（正数日）'}
          </Text>
          <DateTimePicker
            value={endDateDraft}
            mode="date"
            display="spinner"
            themeVariant={isDark ? 'dark' : 'light'}
            locale={Platform.OS === 'ios' ? 'zh_CN' : undefined}
            minimumDate={endPickerMinDate}
            maximumDate={endPickerMaxDate}
            onChange={(_, date) => {
              if (date) setEndDateDraft(startOfLocalDay(date));
            }}
          />
          <View style={styles.dateModalActions}>
            <Pressable
              onPress={() => setEndDatePickerVisible(false)}
              style={[
                styles.dateModalBtnGhost,
                { borderColor: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(194,198,214,0.65)' },
              ]}
            >
              <Text style={[styles.dateModalBtnGhostText, { color: outline }]}>取消</Text>
            </Pressable>
            <Pressable
              onPress={confirmEndDatePicker}
              style={[styles.dateModalBtnPrimary, { backgroundColor: visionPrimary }]}
            >
              <Text style={styles.dateModalBtnPrimaryText}>确定</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

function TabButton({ active, text, onPress }: { active: boolean; text: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabBtn,
        active && { backgroundColor: 'rgba(250,248,255,1)' },
        pressed && { opacity: 0.9 },
      ]}
    >
      <Text style={[styles.tabBtnText, active ? { color: '#0058be', fontWeight: '700' } : { color: 'rgba(114,119,133,0.95)' }]}>
        {text}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType: 'numeric' | 'default';
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={[styles.input, { backgroundColor: 'rgba(234,237,255,0.9)' }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 12,
    height: 56,
    position: 'relative',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.18)',
  },
  headerTitleWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 88,
  },
  headerBar: {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLeading: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSpacer: {
    flex: 1,
  },
  headerTrailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248,250,252,0.18)',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  headerCreateBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: '#0058be',
    shadowColor: '#0058be',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  headerCreateBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    // 底部按钮与布局同流，不需要很大的 padding 兜底，避免末尾出现大片空白
    paddingBottom: 18,
    gap: 10,
  },

  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  dimChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  input: {
    width: '100%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
  },
  textarea: {
    width: '100%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 90,
    fontSize: 14,
    fontWeight: '600',
    textAlignVertical: 'top',
  },

  bgCard: {
    width: 96,
    height: 128,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 0,
    borderColor: '#0058be',
  },
  bgImg: {
    width: '100%',
    height: '100%',
  },
  bgFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(234,237,255,0.72)',
  },
  bgFallbackText: {
    fontSize: 11,
    fontWeight: '700',
  },
  bgSelectedOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,88,190,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customBg: {
    width: 96,
    height: 128,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(194,198,214,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(250,248,255,0.6)',
  },
  customBgSelected: {
    borderColor: '#0058be',
  },
  customBgText: {
    fontSize: 10,
    fontWeight: '700',
  },

  trackTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(234,237,255,0.65)',
    borderRadius: 16,
    padding: 3,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },

  panel: {
    marginTop: 18,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  panelTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  panelSub: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.85,
  },
  directionTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(234,237,255,0.8)',
    borderRadius: 12,
    padding: 4,
    gap: 6,
  },
  directionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  directionBtnText: {
    fontWeight: '700',
    fontSize: 12,
  },

  grid2: {
    gap: 10,
  },
  grid2LabelsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  grid2Label: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginLeft: 2,
  },
  grid2InputsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  grid2Input: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
    backgroundColor: 'rgba(234,237,255,0.9)',
  },

  projectModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  projectModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  projectModalSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 8,
  },
  projectModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.22)',
  },
  projectModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  projectModalLoading: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectModalEmpty: {
    paddingHorizontal: 22,
    paddingVertical: 28,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 21,
  },
  projectModalList: {
    flexGrow: 0,
  },
  projectModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  projectModalRowTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },

  endDateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  endDateFieldText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  endDateHint: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 2,
  },
  dateModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  dateModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  dateModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    paddingTop: 18,
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderWidth: 1,
  },
  dateModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  dateModalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  dateModalBtnGhost: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateModalBtnGhostText: {
    fontSize: 15,
    fontWeight: '800',
  },
  dateModalBtnPrimary: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateModalBtnPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});

