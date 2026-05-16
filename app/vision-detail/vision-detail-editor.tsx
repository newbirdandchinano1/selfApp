import { VisionSubGoalsSection } from '@/components/vision-sub-goals/VisionSubGoalsSection';
import type { VisionRow } from '@/lib/repositories/visions/vision.types';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  clampEndDateToKind,
  defaultEndDateForKind,
  type VisionEditDraft,
  VISION_BUILTIN_BG_COUNT,
} from './vision-detail-edit-helpers';

const visionPrimary = '#0058be';

const bg1 = require('../../assets/vision-bg/bg1.png');
const bg2 = require('../../assets/vision-bg/bg2.png');
const bg3 = require('../../assets/vision-bg/bg3.png');

const BG_THUMBS = [bg1, bg2, bg3] as const;

type Props = {
  row: VisionRow;
  draft: VisionEditDraft;
  setDraft: React.Dispatch<React.SetStateAction<VisionEditDraft | null>>;
  isDark: boolean;
  textColor: string;
  outline: string;
  panelBg: string;
  panelBorder: string;
  placeholderColor: string;
  insetsBottom: number;
};

export function VisionDetailEditor(props: Props) {
  const { row, draft, setDraft, isDark, textColor, outline, panelBg, panelBorder, placeholderColor, insetsBottom } = props;

  const [endDatePickerVisible, setEndDatePickerVisible] = useState(false);
  const [endDateDraft, setEndDateDraft] = useState(() => {
    const d = parseYmdLocal(draft.endDate) ?? parseYmdLocal(defaultEndDateForKind(draft.countdownKind))!;
    return startOfLocalDay(d);
  });

  const endPickerMinDate = useMemo(() => {
    const today = startOfLocalDay(new Date());
    if (draft.countdownKind === 'countdown') return addLocalDays(today, 1);
    const past = new Date();
    past.setFullYear(past.getFullYear() - 120);
    return startOfLocalDay(past);
  }, [draft.countdownKind]);

  const endPickerMaxDate = useMemo(() => {
    const today = startOfLocalDay(new Date());
    if (draft.countdownKind === 'countup') return addLocalDays(today, -1);
    const fut = new Date();
    fut.setFullYear(fut.getFullYear() + 50);
    return startOfLocalDay(fut);
  }, [draft.countdownKind]);

  const patchDraft = useCallback((p: Partial<VisionEditDraft>) => {
    setDraft(d => (d ? { ...d, ...p } : d));
  }, [setDraft]);

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
      patchDraft({ customBgUri: uri, bgIdx: VISION_BUILTIN_BG_COUNT });
    } catch (e) {
      console.warn('openCustomCoverPicker', e);
      Alert.alert('选择失败', '无法打开相册，请稍后重试。');
    }
  }, [patchDraft]);

  const openEndDatePicker = useCallback(() => {
    const today = startOfLocalDay(new Date());
    const parsed = parseYmdLocal(draft.endDate);
    if (draft.countdownKind === 'countdown') {
      const min = addLocalDays(today, 1);
      setEndDateDraft(parsed && parsed > today ? parsed : min);
    } else {
      const max = addLocalDays(today, -1);
      setEndDateDraft(parsed && parsed < today ? parsed : max);
    }
    setEndDatePickerVisible(true);
  }, [draft.countdownKind, draft.endDate]);

  const confirmEndDatePicker = useCallback(() => {
    patchDraft({ endDate: clampEndDateToKind(formatYmd(endDateDraft), draft.countdownKind) });
    setEndDatePickerVisible(false);
  }, [draft.countdownKind, endDateDraft, patchDraft]);

  const kindLabel: Record<VisionRow['track_kind'], string> = {
    progress: '进度追踪',
    count: '计数',
    countdown: '倒数日',
    target: '目标',
  };

  return (
    <>
      <View style={{ marginTop: 6, gap: 10 }}>
        <Text style={[styles.sectionKicker, { color: outline }]}>类型</Text>
        <View style={[styles.kindPill, { borderColor: panelBorder, backgroundColor: isDark ? 'rgba(30,41,59,0.55)' : 'rgba(234,237,255,0.9)' }]}>
          <MaterialIcons name="flag" size={16} color={visionPrimary} />
          <Text style={[styles.kindPillText, { color: textColor }]}>{kindLabel[row.track_kind]}</Text>
        </View>
        <Text style={[styles.editHint, { color: outline }]}>
          追踪方式由创建时确定，此处仅可编辑该类型下的参数与通用信息。
        </Text>
      </View>

      <View style={{ gap: 10, marginTop: 14 }}>
        <Text style={[styles.label, { color: outline }]}>背景选择</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 2 }}>
          {BG_THUMBS.map((src, idx) => {
            const isSelected = draft.bgIdx === idx;
            return (
              <Pressable
                key={idx}
                onPress={() => patchDraft({ bgIdx: idx, customBgUri: null })}
                style={({ pressed }) => [
                  styles.bgCard,
                  pressed && { opacity: 0.9 },
                  isSelected && { borderColor: visionPrimary, borderWidth: 2 },
                ]}
              >
                <Image source={src} style={styles.bgImg} contentFit="cover" transition={120} />
                {isSelected ? (
                  <View style={styles.bgSelectedOverlay}>
                    <MaterialIcons name="check-circle" size={18} color={visionPrimary} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {(() => {
            const idx = VISION_BUILTIN_BG_COUNT;
            const isSelected = draft.bgIdx === idx;
            const hasCustom = !!draft.customBgUri?.trim();
            return (
              <Pressable
                onPress={openCustomCoverPicker}
                style={({ pressed }) => [
                  hasCustom ? styles.bgCard : styles.customBg,
                  isSelected && (hasCustom ? { borderColor: visionPrimary, borderWidth: 2 } : styles.customBgSelected),
                  pressed && { opacity: 0.9 },
                ]}
              >
                {hasCustom ? (
                  <>
                    <Image source={{ uri: draft.customBgUri! }} style={styles.bgImg} contentFit="cover" transition={120} />
                    {isSelected ? (
                      <View style={styles.bgSelectedOverlay}>
                        <MaterialIcons name="check-circle" size={18} color={visionPrimary} />
                      </View>
                    ) : null}
                  </>
                ) : (
                  <>
                    <MaterialIcons name="add-a-photo" size={20} color={outline} />
                    <Text style={[styles.customBgText, { color: outline }]}>自定义</Text>
                  </>
                )}
              </Pressable>
            );
          })()}
        </ScrollView>
      </View>

      {row.track_kind === 'progress' ? (
        <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder, marginTop: 16 }]}>
          <Text style={[styles.panelTitle, { color: textColor, marginBottom: 14 }]}>进度参数</Text>
          <Text style={[styles.label, { color: outline }]}>方向</Text>
          <View style={styles.directionTabs}>
            <Pressable
              onPress={() => patchDraft({ direction: 'positive' })}
              style={({ pressed }) => [
                styles.directionBtn,
                { flex: 1, alignItems: 'center' },
                draft.direction === 'positive' && { backgroundColor: visionPrimary },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={[styles.directionBtnText, draft.direction === 'positive' ? { color: '#fff' } : { color: outline }]}>
                正向增长
              </Text>
            </Pressable>
            <Pressable
              onPress={() => patchDraft({ direction: 'negative' })}
              style={({ pressed }) => [
                styles.directionBtn,
                { flex: 1, alignItems: 'center' },
                draft.direction === 'negative' && { backgroundColor: visionPrimary },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={[styles.directionBtnText, draft.direction === 'negative' ? { color: '#fff' } : { color: outline }]}>
                反向减少
              </Text>
            </Pressable>
          </View>
          <View style={[styles.grid2, { marginTop: 16 }]}>
            <View style={styles.grid2LabelsRow}>
              <Text style={[styles.grid2Label, { color: outline }]}>目标总量</Text>
              <Text style={[styles.grid2Label, { color: outline }]}>步长</Text>
            </View>
            <View style={styles.grid2InputsRow}>
              <TextInput
                value={draft.goalTotal}
                onChangeText={t => patchDraft({ goalTotal: t })}
                keyboardType="numeric"
                placeholderTextColor={placeholderColor}
                style={[styles.grid2Input, { color: textColor }]}
              />
              <TextInput
                value={draft.step}
                onChangeText={t => patchDraft({ step: t })}
                keyboardType="numeric"
                placeholderTextColor={placeholderColor}
                style={[styles.grid2Input, { color: textColor }]}
              />
            </View>
          </View>
          <View style={{ marginTop: 14 }}>
            <Text style={[styles.label, { color: outline }]}>度量单位</Text>
            <TextInput
              value={draft.unit}
              onChangeText={t => patchDraft({ unit: t })}
              placeholder="例如：公里、页、小时"
              placeholderTextColor={placeholderColor}
              style={[styles.input, { color: textColor, backgroundColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(234,237,255,0.9)' }]}
            />
          </View>
        </View>
      ) : null}

      {row.track_kind === 'count' ? (
        <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder, marginTop: 16 }]}>
          <Text style={[styles.panelTitle, { color: textColor, marginBottom: 14 }]}>计数参数</Text>
          <Text style={[styles.label, { color: outline }]}>频率</Text>
          <View style={[styles.directionTabs, { flexWrap: 'wrap', gap: 6 }]}>
            {(
              [
                { key: 'daily' as const, label: '每日' },
                { key: 'weekly' as const, label: '每周' },
                { key: 'monthly' as const, label: '每月' },
              ] as const
            ).map(item => (
              <Pressable
                key={item.key}
                onPress={() => patchDraft({ countFrequency: item.key })}
                style={({ pressed }) => [
                  styles.directionBtn,
                  { paddingHorizontal: 14 },
                  draft.countFrequency === item.key && { backgroundColor: visionPrimary },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text
                  style={[
                    styles.directionBtnText,
                    draft.countFrequency === item.key ? { color: '#fff' } : { color: outline },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.grid2, { marginTop: 16 }]}>
            <View style={styles.grid2LabelsRow}>
              <Text style={[styles.grid2Label, { color: outline }]}>每次增加</Text>
              <Text style={[styles.grid2Label, { color: outline }]}>单位</Text>
            </View>
            <View style={styles.grid2InputsRow}>
              <TextInput
                value={draft.countStep}
                onChangeText={t => patchDraft({ countStep: t })}
                keyboardType="numeric"
                placeholderTextColor={placeholderColor}
                style={[styles.grid2Input, { color: textColor }]}
              />
              <TextInput
                value={draft.countUnit}
                onChangeText={t => patchDraft({ countUnit: t })}
                placeholderTextColor={placeholderColor}
                style={[styles.grid2Input, { color: textColor }]}
              />
            </View>
          </View>
        </View>
      ) : null}

      {row.track_kind === 'countdown' ? (
        <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder, marginTop: 16 }]}>
          <Text style={[styles.panelTitle, { color: textColor, marginBottom: 14 }]}>倒数日参数</Text>
          <Text style={[styles.label, { color: outline }]}>类型</Text>
          <View style={styles.directionTabs}>
            <Pressable
              onPress={() => {
                const next: 'countdown' = 'countdown';
                patchDraft({
                  countdownKind: next,
                  endDate: clampEndDateToKind(draft.endDate, next),
                });
              }}
              style={({ pressed }) => [
                styles.directionBtn,
                { flex: 1, alignItems: 'center' },
                draft.countdownKind === 'countdown' && { backgroundColor: visionPrimary },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text
                style={[
                  styles.directionBtnText,
                  draft.countdownKind === 'countdown' ? { color: '#fff' } : { color: outline },
                ]}
              >
                倒数日
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const next: 'countup' = 'countup';
                patchDraft({
                  countdownKind: next,
                  endDate: clampEndDateToKind(draft.endDate, next),
                });
              }}
              style={({ pressed }) => [
                styles.directionBtn,
                { flex: 1, alignItems: 'center' },
                draft.countdownKind === 'countup' && { backgroundColor: visionPrimary },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text
                style={[styles.directionBtnText, draft.countdownKind === 'countup' ? { color: '#fff' } : { color: outline }]}
              >
                正数日
              </Text>
            </Pressable>
          </View>
          <View style={{ marginTop: 14, gap: 8 }}>
            <Text style={[styles.label, { color: outline }]}>日期</Text>
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
              <MaterialIcons name="event" size={20} color={visionPrimary} />
              <Text style={[styles.endDateFieldText, { color: textColor }]}>{draft.endDate}</Text>
              <MaterialIcons name="expand-more" size={20} color={outline} />
            </Pressable>
            <Text style={[styles.endDateHint, { color: outline }]}>
              {draft.countdownKind === 'countdown' ? '须选择今天之后的日期。' : '须选择今天之前的日期。'}
            </Text>
          </View>
          <View style={{ marginTop: 14, gap: 8 }}>
            <Text style={[styles.label, { color: outline }]}>显示格式</Text>
            <View style={[styles.directionTabs, { gap: 4 }]}>
              {(
                [
                  { key: 'ymd' as const, label: '年月天' },
                  { key: 'year' as const, label: '年' },
                  { key: 'month' as const, label: '月' },
                  { key: 'week' as const, label: '周' },
                  { key: 'day' as const, label: '天' },
                ] as const
              ).map(item => (
                <Pressable
                  key={item.key}
                  onPress={() => patchDraft({ dateFormat: item.key })}
                  style={({ pressed }) => [
                    styles.directionBtn,
                    { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
                    draft.dateFormat === item.key && { backgroundColor: visionPrimary },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Text
                    style={[
                      styles.directionBtnText,
                      { fontSize: 11 },
                      draft.dateFormat === item.key ? { color: '#fff' } : { color: outline },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {row.track_kind === 'target' ? (
        <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder, marginTop: 16, gap: 14 }]}>
          <View style={{ gap: 4 }}>
            <Text style={[styles.panelTitle, { color: textColor }]}>小目标</Text>
            <Text style={{ color: outline, fontSize: 12, fontWeight: '600' }}>
              将总目标拆分为多个小目标；绑定项目后按任务完成情况汇总进度
            </Text>
          </View>
          <VisionSubGoalsSection
            subGoals={draft.subGoals}
            onChange={next => patchDraft({ subGoals: next })}
            textColor={textColor}
            outline={outline}
            placeholderColor={placeholderColor}
            isDark={isDark}
            panelBg={isDark ? 'rgba(30,41,59,0.35)' : 'rgba(234,237,255,0.72)'}
            sheetBg={isDark ? '#0f172a' : '#fff'}
          />
        </View>
      ) : null}

      <Modal visible={endDatePickerVisible} transparent animationType="fade" onRequestClose={() => setEndDatePickerVisible(false)}>
        <View style={styles.dateModalRoot}>
          <Pressable style={styles.dateModalBackdrop} onPress={() => setEndDatePickerVisible(false)} />
          <View
            style={[
              styles.dateModalCard,
              {
                backgroundColor: isDark ? '#0f172a' : '#fff',
                borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.5)',
                marginBottom: Math.max(insetsBottom, 16) + 8,
              },
            ]}
          >
            <Text style={[styles.dateModalTitle, { color: textColor }]}>
              {draft.countdownKind === 'countdown' ? '选择日期（倒数日）' : '选择日期（正数日）'}
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
                style={[styles.dateModalBtnGhost, { borderColor: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(194,198,214,0.65)' }]}
              >
                <Text style={[styles.dateModalBtnGhostText, { color: outline }]}>取消</Text>
              </Pressable>
              <Pressable onPress={confirmEndDatePicker} style={[styles.dateModalBtnPrimary, { backgroundColor: visionPrimary }]}>
                <Text style={styles.dateModalBtnPrimaryText}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

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

function parseYmdLocal(s: string): Date | null {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : startOfLocalDay(dt);
}

const styles = StyleSheet.create({
  sectionKicker: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  kindPillText: { fontSize: 13, fontWeight: '800' },
  editHint: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '700' },
  panel: { borderRadius: 18, borderWidth: 1, padding: 16 },
  panelTitle: { fontSize: 15, fontWeight: '800' },
  directionTabs: { flexDirection: 'row', backgroundColor: 'rgba(234,237,255,0.8)', borderRadius: 12, padding: 4, gap: 6 },
  directionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  directionBtnText: { fontWeight: '700', fontSize: 12 },
  grid2: { gap: 10 },
  grid2LabelsRow: { flexDirection: 'row', gap: 12 },
  grid2Label: { flex: 1, fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 2 },
  grid2InputsRow: { flexDirection: 'row', gap: 12 },
  grid2Input: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
    backgroundColor: 'rgba(234,237,255,0.9)',
  },
  input: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '600' },
  bgCard: { width: 88, height: 118, borderRadius: 16, overflow: 'hidden' },
  bgImg: { width: '100%', height: '100%' },
  bgSelectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,88,190,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customBg: {
    width: 88,
    height: 118,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(194,198,214,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(250,248,255,0.6)',
  },
  customBgSelected: { borderColor: '#0058be' },
  customBgText: { fontSize: 10, fontWeight: '700' },
  endDateField: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  endDateFieldText: { flex: 1, fontSize: 16, fontWeight: '700' },
  endDateHint: { fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 2 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
  },
  linkedBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  linkedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkedName: { flex: 1, fontSize: 15, fontWeight: '800' },
  linkedEmpty: { fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 8 },
  projectModalRoot: { flex: 1, justifyContent: 'flex-end' },
  projectModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  projectModalSheet: { maxHeight: '78%', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 8 },
  projectModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.22)',
  },
  projectModalTitle: { fontSize: 17, fontWeight: '800' },
  projectModalLoading: { paddingVertical: 40, alignItems: 'center' },
  projectModalEmpty: { paddingHorizontal: 22, paddingVertical: 28, textAlign: 'center', fontSize: 14, fontWeight: '600' },
  projectModalList: { flexGrow: 0 },
  projectModalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(194,198,214,0.35)' },
  projectModalRowTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  dateModalRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  dateModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  dateModalCard: { width: '100%', maxWidth: 400, borderRadius: 18, borderWidth: 1, padding: 16, gap: 8 },
  dateModalTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  dateModalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  dateModalBtnGhost: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, alignItems: 'center' },
  dateModalBtnGhostText: { fontSize: 15, fontWeight: '800' },
  dateModalBtnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
  dateModalBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },
});
