import type { WishBoxPalette, WishBoxShadowSet } from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { WishFormLabel, WishToggleRow } from '@/components/wish-board/wish-board-form-ui';
import { formatSignedMoneyTrunc2 } from '@/lib/finance-net-worth';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  isProjectBoundTask,
  isProjectRedeemConditionMet,
  isTaskRedeemConditionMet,
  isTodoBoundTask,
  normalizeMinNetWorth,
  type WishBoardRedeemConditions,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WishBoxGradientFill } from '@/components/wish-board/wish-box-gradient-fill';

type BindKind = 'project' | 'task' | 'todo';

type Props = {
  value: WishBoardRedeemConditions;
  onChange: (next: WishBoardRedeemConditions) => void;
  projects: ProjectRow[];
  tasks: TaskRow[];
  /** 资产页口径的当前净资产，用于对照提示 */
  currentNetWorth?: number | null;
  loading?: boolean;
  disabled?: boolean;
};

const KIND_TABS: { key: BindKind; label: string; empty: string }[] = [
  { key: 'project', label: '项目', empty: '暂无可绑定的项目' },
  { key: 'task', label: '任务', empty: '暂无可绑定的任务' },
  { key: 'todo', label: '待办', empty: '暂无可绑定的待办' },
];

function countTaskProgress(tasks: TaskRow[], projectId: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (t.project_id !== projectId || t.status === 'cancelled') continue;
    total += 1;
    if (t.status === 'done') done += 1;
  }
  return { done, total };
}

/**
 * 兑换条件：绑定项目/任务/待办 + 最低净资产门槛，各自开关（设计稿 05）。
 * 绑定开启后弹出多选；净资产门槛开启后行内输入。
 */
export function WishBoardRedeemConditionsField({
  value,
  onChange,
  projects,
  tasks,
  currentNetWorth = null,
  loading = false,
  disabled = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { c, gradients } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const [pickerKind, setPickerKind] = useState<BindKind>('project');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [netWorthText, setNetWorthText] = useState(
    value.min_net_worth == null ? '' : String(value.min_net_worth),
  );

  const projectTasks = useMemo(() => tasks.filter(t => isProjectBoundTask(t)), [tasks]);
  const todoTasks = useMemo(() => tasks.filter(t => isTodoBoundTask(t)), [tasks]);
  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const taskNameById = useMemo(() => new Map(tasks.map(t => [t.id, t.title])), [tasks]);

  const boundCount =
    value.project_ids.length + value.task_ids.length + value.todo_ids.length;
  const bindingOn = boundCount > 0;
  const netWorthOn = value.min_net_worth != null;

  /** 绑定副标题：单项目时带进度（设计稿「晨间跑步 · 21 天项目（18 / 21）· 更换」） */
  const bindingSubtitle = useMemo(() => {
    if (boundCount === 0) return '未绑定 · 点右侧开关选择';
    const parts: string[] = [];
    for (const id of value.project_ids) {
      const name = projectNameById.get(id)?.trim() || '已删除的项目';
      const { done, total } = countTaskProgress(tasks, id);
      parts.push(total > 0 ? `${name}（${done} / ${total}）` : name);
    }
    for (const id of [...value.task_ids, ...value.todo_ids]) {
      parts.push(taskNameById.get(id)?.trim() || '已删除的任务');
    }
    if (parts.length <= 2) return parts.join('、');
    return `${parts.slice(0, 2).join('、')} 等 ${parts.length} 项`;
  }, [boundCount, projectNameById, taskNameById, tasks, value]);

  const openPicker = useCallback((kind: BindKind, ids: string[]) => {
    setPickerKind(kind);
    setDraftIds(ids);
    setPickerOpen(true);
  }, []);

  const toggleBinding = useCallback(
    (next: boolean) => {
      if (!next) {
        onChange({ ...value, project_ids: [], task_ids: [], todo_ids: [] });
        return;
      }
      openPicker('project', []);
    },
    [onChange, openPicker, value],
  );

  const toggleNetWorth = useCallback(
    (next: boolean) => {
      if (!next) {
        setNetWorthText('');
        onChange({ ...value, min_net_worth: null });
        return;
      }
      // 开启后先带入当前净资产作参考默认值，用户可改
      const rounded =
        currentNetWorth != null && Number.isFinite(currentNetWorth)
          ? Math.round(currentNetWorth)
          : 0;
      setNetWorthText(String(rounded));
      onChange({ ...value, min_net_worth: rounded });
    },
    [currentNetWorth, onChange, value],
  );

  const onNetWorthChange = useCallback(
    (text: string) => {
      setNetWorthText(text);
      const trimmed = text.trim();
      if (!trimmed) {
        if (value.min_net_worth != null) onChange({ ...value, min_net_worth: null });
        return;
      }
      const parsed = normalizeMinNetWorth(trimmed);
      if (parsed != null && parsed !== value.min_net_worth) {
        onChange({ ...value, min_net_worth: parsed });
      }
    },
    [onChange, value],
  );

  const toggleDraft = useCallback((id: string) => {
    setDraftIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }, []);

  const confirmPicker = useCallback(() => {
    const next: WishBoardRedeemConditions = { ...value };
    if (pickerKind === 'project') next.project_ids = draftIds;
    else if (pickerKind === 'task') next.task_ids = draftIds;
    else next.todo_ids = draftIds;
    onChange(next);
    setPickerOpen(false);
  }, [draftIds, onChange, pickerKind, value]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setDraftIds([]);
  }, []);

  const pickerOptions = useMemo(() => {
    // 只展示未完成项；已绑定且已完成的 id 仍保留在 draft 中（确认时不丢）
    if (pickerKind === 'project') {
      return projects
        .filter(p => !isProjectRedeemConditionMet(p))
        .map(p => ({ id: p.id, title: p.name, subtitle: '进行中', icon: 'folder' as const }));
    }
    if (pickerKind === 'task') {
      return projectTasks
        .filter(t => !isTaskRedeemConditionMet(t))
        .map(t => ({ id: t.id, title: t.title, subtitle: '未完成', icon: 'checklist' as const }));
    }
    return todoTasks
      .filter(t => !isTaskRedeemConditionMet(t))
      .map(t => ({ id: t.id, title: t.title, subtitle: '未完成', icon: 'event-note' as const }));
  }, [pickerKind, projectTasks, projects, todoTasks]);

  const pickerEmpty = KIND_TABS.find(k => k.key === pickerKind)?.empty ?? '暂无可选项';

  return (
    <View>
      <WishFormLabel label="兑换条件" hint="可选 · 不满足时不可兑换" />

      <WishToggleRow
        emoji="🔗"
        title="绑定项目 / 任务 / 待办"
        subtitle={loading ? '加载中…' : bindingSubtitle}
        subtitleLink={bindingOn ? '更换' : undefined}
        onPressLink={() => openPicker('project', value.project_ids)}
        on={bindingOn}
        disabled={disabled || loading}
        onToggle={toggleBinding}
      />

      <WishToggleRow
        emoji="💰"
        title="最低净资产门槛"
        subtitle="资产达标后才可兑换"
        on={netWorthOn}
        disabled={disabled}
        onToggle={toggleNetWorth}
      />

      {netWorthOn ? (
        <View style={styles.netWorthRow}>
          <Text style={styles.netWorthLabel}>净资产 ≥</Text>
          <TextInput
            value={netWorthText}
            onChangeText={onNetWorthChange}
            editable={!disabled}
            placeholder="输入门槛金额"
            placeholderTextColor={c.muted}
            keyboardType="decimal-pad"
            style={styles.netWorthInput}
          />
          <Text style={styles.netWorthCurrent}>
            {currentNetWorth != null && Number.isFinite(currentNetWorth)
              ? `当前 ${formatSignedMoneyTrunc2(currentNetWorth)}`
              : '未知'}
          </Text>
        </View>
      ) : null}

      <Modal
        transparent
        visible={pickerOpen}
        animationType="slide"
        onRequestClose={closePicker}>
        <View style={styles.pickerRoot}>
          <Pressable style={styles.pickerOverlay} onPress={closePicker} accessibilityLabel="关闭" />
          <View style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.handle} />
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>绑定项目 / 任务 / 待办</Text>
              <Pressable onPress={closePicker} hitSlop={10} accessibilityLabel="关闭">
                <MaterialIcons name="close" size={21} color={c.ink2} />
              </Pressable>
            </View>
            <Text style={styles.pickerHint}>可多选；全部完成后才能兑换该心愿</Text>

            <View style={styles.tabs}>
              {KIND_TABS.map(tab => {
                const selected = tab.key === pickerKind;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setPickerKind(tab.key)}
                    style={[styles.tab, selected ? styles.tabOn : styles.tabOff]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}>
                    <Text style={[styles.tabText, selected && styles.tabTextOn]}>{tab.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {pickerOptions.length === 0 ? (
              <Text style={styles.pickerEmpty}>{pickerEmpty}</Text>
            ) : (
              <ScrollView
                style={styles.pickerList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                {pickerOptions.map(opt => {
                  const picked = draftIds.includes(opt.id);
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => toggleDraft(opt.id)}
                      style={({ pressed }) => [styles.optRow, { opacity: pressed ? 0.7 : 1 }]}>
                      <MaterialIcons name={opt.icon} size={20} color={c.pri} />
                      <View style={styles.optBody}>
                        <Text style={styles.optTitle} numberOfLines={2}>
                          {opt.title}
                        </Text>
                        <Text style={styles.optSub}>{opt.subtitle}</Text>
                      </View>
                      {picked ? (
                        <MaterialIcons name="check-circle" size={21} color={c.pri} />
                      ) : (
                        <MaterialIcons
                          name="radio-button-unchecked"
                          size={21}
                          color={c.muted}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <Pressable
              onPress={confirmPicker}
              style={({ pressed }) => [styles.confirmBtn, { opacity: pressed ? 0.9 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="确定">
              <WishBoxGradientFill colors={gradients.primary} radius={17} />
              <Text style={styles.confirmText}>
                确定{draftIds.length > 0 ? `（已选 ${draftIds.length} 个）` : ''}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  netWorthRow: {    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    borderRadius: 16,
  },
  netWorthLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: c.ink2,
  },
  netWorthInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14.5,
    fontWeight: '800',
    color: c.ink,
    paddingVertical: 2,
  },
  netWorthCurrent: {
    fontSize: 10.5,
    fontWeight: '600',
    color: c.muted,
  },
  pickerRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.overlay,
  },
  pickerSheet: {
    backgroundColor: c.sheet,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 99,
    backgroundColor: c.handle,
    alignSelf: 'center',
    marginBottom: 14,
  },
  pickerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: c.ink,
  },
  pickerHint: {
    fontSize: 12,
    color: c.muted,
    marginTop: 4,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  tabOn: {
    backgroundColor: c.ink,
    borderColor: c.ink,
  },
  tabOff: {
    backgroundColor: c.card,
    borderColor: c.line,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '800',
    color: c.muted,
  },
  tabTextOn: {
    color: c.onInk,
  },
  pickerList: {
    marginTop: 10,
    maxHeight: 340,
  },
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.divider,
  },
  optBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.ink,
  },
  optSub: {
    fontSize: 11,
    fontWeight: '600',
    color: c.muted,
  },
  pickerEmpty: {
    fontSize: 13,
    fontWeight: '600',
    color: c.muted,
    paddingVertical: 28,
    textAlign: 'center',
  },
  confirmBtn: {
    marginTop: 14,
    height: 50,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  });
}
