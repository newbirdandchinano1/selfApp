import {
  FoldBottomSheet,
  useFoldBottomSheetRequestClose,
} from '@/components/ui/fold-bottom-sheet';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { validatePrerequisiteSelection } from '@/lib/repositories/projects/project-prerequisites';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert } from '@/lib/app-feedback';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type PrerequisiteProjectPickerFieldProps = {
  selectedIds: string[];
  allProjects: ProjectRow[];
  excludeProjectId?: string;
  loading?: boolean;
  disabled?: boolean;
  /** 标签式紧凑展示：芯片 + 轻触发，无冗长提示 */
  compact?: boolean;
  onChange: (ids: string[]) => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
  isDark: boolean;
};

export function PrerequisiteProjectPickerField({
  selectedIds,
  allProjects,
  excludeProjectId,
  loading = false,
  disabled = false,
  /** 默认芯片态；需要旧大框时显式传 compact={false} */
  compact = true,
  onChange,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
  isDark,
}: PrerequisiteProjectPickerFieldProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  const selectableProjects = useMemo(
    () =>
      allProjects.filter(
        (p) =>
          p.id !== excludeProjectId &&
          p.status !== 'done' &&
          p.status !== 'cancelled' &&
          p.status !== 'completed' &&
          p.status !== 'archived',
      ),
    [allProjects, excludeProjectId],
  );

  const nameById = useMemo(() => new Map(allProjects.map((p) => [p.id, p.name])), [allProjects]);

  const selectedSummary = useMemo(() => {
    if (selectedIds.length === 0) return '未绑定';
    const names = selectedIds.map((id) => nameById.get(id)?.trim() || '未知项目');
    if (names.length <= 2) return names.join('、');
    return `${names.slice(0, 2).join('、')} 等 ${names.length} 个`;
  }, [nameById, selectedIds]);

  const selectedChips = useMemo(
    () =>
      selectedIds.map((id) => ({
        id,
        name: nameById.get(id)?.trim() || '未知项目',
      })),
    [nameById, selectedIds],
  );

  const openModal = useCallback(() => {
    if (disabled) return;
    setDraftIds(selectedIds);
    setModalVisible(true);
  }, [disabled, selectedIds]);

  const handleSheetClose = useCallback(() => {
    setModalVisible(false);
    setDraftIds([]);
  }, []);

  const toggleDraft = useCallback((projectId: string) => {
    setDraftIds((prev) => (prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]));
  }, []);

  const removeSelected = useCallback(
    (projectId: string) => {
      if (disabled || loading) return;
      onChange(selectedIds.filter((id) => id !== projectId));
    },
    [disabled, loading, onChange, selectedIds],
  );

  return (
    <>
      {compact ? (
        <View style={styles.compactWrap}>
          <View style={styles.chipRow}>
            {loading ? (
              <Text style={[styles.compactEmpty, { color: outline }]}>加载项目列表…</Text>
            ) : selectedChips.length === 0 ? (
              <Text style={[styles.compactEmpty, { color: outline }]}>未绑定前置项目</Text>
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
                  {selectedIds.length > 0 ? '调整依赖' : '添加依赖'}
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
            <MaterialIcons name="link" size={18} color={primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.selectValue, { color: textColor }]} numberOfLines={2}>
                {loading ? '加载项目列表…' : selectedSummary}
              </Text>
              {selectedIds.length > 0 ? (
                <Text style={[styles.selectHint, { color: outline }]} numberOfLines={1}>
                  需待前置项目执行完毕后解锁
                </Text>
              ) : (
                <Text style={[styles.selectHint, { color: outline }]}>可选多个；绑定后本项目将上锁直至前置完成</Text>
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
        accessibilityLabel="关闭依赖选择">
        <PrerequisitePickerSheetBody
          textColor={textColor}
          outline={outline}
          primary={primary}
          isDark={isDark}
          selectableProjects={selectableProjects}
          draftIds={draftIds}
          toggleDraft={toggleDraft}
          excludeProjectId={excludeProjectId}
          allProjects={allProjects}
          onChange={onChange}
        />
      </FoldBottomSheet>
    </>
  );
}

function PrerequisitePickerSheetBody({
  textColor,
  outline,
  primary,
  isDark,
  selectableProjects,
  draftIds,
  toggleDraft,
  excludeProjectId,
  allProjects,
  onChange,
}: {
  textColor: string;
  outline: string;
  primary: string;
  isDark: boolean;
  selectableProjects: ProjectRow[];
  draftIds: string[];
  toggleDraft: (id: string) => void;
  excludeProjectId?: string;
  allProjects: ProjectRow[];
  onChange: (ids: string[]) => void;
}) {
  const requestClose = useFoldBottomSheetRequestClose();

  const confirm = useCallback(() => {
    const validation = validatePrerequisiteSelection(excludeProjectId ?? null, draftIds, allProjects);
    if (!validation.ok) {
      Alert.alert('无法保存前置项目', validation.message);
      return;
    }
    onChange(draftIds);
    requestClose();
  }, [allProjects, draftIds, excludeProjectId, onChange, requestClose]);

  return (
    <View style={styles.sheetBody}>
      <View style={styles.modalHeader}>
        <Text style={[styles.modalTitle, { color: textColor }]}>选择前置项目</Text>
        <Pressable onPress={requestClose} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
          <MaterialIcons name="close" size={22} color={outline} />
        </Pressable>
      </View>
      <Text style={[styles.modalDesc, { color: outline }]}>
        前置项目全部执行完毕后，本项目才会解锁；解锁前无法分配青蛙。
      </Text>
      {selectableProjects.length === 0 ? (
        <Text style={[styles.modalEmpty, { color: outline }]}>暂无可选项目</Text>
      ) : (
        <>
          <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {selectableProjects.map((p) => {
              const picked = draftIds.includes(p.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => toggleDraft(p.id)}
                  style={({ pressed }) => [
                    styles.modalRow,
                    {
                      borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)',
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}>
                  <MaterialIcons name="folder" size={22} color={primary} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.modalRowTitle, { color: textColor }]} numberOfLines={2}>
                      {p.name}
                    </Text>
                    <Text style={[styles.modalRowSub, { color: outline }]}>进行中</Text>
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
            onPress={confirm}
            style={({ pressed }) => [styles.confirmBtn, { backgroundColor: primary, opacity: pressed ? 0.9 : 1 }]}>
            <Text style={styles.confirmBtnText}>
              确定{draftIds.length > 0 ? `（已选 ${draftIds.length} 个）` : ''}
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
  chipText: { fontSize: 12, fontWeight: '700', maxWidth: 160 },
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
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRowTitle: { fontSize: 14, fontWeight: '700' },
  modalRowSub: { fontSize: 11, fontWeight: '600' },
  confirmBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
