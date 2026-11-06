/**
 * 项目「AI 规划」：里程碑树预览 → 确认后批量建顶层任务与子任务。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskPlanProjectJson, TaskPlanProjectMilestoneJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { createTask } from '@/lib/repositories/tasks/task';
import { requestPush } from '@/lib/sync-manager';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { planTaskProject } from '@/lib/zhipu-image-parse';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type AiPlanProjectSheetProps = {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  description?: string | null;
  dueYmd?: string | null;
  existingTopTitles?: string[];
  onCreated?: () => void;
};

export function AiPlanProjectSheet({
  visible,
  onClose,
  projectId,
  projectName,
  description,
  dueYmd,
  existingTopTitles = [],
  onCreated,
}: AiPlanProjectSheetProps) {
  const insets = useSafeAreaInsets();
  const { tf, fonts } = useTaskFoldTheme();
  const styles = useMemo(() => createStyles(tf.frog), [tf.frog]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<TaskPlanProjectJson | null>(null);
  const [fetched, setFetched] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
      setSelected(new Set());
    }
  }, [visible]);

  const run = useCallback(async () => {
    if (!projectName.trim()) {
      toast.info('请先填写项目名称');
      return;
    }
    setLoading(true);
    try {
      const r = await planTaskProject({
        projectName,
        description: description ?? undefined,
        dueYmd: dueYmd ?? undefined,
        existingTopTitles,
        todayYmd: getLogicalLocalYmd(new Date(), getDayBoundarySync()),
      });
      if (!r.ok) {
        toast.error(r.error || '规划失败');
        return;
      }
      setData(r.data);
      setSelected(new Set(r.data.milestones.map((_, i) => i)));
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, '规划失败'));
    } finally {
      setLoading(false);
    }
  }, [description, dueYmd, existingTopTitles, projectName]);

  useEffect(() => {
    if (visible && !fetched && !loading && projectName.trim()) {
      void run();
    }
  }, [visible, fetched, loading, projectName, run]);

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!data || !projectId.trim()) return;
    const chosen = data.milestones.filter((_, i) => selected.has(i));
    if (!chosen.length) {
      toast.info('请至少勾选一个里程碑');
      return;
    }
    setSaving(true);
    try {
      for (const m of chosen) {
        const parentId = makeTimestampEntityId('tsk_', 8);
        await createTask({
          id: parentId,
          project_id: projectId,
          parent_task_id: null,
          title: m.title.slice(0, 50),
          status: 'todo',
          priority: m.priority ?? 0,
        });
        for (const childTitle of m.children_titles ?? []) {
          const t = childTitle.trim().slice(0, 50);
          if (!t) continue;
          await createTask({
            id: makeTimestampEntityId('tsk_', 8),
            project_id: projectId,
            parent_task_id: parentId,
            title: t,
            status: 'todo',
            priority: 0,
          });
        }
      }
      await markPendingTablesDirty(['tasks']);
      void requestPush();
      toast.success(`已创建 ${chosen.length} 个里程碑`);
      onCreated?.();
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '写入失败'));
    } finally {
      setSaving(false);
    }
  };

  const renderMilestone = (m: TaskPlanProjectMilestoneJson, i: number) => {
    const on = selected.has(i);
    return (
      <Pressable
        key={`${i}-${m.title}`}
        style={[styles.row, on && styles.rowOn]}
        onPress={() => toggle(i)}>
        <Text style={styles.check}>{on ? '✓' : '○'}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowText} numberOfLines={2}>
            {m.title}
          </Text>
          {(m.children_titles?.length ?? 0) > 0 ? (
            <Text style={styles.rowMeta} numberOfLines={3}>
              {m.children_titles.map(c => `· ${c}`).join('\n')}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[styles.title, { fontFamily: fonts.serif }]}>AI 规划</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>勾选里程碑后批量建任务树 · 不改项目状态</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={tf.frog} />
                <Text style={styles.loadingText}>正在规划…</Text>
              </View>
            ) : null}
            {!loading && data?.milestones.map(renderMilestone)}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={styles.ghostBtn}
              disabled={loading}
              onPress={() => {
                setFetched(false);
                void run();
              }}>
              <Text style={styles.ghostText}>重新生成</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (loading || saving || !data) && styles.btnDisabled]}
              disabled={loading || saving || !data}
              onPress={() => void handleConfirm()}>
              <Text style={styles.primaryText}>{saving ? '写入中…' : '确认创建'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(20,28,22,0.38)',
    },
    sheet: {
      maxHeight: '88%',
      backgroundColor: '#FFFCF5',
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: '#D8CDBB',
      marginBottom: 10,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    title: { fontSize: 20, fontWeight: '800', color: '#2F3B32' },
    close: { fontSize: 14, color: '#7C897E', fontWeight: '600' },
    sub: { fontSize: 12, color: '#8A968C', marginBottom: 10 },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12, gap: 8 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
    },
    rowOn: { borderColor: accent, backgroundColor: '#F4F8F2' },
    check: { width: 18, textAlign: 'center', color: accent, fontWeight: '800', marginTop: 1 },
    rowText: { fontSize: 14, color: '#2F3B32', fontWeight: '700' },
    rowMeta: { fontSize: 12, color: '#6F856B', marginTop: 4, lineHeight: 18 },
    footer: { flexDirection: 'row', gap: 10, paddingTop: 8 },
    ghostBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#C9D0C6',
      alignItems: 'center',
    },
    ghostText: { fontSize: 14, fontWeight: '700', color: '#536155' },
    primaryBtn: {
      flex: 1.2,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: accent,
      alignItems: 'center',
    },
    primaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    btnDisabled: { opacity: 0.55 },
  });
}
