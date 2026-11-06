/**
 * 习惯「AI 填入」：一句话解析后回填表单字段，确认仍走保存。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskParseHabitJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { parseTaskHabit } from '@/lib/zhipu-image-parse';
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

export type AiParseHabitSheetProps = {
  visible: boolean;
  onClose: () => void;
  onApply: (draft: TaskParseHabitJson) => void;
};

export function AiParseHabitSheet({ visible, onClose, onApply }: AiParseHabitSheetProps) {
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
      toast.info('请输入一句话，如「每天晨跑 30 分钟」');
      return;
    }
    setBusy(true);
    try {
      const r = await parseTaskHabit({
        text: t,
        todayYmd: getLogicalLocalYmd(new Date(), getDayBoundarySync()),
      });
      if (!r.ok) {
        toast.error(r.error || 'AI 解析失败');
        return;
      }
      onApply(r.data);
      onClose();
      toast.success(r.data.rationale_zh || '已填入，请确认后保存');
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 解析失败'));
    } finally {
      setBusy(false);
    }
  }, [onApply, onClose, text]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={[styles.title, { fontFamily: fonts.serif }]}>AI 填入习惯</Text>
          <Text style={styles.sub}>解析名称 / 类型 / 日目标 / 提醒草稿，确认后仍点保存</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="例：每天晨跑 30 分钟，连续 21 天奖励"
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
