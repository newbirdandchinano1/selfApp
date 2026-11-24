/**
 * 道路节点编辑：对齐 `我的道路-UI重构.html` route-node
 *（自定义顶栏、槽位面包屑、表单卡片、底栏保存；月节点含周目标与项目）。
 */
import { AcceptanceChecklistEditor } from '@/components/life-road/AcceptanceChecklistEditor';
import {
  MonthWeekProjectsEditor,
  type MonthWeekProjectRef,
} from '@/components/life-road/MonthWeekProjectsEditor';
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
import { getDatabase } from '@/lib/database';
import {
  LIFE_ROAD_ACCEPTANCE_MAX_ITEMS,
  flattenAcceptanceItems,
  lifeRoadItemNoun,
  parseAcceptanceCriteria,
  writeAcceptanceCriteria,
  type LifeRoadAcceptanceItem,
} from '@/lib/life-road/life-road-acceptance';
import { parseLifeWeekKey } from '@/lib/life-road/project-road-link';
import {
  parseWeekGoals,
  weekGoalFingerprint,
  writeWeekGoals,
  type LifeRoadWeekGoalEntry,
} from '@/lib/life-road/life-road-weeks';
import {
  LIFE_ROAD_NODE_KIND_LABELS,
  LIFE_ROAD_NODE_STATUS_LABELS,
  LIFE_ROAD_NODE_STATUS_VALUES,
  LIFE_ROAD_NOTE_MAX,
  LIFE_ROAD_TITLE_MAX,
  LifeRoadValidationError,
  QUARTER_MONTHS,
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
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

const PAGE_KEY = 'edit-life-road-node';

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
  const [weekGoals, setWeekGoals] = useState<Record<string, LifeRoadWeekGoalEntry>>(
    {},
  );
  const [monthProjects, setMonthProjects] = useState<MonthWeekProjectRef[]>([]);
  const [extraDataBase, setExtraDataBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [nodeId, setNodeId] = useState<string | null>(isNew ? null : params.id);
  const [directionBody, setDirectionBody] = useState('');
  const [acceptAiOpen, setAcceptAiOpen] = useState(false);
  const [updateAiOpen, setUpdateAiOpen] = useState(false);
  const [legacyAcceptOpen, setLegacyAcceptOpen] = useState(false);
  const [baseline, setBaseline] = useState<{
    title: string;
    note: string;
    status: LifeRoadNodeStatus;
    acceptanceKey: string;
    weekGoalsKey: string;
  } | null>(
    isNew
      ? { title: '', note: '', status: 'on_track', acceptanceKey: '', weekGoalsKey: '' }
      : null,
  );

  const reloadMonthProjects = useCallback(async (monthId: string | null) => {
    if (!monthId) {
      setMonthProjects([]);
      return;
    }
    try {
      const db = await getDatabase();
      if (!db) {
        setMonthProjects([]);
        return;
      }
      const rows = await db.getAllAsync<{
        id: string;
        name: string;
        status: string;
        extra_data: string | null;
      }>(
        `SELECT id, name, status, extra_data FROM projects
         WHERE life_month_goal_id = ?
           AND sync_status != 'pending_delete'
           AND status IN (
             'todo', 'doing', 'blocked', 'shelved', 'done',
             'active', 'paused', 'completed'
           )
         ORDER BY updated_at DESC`,
        [monthId],
      );
      setMonthProjects(
        (rows ?? []).map((p) => ({
          id: String(p.id),
          name: String(p.name),
          status: String(p.status),
          weekKey: parseLifeWeekKey(p.extra_data),
        })),
      );
    } catch {
      setMonthProjects([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadMonthProjects(nodeId);
    }, [nodeId, reloadMonthProjects]),
  );

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

  const titleLen = [...title].length;
  const noteLen = [...note].length;
  const itemNoun = lifeRoadItemNoun(kind);

  const acceptanceKey = useMemo(
    () =>
      flattenAcceptanceItems(acceptance)
        .map(
          (it) =>
            `${it.id}:${it.done ? 1 : 0}:${it.priority ?? 'p1'}:${it.text.trim()}:q${it.link_quarter ?? ''}:m${it.link_month ?? ''}`,
        )
        .join('|'),
    [acceptance],
  );
  const weekGoalsKey = useMemo(() => weekGoalFingerprint(weekGoals), [weekGoals]);

  const linkMode =
    kind === 'year' ? 'quarter' : kind === 'quarter' ? 'month' : null;
  const linkMonthOptions = useMemo(() => {
    if (kind !== 'quarter') return [];
    const q = (quarter ?? 1) as 1 | 2 | 3 | 4;
    return [...(QUARTER_MONTHS[q] ?? QUARTER_MONTHS[1])];
  }, [kind, quarter]);

  const dirty = useMemo(() => {
    if (!baseline) return false;
    return (
      title.trim() !== baseline.title.trim() ||
      note.trim() !== baseline.note.trim() ||
      status !== baseline.status ||
      acceptanceKey !== baseline.acceptanceKey ||
      weekGoalsKey !== baseline.weekGoalsKey
    );
  }, [acceptanceKey, baseline, note, status, title, weekGoalsKey]);

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
          const weeks = parseWeekGoals(row.extra_data);
          setAcceptance(items);
          setWeekGoals(weeks);
          setBaseline({
            title: row.title,
            note: row.note ?? '',
            status: row.status,
            acceptanceKey: flattenAcceptanceItems(items)
              .map(
                (it) =>
                  `${it.id}:${it.done ? 1 : 0}:${it.priority ?? 'p1'}:${it.text.trim()}:q${it.link_quarter ?? ''}:m${it.link_month ?? ''}`,
              )
              .join('|'),
            weekGoalsKey: weekGoalFingerprint(weeks),
          });
          await reloadMonthProjects(row.id);
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
  }, [isNew, params.id, reloadMonthProjects, router, wrapLoad]);

  const onSave = useCallback(async () => {
    if (!title.trim()) {
      toast.warn('先写标题');
      return;
    }
    setSaving(true);
    try {
      let extra_data = writeAcceptanceCriteria(extraDataBase, acceptance);
      if (kind === 'month') {
        extra_data = writeWeekGoals(extra_data, weekGoals);
      }
      if (isNew || !nodeId) {
        const created = await createLifeRoadNode({
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
        setNodeId(created.id);
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
    weekGoals,
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

      <View
        style={[
          styles.appBar,
          {
            paddingTop: insets.top + 6,
            borderBottomColor: lr.line,
            backgroundColor: lr.paper,
          },
        ]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.backTextBtn,
            { opacity: pressed ? 0.7 : 1 },
          ]}>
          <AppIcon name="chevron-left" size={16} color={lr.sage} />
          <Text style={{ fontSize: 12, fontWeight: '500', color: lr.sage }}>返回</Text>
        </Pressable>
        <View style={styles.appBarTitleWrap}>
          <Text style={[lifeRoadType.appTitle, { color: lr.ink, fontSize: 13 }]} numberOfLines={1}>
            {isNew ? '新建节点' : '编辑节点'}
          </Text>
          <Text style={{ fontSize: 10, fontWeight: '500', color: lr.amber, marginTop: 2 }}>
            {slotLabel}
          </Text>
        </View>
        {!isNew ? (
          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel="删除"
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ fontSize: 12, fontWeight: '500', color: '#F43F5E' }}>删除</Text>
          </Pressable>
        ) : (
          <View style={{ width: 28 }} />
        )}
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
              <FormCard lr={lr}>
                <View style={styles.fieldHead}>
                  <Text style={{ fontSize: 11, fontWeight: '500', color: lr.sage }}>标题 *</Text>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.sage }]}>
                    {titleLen}/{LIFE_ROAD_TITLE_MAX}
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
                    { color: lr.ink, borderBottomColor: lr.line, fontSize: 16, fontWeight: '700' },
                  ]}
                />

                <View style={[styles.fieldHead, { marginTop: 16 }]}>
                  <Text style={{ fontSize: 11, fontWeight: '500', color: lr.sage }}>说明</Text>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.sage }]}>
                    {noteLen}/{LIFE_ROAD_NOTE_MAX}
                  </Text>
                </View>
                <TextInput
                  value={note}
                  onChangeText={(t) => setNote([...t].slice(0, LIFE_ROAD_NOTE_MAX).join(''))}
                  maxLength={LIFE_ROAD_NOTE_MAX}
                  placeholder="可选：补充背景与意图"
                  placeholderTextColor={lr.muted2}
                  multiline
                  textAlignVertical="top"
                  style={[styles.noteInput, { color: lr.ink, fontSize: 12, lineHeight: 20 }]}
                />

                <View style={[styles.statusGrid, { borderTopColor: lr.line, marginTop: 14, paddingTop: 14 }]}>
                  {LIFE_ROAD_NODE_STATUS_VALUES.map((s) => {
                    const selected = status === s;
                    return (
                      <Pressable
                        key={s}
                        onPress={() => setStatus(s)}
                        style={[
                          styles.statusOpt,
                          selected
                            ? { backgroundColor: lr.ink }
                            : { backgroundColor: lr.paper2 },
                        ]}>
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: '500',
                            color: selected ? lr.onRoad : lr.sage,
                          }}>
                          {LIFE_ROAD_NODE_STATUS_LABELS[s]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </FormCard>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={1} fromY={10}>
              <Pressable
                onPress={() => setUpdateAiOpen(true)}
                disabled={!title.trim()}
                style={({ pressed }) => [
                  styles.aiHeroBtn,
                  { opacity: !title.trim() ? 0.45 : pressed ? 0.92 : 1 },
                ]}>
                <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
                  <Defs>
                    <LinearGradient id="aiHeroGrad" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor={lr.roadDeep} />
                      <Stop offset="1" stopColor={lr.roadDeepMid} />
                    </LinearGradient>
                  </Defs>
                  <Rect x="0" y="0" width="100%" height="100%" fill="url(#aiHeroGrad)" />
                </Svg>
                <View style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#F5F3E8' }}>
                    一句话更新节点
                  </Text>
                  <Text style={{ fontSize: 10, color: '#A9C7B9', marginTop: 2 }}>
                    自然语言解析状态与进度
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: '#E0B072', zIndex: 1 }}>打开 →</Text>
              </Pressable>
            </FoldRiseIn>

            {kind === 'quarter' && calendarYear != null && quarter != null ? (
              <FoldRiseIn animate={motionOn} index={2} fromY={10}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/life-road',
                      params: { mode: 'panorama' },
                    })
                  }
                  style={({ pressed }) => [
                    styles.navLink,
                    {
                      borderColor: lr.line,
                      backgroundColor: lr.card,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '500', color: lr.ink }}>
                    查看本季度月份
                  </Text>
                  <Text style={{ fontSize: 12, color: lr.amber }}>道路全景 →</Text>
                </Pressable>
              </FoldRiseIn>
            ) : null}

            {kind === 'month' && calendarYear != null && month != null ? (
              <FoldRiseIn animate={motionOn} index={2} fromY={10}>
                <FormCard lr={lr}>
                  <View style={styles.fieldHead}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: lr.ink }}>
                      本月执行 · 周次与项目
                    </Text>
                  </View>
                  <MonthWeekProjectsEditor
                    calendarYear={calendarYear}
                    month={month}
                    monthNodeId={nodeId}
                    weekGoals={weekGoals}
                    onChangeWeekGoals={setWeekGoals}
                    projects={monthProjects}
                    onProjectsChanged={() => void reloadMonthProjects(nodeId)}
                    lr={lr}
                  />
                </FormCard>
              </FoldRiseIn>
            ) : null}

            <FoldRiseIn animate={motionOn} index={3} fromY={10}>
              <View
                style={[
                  styles.legacyWrap,
                  { borderColor: lr.line, backgroundColor: lr.card },
                ]}>
                <Pressable
                  onPress={() => setLegacyAcceptOpen((v) => !v)}
                  style={styles.legacyHead}
                  accessibilityRole="button">
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '500', color: lr.sage }}>
                    历史验收（兼容 · {flattenAcceptanceItems(acceptance).length} 条）
                  </Text>
                  <AppIcon
                    name={legacyAcceptOpen ? 'expand-less' : 'expand-more'}
                    size={16}
                    color={lr.sage}
                  />
                </Pressable>
                {legacyAcceptOpen ? (
                  <View
                    style={{
                      paddingHorizontal: 14,
                      paddingBottom: 14,
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: lr.line,
                    }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: 10,
                        marginBottom: 8,
                      }}>
                      <Text style={{ fontSize: 10, color: lr.muted }}>兼容保留字段</Text>
                      <Pressable
                        onPress={() => setAcceptAiOpen(true)}
                        disabled={!title.trim()}
                        hitSlop={6}
                        style={{ opacity: !title.trim() ? 0.4 : 1 }}>
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: '500',
                            color: lr.ink,
                            textDecorationLine: 'underline',
                          }}>
                          AI 拆解
                        </Text>
                      </Pressable>
                    </View>
                    <AcceptanceChecklistEditor
                      items={acceptance}
                      onChange={setAcceptance}
                      itemNoun={itemNoun}
                      linkMode={linkMode}
                      linkMonthOptions={linkMonthOptions}
                      allowChildren={kind === 'month'}
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
                  </View>
                ) : null}
              </View>
            </FoldRiseIn>
          </ScrollView>

          <View
            style={[
              styles.formFooter,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                backgroundColor: lr.card,
                borderTopColor: lr.line,
              },
            ]}>
            <Text style={[styles.footerHint, { color: lr.sage }]} numberOfLines={2}>
              {footerHint}
            </Text>
            <Pressable
              onPress={() => void onSave()}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.btnSave,
                {
                  backgroundColor: canSave ? lr.ink : lr.paper2,
                  opacity: pressed && canSave ? 0.92 : 1,
                },
              ]}>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '600',
                  color: canSave ? lr.onRoad : lr.muted,
                }}>
                {saving ? '保存中…' : isNew ? '创建节点' : '保存节点'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      <AiLifeRoadAcceptanceSheet
        visible={acceptAiOpen}
        onClose={() => setAcceptAiOpen(false)}
        title={title}
        note={note}
        kind={kind}
        existingAcceptance={flattenAcceptanceItems(acceptance)
          .map((a) => a.text)
          .filter(Boolean)}
        directionBody={directionBody || undefined}
        currentCount={flattenAcceptanceItems(acceptance).length}
        onApply={(items) => {
          setAcceptance((prev) => {
            const room = Math.max(
              0,
              LIFE_ROAD_ACCEPTANCE_MAX_ITEMS - flattenAcceptanceItems(prev).length,
            );
            const existing = new Set(
              flattenAcceptanceItems(prev).map((p) => p.text.trim().toLowerCase()),
            );
            const add = items
              .filter(
                (a) => a.text.trim() && !existing.has(a.text.trim().toLowerCase()),
              )
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
          acceptance: flattenAcceptanceItems(acceptance)
            .map((a) => a.text)
            .filter(Boolean),
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backTextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 56,
  },
  appBarTitleWrap: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 8 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },
  formCard: {
    marginTop: 0,
    marginBottom: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  aiHeroBtn: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 20,
    overflow: 'hidden',
  },
  titleInput: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
    paddingTop: 2,
    paddingBottom: 8,
  },
  noteInput: {
    minHeight: 72,
    maxHeight: 200,
    paddingHorizontal: 0,
    paddingVertical: 2,
  },
  statusGrid: {
    flexDirection: 'row',
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statusOpt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
  navLink: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legacyWrap: {
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  legacyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  formFooter: {
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(30,57,50,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  btnSave: {
    height: 40,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerHint: {
    flex: 1,
    fontSize: 10,
    color: '#8B9D91',
    letterSpacing: 0.2,
  },
});
