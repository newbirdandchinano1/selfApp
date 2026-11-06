/**
 * 列表自然语言筛选：映射到 TaskListFilterState，只改本地筛选。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskParseFilterJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import {
  EMPTY_TASK_LIST_FILTER,
  type TaskDatePreset,
  type TaskEntityScopeFilter,
  type TaskListFilterState,
  type TaskLongTermFilter,
} from '@/lib/task-list-filter';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { parseTaskFilter } from '@/lib/zhipu-image-parse';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type AiParseFilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  tags: TagRow[];
  onApply: (next: TaskListFilterState) => void;
};

function mapToFilterState(
  data: TaskParseFilterJson,
  tags: TagRow[],
): TaskListFilterState {
  const nameToId = new Map(
    tags.map(t => [t.name.trim().toLowerCase(), t.id] as const).filter(([n]) => !!n),
  );
  const tagIds: string[] = [];
  for (const hint of data.tag_hints ?? []) {
    const id = nameToId.get(hint.trim().toLowerCase());
    if (id && !tagIds.includes(id)) tagIds.push(id);
  }
  const datePreset =
    data.date_preset && ['today', 'tomorrow', 'week', 'month', 'year'].includes(data.date_preset)
      ? (data.date_preset as TaskDatePreset)
      : null;
  const longTerm = (['all', 'yes', 'no'].includes(data.long_term)
    ? data.long_term
    : 'all') as TaskLongTermFilter;
  const entityScope = (['all', 'project', 'task'].includes(data.entity_scope)
    ? data.entity_scope
    : 'all') as TaskEntityScopeFilter;
  const priorities = (data.priorities ?? []).filter(p => p >= 1 && p <= 4);
  return {
    ...EMPTY_TASK_LIST_FILTER,
    search: (data.search ?? '').trim(),
    datePreset,
    tagIds,
    priorities,
    longTerm,
    entityScope,
  };
}

export function AiParseFilterSheet({ visible, onClose, tags, onApply }: AiParseFilterSheetProps) {
  const insets = useSafeAreaInsets();
  const { tf, fonts } = useTaskFoldTheme();
  const styles = useMemo(() => createStyles(tf.frog), [tf.frog]);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      setText('');
      setBusy(false);
    }
  }, [visible]);

  const run = useCallback(async () => {
    const t = text.trim();
    if (!t) {
      toast.info('请输入筛选描述，如「本周逾期的重要任务」');
      return;
    }
    setBusy(true);
    try {
      const r = await parseTaskFilter({
        text: t,
        todayYmd: getLogicalLocalYmd(new Date(), getDayBoundarySync()),
        tagNames: tags.map(tag => tag.name).filter(Boolean),
      });
      if (!r.ok) {
        toast.error(r.error || '无法解析，请手选筛选');
        return;
      }
      onApply(mapToFilterState(r.data, tags));
      onClose();
      toast.success('已应用 AI 筛选');
    } catch (e) {
      toast.error(toUserMessage(e, '筛选解析失败'));
    } finally {
      setBusy(false);
    }
  }, [onApply, onClose, tags, text]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={[styles.title, { fontFamily: fonts.serif }]}>AI 筛选</Text>
          <Text style={styles.sub}>一句话映射到现有筛选；筛不出请手选</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="例：找本周逾期的重要任务"
            placeholderTextColor="#A8B0A6"
            multiline
            style={styles.input}
            editable={!busy}
          />
          <View style={styles.footer}>
            <Pressable style={styles.ghostBtn} disabled={busy} onPress={onClose}>
              <Text style={styles.ghostText}>取消</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => void run()}>
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryText}>解析并应用</Text>
              )}
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
      backgroundColor: '#FFFCF5',
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 16,
      paddingTop: 16,
      gap: 10,
    },
    title: { fontSize: 18, fontWeight: '800', color: '#2F3B32' },
    sub: { fontSize: 12, color: '#8A968C', marginBottom: 4 },
    input: {
      minHeight: 88,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      borderRadius: 12,
      padding: 12,
      fontSize: 15,
      color: '#2F3B32',
      textAlignVertical: 'top',
      backgroundColor: '#FFF',
    },
    footer: { flexDirection: 'row', gap: 10, paddingTop: 4 },
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
      justifyContent: 'center',
      minHeight: 44,
    },
    primaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    btnDisabled: { opacity: 0.55 },
  });
}
