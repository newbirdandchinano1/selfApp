import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { VisionLinkedProjectRef, VisionSubGoal } from '@/lib/repositories/visions/vision.types';
import {
  collectLinkedProjectsFromSubGoal,
  newVisionSubGoalId,
} from '@/lib/repositories/visions/vision.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type VisionSubGoalsSectionProps = {
  subGoals: VisionSubGoal[];
  onChange: (next: VisionSubGoal[]) => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  isDark: boolean;
  panelBg?: string;
  visionPrimary?: string;
  sheetBg?: string;
};

export function VisionSubGoalsSection({
  subGoals,
  onChange,
  textColor,
  outline,
  placeholderColor,
  isDark,
  panelBg = 'rgba(234,237,255,0.72)',
  visionPrimary = '#0058be',
  sheetBg,
}: VisionSubGoalsSectionProps) {
  const modalSheetBg = sheetBg ?? (isDark ? '#0f172a' : '#fff');

  const [formModalVisible, setFormModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');

  const [projectPickerVisible, setProjectPickerVisible] = useState(false);
  const [projectPickerSubGoalId, setProjectPickerSubGoalId] = useState<string | null>(null);
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([]);
  const [projectListLoading, setProjectListLoading] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<VisionLinkedProjectRef[]>([]);

  const patchSubGoal = useCallback(
    (id: string, patch: Partial<VisionSubGoal>) => {
      onChange(subGoals.map(sg => (sg.id === id ? { ...sg, ...patch } : sg)));
    },
    [onChange, subGoals]
  );

  const openAddModal = useCallback(() => {
    setEditingId(null);
    setDraftName('');
    setDraftDesc('');
    setFormModalVisible(true);
  }, []);

  const openEditModal = useCallback((sg: VisionSubGoal) => {
    setEditingId(sg.id);
    setDraftName(sg.name);
    setDraftDesc(sg.description ?? '');
    setFormModalVisible(true);
  }, []);

  const closeFormModal = useCallback(() => {
    setFormModalVisible(false);
    setEditingId(null);
    setDraftName('');
    setDraftDesc('');
  }, []);

  const confirmFormModal = useCallback(() => {
    const name = draftName.trim();
    if (!name) {
      Alert.alert('提示', '请填写小目标名称');
      return;
    }
    const description = draftDesc.trim();
    if (editingId) {
      patchSubGoal(editingId, {
        name,
        ...(description ? { description } : { description: undefined }),
      });
    } else {
      onChange([
        ...subGoals,
        {
          id: newVisionSubGoalId(),
          name,
          ...(description ? { description } : {}),
        },
      ]);
    }
    closeFormModal();
  }, [closeFormModal, draftDesc, draftName, editingId, onChange, patchSubGoal, subGoals]);

  const removeSubGoal = useCallback(
    (id: string) => {
      Alert.alert('删除小目标', '确定删除该小目标吗？', [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => onChange(subGoals.filter(sg => sg.id !== id)),
        },
      ]);
    },
    [onChange, subGoals]
  );

  const openProjectPicker = useCallback(
    (sg: VisionSubGoal) => {
      setProjectPickerSubGoalId(sg.id);
      setPickerSelected(collectLinkedProjectsFromSubGoal(sg));
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
    },
    []
  );

  const closeProjectPicker = useCallback(() => {
    setProjectPickerVisible(false);
    setProjectPickerSubGoalId(null);
    setPickerSelected([]);
  }, []);

  const togglePickerProject = useCallback((project: ProjectRow) => {
    setPickerSelected(prev => {
      const exists = prev.some(x => x.id === project.id);
      if (exists) return prev.filter(x => x.id !== project.id);
      return [...prev, { id: project.id, name: project.name }];
    });
  }, []);

  const confirmProjectPicker = useCallback(() => {
    const sgId = projectPickerSubGoalId;
    if (!sgId) return;
    patchSubGoal(sgId, {
      linkedProjects: pickerSelected.length > 0 ? pickerSelected : undefined,
    });
    closeProjectPicker();
  }, [closeProjectPicker, patchSubGoal, pickerSelected, projectPickerSubGoalId]);

  const removeBoundProject = useCallback(
    (subGoalId: string, projectId: string) => {
      const sg = subGoals.find(x => x.id === subGoalId);
      if (!sg) return;
      const next = collectLinkedProjectsFromSubGoal(sg).filter(p => p.id !== projectId);
      patchSubGoal(subGoalId, { linkedProjects: next.length > 0 ? next : undefined });
    },
    [patchSubGoal, subGoals]
  );

  return (
    <>
      <Pressable
        onPress={openAddModal}
        style={({ pressed }) => [styles.addBtn, { backgroundColor: panelBg, opacity: pressed ? 0.9 : 1 }]}
      >
        <View style={[styles.addIcon, { backgroundColor: 'rgba(0,88,190,0.12)' }]}>
          <MaterialIcons name="add" size={20} color={visionPrimary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: textColor, fontSize: 14, fontWeight: '700' }}>添加小目标</Text>
          <Text style={{ color: outline, fontSize: 12, fontWeight: '600' }}>弹窗填写名称与简介，添加后再绑定项目</Text>
        </View>
        <MaterialIcons name="chevron-right" size={20} color={outline} />
      </Pressable>

      {subGoals.length === 0 ? (
        <View style={[styles.emptyBox, { borderColor: 'rgba(194,198,214,0.45)' }]}>
          <MaterialIcons name="flag" size={28} color={'rgba(114,119,133,0.35)'} style={{ alignSelf: 'center' }} />
          <Text style={{ color: 'rgba(114,119,133,0.55)', fontSize: 13, fontStyle: 'italic', textAlign: 'center' }}>
            将总目标拆分为多个小目标；添加完成后可为每个小目标绑定多个项目
          </Text>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {subGoals.map((sg, index) => {
            const bound = collectLinkedProjectsFromSubGoal(sg);
            return (
              <View
                key={sg.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(255,255,255,0.92)',
                    borderColor: 'rgba(194,198,214,0.45)',
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardIndex, { color: visionPrimary }]}>小目标 {index + 1}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Pressable
                      onPress={() => openEditModal(sg)}
                      hitSlop={8}
                      style={({ pressed }) => [{ padding: 4, opacity: pressed ? 0.65 : 1 }]}
                      accessibilityLabel="编辑小目标"
                    >
                      <MaterialIcons name="edit" size={20} color={visionPrimary} />
                    </Pressable>
                    <Pressable
                      onPress={() => removeSubGoal(sg.id)}
                      hitSlop={8}
                      style={({ pressed }) => [{ padding: 4, opacity: pressed ? 0.65 : 1 }]}
                      accessibilityLabel="删除小目标"
                    >
                      <MaterialIcons name="delete-outline" size={22} color={outline} />
                    </Pressable>
                  </View>
                </View>

                <Text style={{ color: textColor, fontSize: 16, fontWeight: '800' }}>{sg.name}</Text>
                {sg.description ? (
                  <Text style={{ color: outline, fontSize: 13, fontWeight: '600', lineHeight: 20 }}>{sg.description}</Text>
                ) : null}

                <View style={{ gap: 8, marginTop: 4 }}>
                  <Text style={[styles.fieldLabel, { color: outline }]}>关联项目</Text>
                  {bound.length > 0 ? (
                    <View style={{ gap: 8 }}>
                      {bound.map(p => (
                        <View key={p.id} style={[styles.projectRow, { backgroundColor: panelBg }]}>
                          <MaterialIcons name="folder-special" size={20} color={visionPrimary} />
                          <Text style={[styles.projectName, { color: textColor }]} numberOfLines={2}>
                            {p.name}
                          </Text>
                          <Pressable
                            onPress={() => removeBoundProject(sg.id, p.id)}
                            hitSlop={8}
                            style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.65 : 1 }]}
                          >
                            <MaterialIcons name="close" size={20} color={outline} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => openProjectPicker(sg)}
                    style={({ pressed }) => [
                      styles.bindBtn,
                      { borderColor: 'rgba(194,198,214,0.55)', opacity: pressed ? 0.88 : 1 },
                    ]}
                  >
                    <MaterialIcons name="add-link" size={18} color={visionPrimary} />
                    <Text style={{ color: textColor, fontSize: 13, fontWeight: '700' }}>
                      {bound.length > 0 ? '管理绑定项目' : '绑定项目'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* 添加 / 编辑小目标（仅名称与简介） */}
      <Modal visible={formModalVisible} animationType="fade" transparent onRequestClose={closeFormModal}>
        <View style={styles.formModalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeFormModal} />
          <View style={[styles.formCard, { backgroundColor: modalSheetBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>
              {editingId ? '编辑小目标' : '添加小目标'}
            </Text>
            <View style={{ gap: 6 }}>
              <Text style={[styles.fieldLabel, { color: outline }]}>名称</Text>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                placeholder="输入小目标名称..."
                placeholderTextColor={placeholderColor}
                autoFocus
                style={[
                  styles.input,
                  {
                    color: textColor,
                    backgroundColor: isDark ? 'rgba(15,23,42,0.35)' : 'rgba(234,237,255,0.9)',
                  },
                ]}
              />
            </View>
            <View style={{ gap: 6, marginTop: 12 }}>
              <Text style={[styles.fieldLabel, { color: outline }]}>简介</Text>
              <TextInput
                value={draftDesc}
                onChangeText={setDraftDesc}
                placeholder="可选：补充说明..."
                placeholderTextColor={placeholderColor}
                multiline
                style={[
                  styles.input,
                  styles.descInput,
                  {
                    color: textColor,
                    backgroundColor: isDark ? 'rgba(15,23,42,0.35)' : 'rgba(234,237,255,0.9)',
                  },
                ]}
              />
            </View>
            <View style={styles.formActions}>
              <Pressable
                onPress={closeFormModal}
                style={[styles.formBtnGhost, { borderColor: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(194,198,214,0.65)' }]}
              >
                <Text style={[styles.formBtnGhostText, { color: outline }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={confirmFormModal}
                style={[styles.formBtnPrimary, { backgroundColor: visionPrimary }]}
              >
                <Text style={styles.formBtnPrimaryText}>{editingId ? '保存' : '添加'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 绑定多个项目 */}
      <Modal visible={projectPickerVisible} animationType="slide" transparent onRequestClose={closeProjectPicker}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeProjectPicker} />
          <View style={[styles.modalSheet, { backgroundColor: modalSheetBg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: textColor }]}>绑定项目（可多选）</Text>
              <Pressable onPress={closeProjectPicker} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                <MaterialIcons name="close" size={22} color={outline} />
              </Pressable>
            </View>
            {projectListLoading ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={visionPrimary} />
              </View>
            ) : projectRows.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: outline }]}>
                暂无项目，请先在任务中创建项目后再绑定。
              </Text>
            ) : (
              <>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  style={styles.modalList}
                  showsVerticalScrollIndicator={false}
                >
                  {projectRows.map(p => {
                    const selected = pickerSelected.some(x => x.id === p.id);
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => togglePickerProject(p)}
                        style={({ pressed }) => [
                          styles.modalRow,
                          {
                            borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)',
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}
                      >
                        <MaterialIcons name="folder" size={22} color={visionPrimary} />
                        <Text style={[styles.modalRowTitle, { color: textColor }]} numberOfLines={2}>
                          {p.name}
                        </Text>
                        {selected ? (
                          <MaterialIcons name="check-circle" size={22} color={visionPrimary} />
                        ) : (
                          <MaterialIcons name="radio-button-unchecked" size={22} color={outline} />
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable
                  onPress={confirmProjectPicker}
                  style={({ pressed }) => [
                    styles.confirmPickerBtn,
                    { backgroundColor: visionPrimary, opacity: pressed ? 0.9 : 1 },
                  ]}
                >
                  <Text style={styles.confirmPickerBtnText}>
                    确定{pickerSelected.length > 0 ? `（已选 ${pickerSelected.length} 个）` : ''}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
  },
  addIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 26,
    paddingHorizontal: 14,
    gap: 10,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardIndex: {
    fontSize: 13,
    fontWeight: '800',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
  },
  descInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
  },
  projectName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  bindBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  formModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  formCard: {
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  formActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  formBtnGhost: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  formBtnGhostText: {
    fontSize: 15,
    fontWeight: '700',
  },
  formBtnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  formBtnPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  modalSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  modalLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  modalEmpty: {
    paddingHorizontal: 18,
    paddingVertical: 24,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalList: {
    maxHeight: 360,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  confirmPickerBtn: {
    marginHorizontal: 18,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmPickerBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});
