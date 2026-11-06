/**
 * 节点「一句话更新」：自然语言 → patch 预览 → 确认写入编辑态；
 * arrived / dropped 需二次确认。
 */
import { useLifeRoadTheme } from '@/constants/life-road-theme';
import type { LifeRoadNodeUpdatePatchJson } from '@/lib/ai-api-client';
import { Alert, toast, toUserMessage } from '@/lib/app-feedback';
import {
  createAcceptanceItem,
  type LifeRoadAcceptanceItem,
} from '@/lib/life-road/life-road-acceptance';
import {
  LIFE_ROAD_NODE_STATUS_LABELS,
  type LifeRoadNodeStatus,
} from '@/lib/life-road/life-road-node-model';
import { parseLifeRoadNodeUpdate } from '@/lib/zhipu-image-parse';
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

export type AiLifeRoadNodeUpdateApply = {
  title?: string;
  note?: string | null;
  status?: LifeRoadNodeStatus;
  acceptanceItems?: LifeRoadAcceptanceItem[];
};

export type AiLifeRoadNodeUpdateSheetProps = {
  visible: boolean;
  onClose: () => void;
  nodeSummary: {
    title: string;
    note?: string;
    kind?: string;
    status?: string;
    acceptance?: string[];
  };
  onApply: (patch: AiLifeRoadNodeUpdateApply) => void;
};

export function AiLifeRoadNodeUpdateSheet({
  visible,
  onClose,
  nodeSummary,
  onApply,
}: AiLifeRoadNodeUpdateSheetProps) {
  const insets = useSafeAreaInsets();
  const { lr } = useLifeRoadTheme();
  const styles = useMemo(() => createStyles(lr.pine), [lr.pine]);

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LifeRoadNodeUpdatePatchJson | null>(null);

  useEffect(() => {
    if (!visible) {
      setText('');
      setData(null);
      setLoading(false);
    }
  }, [visible]);

  const run = useCallback(async () => {
    const seed = text.trim();
    if (!seed) {
      toast.info('写一句想改的内容');
      return;
    }
    setLoading(true);
    try {
      const r = await parseLifeRoadNodeUpdate({
        text: seed,
        node: {
          title: nodeSummary.title,
          note: nodeSummary.note ?? null,
          kind: nodeSummary.kind,
          status: nodeSummary.status,
          acceptance: nodeSummary.acceptance,
        },
      });
      if (!r.ok) {
        toast.error(r.error || '解析失败');
        return;
      }
      setData(r.data);
    } catch (e) {
      toast.error(toUserMessage(e, '解析失败'));
    } finally {
      setLoading(false);
    }
  }, [nodeSummary, text]);

  const applyPatch = (patch: LifeRoadNodeUpdatePatchJson) => {
    const out: AiLifeRoadNodeUpdateApply = {};
    if (patch.title) out.title = patch.title;
    if ('note' in patch) out.note = patch.note ?? null;
    if (patch.status === 'on_track' || patch.status === 'paused' || patch.status === 'arrived' || patch.status === 'dropped') {
      out.status = patch.status;
    }
    if (patch.acceptance_items?.length) {
      out.acceptanceItems = patch.acceptance_items.map(a => createAcceptanceItem(a.text));
    }
    onApply(out);
    toast.success('已填入更新，记得保存');
    onClose();
  };

  const handleApply = () => {
    if (!data) return;
    const terminal = data.status === 'arrived' || data.status === 'dropped';
    if (terminal) {
      const label =
        data.status === 'arrived'
          ? LIFE_ROAD_NODE_STATUS_LABELS.arrived
          : LIFE_ROAD_NODE_STATUS_LABELS.dropped;
      Alert.alert('确认终态', `将状态改为「${label}」？此操作成本较高。`, [
        { text: '取消', style: 'cancel' },
        { text: '确认', style: 'destructive', onPress: () => applyPatch(data) },
      ]);
      return;
    }
    applyPatch(data);
  };

  const lines: string[] = [];
  if (data?.title) lines.push(`标题 → ${data.title}`);
  if (data && 'note' in data) lines.push(`说明 → ${data.note?.trim() || '（清空）'}`);
  if (data?.status) {
    const st = data.status as LifeRoadNodeStatus;
    lines.push(`状态 → ${LIFE_ROAD_NODE_STATUS_LABELS[st] ?? data.status}`);
  }
  if (data?.acceptance_items?.length) {
    lines.push(`验收（替换草稿）· ${data.acceptance_items.length} 条`);
    for (const a of data.acceptance_items.slice(0, 6)) {
      lines.push(`  · ${a.text}`);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>一句话更新</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>预览 patch · 确认后仍需点保存 · 抵达/放弃二次确认</Text>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="例：这个月先暂停，备注改成等肩颈恢复"
            placeholderTextColor="#A8B0A6"
            multiline
            style={styles.input}
            editable={!loading}
          />

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={lr.pine} />
                <Text style={styles.loadingText}>正在解析…</Text>
              </View>
            ) : null}
            {!loading && data ? (
              <View style={styles.card}>
                {lines.map((l, i) => (
                  <Text key={`${i}-${l}`} style={styles.cardLine}>
                    {l}
                  </Text>
                ))}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.ghostBtn} disabled={loading} onPress={() => void run()}>
              <Text style={styles.ghostText}>{data ? '重新解析' : '解析'}</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (loading || !data) && styles.btnDisabled]}
              disabled={loading || !data}
              onPress={handleApply}>
              <Text style={styles.primaryText}>填入更新</Text>
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
    input: {
      minHeight: 64,
      maxHeight: 100,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: '#2F3B32',
      textAlignVertical: 'top',
      marginBottom: 10,
    },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12, gap: 10 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    card: {
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
      gap: 6,
    },
    cardLine: { fontSize: 13, color: '#2F3B32', lineHeight: 20 },
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
