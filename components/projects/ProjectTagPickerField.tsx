import type { ProjectTagRow } from '@/lib/repositories/projects/project-tag.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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

type ProjectTagPickerFieldProps = {
  selectedIds: string[];
  allTags: ProjectTagRow[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (ids: string[]) => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
  isDark: boolean;
};

export function ProjectTagPickerField({
  selectedIds,
  allTags,
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
}: ProjectTagPickerFieldProps) {
  const router = useRouter();
  const [modalVisible, setModalVisible] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  const tagById = useMemo(() => new Map(allTags.map((t) => [t.id, t])), [allTags]);

  const selectedTags = useMemo(
    () =>
      selectedIds
        .map((id) => tagById.get(id))
        .filter((t): t is ProjectTagRow => !!t),
    [selectedIds, tagById],
  );

  const selectedSummary = useMemo(() => {
    if (selectedTags.length === 0) return '未贴标签';
    if (selectedTags.length <= 3) return selectedTags.map((t) => t.name).join('、');
    return `${selectedTags
      .slice(0, 2)
      .map((t) => t.name)
      .join('、')} 等 ${selectedTags.length} 个`;
  }, [selectedTags]);

  const openModal = useCallback(() => {
    if (disabled) return;
    setDraftIds(selectedIds);
    setModalVisible(true);
  }, [disabled, selectedIds]);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setDraftIds([]);
  }, []);

  const toggleDraft = useCallback((tagId: string) => {
    setDraftIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }, []);

  const confirmModal = useCallback(() => {
    onChange(draftIds);
    closeModal();
  }, [closeModal, draftIds, onChange]);

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
          <MaterialIcons name="local-offer" size={18} color={primary} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.selectValue, { color: textColor }]} numberOfLines={2}>
              {loading ? '加载标签…' : selectedSummary}
            </Text>
            {selectedTags.length > 0 ? (
              <View style={styles.chipRow}>
                {selectedTags.slice(0, 4).map((tag) => (
                  <View
                    key={tag.id}
                    style={[styles.miniChip, { backgroundColor: `${tag.color}22`, borderColor: `${tag.color}55` }]}>
                    <View style={[styles.miniDot, { backgroundColor: tag.color }]} />
                    <Text style={[styles.miniChipText, { color: tag.color }]} numberOfLines={1}>
                      {tag.name}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.selectHint, { color: outline }]}>可选多个标签；可在标签管理中新建</Text>
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
              <Text style={[styles.modalTitle, { color: textColor }]}>选择项目标签</Text>
              <Pressable onPress={closeModal} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                <MaterialIcons name="close" size={22} color={outline} />
              </Pressable>
            </View>
            <Text style={[styles.modalDesc, { color: outline }]}>
              一个项目可贴 0 到多个标签；权重高的标签会优先展示。
            </Text>

            <Pressable
              onPress={() => {
                closeModal();
                router.push('/project-tags');
              }}
              style={({ pressed }) => [
                styles.manageBtn,
                { borderColor: `${primary}33`, backgroundColor: `${primary}10`, opacity: pressed ? 0.85 : 1 },
              ]}>
              <MaterialIcons name="settings" size={16} color={primary} />
              <Text style={[styles.manageBtnText, { color: primary }]}>管理标签（新建 / 删除 / 权重）</Text>
            </Pressable>

            {allTags.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: outline }]}>暂无标签，请先去管理页新建</Text>
            ) : (
              <>
                <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {allTags.map((tag) => {
                    const picked = draftIds.includes(tag.id);
                    return (
                      <Pressable
                        key={tag.id}
                        onPress={() => toggleDraft(tag.id)}
                        style={({ pressed }) => [
                          styles.modalRow,
                          {
                            borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)',
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}>
                        <View style={[styles.colorDot, { backgroundColor: tag.color }]} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[styles.modalRowTitle, { color: textColor }]} numberOfLines={1}>
                            {tag.name}
                          </Text>
                          <Text style={[styles.modalRowSub, { color: outline }]} numberOfLines={1}>
                            权重 {tag.weight}
                            {tag.description?.trim() ? ` · ${tag.description.trim()}` : ''}
                          </Text>
                        </View>
                        {picked ? (
                          <MaterialIcons name="check-circle" size={22} color={primary} />
                        ) : (
                          <MaterialIcons name="radio-button-unchecked" size={22} color={outline} />
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable
                  onPress={confirmModal}
                  style={({ pressed }) => [styles.confirmBtn, { backgroundColor: primary, opacity: pressed ? 0.9 : 1 }]}>
                  <Text style={styles.confirmBtnText}>
                    确定{draftIds.length > 0 ? `（已选 ${draftIds.length} 个）` : ''}
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  miniChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 120,
  },
  miniDot: { width: 6, height: 6, borderRadius: 3 },
  miniChipText: { fontSize: 11, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.38)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: { borderWidth: 1, borderRadius: 16, padding: 14, maxHeight: '78%', gap: 8 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalDesc: { fontSize: 12, fontWeight: '600', lineHeight: 18, marginBottom: 2 },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  manageBtnText: { fontSize: 12, fontWeight: '700' },
  modalEmpty: { fontSize: 13, fontWeight: '600', paddingVertical: 24, textAlign: 'center' },
  modalList: { maxHeight: 360 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  modalRowTitle: { fontSize: 14, fontWeight: '700' },
  modalRowSub: { fontSize: 11, fontWeight: '600' },
  confirmBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
