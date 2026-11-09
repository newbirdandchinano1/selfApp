/**
 * 道路节点「生成验收」：增量验收草稿 → 勾选合并进编辑态（不自动标 done）。
 */
import { useLifeRoadTheme } from '@/constants/life-road-theme';
import type { LifeRoadPlanAcceptanceItemJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  createAcceptanceItem,
  LIFE_ROAD_ACCEPTANCE_MAX_ITEMS,
  type LifeRoadAcceptanceItem,
} from '@/lib/life-road/life-road-acceptance';
import { draftLifeRoadAcceptance } from '@/lib/zhipu-image-parse';
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

export type AiLifeRoadAcceptanceSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  note?: string;
  kind?: string;
  existingAcceptance: string[];
  directionBody?: string;
  /** 将勾选的增量项合并进编辑态验收列表 */
  onApply: (items: LifeRoadAcceptanceItem[]) => void;
  currentCount: number;
};

export function AiLifeRoadAcceptanceSheet({
  visible,
  onClose,
  title,
  note,
  kind,
  existingAcceptance,
  directionBody,
  onApply,
  currentCount,
}: AiLifeRoadAcceptanceSheetProps) {
  const insets = useSafeAreaInsets();
  const { lr } = useLifeRoadTheme();
  const styles = useMemo(() => createStyles(lr.pine), [lr.pine]);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LifeRoadPlanAcceptanceItemJson[]>([]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setItems([]);
      setSelected(new Set());
      setFetched(false);
      setLoading(false);
    }
  }, [visible]);

  const run = useCallback(async () => {
    if (!title.trim()) {
      toast.info('请先填写节点标题');
      return;
    }
    setLoading(true);
    try {
      const r = await draftLifeRoadAcceptance({
        title,
        note,
        kind,
        existingAcceptance,
        directionBody,
      });
      if (!r.ok) {
        toast.error(r.error || '生成验收失败');
        return;
      }
      setItems(r.data.acceptance_items);
      setSelected(new Set(r.data.acceptance_items.map((_, i) => i)));
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, '生成验收失败'));
    } finally {
      setLoading(false);
    }
  }, [directionBody, existingAcceptance, kind, note, title]);

  useEffect(() => {
    if (visible && !fetched && !loading && title.trim()) {
      void run();
    }
  }, [visible, fetched, loading, title, run]);

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleApply = () => {
    const room = Math.max(0, LIFE_ROAD_ACCEPTANCE_MAX_ITEMS - currentCount);
    if (room <= 0) {
      toast.info(`验收已满 ${LIFE_ROAD_ACCEPTANCE_MAX_ITEMS} 条`);
      return;
    }
    const chosen = items.filter((_, i) => selected.has(i)).slice(0, room);
    if (!chosen.length) {
      toast.info('请至少勾选一条');
      return;
    }
    onApply(chosen.map(a => createAcceptanceItem(a.text)));
    toast.success(`已加入 ${chosen.length} 条，记得保存`);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>生成验收</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>基于标题与梗概 · 增量草稿 · 勾选合并</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={lr.pine} />
                <Text style={styles.loadingText}>正在生成…</Text>
              </View>
            ) : null}
            {!loading &&
              items.map((it, i) => {
                const on = selected.has(i);
                return (
                  <Pressable
                    key={`${i}-${it.text}`}
                    style={[styles.row, on && styles.rowOn]}
                    onPress={() => toggle(i)}>
                    <Text style={styles.check}>{on ? '✓' : '○'}</Text>
                    <Text style={styles.rowText}>{it.text}</Text>
                  </Pressable>
                );
              })}
            {!loading && fetched && items.length === 0 ? (
              <Text style={styles.empty}>没有新的验收建议（可能已覆盖现有项）</Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.ghostBtn} disabled={loading} onPress={() => void run()}>
              <Text style={styles.ghostText}>{fetched ? '重新生成' : '生成'}</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (loading || !items.length) && styles.btnDisabled]}
              disabled={loading || !items.length}
              onPress={handleApply}>
              <Text style={styles.primaryText}>合并进验收</Text>
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
    rowText: { flex: 1, fontSize: 14, color: '#2F3B32', lineHeight: 20 },
    empty: { fontSize: 13, color: '#8A968C', textAlign: 'center', paddingVertical: 24 },
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
