import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { createVision } from '@/lib/repositories/visions/vision';
import type { VisionExtraPayload, VisionLinkedProjectRef } from '@/lib/repositories/visions/vision.types';
import { visionTrackKindFromCreateTab } from '@/lib/repositories/visions/vision.types';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
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

export default function VisionCreateScreen() {
  const router = useRouter();
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

  // 追踪方式：进度 / 计数 / 倒数日 / 目标
  const [trackType, setTrackType] = useState<0 | 1 | 2 | 3>(0);
  // 方向：正向增长 / 反向减少
  const [direction, setDirection] = useState<'positive' | 'negative'>('positive');

  const [goalTotal, setGoalTotal] = useState('100');
  const [step, setStep] = useState('1');
  const [unit, setUnit] = useState('');

  // 计数配置
  const [countStep, setCountStep] = useState('1');
  const [countUnit, setCountUnit] = useState('次');

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

  /** 「目标」追踪：可选，可多选；为空表示暂不关联项目 */
  const [linkedProjects, setLinkedProjects] = useState<VisionLinkedProjectRef[]>([]);
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([]);
  const [projectListLoading, setProjectListLoading] = useState(false);

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

  const openProjectPicker = useCallback(() => {
    setProjectPickerVisible(true);
    setProjectListLoading(true);
    void (async () => {
      try {
        const rows = await getProjects();
        setProjectRows(rows);
      } catch {
        setProjectRows([]);
        Alert.alert('提示', '无法加载项目列表，请稍后重试。');
      } finally {
        setProjectListLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (trackType !== 2) return;
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
      Alert.alert('提示', '请填写愿景名称');
      return;
    }

    const id = `vn_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const track_kind = visionTrackKindFromCreateTab(trackType);
    const directionForDb = trackType === 0 || trackType === 3 ? direction : null;

    const extra: VisionExtraPayload = {
      goalTotal,
      step,
      unit,
      countFrequency: 'daily',
      countStep,
      countUnit,
      countdownKind,
      endDate,
      dateFormat,
      ...(trackType === 0 || trackType === 1 || trackType === 3 ? { currentAmount: '0' } : {}),
    };
    if (trackType === 3 && linkedProjects.length > 0) {
      extra.linkedProjects = linkedProjects.map(p => ({
        id: p.id.trim(),
        name: p.name.trim(),
      }));
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
        <View style={styles.headerLeading}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialIcons name="close" size={20} color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'} />
          </Pressable>
        </View>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: textColor }]} numberOfLines={1}>
            新建愿景
          </Text>
        </View>
        <View style={styles.headerTrailing}>
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [styles.headerCreateBtn, pressed && { opacity: 0.88 }]}
          >
            <Text style={styles.headerCreateBtnText}>创建愿景</Text>
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          alwaysBounceVertical={false}
        >
          <View style={{ gap: 18 }}>
            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: outline }]}>愿景名称</Text>
              <TextInput
                value={visionName}
                onChangeText={setVisionName}
                placeholder="输入愿景名称..."
                placeholderTextColor={placeholderColor}
                style={[styles.input, { color: textColor, backgroundColor: 'rgba(234,237,255,0.9)' }]}
              />
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
              <TabButton active={trackType === 1} text="计数" onPress={() => setTrackType(1)} />
              <TabButton active={trackType === 2} text="倒数日" onPress={() => setTrackType(2)} />
              <TabButton active={trackType === 3} text="目标" onPress={() => setTrackType(3)} />
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
              <View style={{ gap: 14 }}>
                <Text style={[styles.panelTitle, { color: textColor }]}>计数设置</Text>
                <View style={styles.grid2}>
                  <View style={styles.grid2LabelsRow}>
                    <Text style={[styles.grid2Label, { color: outline }]}>每次增加</Text>
                    <Text style={[styles.grid2Label, { color: outline }]}>单位</Text>
                  </View>
                  <View style={styles.grid2InputsRow}>
                    <TextInput
                      value={countStep}
                      onChangeText={setCountStep}
                      keyboardType="numeric"
                      placeholder="1"
                      placeholderTextColor={placeholderColor}
                      style={[styles.grid2Input, { color: textColor }]}
                    />
                    <TextInput
                      value={countUnit}
                      onChangeText={setCountUnit}
                      placeholder="例如：次"
                      placeholderTextColor={placeholderColor}
                      style={[styles.grid2Input, { color: textColor }]}
                    />
                  </View>
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
          ) : trackType === 3 ? (
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
                  <Text style={[styles.panelTitle, { color: textColor }]}>目标设置</Text>
                  <Text style={[styles.panelSub, { color: outline }]}>
                    可不关联；关联后按所选项目（可多选）的任务完成情况汇总进度
                  </Text>
                </View>
                <MaterialIcons name="track-changes" size={18} color={visionPrimary} />
              </View>

              <Pressable
                onPress={openProjectPicker}
                style={({ pressed }) => [
                  {
                    width: '100%',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: 'rgba(234,237,255,0.72)',
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(0,88,190,0.12)',
                    }}
                  >
                    <MaterialIcons name="add-link" size={18} color={visionPrimary} />
                  </View>
                  <View style={{ gap: 2 }}>
                    <Text style={{ color: textColor, fontSize: 14, fontWeight: '700' }}>添加关联项目</Text>
                    <Text style={{ color: outline, fontSize: 12, fontWeight: '600' }}>可多次打开，添加多个项目</Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={outline} />
              </Pressable>

              <View style={{ gap: 10 }}>
                <Text style={[styles.label, { color: outline }]}>已关联项目</Text>
                <View
                  style={{
                    borderWidth: 2,
                    borderStyle: 'dashed',
                    borderColor: 'rgba(194,198,214,0.45)',
                    borderRadius: 12,
                    paddingVertical: linkedProjects.length > 0 ? 12 : 26,
                    paddingHorizontal: 14,
                    alignItems: 'stretch',
                    justifyContent: 'center',
                    gap: 10,
                  }}
                >
                  {linkedProjects.length > 0 ? (
                    <>
                      <Text style={{ color: outline, fontSize: 11, fontWeight: '600', marginBottom: 2 }}>
                        各项目任务合并统计：已完成 / 全部非取消任务
                      </Text>
                      {linkedProjects.map(p => (
                        <View
                          key={p.id}
                          style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12 }}
                        >
                          <View
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 20,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: 'rgba(0,88,190,0.1)',
                            }}
                          >
                            <MaterialIcons name="folder-special" size={22} color={visionPrimary} />
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={{ color: textColor, fontSize: 15, fontWeight: '800' }} numberOfLines={2}>
                              {p.name}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => setLinkedProjects(prev => prev.filter(x => x.id !== p.id))}
                            hitSlop={8}
                            style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.65 : 1 }]}
                            accessibilityLabel={`移除关联 ${p.name}`}
                          >
                            <MaterialIcons name="close" size={22} color={outline} />
                          </Pressable>
                        </View>
                      ))}
                    </>
                  ) : (
                    <>
                      <MaterialIcons name="folder-off" size={28} color={'rgba(114,119,133,0.35)'} style={{ alignSelf: 'center' }} />
                      <Text style={{ color: 'rgba(114,119,133,0.55)', fontSize: 13, fontStyle: 'italic', textAlign: 'center' }}>
                        暂不关联项目也可以保存；需要时点击「添加关联项目」
                      </Text>
                    </>
                  )}
                </View>
              </View>
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
                  <Text style={[styles.grid2Label, { color: outline }]}>步长</Text>
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
                    value={step}
                    onChangeText={setStep}
                    keyboardType="numeric"
                    placeholder=""
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
      visible={projectPickerVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setProjectPickerVisible(false)}
    >
      <View style={styles.projectModalRoot}>
        <Pressable style={styles.projectModalBackdrop} onPress={() => setProjectPickerVisible(false)} />
        <View style={[styles.projectModalSheet, { backgroundColor: theme.background }]}>
          <View style={styles.projectModalHeader}>
            <Text style={[styles.projectModalTitle, { color: textColor }]}>添加关联项目</Text>
            <Pressable onPress={() => setProjectPickerVisible(false)} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
              <MaterialIcons name="close" size={22} color={outline} />
            </Pressable>
          </View>
          {projectListLoading ? (
            <View style={styles.projectModalLoading}>
              <ActivityIndicator size="large" color={visionPrimary} />
            </View>
          ) : projectRows.length === 0 ? (
            <Text style={[styles.projectModalEmpty, { color: outline }]}>暂无项目，请先在任务中创建项目后再关联。</Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.projectModalList} showsVerticalScrollIndicator={false}>
              {projectRows.map(p => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    if (linkedProjects.some(x => x.id === p.id)) {
                      Alert.alert('提示', '该项目已在关联列表中');
                      return;
                    }
                    setLinkedProjects(prev => [...prev, { id: p.id, name: p.name }]);
                  }}
                  style={({ pressed }) => [
                    styles.projectModalRow,
                    {
                      borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)',
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}
                >
                  <MaterialIcons name="folder" size={22} color={visionPrimary} />
                  <Text style={[styles.projectModalRowTitle, { color: textColor }]} numberOfLines={2}>
                    {p.name}
                  </Text>
                  {linkedProjects.some(x => x.id === p.id) ? (
                    <MaterialIcons name="check-circle" size={22} color={visionPrimary} />
                  ) : (
                    <MaterialIcons name="add-circle-outline" size={22} color={outline} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          )}
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
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.18)',
  },
  headerLeading: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTrailing: {
    minWidth: 96,
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

