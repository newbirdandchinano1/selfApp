/**
 * 日程选择器「一句话改」：解析后回填本地 state，确认仍走选择器完成按钮。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskAiScheduleDraft, TaskParseScheduleJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { parseTaskSchedule } from '@/lib/zhipu-image-parse';
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

export type AiParseScheduleSheetProps = {
  visible: boolean;
  onClose: () => void;
  currentDueYmd?: string | null;
  currentSchedule?: TaskAiScheduleDraft | Record<string, unknown> | null;
  onApply: (draft: TaskParseScheduleJson) => void;
};

export function AiParseScheduleSheet({
  visible,
  onClose,
  currentDueYmd,
  currentSchedule,
  onApply,
}: AiParseScheduleSheetProps) {
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
      toast.info('请输入一句话，如「改到下周五提前一天提醒」');
      return;
    }
    setBusy(true);
    try {
      const r = await parseTaskSchedule({
        text: t,
        todayYmd: getLogicalLocalYmd(new Date(), getDayBoundarySync()),
        dueYmd: currentDueYmd ?? undefined,
        schedule: currentSchedule ?? undefined,
      });
      if (!r.ok) {
        toast.error(r.error || '无法解析，请手选');
        return;
      }
      onApply(r.data);
      onClose();
      toast.success('已填入日程，请确认后点完成');
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 解析失败'));
    } finally {
      setBusy(false);
    }
  }, [currentDueYmd, currentSchedule, onApply, onClose, text]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={[styles.title, { fontFamily: fonts.serif }]}>一句话改日程</Text>
          <Text style={styles.sub}>改截止日 / 提醒 / 重复；确认后仍点下方「完成」写入</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="例：改到下周五，提前一天提醒，每周"
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
                <Text style={styles.primaryText}>解析并填入</Text>
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
