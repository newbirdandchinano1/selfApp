import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  addRecipePlanEntry,
  formatLocalYmd,
  MEAL_SLOTS,
  mealSlotLabel,
  parseLocalYmd,
  type MealSlot,
} from '@/lib/recipe-plan';
import { getRecipePalette } from '@/lib/recipe-theme';
import { PaletteDark, PaletteLight } from '@/constants/design-tokens';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
/** 与设计稿一致：周日为首 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

type CalCell = { key: string; day: number | null; ymd: string | null };

function buildMonthGrid(year: number, monthIndex: number): CalCell[] {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay(); // 0=Sun
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: CalCell[] = [];
  for (let i = 0; i < startPad; i += 1) {
    cells.push({ key: `pad-${i}`, day: null, ymd: null });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const ymd = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ key: ymd, day: d, ymd });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, day: null, ymd: null });
  }
  return cells;
}

function formatYmdZh(ymd: string): string {
  const d = parseLocalYmd(ymd);
  if (!d) return ymd;
  return `${d.getFullYear()}年 ${d.getMonth() + 1}月 ${d.getDate()}日`;
}

export type AddRecipeToPlanSheetProps = {
  visible: boolean;
  onClose: () => void;
  recipeId: string;
  recipeTitle: string;
  categoryName?: string;
  /** 保存成功后回调（例如关闭弹层） */
  onSaved?: () => void;
};

export function AddRecipeToPlanSheet({
  visible,
  onClose,
  recipeId,
  recipeTitle,
  categoryName,
  onSaved,
}: AddRecipeToPlanSheetProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const p = getRecipePalette(colorScheme);
  const tokens = (colorScheme ?? 'light') === 'dark' ? PaletteDark : PaletteLight;
  const reduceMotion = useReducedMotion();

  const today = useMemo(() => formatLocalYmd(new Date()), []);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedYmd, setSelectedYmd] = useState(today);
  const [slot, setSlot] = useState<MealSlot>('lunch');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [shouldRender, setShouldRender] = useState(visible);
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const resetForm = useCallback(() => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedYmd(formatLocalYmd(now));
    setSlot('lunch');
    setNote('');
    setSaving(false);
  }, []);

  const playOpen = useCallback(() => {
    if (reduceMotion) {
      translateY.setValue(0);
      backdropOpacity.setValue(1);
      return;
    }
    translateY.setValue(SCREEN_HEIGHT);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, reduceMotion, translateY]);

  const playClose = useCallback(
    (after?: () => void) => {
      if (reduceMotion) {
        translateY.setValue(SCREEN_HEIGHT);
        backdropOpacity.setValue(0);
        after?.();
        return;
      }
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: 280,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) after?.();
      });
    },
    [backdropOpacity, reduceMotion, translateY],
  );

  const requestClose = useCallback(() => {
    if (saving) return;
    onCloseRef.current();
  }, [saving]);

  useEffect(() => {
    if (!visible) return;
    resetForm();
    setShouldRender(true);
    const raf = requestAnimationFrame(playOpen);
    return () => cancelAnimationFrame(raf);
  }, [playOpen, resetForm, visible]);

  useEffect(() => {
    if (visible || !shouldRender) return;
    playClose(() => setShouldRender(false));
  }, [playClose, shouldRender, visible]);

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const monthLabel = `${viewYear}年 ${viewMonth + 1}月`;
  const recipeLine = categoryName?.trim()
    ? `${recipeTitle} · ${categoryName.trim()}`
    : recipeTitle;

  const shiftMonth = useCallback(
    (delta: number) => {
      setViewMonth(m => {
        const next = new Date(viewYear, m + delta, 1);
        setViewYear(next.getFullYear());
        return next.getMonth();
      });
    },
    [viewYear],
  );

  const pickSlot = useCallback(() => {
    Alert.alert('选择餐次', undefined, [
      ...MEAL_SLOTS.map(s => ({
        text: s.label,
        onPress: () => setSlot(s.key),
      })),
      { text: '取消', style: 'cancel' as const },
    ]);
  }, []);

  const onSave = useCallback(async () => {
    if (saving || !recipeId) return;
    setSaving(true);
    try {
      await addRecipePlanEntry({
        date: selectedYmd,
        slot,
        recipeId,
        recipeTitle,
      });
      toast.success(`已加入${mealSlotLabel(slot)}`);
      onSaved?.();
      onCloseRef.current();
    } catch (e) {
      toast.error(toUserMessage(e, '添加失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }, [onSaved, recipeId, recipeTitle, saving, selectedYmd, slot]);

  if (!shouldRender) return null;

  return (
    <Modal
      visible={shouldRender}
      transparent
      animationType="none"
      onRequestClose={requestClose}
      statusBarTranslucent>
      <View style={styles.root} pointerEvents="box-none">
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: p.overlay, opacity: backdropOpacity }]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          accessibilityLabel="关闭"
          disabled={saving}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
          pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: p.bg,
                paddingBottom: Math.max(insets.bottom, 16),
                transform: [{ translateY }],
              },
            ]}>
            <View style={styles.header}>
              <Pressable
                onPress={requestClose}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="取消"
                style={({ pressed }) => [
                  styles.headerBtn,
                  {
                    borderColor: p.border,
                    backgroundColor: p.card,
                    opacity: pressed || saving ? 0.7 : 1,
                  },
                ]}>
                <Text style={[styles.headerBtnText, { color: tokens.danger }]}>取消</Text>
              </Pressable>
              <Text style={[styles.headerTitle, { color: p.text }]}>加入计划</Text>
              <Pressable
                onPress={() => void onSave()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="保存"
                style={({ pressed }) => [
                  styles.headerBtn,
                  {
                    borderColor: p.border,
                    backgroundColor: p.card,
                    opacity: pressed || saving ? 0.7 : 1,
                  },
                ]}>
                {saving ? (
                  <ActivityIndicator size="small" color={tokens.success} />
                ) : (
                  <Text style={[styles.headerBtnText, { color: tokens.success }]}>保存</Text>
                )}
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              bounces={false}>
              <View style={[styles.recipeChip, { backgroundColor: p.card, borderColor: p.border }]}>
                <Text style={[styles.recipeChipText, { color: p.text }]} numberOfLines={1}>
                  {recipeLine}
                </Text>
              </View>

              <Text style={[styles.prompt, { color: p.text }]}>哪天想吃这道菜？</Text>

              <View style={[styles.calCard, { backgroundColor: p.card, borderColor: p.border }]}>
                <View style={styles.calNav}>
                  <Pressable
                    onPress={() => shiftMonth(-1)}
                    hitSlop={10}
                    accessibilityLabel="上个月"
                    style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                    <MaterialIcons name="chevron-left" size={26} color={p.outlineMuted} />
                  </Pressable>
                  <Text style={[styles.calMonth, { color: p.text }]}>{monthLabel}</Text>
                  <Pressable
                    onPress={() => shiftMonth(1)}
                    hitSlop={10}
                    accessibilityLabel="下个月"
                    style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
                    <MaterialIcons name="chevron-right" size={26} color={p.outlineMuted} />
                  </Pressable>
                </View>

                <View style={styles.weekRow}>
                  {WEEKDAYS.map(w => (
                    <Text key={w} style={[styles.weekLabel, { color: p.outlineMuted }]}>
                      {w}
                    </Text>
                  ))}
                </View>

                <View style={styles.dayGrid}>
                  {grid.map(cell => {
                    if (cell.day == null || !cell.ymd) {
                      return <View key={cell.key} style={styles.dayCell} />;
                    }
                    const selected = cell.ymd === selectedYmd;
                    const isToday = cell.ymd === today;
                    return (
                      <Pressable
                        key={cell.key}
                        onPress={() => setSelectedYmd(cell.ymd!)}
                        style={styles.dayCell}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${cell.day}日`}>
                        <View
                          style={[
                            styles.dayInner,
                            selected ? { backgroundColor: tokens.success } : null,
                          ]}>
                          <Text
                            style={[
                              styles.dayNum,
                              {
                                color: selected ? '#fff' : p.text,
                                fontWeight: selected || isToday ? '800' : '600',
                              },
                            ]}>
                            {cell.day}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={[styles.divider, { backgroundColor: p.border }]} />

                <Text style={[styles.selectedDate, { color: p.text }]}>
                  {formatYmdZh(selectedYmd)}
                </Text>

                <Pressable
                  onPress={pickSlot}
                  accessibilityRole="button"
                  accessibilityLabel={`餐次 ${mealSlotLabel(slot)}`}
                  style={({ pressed }) => [
                    styles.mealRow,
                    { opacity: pressed ? 0.75 : 1 },
                  ]}>
                  <Text style={[styles.mealLabel, { color: p.text }]}>餐次</Text>
                  <View style={styles.mealValueWrap}>
                    <Text style={[styles.mealValue, { color: p.outline }]}>
                      {mealSlotLabel(slot)}
                    </Text>
                    <MaterialIcons name="unfold-more" size={18} color={p.outlineMuted} />
                  </View>
                </Pressable>

                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="备注"
                  placeholderTextColor={p.outlineMuted}
                  style={[styles.noteInput, { color: p.text, borderTopColor: p.border }]}
                  returnKeyType="done"
                  maxLength={120}
                />
              </View>
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheetWrap: { justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: SCREEN_HEIGHT * 0.92,
    paddingTop: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  headerBtn: {
    minWidth: 64,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnText: { fontSize: 15, fontWeight: '700' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 14,
  },
  recipeChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  recipeChipText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  prompt: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  calCard: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
  },
  calNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calMonth: { fontSize: 17, fontWeight: '800' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
  },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  dayInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNum: { fontSize: 15, lineHeight: 18 },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 8,
    marginBottom: 12,
  },
  selectedDate: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  mealLabel: { fontSize: 15, fontWeight: '700' },
  mealValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  mealValue: { fontSize: 15, fontWeight: '600' },
  noteInput: {
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
