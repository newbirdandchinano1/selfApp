/**
 * 道路「AI 拆解方向」：年/季/月节点预览 → 确认后批量创建（跳过已占槽位）。
 */
import { useLifeRoadTheme } from '@/constants/life-road-theme';
import type { LifeRoadPlanFromDirectionJson, LifeRoadPlanNodeJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  createAcceptanceItem,
  writeAcceptanceCriteria,
} from '@/lib/life-road/life-road-acceptance';
import {
  LIFE_ROAD_NODE_KIND_LABELS,
  type LifeRoadNodeKind,
} from '@/lib/life-road/life-road-node-model';
import { updateLifeDirection } from '@/lib/repositories/life-road/life-direction';
import {
  createLifeRoadNode,
  getLifeRoadNodesLocal,
} from '@/lib/repositories/life-road/life-road-node';
import type { LifeRoadNodeRow } from '@/lib/repositories/life-road/life-road-node.types';
import { planLifeRoadFromDirection } from '@/lib/zhipu-image-parse';
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

const PREFS = [
  { key: '偏少而硬', label: '偏少而硬' },
  { key: '按季铺开', label: '按季铺开' },
] as const;

function slotKey(n: {
  kind: string;
  calendar_year?: number | null;
  quarter?: number | null;
  month?: number | null;
}): string {
  return `${n.kind}:${n.calendar_year ?? ''}:${n.quarter ?? ''}:${n.month ?? ''}`;
}

function occupiedSlots(nodes: LifeRoadNodeRow[], year: number): Set<string> {
  const set = new Set<string>();
  for (const n of nodes) {
    if (n.kind !== 'year' && n.kind !== 'quarter' && n.kind !== 'month') continue;
    if (n.calendar_year !== year) continue;
    set.add(slotKey(n));
  }
  return set;
}

export type AiLifeRoadPlanSheetProps = {
  visible: boolean;
  onClose: () => void;
  directionId: string | null;
  directionBody: string;
  yearTheme?: string | null;
  calendarYear: number;
  existingNodeTitles?: string[];
  onCreated?: () => void;
};

export function AiLifeRoadPlanSheet({
  visible,
  onClose,
  directionId,
  directionBody,
  yearTheme,
  calendarYear,
  existingNodeTitles = [],
  onCreated,
}: AiLifeRoadPlanSheetProps) {
  const insets = useSafeAreaInsets();
  const { lr } = useLifeRoadTheme();
  const styles = useMemo(() => createStyles(lr.pine), [lr.pine]);

  const [preference, setPreference] = useState<(typeof PREFS)[number]['key']>('偏少而硬');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<LifeRoadPlanFromDirectionJson | null>(null);
  const [fetched, setFetched] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [blocked, setBlocked] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
      setSelected(new Set());
      setBlocked(new Set());
    }
  }, [visible]);

  const run = useCallback(async () => {
    if (!directionBody.trim()) {
      toast.info('请先写下总方向');
      return;
    }
    setLoading(true);
    try {
      const existing = await getLifeRoadNodesLocal();
      const occ = occupiedSlots(existing, calendarYear);
      const r = await planLifeRoadFromDirection({
        body: directionBody,
        yearTheme: yearTheme ?? undefined,
        calendarYear,
        existingNodeTitles,
        preference,
      });
      if (!r.ok) {
        toast.error(r.error || '拆解失败');
        return;
      }
      const nextBlocked = new Set<number>();
      const nextSelected = new Set<number>();
      r.data.nodes.forEach((n, i) => {
        const key = slotKey({
          kind: n.kind,
          calendar_year: n.calendar_year ?? calendarYear,
          quarter: n.quarter,
          month: n.month,
        });
        if (occ.has(key)) {
          nextBlocked.add(i);
        } else {
          nextSelected.add(i);
        }
      });
      setData(r.data);
      setBlocked(nextBlocked);
      setSelected(nextSelected);
      setFetched(true);
      if (nextBlocked.size > 0 && nextSelected.size === 0) {
        toast.info('对应年/季/月槽位已有节点，请先编辑或删除后再拆解');
      }
    } catch (e) {
      toast.error(toUserMessage(e, '拆解失败'));
    } finally {
      setLoading(false);
    }
  }, [calendarYear, directionBody, existingNodeTitles, preference, yearTheme]);

  useEffect(() => {
    if (visible && !fetched && !loading && directionBody.trim()) {
      void run();
    }
  }, [visible, fetched, loading, directionBody, run]);

  const toggle = (i: number) => {
    if (blocked.has(i)) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!data) return;
    const chosenIdx = data.nodes.map((_, i) => i).filter(i => selected.has(i) && !blocked.has(i));
    if (!chosenIdx.length) {
      toast.info('请至少勾选一个可创建节点');
      return;
    }
    setSaving(true);
    try {
      const createdIds: (string | null)[] = data.nodes.map(() => null);
      // 按 year → quarter → month 顺序创建，便于挂 parent
      const order = [...chosenIdx].sort((a, b) => {
        const rank = (k: string) => (k === 'year' ? 0 : k === 'quarter' ? 1 : 2);
        return rank(data.nodes[a].kind) - rank(data.nodes[b].kind);
      });

      for (const i of order) {
        const n = data.nodes[i];
        const kind = n.kind as LifeRoadNodeKind;
        let parentId: string | null = null;
        if (n.parent_hint != null && createdIds[n.parent_hint]) {
          parentId = createdIds[n.parent_hint];
        } else if (kind === 'quarter') {
          const yearIdx = data.nodes.findIndex(
            (x, j) =>
              j < i &&
              x.kind === 'year' &&
              selected.has(j) &&
              !blocked.has(j) &&
              createdIds[j],
          );
          if (yearIdx >= 0) parentId = createdIds[yearIdx];
        } else if (kind === 'month') {
          const q = n.quarter;
          const qIdx = data.nodes.findIndex(
            (x, j) =>
              j < i &&
              x.kind === 'quarter' &&
              x.quarter === q &&
              selected.has(j) &&
              !blocked.has(j) &&
              createdIds[j],
          );
          if (qIdx >= 0) parentId = createdIds[qIdx];
        }

        const acceptance = (n.acceptance_items ?? []).map(a => createAcceptanceItem(a.text));
        const extra = writeAcceptanceCriteria(null, acceptance);
        const row = await createLifeRoadNode({
          kind,
          title: n.title,
          note: n.note,
          calendar_year: n.calendar_year ?? calendarYear,
          quarter: n.quarter,
          month: n.month,
          parent_id: parentId,
          extra_data: extra,
        });
        createdIds[i] = row.id;
      }

      if (directionId && data.year_theme?.trim()) {
        try {
          await updateLifeDirection(directionId, { year_theme: data.year_theme.trim() });
        } catch {
          /* 主题更新失败不影响节点创建 */
        }
      }

      toast.success(`已创建 ${order.length} 个道路节点`);
      onCreated?.();
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '写入失败'));
    } finally {
      setSaving(false);
    }
  };

  const renderNode = (n: LifeRoadPlanNodeJson, i: number) => {
    const on = selected.has(i);
    const isBlocked = blocked.has(i);
    const kindLabel =
      LIFE_ROAD_NODE_KIND_LABELS[n.kind as LifeRoadNodeKind] ?? n.kind;
    const slot =
      n.kind === 'year'
        ? `${n.calendar_year ?? calendarYear}`
        : n.kind === 'quarter'
          ? `Q${n.quarter}`
          : `${n.month}月`;
    return (
      <Pressable
        key={`${i}-${n.title}`}
        style={[styles.row, on && !isBlocked && styles.rowOn, isBlocked && styles.rowBlocked]}
        onPress={() => toggle(i)}
        disabled={isBlocked}>
        <Text style={styles.check}>{isBlocked ? '—' : on ? '✓' : '○'}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowMeta}>
            {kindLabel} · {slot}
            {isBlocked ? ' · 槽位已占用' : ''}
          </Text>
          <Text style={styles.rowText} numberOfLines={2}>
            {n.title}
          </Text>
          {(n.acceptance_items?.length ?? 0) > 0 ? (
            <Text style={styles.rowAcc} numberOfLines={3}>
              {n.acceptance_items.map(a => `· ${a.text}`).join('\n')}
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
            <Text style={styles.title}>AI 拆解方向</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>勾选后批量建年/季/月 · 不自动建任务</Text>

          <View style={styles.prefRow}>
            {PREFS.map(p => {
              const on = preference === p.key;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => {
                    setPreference(p.key);
                    setFetched(false);
                  }}
                  style={[styles.prefChip, on && styles.prefChipOn]}>
                  <Text style={[styles.prefText, on && styles.prefTextOn]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {!loading && data?.year_theme ? (
            <Text style={styles.themeLine}>年主题建议 · {data.year_theme}</Text>
          ) : null}

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={lr.pine} />
                <Text style={styles.loadingText}>正在拆解…</Text>
              </View>
            ) : null}
            {!loading && data?.nodes.map(renderNode)}
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
      maxHeight: '90%',
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
    prefRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    prefChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#D8CDBB',
      backgroundColor: '#FFF',
    },
    prefChipOn: { borderColor: accent, backgroundColor: '#EAF3EC' },
    prefText: { fontSize: 12, fontWeight: '700', color: '#6F856B' },
    prefTextOn: { color: accent },
    themeLine: {
      fontSize: 13,
      fontWeight: '700',
      color: accent,
      marginBottom: 8,
      lineHeight: 18,
    },
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
    rowBlocked: { opacity: 0.55 },
    check: { width: 18, textAlign: 'center', color: accent, fontWeight: '800', marginTop: 1 },
    rowMeta: { fontSize: 11, color: '#6F856B', fontWeight: '700', marginBottom: 2 },
    rowText: { fontSize: 14, color: '#2F3B32', fontWeight: '700' },
    rowAcc: { fontSize: 12, color: '#6F856B', marginTop: 4, lineHeight: 18 },
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
