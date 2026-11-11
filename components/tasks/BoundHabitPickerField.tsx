import {
  FoldBottomSheet,
  useFoldBottomSheetRequestClose,
} from '@/components/ui/fold-bottom-sheet';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type HabitSection = {
  contextId: string;
  contextName: string;
  habits: HabitRow[];
};

type BoundHabitPickerFieldProps = {
  selectedHabitIds: string[];
  sections: HabitSection[];
  loading?: boolean;
  disabled?: boolean;
  /** 默认芯片态；需要旧大框时显式传 compact={false} */
  compact?: boolean;
  onChange: (habitIds: string[]) => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
  isDark: boolean;
  /** 未选时的副文案 */
  emptyHint?: string;
  /** 已选时的副文案 */
  selectedHint?: string;
  modalTitle?: string;
  modalDesc?: string;
};

export function BoundHabitPickerField({
  selectedHabitIds,
  sections,
  loading = false,
  disabled = false,
  compact = true,
  onChange,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
  isDark,
  emptyHint = '可选多项；绑定后由习惯进度驱动任务完成',
  selectedHint = '全部绑定习惯达成目标后，此任务将自动完成',
  modalTitle = '绑定小习惯',
  modalDesc = '可多选小习惯；当全部达成目标时，本任务会自动标记为完成。',
}: BoundHabitPickerFieldProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  const habitMetaById = useMemo(() => {
    const map = new Map<string, { name: string; icon: string }>();
    for (const section of sections) {
      for (const habit of section.habits) {
        map.set(habit.id, { name: habit.name, icon: habit.icon });
      }
    }
    return map;
  }, [sections]);

  const selectedChips = useMemo(
    () =>
      selectedHabitIds.map((id) => {
        const meta = habitMetaById.get(id);
        return {
          id,
          name: meta?.name?.trim() || '未知习惯',
          icon: meta?.icon || '',
        };
      }),
    [habitMetaById, selectedHabitIds],
  );

  const selectedSummary = useMemo(() => {
    if (selectedChips.length === 0) return '未绑定';
    const names = selectedChips.map((c) => c.name);
    if (names.length <= 2) return names.join('、');
    return `${names.slice(0, 2).join('、')} 等 ${names.length} 项`;
  }, [selectedChips]);

  const openModal = useCallback(() => {
    if (disabled) return;
    setDraftIds(selectedHabitIds);
    setModalVisible(true);
  }, [disabled, selectedHabitIds]);

  const handleSheetClose = useCallback(() => {
    setModalVisible(false);
    setDraftIds([]);
  }, []);

  const toggleDraft = useCallback((habitId: string) => {
    setDraftIds((prev) =>
      prev.includes(habitId) ? prev.filter((id) => id !== habitId) : [...prev, habitId],
    );
  }, []);

  const removeSelected = useCallback(
    (habitId: string) => {
      if (disabled || loading) return;
      onChange(selectedHabitIds.filter((id) => id !== habitId));
    },
    [disabled, loading, onChange, selectedHabitIds],
  );

  const totalHabits = useMemo(
    () => sections.reduce((sum, section) => sum + section.habits.length, 0),
    [sections],
  );

  return (
    <>
      {compact ? (
        <View style={styles.compactWrap}>
          <View style={styles.chipRow}>
            {loading ? (
              <Text style={[styles.compactEmpty, { color: outline }]}>加载小习惯…</Text>
            ) : selectedChips.length === 0 ? (
              <Text style={[styles.compactEmpty, { color: outline }]}>未绑定习惯</Text>
            ) : (
              selectedChips.map((chip) => (
                <View
                  key={chip.id}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: isDark ? `${primary}33` : `${primary}14`,
                      borderColor: isDark ? primary : `${primary}44`,
                    },
                  ]}>
                  {chip.icon ? <Text style={styles.chipIcon}>{chip.icon}</Text> : null}
                  <Text style={[styles.chipText, { color: isDark ? '#fff' : primary }]} numberOfLines={1}>
                    {chip.name}
                  </Text>
                  {!disabled ? (
                    <Pressable
                      onPress={() => removeSelected(chip.id)}
                      hitSlop={8}
                      accessibilityLabel={`移除 ${chip.name}`}>
                      <MaterialIcons name="close" size={14} color={isDark ? '#fff' : primary} />
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}
          </View>
          <Pressable
            onPress={openModal}
            disabled={disabled || loading}
            style={({ pressed }) => [
              styles.compactAdd,
              {
                borderColor: placeholderColor,
                backgroundColor: surfaceLow,
                opacity: disabled || loading ? 0.55 : pressed ? 0.8 : 1,
              },
            ]}>
            {loading ? (
              <ActivityIndicator size="small" color={primary} />
            ) : (
              <>
                <MaterialIcons name="add" size={15} color={primary} />
                <Text style={[styles.compactAddText, { color: primary }]}>
                  {selectedHabitIds.length > 0 ? '调整习惯' : '绑定习惯'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={openModal}
          disabled={disabled || loading}
          style={({ pressed }) => [
            styles.select,
            { backgroundColor: surfaceLow, borderColor: placeholderColor },
            (disabled || loading) && { opacity: 0.65 },
            pressed && !disabled && !loading && { opacity: 0.8 },
          ]}>
          <View style={styles.selectLeft}>
            <MaterialIcons name="repeat" size={18} color={primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.selectValue, { color: textColor }]} numberOfLines={2}>
                {loading ? '加载小习惯…' : selectedSummary}
              </Text>
              {selectedHabitIds.length > 0 ? (
                <Text style={[styles.selectHint, { color: outline }]} numberOfLines={2}>
                  {selectedHint}
                </Text>
              ) : (
                <Text style={[styles.selectHint, { color: outline }]}>{emptyHint}</Text>
              )}
            </View>
          </View>
          {loading ? (
            <ActivityIndicator size="small" color={primary} />
          ) : (
            <MaterialIcons name="expand-more" size={20} color={outline} />
          )}
        </Pressable>
      )}

      <FoldBottomSheet
        visible={modalVisible}
        onClose={handleSheetClose}
        accessibilityLabel="关闭习惯选择">
        <BoundHabitPickerSheetBody
          modalTitle={modalTitle}
          modalDesc={modalDesc}
          textColor={textColor}
          outline={outline}
          primary={primary}
          isDark={isDark}
          totalHabits={totalHabits}
          sections={sections}
          draftIds={draftIds}
          toggleDraft={toggleDraft}
          onChange={onChange}
        />
      </FoldBottomSheet>
    </>
  );
}

function BoundHabitPickerSheetBody({
  modalTitle,
  modalDesc,
  textColor,
  outline,
  primary,
  isDark,
  totalHabits,
  sections,
  draftIds,
  toggleDraft,
  onChange,
}: {
  modalTitle: string;
  modalDesc: string;
  textColor: string;
  outline: string;
  primary: string;
  isDark: boolean;
  totalHabits: number;
  sections: HabitSection[];
  draftIds: string[];
  toggleDraft: (id: string) => void;
  onChange: (ids: string[]) => void;
}) {
  const requestClose = useFoldBottomSheetRequestClose();

  const confirm = useCallback(() => {
    onChange(draftIds);
    requestClose();
  }, [draftIds, onChange, requestClose]);

  return (
    <View style={styles.sheetBody}>
      <View style={styles.modalHeader}>
        <Text style={[styles.modalTitle, { color: textColor }]}>{modalTitle}</Text>
        <Pressable onPress={requestClose} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
          <MaterialIcons name="close" size={22} color={outline} />
        </Pressable>
      </View>
      <Text style={[styles.modalDesc, { color: outline }]}>{modalDesc}</Text>
      {totalHabits === 0 ? (
        <Text style={[styles.modalEmpty, { color: outline }]}>暂无小习惯，请先在任务页添加</Text>
      ) : (
        <>
          <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {sections.map((section) => (
              <View key={section.contextId}>
                <Text style={[styles.sectionLabel, { color: outline }]}>{section.contextName}</Text>
                {section.habits.map((habit) => {
                  const picked = draftIds.includes(habit.id);
                  return (
                    <Pressable
                      key={habit.id}
                      onPress={() => toggleDraft(habit.id)}
                      style={({ pressed }) => [
                        styles.modalRow,
                        {
                          borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)',
                          opacity: pressed ? 0.88 : 1,
                        },
                      ]}>
                      <Text style={styles.habitIcon}>{habit.icon}</Text>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.modalRowTitle, { color: textColor }]} numberOfLines={2}>
                          {habit.name}
                        </Text>
                        {!!habit.tag && (
                          <Text style={[styles.modalRowSub, { color: outline }]} numberOfLines={1}>
                            {habit.tag}
                          </Text>
                        )}
                      </View>
                      {picked ? (
                        <MaterialIcons name="check-circle" size={22} color={primary} />
                      ) : (
                        <MaterialIcons name="radio-button-unchecked" size={22} color={outline} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
          <Pressable
            onPress={confirm}
            style={({ pressed }) => [styles.confirmBtn, { backgroundColor: primary, opacity: pressed ? 0.9 : 1 }]}>
            <Text style={styles.confirmBtnText}>
              确定{draftIds.length > 0 ? `（已选 ${draftIds.length} 项）` : ''}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  compactWrap: { gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  chipIcon: { fontSize: 12 },
  chipText: { fontSize: 12, fontWeight: '700', maxWidth: 140 },
  compactEmpty: { fontSize: 12, fontWeight: '600' },
  compactAdd: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  compactAddText: { fontSize: 12, fontWeight: '700' },
  select: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  selectLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1 },
  selectValue: { fontSize: 14, fontWeight: '700' },
  selectHint: { fontSize: 11, fontWeight: '600' },
  sheetBody: { gap: 8, paddingBottom: 4 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalDesc: { fontSize: 12, fontWeight: '600', lineHeight: 18, marginBottom: 4 },
  modalEmpty: { fontSize: 13, fontWeight: '600', paddingVertical: 24, textAlign: 'center' },
  modalList: { maxHeight: 360 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 2,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRowTitle: { fontSize: 14, fontWeight: '700' },
  modalRowSub: { fontSize: 11, fontWeight: '600' },
  habitIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  confirmBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
