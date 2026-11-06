/**
 * 备忘 P2 AI Sheet：关联项目/待办建议。
 * 确认后由页面写 linked_task_id 或跳转；Agent 不写库。
 */
import { useMemoCenterSheetClose } from '@/components/memo/memo-center-sheet';
import { AppButton, MotionPressable } from '@/components/ui';
import { MemoText } from '@/constants/memo-ui';
import type { MemoLinkSuggestJson } from '@/lib/ai-types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

type CommonColors = { ink: string; muted: string; secondary: string; primary: string };

function SheetHead({ title, ink, muted }: { title: string; ink: string; muted: string }) {
  const requestClose = useMemoCenterSheetClose();
  return (
    <View style={styles.head}>
      <Text style={[styles.title, { color: ink }]} numberOfLines={2}>
        {title}
      </Text>
      <MotionPressable onPress={() => requestClose()} hitSlop={10} accessibilityLabel="关闭">
        <MaterialIcons name="close" size={22} color={muted} />
      </MotionPressable>
    </View>
  );
}

export function MemoAiLinkSuggestBody({
  colors,
  loading,
  error,
  suggestion,
  projects,
  todos,
  selectedProjectId,
  selectedTaskId,
  onSelectProject,
  onSelectTask,
  onRetry,
  onConfirmLinkTask,
  onOpenProject,
  onCreateTodoDraft,
}: {
  colors: CommonColors;
  loading: boolean;
  error: string | null;
  suggestion: MemoLinkSuggestJson | null;
  projects: { id: string; name: string }[];
  todos: { id: string; title: string }[];
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  onSelectProject: (id: string | null) => void;
  onSelectTask: (id: string | null) => void;
  onRetry: () => void;
  onConfirmLinkTask: (taskId: string) => void;
  onOpenProject: (projectId: string) => void;
  onCreateTodoDraft: (draft: { title: string; note: string }) => void;
}) {
  const { ink, muted, secondary, primary } = colors;
  const projectName = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const todoTitle = useMemo(() => new Map(todos.map(t => [t.id, t.title])), [todos]);

  if (loading) {
    return (
      <View style={styles.centerBlock}>
        <ActivityIndicator color={primary} />
        <Text style={[styles.hint, { color: muted }]}>正在匹配开放项目 / 待办…</Text>
      </View>
    );
  }

  if (error || !suggestion) {
    return (
      <>
        <SheetHead title="关联到…" ink={ink} muted={muted} />
        <Text style={[styles.body, { color: secondary }]}>{error || '暂无建议'}</Text>
        <AppButton label="重试" onPress={onRetry} style={styles.btn} />
      </>
    );
  }

  const projectIds = suggestion.project_ids.filter(id => projectName.has(id));
  const taskIds = suggestion.task_ids.filter(id => todoTitle.has(id));
  const draft = suggestion.create_todo_draft;

  return (
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
      <SheetHead title="关联建议" ink={ink} muted={muted} />
      <Text style={[styles.hint, { color: muted }]}>
        仅推荐请求内已有条目；确认后写入关联或跳转，不会自动删备忘。
      </Text>

      {projectIds.length === 0 && taskIds.length === 0 && !draft ? (
        <Text style={[styles.body, { color: secondary }]}>未匹配到合适的项目或待办。</Text>
      ) : null}

      {projectIds.length > 0 ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>相关项目</Text>
          {projectIds.map(id => {
            const on = selectedProjectId === id;
            return (
              <MotionPressable
                key={id}
                onPress={() => onSelectProject(on ? null : id)}
                style={[
                  styles.row,
                  { borderColor: on ? primary : muted, backgroundColor: on ? `${primary}14` : 'transparent' },
                ]}>
                <Text style={[styles.body, { color: on ? primary : ink, flex: 1 }]}>
                  {projectName.get(id) ?? id}
                </Text>
                {suggestion.reasons[id] ? (
                  <Text style={[styles.hint, { color: muted, flex: 1 }]} numberOfLines={2}>
                    {suggestion.reasons[id]}
                  </Text>
                ) : null}
              </MotionPressable>
            );
          })}
          <AppButton
            label="查看所选项目"
            disabled={!selectedProjectId}
            onPress={() => selectedProjectId && onOpenProject(selectedProjectId)}
            style={styles.btn}
          />
        </>
      ) : null}

      {taskIds.length > 0 ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>相关待办</Text>
          {taskIds.map(id => {
            const on = selectedTaskId === id;
            return (
              <MotionPressable
                key={id}
                onPress={() => onSelectTask(on ? null : id)}
                style={[
                  styles.row,
                  { borderColor: on ? primary : muted, backgroundColor: on ? `${primary}14` : 'transparent' },
                ]}>
                <Text style={[styles.body, { color: on ? primary : ink, flex: 1 }]}>
                  {todoTitle.get(id) ?? id}
                </Text>
                {suggestion.reasons[id] ? (
                  <Text style={[styles.hint, { color: muted, flex: 1 }]} numberOfLines={2}>
                    {suggestion.reasons[id]}
                  </Text>
                ) : null}
              </MotionPressable>
            );
          })}
          <AppButton
            label="关联所选待办"
            disabled={!selectedTaskId}
            onPress={() => selectedTaskId && onConfirmLinkTask(selectedTaskId)}
            style={styles.btn}
          />
        </>
      ) : null}

      {draft ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>也可新建待办并关联</Text>
          <Text style={[styles.body, { color: ink }]}>{draft.title}</Text>
          {draft.note ? (
            <Text style={[styles.hint, { color: muted }]} numberOfLines={4}>
              {draft.note}
            </Text>
          ) : null}
          <AppButton
            label="新建待办并关联（保留备忘）"
            onPress={() => onCreateTodoDraft(draft)}
            style={styles.btn}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  title: { flex: 1, ...MemoText.listTitle },
  kicker: { ...MemoText.caption, marginTop: 12, marginBottom: 6, fontWeight: '700' },
  body: { ...MemoText.body, lineHeight: 22 },
  hint: { ...MemoText.caption, marginBottom: 8, lineHeight: 18 },
  btn: { marginTop: 12 },
  centerBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 10 },
  scroll: { maxHeight: 480 },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 4,
  },
});
