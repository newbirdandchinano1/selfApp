import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
  onChange: (habitIds: string[]) => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
  isDark: boolean;
};

export function BoundHabitPickerField({
  selectedHabitIds,
  sections,
  loading = false,
  disabled = false,
  onChange,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
  isDark,
}: BoundHabitPickerFieldProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  const habitNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of sections) {
      for (const habit of section.habits) {
        map.set(habit.id, habit.name);
      }
    }
    return map;
  }, [sections]);

  const selectedSummary = useMemo(() => {
    if (selectedHabitIds.length === 0) return '未绑定';
    const names = selectedHabitIds.map((id) => habitNameById.get(id)?.trim() || '未知习惯');
    if (names.length <= 2) return names.join('、');
    return `${names.slice(0, 2).join('、')} 等 ${names.length} 项`;
  }, [habitNameById, selectedHabitIds]);

  const openModal = useCallback(() => {
    if (disabled) return;
    setDraftIds(selectedHabitIds);
    setModalVisible(true);
  }, [disabled, selectedHabitIds]);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setDraftIds([]);
  }, []);

  const toggleDraft = useCallback((habitId: string) => {
    setDraftIds((prev) =>
      prev.includes(habitId) ? prev.filter((id) => id !== habitId) : [...prev, habitId],
    );
  }, []);

  const confirmModal = useCallback(() => {
    onChange(draftIds);
    closeModal();
  }, [closeModal, draftIds, onChange]);

  const totalHabits = useMemo(
    () => sections.reduce((sum, section) => sum + section.habits.length, 0),
    [sections],
  );

  return (
    <>
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
                全部绑定习惯达成目标后，此任务将自动完成
              </Text>
            ) : (
              <Text style={[styles.selectHint, { color: outline }]}>可选多项；绑定后由习惯进度驱动任务完成</Text>
            )}
          </View>
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={primary} />
        ) : (
          <MaterialIcons name="expand-more" size={20} color={outline} />
        )}
      </Pressable>

      <Modal transparent visible={modalVisible} animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.modalOverlay} onPress={closeModal}>
          <Pressable
            onPress={() => {}}
            style={[styles.modalCard, { backgroundColor: surfaceLowest, borderColor: placeholderColor }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: textColor }]}>绑定小习惯</Text>
              <Pressable onPress={closeModal} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                <MaterialIcons name="close" size={22} color={outline} />
              </Pressable>
            </View>
            <Text style={[styles.modalDesc, { color: outline }]}>
              可多选小习惯；当全部达成目标时，本任务会自动标记为完成。
            </Text>
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
                  onPress={confirmModal}
                  style={({ pressed }) => [styles.confirmBtn, { backgroundColor: primary, opacity: pressed ? 0.9 : 1 }]}>
                  <Text style={styles.confirmBtnText}>
                    确定{draftIds.length > 0 ? `（已选 ${draftIds.length} 项）` : ''}
                  </Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.38)', justifyContent: 'center', paddingHorizontal: 18 },
  modalCard: { borderWidth: 1, borderRadius: 16, padding: 14, maxHeight: '78%', gap: 8 },
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
