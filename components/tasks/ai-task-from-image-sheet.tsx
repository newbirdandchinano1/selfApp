/**
 * 拍照 / 相册识图 → 多条独立待办草稿；勾选确认后批量 createTask。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskParseFromImageItemJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { createTask } from '@/lib/repositories/tasks/task';
import { requestPush } from '@/lib/sync-manager';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { parseTaskFromImage } from '@/lib/zhipu-image-parse';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type AiTaskFromImageSheetProps = {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

export function AiTaskFromImageSheet({ visible, onClose, onCreated }: AiTaskFromImageSheetProps) {
  const insets = useSafeAreaInsets();
  const { tf, fonts } = useTaskFoldTheme();
  const styles = useMemo(() => createStyles(tf.frog), [tf.frog]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplement, setSupplement] = useState('');
  const [items, setItems] = useState<TaskParseFromImageItemJson[]>([]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (!visible) {
      setLoading(false);
      setSaving(false);
      setSupplement('');
      setItems([]);
      setSelected(new Set());
    }
  }, [visible]);

  const runParse = useCallback(
    async (source: 'camera' | 'library') => {
      try {
        if (source === 'camera') {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            toast.info('需要相机权限才能拍照');
            return;
          }
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            toast.info('需要相册权限才能选图');
            return;
          }
        }
        const picked =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.75,
                base64: true,
              })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.75,
                base64: true,
              });
        if (picked.canceled || !picked.assets?.[0]?.base64) {
          if (!picked.canceled) toast.error('无法读取图片数据');
          return;
        }

        setLoading(true);
        const asset = picked.assets[0];
        const mime = asset.mimeType?.trim() || 'image/jpeg';
        const dataUri = `data:${mime};base64,${asset.base64}`;
        const r = await parseTaskFromImage({
          imageDataUri: dataUri,
          supplementText: supplement.trim() || undefined,
          todayYmd: getLogicalLocalYmd(new Date(), getDayBoundarySync()),
        });
        if (!r.ok) {
          toast.error(r.error || '识图失败');
          return;
        }
        setItems(r.data.items);
        setSelected(new Set(r.data.items.map((_, i) => i)));
        toast.success(`识别到 ${r.data.items.length} 条`);
      } catch (e) {
        toast.error(toUserMessage(e, '识图失败'));
      } finally {
        setLoading(false);
      }
    },
    [supplement],
  );

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleConfirm = async () => {
    const chosen = items.filter((_, i) => selected.has(i));
    if (!chosen.length) {
      toast.info('请至少勾选一条');
      return;
    }
    setSaving(true);
    try {
      for (const item of chosen) {
        const id = makeTimestampEntityId('tsk_', 8);
        const due = item.due_ymd?.trim() || null;
        await createTask({
          id,
          title: item.title.slice(0, 50),
          note: item.note ?? null,
          status: 'todo',
          priority: item.priority ?? 0,
          due_date: due,
          project_id: null,
          parent_task_id: null,
        });
      }
      await markPendingTablesDirty(['tasks']);
      void requestPush();
      toast.success(`已创建 ${chosen.length} 条独立待办`);
      onCreated?.();
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '创建失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[styles.title, { fontFamily: fonts.serif }]}>拍照建待办</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>白板 / 便签 / 截图 → 勾选后批量建独立待办</Text>

          <TextInput
            value={supplement}
            onChangeText={setSupplement}
            placeholder="补充说明（可选）"
            placeholderTextColor="#A8B0A6"
            style={styles.input}
            editable={!loading && !saving}
          />

          <View style={styles.pickRow}>
            <Pressable
              style={[styles.pickBtn, loading && styles.btnDisabled]}
              disabled={loading || saving}
              onPress={() => void runParse('camera')}>
              <Text style={styles.pickText}>拍照</Text>
            </Pressable>
            <Pressable
              style={[styles.pickBtn, loading && styles.btnDisabled]}
              disabled={loading || saving}
              onPress={() => void runParse('library')}>
              <Text style={styles.pickText}>相册</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={tf.frog} />
                <Text style={styles.loadingText}>正在识别…</Text>
              </View>
            ) : null}
            {!loading &&
              items.map((item, i) => {
                const on = selected.has(i);
                return (
                  <Pressable
                    key={`${i}-${item.title}`}
                    style={[styles.row, on && styles.rowOn]}
                    onPress={() => toggle(i)}>
                    <Text style={styles.check}>{on ? '✓' : '○'}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowText} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {item.due_ymd || item.note ? (
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {[item.due_ymd, item.note].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
          </ScrollView>

          <Pressable
            style={[styles.primaryBtn, (loading || saving || !items.length) && styles.btnDisabled]}
            disabled={loading || saving || !items.length}
            onPress={() => void handleConfirm()}>
            <Text style={styles.primaryText}>
              {saving ? '创建中…' : `确认创建（${selected.size}）`}
            </Text>
          </Pressable>
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
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: '#2F3B32',
      backgroundColor: '#FFF',
      marginBottom: 10,
    },
    pickRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
    pickBtn: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accent,
      alignItems: 'center',
      backgroundColor: '#F4F8F2',
    },
    pickText: { fontSize: 14, fontWeight: '700', color: accent },
    body: { flexGrow: 0, maxHeight: 320 },
    bodyContent: { paddingBottom: 12, gap: 8 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
    },
    rowOn: { borderColor: accent, backgroundColor: '#F4F8F2' },
    check: { width: 18, textAlign: 'center', color: accent, fontWeight: '800' },
    rowText: { fontSize: 14, color: '#2F3B32', fontWeight: '600' },
    rowMeta: { fontSize: 11, color: '#8A968C', marginTop: 2 },
    primaryBtn: {
      marginTop: 8,
      paddingVertical: 13,
      borderRadius: 10,
      backgroundColor: accent,
      alignItems: 'center',
    },
    primaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    btnDisabled: { opacity: 0.55 },
  });
}
