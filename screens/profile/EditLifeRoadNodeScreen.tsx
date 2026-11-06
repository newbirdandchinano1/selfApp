/**
 * 道路节点编辑：对齐 `我的道路-UI重构.html` route-node
 *（自定义顶栏、槽位面包屑、表单卡片、状态网格、底栏保存）。
 */
import { AcceptanceChecklistEditor } from '@/components/life-road/AcceptanceChecklistEditor';
import { AiLifeRoadAcceptanceSheet } from '@/components/profile/ai-life-road-acceptance-sheet';
import {
  AiLifeRoadNodeUpdateSheet,
  type AiLifeRoadNodeUpdateApply,
} from '@/components/profile/ai-life-road-node-update-sheet';
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui/app-icon';
import { useWardrobeFonts } from '@/components/wardrobe/use-wardrobe-fonts';
import {
  lifeRoadType,
  useLifeRoadTheme,
  type LifeRoadPalette,
} from '@/constants/life-road-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import {
  LIFE_ROAD_ACCEPTANCE_MAX_ITEMS,
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
import { getLifeDirectionLocal } from '@/lib/repositories/life-road/life-direction';
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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

const PAGE_KEY = 'edit-life-road-node';

const STATUS_TONE: Record<
  LifeRoadNodeStatus,
  { color: string; bg: string }
> = {
  on_track: { color: '#5D846E', bg: 'rgba(93,132,110,0.09)' },
  paused: { color: '#D39A55', bg: 'rgba(211,154,85,0.09)' },
  arrived: { color: '#3D6B58', bg: 'rgba(61,107,88,0.09)' },
  dropped: { color: '#BF6F52', bg: 'rgba(191,111,82,0.09)' },
};

function CheckIcon({ color }: { color: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5l4.5 4.5L19 7"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CrumbDot({ color }: { color: string }) {
  return <View style={[styles.crumbDot, { backgroundColor: color }]} />;
}

function buildSlotLabel(
  kind: LifeRoadNodeKind,
  calendarYear: number | null,
  quarter: number | null | undefined,
  month: number | null | undefined,
): string {
  if (kind === 'multi' || kind === 'farther') return LIFE_ROAD_NODE_KIND_LABELS[kind];
  if (kind === 'year') return `${calendarYear ?? ''} 年目标`.trim();
  if (kind === 'quarter') {
    return `${calendarYear ?? ''} ${quarterLabel(quarter ?? 1)}`.trim();
  }
  if (kind === 'month') {
    return `${calendarYear ?? ''} ${monthLabel(month ?? 1)}`.trim();
  }
  return LIFE_ROAD_NODE_KIND_LABELS[kind];
}

function buildCrumbParts(
  kind: LifeRoadNodeKind,
  calendarYear: number | null,
  quarter: number | null | undefined,
  month: number | null | undefined,
): string[] {
  if (kind === 'multi') return ['多年', '3–10 年坐标'];
  if (kind === 'farther') return ['更远', '更远方向'];
  if (kind === 'year') return [String(calendarYear ?? ''), '年目标'];
  if (kind === 'quarter') {
    return [String(calendarYear ?? ''), quarterLabel(quarter ?? 1), '季目标'];
  }
  return [
    String(calendarYear ?? ''),
    quarter != null ? quarterLabel(quarter) : '',
    monthLabel(month ?? 1),
  ].filter(Boolean);
}

export default function EditLifeRoadNodeScreen() {
  useWardrobeFonts();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lr } = useLifeRoadTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_KEY);
  const params = useLocalSearchParams<{
    id: string;
    kind?: string;
    year?: string;
    quarter?: string;
    month?: string;
    parent_id?: string;
  }>();

  const isNew = !params.id || params.id === 'new';
  const paramKind: LifeRoadNodeKind = useMemo(() => {
    try {
      return parseLifeRoadNodeKind(params.kind ?? 'month');
    } catch {
      return 'month';
    }
  }, [params.kind]);

  const paramYear = params.year ? Number(params.year) : new Date().getFullYear();
  const paramQuarter = params.quarter ? Number(params.quarter) : undefined;
  const paramMonth = params.month ? Number(params.month) : undefined;
  const parentId = params.parent_id?.trim() || null;

  const [kind, setKind] = useState<LifeRoadNodeKind>(paramKind);
  const [calendarYear, setCalendarYear] = useState<number | null>(
    paramKind === 'multi' || paramKind === 'farther' ? null : paramYear,
  );
  const [quarter, setQuarter] = useState<number | null | undefined>(paramQuarter);
  const [month, setMonth] = useState<number | null | undefined>(paramMonth);

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<LifeRoadNodeStatus>('on_track');
  const [acceptance, setAcceptance] = useState<LifeRoadAcceptanceItem[]>([]);
  const [extraDataBase, setExtraDataBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [nodeId, setNodeId] = useState<string | null>(isNew ? null : params.id);
  const [directionBody, setDirectionBody] = useState('');
  const [acceptAiOpen, setAcceptAiOpen] = useState(false);
  const [updateAiOpen, setUpdateAiOpen] = useState(false);
  const [baseline, setBaseline] = useState<{
    title: string;
    note: string;
    status: LifeRoadNodeStatus;
    acceptanceKey: string;
  } | null>(isNew ? { title: '', note: '', status: 'on_track', acceptanceKey: '' } : null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const dir = await getLifeDirectionLocal();
        if (!cancelled) setDirectionBody(dir?.body?.trim() ?? '');
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const slotLabel = useMemo(
    () => buildSlotLabel(kind, calendarYear, quarter, month),
    [kind, calendarYear, quarter, month],
  );

  const crumbParts = useMemo(
    () => buildCrumbParts(kind, calendarYear, quarter, month),
    [kind, calendarYear, quarter, month],
  );

  const titleLen = [...title].length;
  const noteLen = [...note].length;
  const acceptanceKey = useMemo(
    () =>
      acceptance
        .map((it) => `${it.id}:${it.done ? 1 : 0}:${it.text.trim()}`)
        .join('|'),
    [acceptance],
  );

  const dirty = useMemo(() => {
    if (!baseline) return false;
    return (
      title.trim() !== baseline.title.trim() ||
      note.trim() !== baseline.note.trim() ||
      status !== baseline.status ||
      acceptanceKey !== baseline.acceptanceKey
    );
  }, [acceptanceKey, baseline, note, status, title]);

  const canSave =
    Boolean(title.trim()) && !saving && !loading && (isNew || dirty);

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
          setKind(row.kind);
          setCalendarYear(row.calendar_year);
          setQuarter(row.quarter);
          setMonth(row.month);
          setTitle(row.title);
          setNote(row.note ?? '');
          setStatus(row.status);
          setExtraDataBase(row.extra_data ?? null);
          const items = parseAcceptanceCriteria(row.extra_data);
          setAcceptance(items);
          setBaseline({
            title: row.title,
            note: row.note ?? '',
            status: row.status,
            acceptanceKey: items
              .map((it) => `${it.id}:${it.done ? 1 : 0}:${it.text.trim()}`)
              .join('|'),
          });
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
    if (!title.trim()) {
      toast.warn('先写标题');
      return;
    }
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
      notifyAncestorsDataChanged();
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
    notifyAncestorsDataChanged,
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
              notifyAncestorsDataChanged();
              toast.success('已删除');
              router.back();
            } catch (e) {
              toast.error(toUserMessage(e, '删除失败'));
            }
          })();
        },
      },
    ]);
  }, [nodeId, title, slotLabel, router, notifyAncestorsDataChanged]);

  const footerHint = isNew
    ? '标题非空才可创建节点'
    : canSave
      ? '有改动 · 保存后返回'
      : title.trim()
        ? '标题非空 · 有改动才可保存'
        : '标题非空 · 有改动才可保存';

  const onApplyNodeUpdate = useCallback((patch: AiLifeRoadNodeUpdateApply) => {
    if (patch.title) setTitle([...patch.title].slice(0, LIFE_ROAD_TITLE_MAX).join(''));
    if ('note' in patch) {
      const n = patch.note?.trim() ?? '';
      setNote([...n].slice(0, LIFE_ROAD_NOTE_MAX).join(''));
    }
    if (patch.status) setStatus(patch.status);
    if (patch.acceptanceItems?.length) {
      setAcceptance(prev => {
        const room = Math.max(0, LIFE_ROAD_ACCEPTANCE_MAX_ITEMS - prev.length);
        if (room <= 0) return prev;
        const existing = new Set(prev.map(p => p.text.trim().toLowerCase()));
        const add = patch.acceptanceItems!
          .filter(a => a.text.trim() && !existing.has(a.text.trim().toLowerCase()))
          .slice(0, room);
        return add.length ? [...prev, ...add] : prev;
      });
    }
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: lr.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.appBar, { paddingTop: insets.top + 4 }]}>
        <View style={styles.appBarSide}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={10}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                borderColor: lr.line,
                backgroundColor: 'rgba(252,249,241,0.66)',
                opacity: pressed ? 0.88 : 1,
              },
            ]}>
            <AppIcon name="arrow-back" size={18} color={lr.ink2} />
          </Pressable>
        </View>
        <View style={styles.appBarTitleWrap}>
          <Text style={[styles.appTitle, { color: lr.pine }]} numberOfLines={1}>
            {isNew ? `新建 · ${slotLabel}` : `编辑 · ${slotLabel}`}
          </Text>
          <Text style={[lifeRoadType.appSub, { color: lr.muted }]}>
            ROAD NODE · {kind.toUpperCase()}
          </Text>
        </View>
        <View style={[styles.appBarSide, styles.appBarSideEnd]}>
          {!isNew ? (
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel="删除"
              style={({ pressed }) => [
                styles.deleteTop,
                {
                  borderColor: 'rgba(191,111,82,0.18)',
                  backgroundColor: 'rgba(241,220,210,0.28)',
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '600',
                  letterSpacing: 0.4,
                  color: lr.clay,
                }}>
                删除
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={lr.pine} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: Math.max(insets.bottom, 16) + 110 },
            ]}
            showsVerticalScrollIndicator={false}>
            <FoldRiseIn animate={motionOn} index={0} fromY={10}>
              <View
                style={[
                  styles.slotCrumb,
                  {
                    borderColor: lr.line3,
                    backgroundColor: 'rgba(252,249,241,0.45)',
                  },
                ]}>
                {crumbParts.map((part, i) => (
                  <React.Fragment key={`${part}-${i}`}>
                    {i > 0 ? <CrumbDot color={lr.line2} /> : null}
                    <Text
                      style={[
                        lifeRoadType.monoTiny,
                        {
                          color: i === crumbParts.length - 1 ? lr.ink3 : lr.muted,
                          fontWeight: i === crumbParts.length - 1 ? '600' : '400',
                        },
                      ]}>
                      {part}
                    </Text>
                  </React.Fragment>
                ))}
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={1} fromY={10}>
              <FormCard lr={lr}>
                <View style={styles.fieldHead}>
                  <View style={styles.fieldLabel}>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>01</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}>标题</Text>
                    <Text style={{ fontSize: 10, color: lr.clay }}>必填</Text>
                  </View>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                    {titleLen} / {LIFE_ROAD_TITLE_MAX}
                  </Text>
                </View>
                <TextInput
                  value={title}
                  onChangeText={(t) => setTitle([...t].slice(0, LIFE_ROAD_TITLE_MAX).join(''))}
                  placeholder="这个节点叫什么？"
                  placeholderTextColor={lr.muted2}
                  style={[
                    styles.titleInput,
                    lifeRoadType.serifNorth,
                    { color: lr.ink, borderBottomColor: lr.line },
                  ]}
                />
                <View style={styles.lineNote}>
                  <Text style={{ fontSize: 11, color: lr.muted, flex: 1 }}>标题非空才可保存</Text>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>简短、可被记住</Text>
                </View>
              </FormCard>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={2} fromY={10}>
              <FormCard lr={lr}>
                <View style={styles.fieldHead}>
                  <View style={styles.fieldLabel}>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>02</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}>说明</Text>
                  </View>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                    {noteLen} / {LIFE_ROAD_NOTE_MAX}
                  </Text>
                </View>
                <TextInput
                  value={note}
                  onChangeText={(t) => setNote([...t].slice(0, LIFE_ROAD_NOTE_MAX).join(''))}
                  maxLength={LIFE_ROAD_NOTE_MAX}
                  placeholder="可选：为什么要走这一步？"
                  placeholderTextColor={lr.muted2}
                  multiline
                  textAlignVertical="top"
                  style={[styles.noteInput, { color: lr.ink3 }]}
                />
              </FormCard>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={3} fromY={10}>
              <FormCard lr={lr}>
                <View style={styles.fieldHead}>
                  <View style={styles.fieldLabel}>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>03</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}>状态</Text>
                  </View>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>4 种</Text>
                </View>
                <View style={styles.statusGrid}>
                  {LIFE_ROAD_NODE_STATUS_VALUES.map((s) => {
                    const on = status === s;
                    const tone = STATUS_TONE[s];
                    return (
                      <Pressable
                        key={s}
                        onPress={() => setStatus(s)}
                        style={[
                          styles.statusOpt,
                          {
                            borderColor: on ? tone.color : lr.line,
                            backgroundColor: on ? tone.bg : 'rgba(255,255,255,0.32)',
                          },
                        ]}>
                        <View
                          style={[styles.statusDot, { backgroundColor: tone.color }]}
                        />
                        <Text
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 12,
                            fontWeight: on ? '700' : '500',
                            color: on ? lr.ink : lr.ink3,
                          }}
                          numberOfLines={1}>
                          {LIFE_ROAD_NODE_STATUS_LABELS[s]}
                        </Text>
                        {on ? (
                          <Text style={{ fontSize: 11, fontWeight: '700', color: tone.color }}>
                            ✓
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </FormCard>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={4} fromY={10}>
              <FormCard lr={lr}>
                <View style={styles.fieldHead}>
                  <View style={styles.fieldLabel}>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>04</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}>
                      验收标准
                    </Text>
                  </View>
                  <View style={styles.aiHeadActions}>
                    <Pressable
                      onPress={() => setAcceptAiOpen(true)}
                      disabled={!title.trim()}
                      style={({ pressed }) => [
                        styles.aiMiniBtn,
                        {
                          borderColor: lr.line,
                          opacity: !title.trim() ? 0.4 : pressed ? 0.88 : 1,
                        },
                      ]}>
                      <AppIcon name="auto-awesome" size={12} color={lr.pine} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: lr.pine }}>
                        生成验收
                      </Text>
                    </Pressable>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                      {acceptance.length} / {LIFE_ROAD_ACCEPTANCE_MAX_ITEMS}
                    </Text>
                  </View>
                </View>
                <AcceptanceChecklistEditor
                  items={acceptance}
                  onChange={setAcceptance}
                  ink2={lr.ink2}
                  ink3={lr.ink3}
                  muted={lr.muted}
                  muted2={lr.muted2}
                  faint={lr.muted2}
                  line={lr.line}
                  pine={lr.pine}
                  onRoad={lr.onRoad}
                  clay2={lr.clay2}
                />
                <View style={styles.lineNote}>
                  <Text style={{ fontSize: 11, color: lr.muted, flex: 1 }}>
                    勾选会直接写回 extra_data
                  </Text>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                    最多 {LIFE_ROAD_ACCEPTANCE_MAX_ITEMS} 条
                  </Text>
                </View>
              </FormCard>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={5} fromY={10}>
              <Pressable
                onPress={() => setUpdateAiOpen(true)}
                disabled={!title.trim()}
                style={({ pressed }) => [
                  styles.aiUpdateBtn,
                  {
                    borderColor: lr.line,
                    backgroundColor: 'rgba(255,255,255,0.55)',
                    opacity: !title.trim() ? 0.45 : pressed ? 0.9 : 1,
                  },
                ]}>
                <AppIcon name="auto-awesome" size={14} color={lr.pine} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: lr.pine }}>
                    一句话更新
                  </Text>
                  <Text style={{ fontSize: 11, color: lr.muted, marginTop: 2 }}>
                    自然语言改状态 / 说明 / 验收草稿
                  </Text>
                </View>
              </Pressable>
            </FoldRiseIn>

            <View style={styles.helperNote}>
              <AppIcon name="info-outline" size={12} color={lr.muted2} />
              <Text style={{ flex: 1, fontSize: 11, lineHeight: 16, color: lr.muted }}>
                道路只负责方向与验收：这里没有截止日期、优先级、进度条，也不进入任务日历与积分。
              </Text>
            </View>
          </ScrollView>

          <View
            style={[
              styles.formFooter,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                backgroundColor: lr.paper,
              },
            ]}>
            <Pressable
              onPress={() => void onSave()}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.btnSave,
                {
                  backgroundColor: lr.pine,
                  opacity: !canSave ? 0.38 : pressed ? 0.92 : 1,
                },
              ]}>
              <CheckIcon color={lr.onRoad} />
              <Text style={[lifeRoadType.cta, { color: lr.onRoad, letterSpacing: 0.8 }]}>
                {saving ? '保存中…' : isNew ? '创建节点' : '保存节点'}
              </Text>
            </Pressable>
            <Text style={styles.footerHint}>{footerHint}</Text>
          </View>
        </KeyboardAvoidingView>
      )}

      <AiLifeRoadAcceptanceSheet
        visible={acceptAiOpen}
        onClose={() => setAcceptAiOpen(false)}
        title={title}
        note={note}
        kind={kind}
        existingAcceptance={acceptance.map(a => a.text).filter(Boolean)}
        directionBody={directionBody || undefined}
        currentCount={acceptance.length}
        onApply={items => {
          setAcceptance(prev => {
            const room = Math.max(0, LIFE_ROAD_ACCEPTANCE_MAX_ITEMS - prev.length);
            const existing = new Set(prev.map(p => p.text.trim().toLowerCase()));
            const add = items
              .filter(a => a.text.trim() && !existing.has(a.text.trim().toLowerCase()))
              .slice(0, room);
            return add.length ? [...prev, ...add] : prev;
          });
        }}
      />

      <AiLifeRoadNodeUpdateSheet
        visible={updateAiOpen}
        onClose={() => setUpdateAiOpen(false)}
        nodeSummary={{
          title,
          note,
          kind,
          status,
          acceptance: acceptance.map(a => a.text).filter(Boolean),
        }}
        onApply={onApplyNodeUpdate}
      />
    </SafeAreaView>
  );
}

function FormCard({
  lr,
  children,
}: {
  lr: LifeRoadPalette;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.formCard, { borderColor: lr.line, backgroundColor: lr.card2 }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 8,
    gap: 9,
  },
  appBarSide: {
    width: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  appBarSideEnd: { justifyContent: 'flex-end' },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 4 },
  appTitle: {
    ...lifeRoadType.appTitle,
    fontSize: 17,
    lineHeight: 20,
  },
  deleteTop: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingTop: 4 },
  slotCrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 2,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  crumbDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  formCard: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 13,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  fieldLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  aiHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  aiUpdateBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  titleInput: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 1,
    paddingTop: 3,
    paddingBottom: 7,
    fontSize: 15,
  },
  noteInput: {
    minHeight: 72,
    paddingHorizontal: 1,
    paddingVertical: 2,
    fontSize: 14,
    lineHeight: 22,
  },
  lineNote: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 6,
  },
  statusOpt: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  helperNote: {
    marginTop: 12,
    marginHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
  },
  formFooter: {
    paddingHorizontal: 18,
    paddingTop: 9,
  },
  btnSave: {
    height: 43,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  footerHint: {
    textAlign: 'center',
    marginTop: 7,
    fontSize: 11,
    color: '#A6AEA5',
    letterSpacing: 0.2,
  },
});
