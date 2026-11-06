/**
 * 道路「拍照导入」：手写便签 / 截图 → 方向或年季月节点草稿，确认后写入。
 */
import { useLifeRoadTheme } from '@/constants/life-road-theme';
import type { LifeRoadParseFromImageJson, LifeRoadPlanNodeJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  createAcceptanceItem,
  writeAcceptanceCriteria,
} from '@/lib/life-road/life-road-acceptance';
import {
  LIFE_ROAD_NODE_KIND_LABELS,
  type LifeRoadNodeKind,
} from '@/lib/life-road/life-road-node-model';
import {
  getLifeDirectionLocal,
  updateLifeDirection,
  upsertLifeDirection,
} from '@/lib/repositories/life-road/life-direction';
import {
  createLifeRoadNode,
  getLifeRoadNodesLocal,
} from '@/lib/repositories/life-road/life-road-node';
import type { LifeRoadNodeRow } from '@/lib/repositories/life-road/life-road-node.types';
import { parseLifeRoadFromImage } from '@/lib/zhipu-image-parse';
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

export type AiLifeRoadFromImageSheetProps = {
  visible: boolean;
  onClose: () => void;
  calendarYear: number;
  directionId: string | null;
  onCreated?: () => void;
};

export function AiLifeRoadFromImageSheet({
  visible,
  onClose,
  calendarYear,
  directionId,
  onCreated,
}: AiLifeRoadFromImageSheetProps) {
  const insets = useSafeAreaInsets();
  const { lr } = useLifeRoadTheme();
  const styles = useMemo(() => createStyles(lr.pine), [lr.pine]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplement, setSupplement] = useState('');
  const [data, setData] = useState<LifeRoadParseFromImageJson | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [blocked, setBlocked] = useState<Set<number>>(() => new Set());
  const [applyDirection, setApplyDirection] = useState(true);

  useEffect(() => {
    if (!visible) {
      setLoading(false);
      setSaving(false);
      setSupplement('');
      setData(null);
      setSelected(new Set());
      setBlocked(new Set());
      setApplyDirection(true);
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
        const r = await parseLifeRoadFromImage({
          imageBase64: asset.base64,
          imageMimeType: mime,
          supplementText: supplement.trim() || undefined,
          calendarYear,
        });
        if (!r.ok) {
          toast.error(r.error || '识图失败');
          return;
        }

        const existing = await getLifeRoadNodesLocal();
        const occ = occupiedSlots(existing, calendarYear);
        const nextBlocked = new Set<number>();
        const nextSelected = new Set<number>();
        r.data.nodes.forEach((n, i) => {
          const key = slotKey({
            kind: n.kind,
            calendar_year: n.calendar_year ?? calendarYear,
            quarter: n.quarter,
            month: n.month,
          });
          if (occ.has(key)) nextBlocked.add(i);
          else nextSelected.add(i);
        });
        setData(r.data);
        setBlocked(nextBlocked);
        setSelected(nextSelected);
        setApplyDirection(Boolean(r.data.direction_body?.trim()));
        toast.success('已识别草稿');
      } catch (e) {
        toast.error(toUserMessage(e, '识图失败'));
      } finally {
        setLoading(false);
      }
    },
    [calendarYear, supplement],
  );

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
    const wantDir = applyDirection && Boolean(data.direction_body?.trim());
    if (!chosenIdx.length && !wantDir) {
      toast.info('请勾选节点，或勾选写入总方向');
      return;
    }
    setSaving(true);
    try {
      if (wantDir && data.direction_body?.trim()) {
        const body = data.direction_body.trim();
        const theme = data.year_theme?.trim() || null;
        if (directionId) {
          await updateLifeDirection(directionId, {
            body,
            ...(theme ? { year_theme: theme } : {}),
          });
        } else {
          const local = await getLifeDirectionLocal();
          if (local?.id) {
            await updateLifeDirection(local.id, {
              body,
              ...(theme ? { year_theme: theme } : {}),
            });
          } else {
            await upsertLifeDirection({
              body,
              year_theme: theme,
            });
          }
        }
      }

      const createdIds: (string | null)[] = data.nodes.map(() => null);
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

      const parts: string[] = [];
      if (wantDir) parts.push('总方向');
      if (order.length) parts.push(`${order.length} 个节点`);
      toast.success(`已写入 ${parts.join(' · ')}`);
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
    const kindLabel = LIFE_ROAD_NODE_KIND_LABELS[n.kind as LifeRoadNodeKind] ?? n.kind;
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
            <Text style={styles.title}>拍照导入</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>便签 / 截图 → 预览确认 · 图不落库</Text>

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
                <ActivityIndicator color={lr.pine} />
                <Text style={styles.loadingText}>正在识别…</Text>
              </View>
            ) : null}
            {!loading && data?.direction_body ? (
              <Pressable
                style={[styles.dirCard, applyDirection && styles.rowOn]}
                onPress={() => setApplyDirection(v => !v)}>
                <Text style={styles.check}>{applyDirection ? '✓' : '○'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowMeta}>写入总方向</Text>
                  <Text style={styles.rowText}>{data.direction_body}</Text>
                  {data.year_theme ? (
                    <Text style={styles.rowAcc}>年主题 · {data.year_theme}</Text>
                  ) : null}
                </View>
              </Pressable>
            ) : null}
            {!loading && data?.nodes.map(renderNode)}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, (loading || saving || !data) && styles.btnDisabled]}
              disabled={loading || saving || !data}
              onPress={() => void handleConfirm()}>
              <Text style={styles.primaryText}>{saving ? '写入中…' : '确认写入'}</Text>
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
    input: {
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: '#2F3B32',
      marginBottom: 10,
    },
    pickRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    pickBtn: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#C9D0C6',
      alignItems: 'center',
      backgroundColor: '#FFF',
    },
    pickText: { fontSize: 14, fontWeight: '700', color: '#536155' },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12, gap: 8 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    dirCard: {
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
    primaryBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: accent,
      alignItems: 'center',
    },
    primaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    btnDisabled: { opacity: 0.55 },
  });
}
