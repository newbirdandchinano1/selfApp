import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  countWishBoardRedeemConditions,
  emptyWishBoardRedeemConditions,
  isProjectBoundTask,
  isProjectRedeemConditionMet,
  isTaskRedeemConditionMet,
  isTodoBoundTask,
  type WishBoardRedeemConditions,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
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

type BindKind = 'project' | 'task' | 'todo';

type WishBoardRedeemConditionsFieldProps = {
  value: WishBoardRedeemConditions;
  onChange: (next: WishBoardRedeemConditions) => void;
  projects: ProjectRow[];
  tasks: TaskRow[];
  loading?: boolean;
  disabled?: boolean;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
  isDark: boolean;
};

const KIND_META: Record<
  BindKind,
  { title: string; icon: keyof typeof MaterialIcons.glyphMap; empty: string; hint: string }
> = {
  project: {
    title: '绑定项目',
    icon: 'folder',
    empty: '未绑定项目',
    hint: '所选项目须全部执行完毕',
  },
  task: {
    title: '绑定任务',
    icon: 'checklist',
    empty: '未绑定任务',
    hint: '所选项目任务须全部完成',
  },
  todo: {
    title: '绑定待办',
    icon: 'event-note',
    empty: '未绑定待办',
    hint: '所选独立待办须全部完成',
  },
};

function summaryForIds(
  ids: string[],
  nameById: Map<string, string>,
  emptyLabel: string,
  unknownLabel: string,
): string {
  if (ids.length === 0) return emptyLabel;
  const names = ids.map(id => nameById.get(id)?.trim() || unknownLabel);
  if (names.length <= 2) return names.join('、');
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 个`;
}

function BindRow({
  kind,
  selectedIds,
  summary,
  loading,
  disabled,
  onPress,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
}: {
  kind: BindKind;
  selectedIds: string[];
  summary: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
}) {
  const meta = KIND_META[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.select,
        { backgroundColor: surfaceLow, borderColor: placeholderColor },
        (disabled || loading) && { opacity: 0.65 },
        pressed && !disabled && !loading && { opacity: 0.8 },
      ]}>
      <View style={styles.selectLeft}>
        <MaterialIcons name={meta.icon} size={18} color={primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.selectLabel, { color: outline }]}>{meta.title}</Text>
          <Text style={[styles.selectValue, { color: textColor }]} numberOfLines={2}>
            {loading ? '加载中…' : summary}
          </Text>
          <Text style={[styles.selectHint, { color: outline }]} numberOfLines={1}>
            {selectedIds.length > 0 ? meta.hint : '可选多个；与积分同时作为兑换条件'}
          </Text>
        </View>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={primary} />
      ) : (
        <MaterialIcons name="expand-more" size={20} color={outline} />
      )}
    </Pressable>
  );
}

export function WishBoardRedeemConditionsField({
  value,
  onChange,
  projects,
  tasks,
  loading = false,
  disabled = false,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
  isDark,
}: WishBoardRedeemConditionsFieldProps) {
  const [modalKind, setModalKind] = useState<BindKind | null>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  const projectTasks = useMemo(
    () => tasks.filter(t => isProjectBoundTask(t)),
    [tasks],
  );
  const todoTasks = useMemo(() => tasks.filter(t => isTodoBoundTask(t)), [tasks]);

  const projectNameById = useMemo(
    () => new Map(projects.map(p => [p.id, p.name])),
    [projects],
  );
  const taskNameById = useMemo(() => new Map(tasks.map(t => [t.id, t.title])), [tasks]);

  const totalBound = countWishBoardRedeemConditions(value);

  const openModal = useCallback(
    (kind: BindKind) => {
      if (disabled) return;
      const ids =
        kind === 'project'
          ? value.project_ids
          : kind === 'task'
            ? value.task_ids
            : value.todo_ids;
      setDraftIds(ids);
      setModalKind(kind);
    },
    [disabled, value.project_ids, value.task_ids, value.todo_ids],
  );

  const closeModal = useCallback(() => {
    setModalKind(null);
    setDraftIds([]);
  }, []);

  const toggleDraft = useCallback((id: string) => {
    setDraftIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }, []);

  const confirmModal = useCallback(() => {
    if (!modalKind) return;
    const next: WishBoardRedeemConditions = { ...value };
    if (modalKind === 'project') next.project_ids = draftIds;
    else if (modalKind === 'task') next.task_ids = draftIds;
    else next.todo_ids = draftIds;
    onChange(next);
    closeModal();
  }, [closeModal, draftIds, modalKind, onChange, value]);

  const clearAll = useCallback(() => {
    onChange(emptyWishBoardRedeemConditions());
  }, [onChange]);

  const modalOptions = useMemo(() => {
    if (modalKind === 'project') {
      return projects.map(p => ({
        id: p.id,
        title: p.name,
        subtitle: isProjectRedeemConditionMet(p) ? '已完成' : '进行中',
        icon: 'folder' as const,
      }));
    }
    if (modalKind === 'task') {
      return projectTasks.map(t => ({
        id: t.id,
        title: t.title,
        subtitle: isTaskRedeemConditionMet(t) ? '已完成' : '未完成',
        icon: 'checklist' as const,
      }));
    }
    if (modalKind === 'todo') {
      return todoTasks.map(t => ({
        id: t.id,
        title: t.title,
        subtitle: isTaskRedeemConditionMet(t) ? '已完成' : '未完成',
        icon: 'event-note' as const,
      }));
    }
    return [];
  }, [modalKind, projectTasks, projects, todoTasks]);

  const modalTitle = modalKind ? KIND_META[modalKind].title : '';
  const modalDesc = modalKind
    ? '兑换时须与积分条件同时满足；可多选，全部完成后才可兑换。'
    : '';

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>兑换附加条件（可选）</Text>
        {totalBound > 0 && !disabled ? (
          <Pressable onPress={clearAll} hitSlop={8}>
            <Text style={[styles.clearText, { color: primary }]}>清空</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.sectionHint, { color: outline }]}>
        除积分外，还可要求若干项目、任务或待办完成后才能兑换
      </Text>

      <BindRow
        kind="project"
        selectedIds={value.project_ids}
        summary={summaryForIds(value.project_ids, projectNameById, '未绑定项目', '未知项目')}
        loading={loading}
        disabled={disabled}
        onPress={() => openModal('project')}
        textColor={textColor}
        outline={outline}
        placeholderColor={placeholderColor}
        primary={primary}
        surfaceLow={surfaceLow}
      />
      <BindRow
        kind="task"
        selectedIds={value.task_ids}
        summary={summaryForIds(value.task_ids, taskNameById, '未绑定任务', '未知任务')}
        loading={loading}
        disabled={disabled}
        onPress={() => openModal('task')}
        textColor={textColor}
        outline={outline}
        placeholderColor={placeholderColor}
        primary={primary}
        surfaceLow={surfaceLow}
      />
      <BindRow
        kind="todo"
        selectedIds={value.todo_ids}
        summary={summaryForIds(value.todo_ids, taskNameById, '未绑定待办', '未知待办')}
        loading={loading}
        disabled={disabled}
        onPress={() => openModal('todo')}
        textColor={textColor}
        outline={outline}
        placeholderColor={placeholderColor}
        primary={primary}
        surfaceLow={surfaceLow}
      />

      <Modal transparent visible={modalKind != null} animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.modalOverlay} onPress={closeModal}>
          <Pressable
            onPress={() => {}}
            style={[styles.modalCard, { backgroundColor: surfaceLowest, borderColor: placeholderColor }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: textColor }]}>{modalTitle}</Text>
              <Pressable onPress={closeModal} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                <MaterialIcons name="close" size={22} color={outline} />
              </Pressable>
            </View>
            <Text style={[styles.modalDesc, { color: outline }]}>{modalDesc}</Text>
            {modalOptions.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: outline }]}>暂无可选项</Text>
            ) : (
              <>
                <ScrollView
                  style={styles.modalList}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
                  {modalOptions.map(opt => {
                    const picked = draftIds.includes(opt.id);
                    return (
                      <Pressable
                        key={opt.id}
                        onPress={() => toggleDraft(opt.id)}
                        style={({ pressed }) => [
                          styles.modalRow,
                          {
                            borderBottomColor: isDark
                              ? 'rgba(148,163,184,0.18)'
                              : 'rgba(194,198,214,0.35)',
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}>
                        <MaterialIcons name={opt.icon} size={22} color={primary} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[styles.modalRowTitle, { color: textColor }]} numberOfLines={2}>
                            {opt.title}
                          </Text>
                          <Text style={[styles.modalRowSub, { color: outline }]}>{opt.subtitle}</Text>
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
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    { backgroundColor: primary, opacity: pressed ? 0.9 : 1 },
                  ]}>
                  <Text style={styles.confirmBtnText}>
                    确定{draftIds.length > 0 ? `（已选 ${draftIds.length} 个）` : ''}
                  </Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  sectionHint: { fontSize: 12, fontWeight: '600', lineHeight: 17, marginTop: -4 },
  clearText: { fontSize: 13, fontWeight: '700' },
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
  selectLabel: { fontSize: 11, fontWeight: '700' },
  selectValue: { fontSize: 14, fontWeight: '700' },
  selectHint: { fontSize: 11, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.38)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: { borderWidth: 1, borderRadius: 16, padding: 14, maxHeight: '78%', gap: 8 },
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
