/**
 * 道路节点编辑表单：标题 + 说明 + 状态 + 验收标准 checklist。
 * 验收标准是方向级「做成了算过关」，不是任务排期。
 */
import { AcceptanceChecklistEditor } from '@/components/life-road/AcceptanceChecklistEditor';
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { getMinTouchTarget, Spacing } from '@/constants/design-tokens';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import {
  parseAcceptanceCriteria,
  writeAcceptanceCriteria,
  type LifeRoadAcceptanceItem,
} from '@/lib/life-road/life-road-acceptance';
import {
  LIFE_ROAD_NODE_KIND_LABELS,
  LIFE_ROAD_NODE_STATUS_LABELS,
  LIFE_ROAD_NODE_STATUS_VALUES,
  LIFE_ROAD_NOTE_MAX,
  LIFE_ROAD_TITLE_MAX,
  LifeRoadValidationError,
  monthLabel,
  parseLifeRoadNodeKind,
  quarterLabel,
  type LifeRoadNodeKind,
  type LifeRoadNodeStatus,
} from '@/lib/life-road/life-road-node-model';
import {
  createLifeRoadNode,
  deleteLifeRoadNode,
  getLifeRoadNodeById,
  updateLifeRoadNode,
} from '@/lib/repositories/life-road/life-road-node';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_KEY = 'edit-life-road-node';
const MIN_TOUCH = getMinTouchTarget(Platform.OS);

export default function EditLifeRoadNodeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_KEY);
  const params = useLocalSearchParams<{
    id: string;
    kind?: string;
    year?: string;
    quarter?: string;
    month?: string;
    parent_id?: string;
  }>();

  const isNew = !params.id || params.id === 'new';
  const kind: LifeRoadNodeKind = useMemo(() => {
    try {
      return parseLifeRoadNodeKind(params.kind ?? 'month');
    } catch {
      return 'month';
    }
  }, [params.kind]);

  const calendarYear = params.year ? Number(params.year) : new Date().getFullYear();
  const quarter = params.quarter ? Number(params.quarter) : undefined;
  const month = params.month ? Number(params.month) : undefined;
  const parentId = params.parent_id?.trim() || null;

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<LifeRoadNodeStatus>('on_track');
  const [acceptance, setAcceptance] = useState<LifeRoadAcceptanceItem[]>([]);
  const [extraDataBase, setExtraDataBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [nodeId, setNodeId] = useState<string | null>(isNew ? null : params.id);

  const slotLabel = useMemo(() => {
    if (kind === 'multi' || kind === 'farther') return LIFE_ROAD_NODE_KIND_LABELS[kind];
    if (kind === 'year') return `${calendarYear} 年目标`;
    if (kind === 'quarter') return `${calendarYear} ${quarterLabel(quarter ?? 1)}`;
    if (kind === 'month') return `${calendarYear} ${monthLabel(month ?? 1)}`;
    return LIFE_ROAD_NODE_KIND_LABELS[kind];
  }, [kind, calendarYear, quarter, month]);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await wrapLoad(async () => {
          const row = await getLifeRoadNodeById(params.id!, { serverFallback: true });
          if (cancelled) return;
          if (!row) {
            toast.error('节点不存在');
            router.back();
            return;
          }
          setNodeId(row.id);
          setTitle(row.title);
          setNote(row.note ?? '');
          setStatus(row.status);
          setExtraDataBase(row.extra_data ?? null);
          setAcceptance(parseAcceptanceCriteria(row.extra_data));
        }, false);
      } catch (e) {
        toast.error(toUserMessage(e, '加载失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, params.id, router, wrapLoad]);

  const onSave = useCallback(async () => {
    setSaving(true);
    try {
      const extra_data = writeAcceptanceCriteria(extraDataBase, acceptance);
      if (isNew || !nodeId) {
        await createLifeRoadNode({
          kind,
          title,
          note: note.trim() ? note : null,
          status,
          calendar_year:
            kind === 'multi' || kind === 'farther' ? null : calendarYear,
          quarter: kind === 'quarter' || kind === 'month' ? quarter ?? null : null,
          month: kind === 'month' ? month ?? null : null,
          parent_id: parentId,
          extra_data,
        });
        toast.success('已创建');
      } else {
        await updateLifeRoadNode(nodeId, {
          title,
          note: note.trim() ? note : null,
          status,
          extra_data,
        });
        toast.success('已保存');
      }
      router.back();
    } catch (e) {
      const msg =
        e instanceof LifeRoadValidationError
          ? e.message
          : toUserMessage(e, '保存失败');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [
    isNew,
    nodeId,
    kind,
    title,
    note,
    status,
    acceptance,
    extraDataBase,
    calendarYear,
    quarter,
    month,
    parentId,
    router,
  ]);

  const onDelete = useCallback(() => {
    if (!nodeId) return;
    Alert.alert('删除节点', `确定删除「${title || slotLabel}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteLifeRoadNode(nodeId);
              toast.success('已删除');
              router.back();
            } catch (e) {
              toast.error(toUserMessage(e, '删除失败'));
            }
          })();
        },
      },
    ]);
  }, [nodeId, title, slotLabel, router]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <Stack.Screen
        options={{
          title: isNew ? `新建 · ${slotLabel}` : `编辑 · ${slotLabel}`,
          headerRight: () =>
            !isNew ? (
              <Pressable
                onPress={onDelete}
                accessibilityLabel="删除"
                style={{ paddingHorizontal: 8, minHeight: MIN_TOUCH, justifyContent: 'center' }}>
                <Text style={{ color: fold.clay, fontWeight: '700' }}>删除</Text>
              </Pressable>
            ) : null,
        }}
      />
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={fold.pine} />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + Spacing['6xl'],
            gap: 14,
          }}>
          <FoldRiseIn animate={motionOn} index={0} fromY={10}>
            <Text style={[styles.hint, { color: fold.muted }]}>
              标题 / 说明写方向；验收标准写「怎样算过关」。具体做法与期限仍放到项目里。
            </Text>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={1} fromY={10}>
            <Text style={[styles.lab, { color: fold.faint }]}>标题</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={LIFE_ROAD_TITLE_MAX}
              placeholder="一句话方向"
              placeholderTextColor={fold.faint}
              style={[
                styles.input,
                {
                  color: fold.ink,
                  borderColor: fold.line,
                  backgroundColor: 'rgba(255,252,245,0.92)',
                  fontFamily: foldFonts.serif,
                },
              ]}
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} fromY={10}>
            <Text style={[styles.lab, { color: fold.faint }]}>说明（可选）</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={LIFE_ROAD_NOTE_MAX}
              placeholder="背景或补充说明"
              placeholderTextColor={fold.faint}
              multiline
              style={[
                styles.area,
                {
                  color: fold.ink,
                  borderColor: fold.line,
                  backgroundColor: 'rgba(255,252,245,0.92)',
                },
              ]}
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} fromY={10}>
            <Text style={[styles.lab, { color: fold.faint }]}>状态</Text>
            <View style={styles.chips}>
              {LIFE_ROAD_NODE_STATUS_VALUES.map((s) => {
                const on = status === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setStatus(s)}
                    style={[
                      styles.chip,
                      {
                        borderColor: on ? fold.pine2 : fold.line,
                        backgroundColor: on ? fold.sage2 : 'transparent',
                      },
                    ]}>
                    <Text
                      style={{
                        color: on ? fold.pine2 : fold.ink2,
                        fontSize: 12,
                        fontWeight: '700',
                      }}>
                      {LIFE_ROAD_NODE_STATUS_LABELS[s]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={4} fromY={10}>
            <AcceptanceChecklistEditor
              items={acceptance}
              onChange={setAcceptance}
              ink={fold.ink}
              ink2={fold.ink2}
              muted={fold.muted}
              faint={fold.faint}
              line={fold.line}
              pine2={fold.pine2}
              sage2={fold.sage2}
            />
          </FoldRiseIn>

          <Pressable
            onPress={() => void onSave()}
            disabled={saving || !title.trim()}
            style={[
              styles.save,
              {
                backgroundColor: fold.pineButton,
                opacity: saving || !title.trim() ? 0.5 : 1,
                minHeight: MIN_TOUCH,
              },
            ]}>
            <Text style={{ color: fold.onPineButton, fontWeight: '800', fontSize: 15 }}>
              {saving ? '保存中…' : '保存'}
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hint: { fontSize: 12, lineHeight: 18 },
  lab: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  area: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  save: {
    marginTop: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
