/**
 * 道路导图子页：对齐 `我的道路-UI重构.html` route-road
 *（同步条、总方向 north-card、今年之上 / 今年目标树 / 下一年；主页仅展示目标/任务，勾选在编辑页）。
 */
import { useWardrobeFonts } from '@/components/wardrobe/use-wardrobe-fonts';
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui/app-icon';
import { Spacing } from '@/constants/design-tokens';
import {
  lifeRoadType,
  useLifeRoadTheme,
  type LifeRoadPalette,
} from '@/constants/life-road-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  LIFE_ROAD_ACCEPTANCE_PRIORITIES,
  LIFE_ROAD_ACCEPTANCE_PRIORITY_LABELS,
  acceptanceLinkLabel,
  acceptanceMetaLabel,
  groupAcceptanceByPriority,
  lifeRoadItemNoun,
  parseAcceptanceCriteria,
  type LifeRoadAcceptanceItem,
  type LifeRoadItemNoun,
} from '@/lib/life-road/life-road-acceptance';
import { parseLifeWeekKey } from '@/lib/life-road/project-road-link';
import { listWeeksInMonth, parseWeekGoals } from '@/lib/life-road/life-road-weeks';
import {
  LIFE_ROAD_NODE_KIND_LABELS,
  LIFE_ROAD_NODE_STATUS_LABELS,
  monthLabel,
  quarterLabel,
  type LifeRoadNodeKind,
  type LifeRoadNodeStatus,
} from '@/lib/life-road/life-road-node-model';
import {
  buildRoadMindMap,
  type RoadMindMapModel,
  type RoadProjectRef,
} from '@/lib/life-road/life-road-tree';
import { getDatabase } from '@/lib/database';
import { getLifeDirection } from '@/lib/repositories/life-road/life-direction';
import type { LifeDirectionRow } from '@/lib/repositories/life-road/life-direction.types';
import {
  deleteLifeRoadNode,
  getLifeRoadNodes,
} from '@/lib/repositories/life-road/life-road-node';
import type { LifeRoadNodeRow } from '@/lib/repositories/life-road/life-road-node.types';
import { fetchProfileLifeRoad } from '@/lib/profile-page-api';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

const PAGE_KEY = 'life-road';

function joinMeta(...parts: Array<string | null | undefined>): string | undefined {
  const s = parts.filter((p) => p && String(p).trim()).join(' · ');
  return s || undefined;
}

function parseKeywords(extra: string | null | undefined): string[] {
  if (!extra?.trim()) return [];
  try {
    const parsed = JSON.parse(extra) as { keywords?: unknown };
    if (!Array.isArray(parsed?.keywords)) return [];
    return parsed.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0);
  } catch {
    return [];
  }
}

function statusTone(
  status: LifeRoadNodeStatus | undefined,
  lr: LifeRoadPalette,
): { label: string; color: string; bg: string; border: string } | null {
  if (!status) return null;
  const label = LIFE_ROAD_NODE_STATUS_LABELS[status];
  switch (status) {
    case 'on_track':
      return {
        label,
        color: lr.toneOnTrack,
        bg: lr.toneOnTrackBg,
        border: lr.toneOnTrackBorder,
      };
    case 'paused':
      return {
        label,
        color: lr.tonePaused,
        bg: lr.tonePausedBg,
        border: lr.tonePausedBorder,
      };
    case 'arrived':
      return {
        label,
        color: lr.toneArrived,
        bg: lr.toneArrivedBg,
        border: lr.toneArrivedBorder,
      };
    case 'dropped':
      return {
        label,
        color: lr.toneDropped,
        bg: lr.toneDroppedBg,
        border: lr.toneDroppedBorder,
      };
    default:
      return { label, color: lr.muted, bg: lr.sage2, border: lr.line };
  }
}

function ChevronIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
      <Path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function PencilIcon({ color }: { color: string }) {
  return (
    <Svg width={9} height={9} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function NorthCompass({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3v3M12 18v3M5 12H2M22 12h-3"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <Path
        d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"
        stroke={color}
        strokeWidth={1.5}
      />
    </Svg>
  );
}

function AcceptanceInlineRows({
  items,
  lr,
  depth,
}: {
  items: LifeRoadAcceptanceItem[];
  lr: LifeRoadPalette;
  depth: number;
}) {
  return (
    <>
      {items.map((item) => {
        const link = depth === 1 ? acceptanceLinkLabel(item) : null;
        return (
          <View key={item.id}>
            <View
              style={[
                styles.accItem,
                depth > 1 ? { paddingLeft: 8 + (depth - 1) * 12 } : null,
              ]}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                }}>
                <Text
                  style={[
                    styles.accTxt,
                    {
                      color: item.done ? lr.muted : lr.ink3,
                      textDecorationLine: item.done ? 'line-through' : 'none',
                    },
                  ]}
                  numberOfLines={2}>
                  {item.text}
                </Text>
              </View>
              {link ? (
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '700',
                    color: lr.pine3,
                    flexShrink: 0,
                  }}>
                  {link}
                </Text>
              ) : null}
            </View>
            {(item.children ?? []).length > 0 ? (
              <AcceptanceInlineRows
                items={item.children ?? []}
                lr={lr}
                depth={depth + 1}
              />
            ) : null}
          </View>
        );
      })}
    </>
  );
}

/** 主页只读展示：无勾选框；已完成删除线；顶层按 P0/P1/P2 分层 */
function AcceptanceInline({
  items,
  lr,
  noun = '目标',
}: {
  items: LifeRoadAcceptanceItem[];
  lr: LifeRoadPalette;
  noun?: LifeRoadItemNoun;
}) {
  if (items.length === 0) return null;
  const groups = groupAcceptanceByPriority(items);
  return (
    <View style={styles.accInner}>
      {LIFE_ROAD_ACCEPTANCE_PRIORITIES.map((p) => {
        const layer = groups[p];
        if (layer.length === 0) return null;
        return (
          <View key={p} style={{ marginBottom: 4 }}>
            <Text
              style={{
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 0.7,
                color: lr.muted2,
                paddingHorizontal: 10,
                paddingTop: 4,
                paddingBottom: 2,
              }}>
              {LIFE_ROAD_ACCEPTANCE_PRIORITY_LABELS[p]} · {noun}
            </Text>
            <AcceptanceInlineRows items={layer} lr={lr} depth={1} />
          </View>
        );
      })}
    </View>
  );
}

function MonthWeekProjectsInline({
  year,
  month,
  projects,
  weekGoalsExtra,
  lr,
  onOpenProject,
}: {
  year: number;
  month: number;
  projects: RoadProjectRef[];
  weekGoalsExtra: string | null | undefined;
  lr: LifeRoadPalette;
  onOpenProject: (projectId: string) => void;
}) {
  if (projects.length === 0) return null;
  const weeks = listWeeksInMonth(year, month);
  const goals = parseWeekGoals(weekGoalsExtra);
  const byWeek = new Map<string, RoadProjectRef[]>();
  const unassigned: RoadProjectRef[] = [];
  for (const p of projects) {
    const key = p.weekKey?.trim() || '';
    if (!key) {
      unassigned.push(p);
      continue;
    }
    const list = byWeek.get(key) ?? [];
    list.push(p);
    byWeek.set(key, list);
  }
  return (
    <View style={{ paddingHorizontal: 8, paddingBottom: 6, gap: 6 }}>
      {weeks.map((w) => {
        const list = byWeek.get(w.weekKey) ?? [];
        const goalText = goals[w.weekKey]?.text?.trim();
        if (list.length === 0 && !goalText) return null;
        return (
          <View key={w.weekKey}>
            <Text
              style={{
                fontSize: 10,
                fontWeight: '700',
                color: lr.muted2,
                paddingHorizontal: 4,
                marginBottom: 2,
              }}>
              {w.label}
              {goalText ? ` · ${goalText}` : ''}
            </Text>
            {list.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                lr={lr}
                onPress={() => onOpenProject(p.id)}
              />
            ))}
          </View>
        );
      })}
      {unassigned.length > 0 ? (
        <View>
          <Text
            style={{
              fontSize: 10,
              fontWeight: '700',
              color: lr.muted2,
              paddingHorizontal: 4,
              marginBottom: 2,
            }}>
            未分周
          </Text>
          {unassigned.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              lr={lr}
              onPress={() => onOpenProject(p.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

type DraftTarget =
  | { mode: 'edit'; node: LifeRoadNodeRow }
  | {
      mode: 'create';
      kind: LifeRoadNodeKind;
      calendar_year?: number;
      quarter?: number;
      month?: number;
      parent_id?: string | null;
    };

function NodeRow({
  kindLabel,
  title,
  meta,
  empty,
  current,
  open,
  onToggle,
  onPress,
  status,
  showNow,
  lr,
}: {
  kindLabel: string;
  title: string;
  meta?: string;
  empty?: boolean;
  current?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onPress: () => void;
  status?: LifeRoadNodeStatus;
  showNow?: boolean;
  lr: LifeRoadPalette;
}) {
  const tone = statusTone(status, lr);
  return (
    <View
      style={[
        styles.trow,
        current && {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: lr.currentBorder,
          backgroundColor: lr.currentWash,
        },
        empty && { opacity: 0.85 },
      ]}>
      {onToggle ? (
        <Pressable
          onPress={onToggle}
          hitSlop={8}
          accessibilityLabel={open ? '折叠' : '展开'}
          style={[
            styles.tchev,
            {
              backgroundColor: lr.pineGhost,
              borderColor: lr.pineGhostBorder,
            },
          ]}>
          <ChevronIcon open={!!open} color={lr.muted} />
        </Pressable>
      ) : empty ? (
        <View
          style={[
            styles.emptyPlus,
            { borderColor: lr.line2, backgroundColor: lr.emptyPlusBg },
          ]}>
          <Text style={{ color: lr.muted2, fontSize: 14 }}>+</Text>
        </View>
      ) : (
        <View style={styles.tchevBlank} />
      )}
      <Pressable onPress={onPress} style={styles.tmain} accessibilityRole="button">
        <View style={styles.ttitle}>
          <Text style={[lifeRoadType.nodeKind, { color: lr.muted2 }]}>{kindLabel}</Text>
          <Text
            style={[
              lifeRoadType.nodeName,
              {
                color: empty ? lr.muted : current ? lr.pine : lr.ink2,
                fontStyle: empty ? 'italic' : 'normal',
                flexShrink: 1,
              },
            ]}
            numberOfLines={2}>
            {title}
          </Text>
          {tone ? (
            <View
              style={[
                styles.statusPill,
                { backgroundColor: tone.bg, borderColor: tone.border },
              ]}>
              <View style={[styles.statusDot, { backgroundColor: tone.color }]} />
              <Text style={{ fontSize: 10, fontWeight: '600', color: tone.color }}>
                {tone.label}
              </Text>
            </View>
          ) : null}
          {showNow ? (
            <View
              style={[
                styles.nowTag,
                {
                  backgroundColor: lr.nowBg,
                  borderColor: lr.nowBorder,
                },
              ]}>
              <Text style={[lifeRoadType.monoTiny, { color: lr.nowInk }]}>NOW</Text>
            </View>
          ) : null}
        </View>
        {meta ? (
          <Text style={[styles.tmeta, { color: lr.muted }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function ProjectCard({
  project,
  lr,
  onPress,
}: {
  project: RoadProjectRef;
  lr: LifeRoadPalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.projCard,
        {
          borderColor: lr.line,
          backgroundColor: lr.card2,
          opacity: pressed ? 0.92 : 1,
        },
      ]}>
      <View
        style={[
          styles.projIco,
          { backgroundColor: lr.sage2, borderColor: 'rgba(140,173,156,0.18)' },
        ]}>
        <AppIcon name="flag" size={14} color={lr.pine} />
      </View>
      <View style={styles.projCopy}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }} numberOfLines={1}>
          {project.name}
        </Text>
        <Text style={{ fontSize: 11, color: lr.muted, marginTop: 2 }} numberOfLines={1}>
          项目 · {project.status}
        </Text>
      </View>
      <View style={[styles.projGo, { backgroundColor: lr.pineWash }]}>
        <AppIcon name="chevron-right" size={12} color={lr.muted} />
      </View>
    </Pressable>
  );
}

export default function LifeRoadScreen() {
  useWardrobeFonts();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lr } = useLifeRoadTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_KEY);
  const params = useLocalSearchParams<{ focus_month_id?: string | string[] }>();
  const focusMonthId = useMemo(() => {
    const raw = params.focus_month_id;
    const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    return (s ?? '').trim() || null;
  }, [params.focus_month_id]);

  const [direction, setDirection] = useState<LifeDirectionRow | null>(null);
  const [model, setModel] = useState<RoadMindMapModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [revealEmptySeason, setRevealEmptySeason] = useState(false);
  const seededExpand = useRef(false);
  const appliedFocusRef = useRef<string | null>(null);
  const yearNow = new Date().getFullYear();
  const monthNow = new Date().getMonth() + 1;

  const rebuild = useCallback(async () => {
    const [dir, nodes] = await Promise.all([
      getLifeDirection({ serverFallback: true }),
      getLifeRoadNodes({ serverFallback: true }),
    ]);
    setDirection(dir);

    const db = await getDatabase();
    const projectsByMonthId = new Map<string, RoadProjectRef[]>();
    if (db) {
      const linked = await db.getAllAsync<{
        id: string;
        name: string;
        status: string;
        life_month_goal_id: string;
        extra_data: string | null;
      }>(
        `SELECT id, name, status, life_month_goal_id, extra_data FROM projects
         WHERE life_month_goal_id IS NOT NULL
           AND life_month_goal_id != ''
           AND sync_status != 'pending_delete'
           AND status IN (
             'todo', 'doing', 'blocked', 'shelved', 'done',
             'active', 'paused', 'completed'
           )`,
      );
      for (const p of linked ?? []) {
        const mid = String(p.life_month_goal_id);
        const list = projectsByMonthId.get(mid) ?? [];
        list.push({
          id: String(p.id),
          name: String(p.name),
          status: String(p.status),
          weekKey: parseLifeWeekKey(p.extra_data),
        });
        projectsByMonthId.set(mid, list);
      }
    }
    const next = buildRoadMindMap(nodes, projectsByMonthId);
    setModel(next);
    if (!seededExpand.current) {
      setExpanded(new Set(next.defaultExpandedKeys));
      seededExpand.current = true;
    }
  }, []);

  const reload = useCallback(
    async (force = false) => {
      setLoading(true);
      setSyncing(true);
      try {
        await wrapLoad(async () => {
          await fetchProfileLifeRoad({ serverFallback: true });
          await rebuild();
        }, force);
      } catch (e) {
        toast.error(toUserMessage(e, '道路加载失败'));
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    [rebuild, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_KEY, () => reload(true));

  useFocusEffect(
    useCallback(() => {
      void reload(false);
    }, [reload]),
  );

  /** 从任务页「道路归属」跳入时，展开对应年月季 */
  useEffect(() => {
    if (!model || !focusMonthId) return;
    if (appliedFocusRef.current === focusMonthId) return;
    for (const yearBranch of model.years) {
      for (const q of yearBranch.quarters) {
        for (const m of q.months) {
          if (m.node?.id !== focusMonthId) continue;
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add('above');
            next.add(`year:${yearBranch.year}`);
            next.add(`quarter:${yearBranch.year}:${q.quarter}`);
            next.add(`month:${yearBranch.year}:${m.month}`);
            return next;
          });
          appliedFocusRef.current = focusMonthId;
          return;
        }
      }
    }
  }, [focusMonthId, model]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openDirection = () => router.push('/edit-life-direction');

  const openNode = (target: DraftTarget) => {
    if (target.mode === 'edit') {
      router.push({
        pathname: '/edit-life-road-node/[id]',
        params: { id: target.node.id },
      });
      return;
    }
    const params: {
      id: string;
      kind: string;
      year?: string;
      quarter?: string;
      month?: string;
      parent_id?: string;
    } = {
      id: 'new',
      kind: target.kind,
    };
    if (target.calendar_year != null) params.year = String(target.calendar_year);
    if (target.quarter != null) params.quarter = String(target.quarter);
    if (target.month != null) params.month = String(target.month);
    if (target.parent_id) params.parent_id = target.parent_id;
    router.push({ pathname: '/edit-life-road-node/[id]', params });
  };

  const confirmDelete = (node: LifeRoadNodeRow) => {
    Alert.alert('删除节点', `确定删除「${node.title}」？挂在其下的项目会摘除归属。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteLifeRoadNode(node.id);
              toast.success('已删除');
              await rebuild();
            } catch (e) {
              toast.error(toUserMessage(e, '删除失败'));
            }
          })();
        },
      },
    ]);
  };

  const aboveOpen = expanded.has('above');
  const keywords = useMemo(() => parseKeywords(direction?.extra_data), [direction?.extra_data]);
  const syncStamp = useMemo(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, [model, direction]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: lr.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.appBar, { paddingTop: insets.top + 4 }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            {
              borderColor: lr.line,
              backgroundColor: lr.iconBtn,
              opacity: pressed ? 0.88 : 1,
            },
          ]}>
          <AppIcon name="arrow-back" size={18} color={lr.ink2} />
        </Pressable>
        <View style={styles.appBarTitleWrap}>
          <Text style={[lifeRoadType.appTitle, { color: lr.pine }]}>我的道路</Text>
          <Text style={[lifeRoadType.appSub, { color: lr.muted }]}>
            LIFE ROAD · {yearNow}
          </Text>
        </View>
        <Pressable
          onPress={() => openNode({ mode: 'create', kind: 'multi' })}
          accessibilityLabel="添加多年目标"
          style={({ pressed }) => [
            styles.pillBtn,
            {
              backgroundColor: lr.pine,
              opacity: pressed ? 0.9 : 1,
            },
          ]}>
          <Text style={{ color: lr.onRoad, fontSize: 16, lineHeight: 16, marginTop: -1 }}>+</Text>
          <Text style={{ color: lr.onRoad, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>
            多年
          </Text>
        </Pressable>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingTop: 4,
          paddingBottom: insets.bottom + Spacing['6xl'],
        }}
        showsVerticalScrollIndicator={false}>
        <FoldRiseIn animate={motionOn} index={0} fromY={8}>
          <View
            style={[
              styles.syncBar,
              {
                borderColor: lr.syncBorder,
                backgroundColor: lr.syncWash,
              },
            ]}>
            <View
              style={[
                styles.sdot,
                { backgroundColor: syncing ? lr.amber : lr.sage },
              ]}
            />
            <Text style={[styles.stext, { color: lr.ink3 }]} numberOfLines={1}>
              {syncing ? '正在同步道路…' : `云端已同步 · ${syncStamp}`}
            </Text>
            <Pressable
              onPress={() => void reload(true)}
              style={[
                styles.refreshChip,
                {
                  borderColor: lr.clay2,
                  backgroundColor: lr.chipSoft,
                },
              ]}>
              <AppIcon name="refresh" size={11} color={lr.clay} />
              <Text style={[lifeRoadType.monoTiny, { color: lr.clay }]}>刷新</Text>
            </Pressable>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={1} fromY={8}>
          <View
            style={[
              styles.roadHint,
              {
                borderColor: lr.line2,
                backgroundColor: lr.softPanel,
              },
            ]}>
            <AppIcon name="explore" size={12} color={lr.clay} />
              <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: lr.muted }}>
              <Text style={{ fontWeight: '600', color: lr.ink3 }}>点标题编辑</Text>
              {' · 年/季目标 · 月任务 · 项目按周挂在月编辑页'}
            </Text>
          </View>
        </FoldRiseIn>

        {loading && !model ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={lr.pine} />
        ) : (
          <>
            <FoldRiseIn animate={motionOn} index={2} fromY={10}>
              <View
                style={[
                  styles.northCard,
                  { borderColor: lr.line, backgroundColor: lr.card2 },
                ]}>
                <View
                  style={[styles.northOrbit, { borderColor: lr.northOrbit }]}
                  pointerEvents="none"
                />
                <View style={styles.northHead}>
                  <View style={styles.kickerRow}>
                    <NorthCompass color={lr.clay} />
                    <Text style={[lifeRoadType.kickerTiny, { color: lr.clay }]}>
                      TRUE NORTH · 总方向
                    </Text>
                  </View>
                  <Pressable
                    onPress={openDirection}
                    style={[
                      styles.northEdit,
                      {
                        borderColor: lr.line,
                        backgroundColor: lr.checkEmpty,
                      },
                    ]}>
                    <PencilIcon color={lr.ink3} />
                    <Text style={{ fontSize: 11, color: lr.ink3 }}>编辑</Text>
                  </Pressable>
                </View>
                <Pressable onPress={openDirection}>
                  <Text
                    style={[
                      lifeRoadType.serifNorth,
                      {
                        color: direction?.body?.trim() ? lr.ink : lr.muted,
                        marginTop: 8,
                        fontStyle: direction?.body?.trim() ? 'normal' : 'italic',
                      },
                    ]}>
                    {direction?.body?.trim() || '点击写下总方向'}
                  </Text>
                </Pressable>
                <View style={styles.northFoot}>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>
                    年度主题 · {direction?.year_theme?.trim() || '未命名'}
                  </Text>
                  <View style={[styles.footDot, { backgroundColor: lr.line2 }]} />
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted, flexShrink: 1 }]}>
                    关键词 · {keywords.length ? keywords.join(' / ') : '未选择'}
                  </Text>
                </View>
              </View>
            </FoldRiseIn>

            {/* 今年之上：独立于今年目标树，对齐「下一年目标」层级 */}
            <FoldRiseIn animate={motionOn} index={3} fromY={10}>
              <View
                style={[
                  styles.sideCard,
                  {
                    borderColor: lr.line2,
                    backgroundColor: lr.nextYearBg,
                  },
                ]}>
                <NodeRow
                  kindLabel="ABOVE · 今年之上"
                  title="今年之上"
                  meta={
                    model && model.aboveYear.length > 0
                      ? `3–10 年 · ${model.aboveYear.length} 个坐标`
                      : '可写多年或更远方向'
                  }
                  empty={!model?.aboveYear.length}
                  open={aboveOpen}
                  onToggle={() => toggle('above')}
                  onPress={() => toggle('above')}
                  lr={lr}
                />
                {aboveOpen ? (
                  <View style={styles.childrenPad}>
                    {(model?.aboveYear ?? []).map((n) => {
                      const criteria = parseAcceptanceCriteria(n.extra_data);
                      const cKey = `accept:${n.id}`;
                      const cOpen = expanded.has(cKey);
                      return (
                        <View key={n.id}>
                          <NodeRow
                            kindLabel={`${LIFE_ROAD_NODE_KIND_LABELS[n.kind]}`}
                            title={n.title}
                            meta={joinMeta(
                              LIFE_ROAD_NODE_STATUS_LABELS[n.status],
                              acceptanceMetaLabel(
                                criteria,
                                lifeRoadItemNoun(n.kind),
                              ),
                            )}
                            open={criteria.length > 0 ? cOpen : undefined}
                            onToggle={
                              criteria.length > 0 ? () => toggle(cKey) : undefined
                            }
                            onPress={() => openNode({ mode: 'edit', node: n })}
                            status={n.status}
                            lr={lr}
                          />
                          {cOpen ? (
                            <AcceptanceInline
                              items={criteria}
                              lr={lr}
                              noun={lifeRoadItemNoun(n.kind)}
                            />
                          ) : null}
                        </View>
                      );
                    })}
                    <Pressable
                      onPress={() => openNode({ mode: 'create', kind: 'farther' })}
                      style={[
                        styles.addFar,
                        { borderColor: lr.line2, backgroundColor: lr.chipGhost },
                      ]}>
                      <Text style={{ color: lr.clay, fontSize: 14 }}>+</Text>
                      <Text style={{ fontSize: 12, color: lr.muted }}>更远</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={4} fromY={10}>
              <View
                style={[
                  styles.treeCard,
                  {
                    borderColor: lr.line,
                    backgroundColor: lr.treeCard,
                  },
                ]}>
                <View style={styles.treeHead}>
                  <Text style={[lifeRoadType.kickerTiny, { color: lr.muted }]}>
                    YEAR · 今年目标树
                  </Text>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                    {yearNow} · {monthNow} 月
                  </Text>
                </View>

                {(model?.years ?? []).map((yearBranch) => {
                  const yKey = `year:${yearBranch.year}`;
                  const yOpen = expanded.has(yKey);
                  const yearCriteria = yearBranch.node
                    ? parseAcceptanceCriteria(yearBranch.node.extra_data)
                    : [];
                  const emptyQuarters = yearBranch.quarters.filter(
                    (q) => !q.hasContent && !q.isCurrent,
                  );
                  return (
                    <View key={yKey}>
                      <NodeRow
                        kindLabel={`YEAR · ${yearBranch.year}`}
                        title={yearBranch.node?.title?.trim() || `${yearBranch.year} 年目标`}
                        empty={!yearBranch.node?.title?.trim()}
                        current={yearBranch.isCurrent}
                        showNow={yearBranch.isCurrent}
                        open={yOpen}
                        onToggle={() => toggle(yKey)}
                        meta={
                          acceptanceMetaLabel(yearCriteria, '目标') ?? undefined
                        }
                        onPress={() => {
                          if (yearBranch.node) {
                            openNode({ mode: 'edit', node: yearBranch.node });
                          } else {
                            openNode({
                              mode: 'create',
                              kind: 'year',
                              calendar_year: yearBranch.year,
                            });
                          }
                        }}
                        status={yearBranch.node?.status}
                        lr={lr}
                      />
                      {yOpen && yearBranch.node && yearCriteria.length > 0 ? (
                        <AcceptanceInline
                          items={yearCriteria}
                          lr={lr}
                          noun="目标"
                        />
                      ) : null}
                      {yOpen ? (
                        <View style={styles.childrenPad}>
                          {yearBranch.quarters.map((q) => {
                            const qKey = `quarter:${yearBranch.year}:${q.quarter}`;
                            const qOpen = expanded.has(qKey);
                            const qCriteria = q.node
                              ? parseAcceptanceCriteria(q.node.extra_data)
                              : [];
                            const isHiddenEmpty =
                              !q.hasContent &&
                              !q.isCurrent &&
                              !revealEmptySeason &&
                              yearBranch.isCurrent;
                            if (isHiddenEmpty) return null;
                            if (
                              !q.hasContent &&
                              !q.isCurrent &&
                              !yearBranch.isCurrent &&
                              !qOpen
                            ) {
                              return null;
                            }
                            return (
                              <View key={qKey}>
                                <NodeRow
                                  kindLabel={quarterLabel(q.quarter)}
                                  title={
                                    q.node?.title?.trim() ||
                                    (q.isCurrent ? '本季焦点' : '尚未落子')
                                  }
                                  empty={!q.node?.title?.trim()}
                                  current={q.isCurrent}
                                  showNow={q.isCurrent}
                                  open={qOpen}
                                  onToggle={() => toggle(qKey)}
                                  meta={
                                    q.node
                                      ? acceptanceMetaLabel(qCriteria, '目标') ??
                                        undefined
                                      : '空白季 · 点此新建'
                                  }
                                  onPress={() => {
                                    if (q.node) openNode({ mode: 'edit', node: q.node });
                                    else
                                      openNode({
                                        mode: 'create',
                                        kind: 'quarter',
                                        calendar_year: yearBranch.year,
                                        quarter: q.quarter,
                                        parent_id: yearBranch.node?.id ?? null,
                                      });
                                  }}
                                  status={q.node?.status}
                                  lr={lr}
                                />
                                {qOpen && q.node && qCriteria.length > 0 ? (
                                  <AcceptanceInline
                                    items={qCriteria}
                                    lr={lr}
                                    noun="目标"
                                  />
                                ) : null}
                                {qOpen ? (
                                  <View style={styles.childrenPad}>
                                    {q.months.map((m) => {
                                      const mKey = `month:${yearBranch.year}:${m.month}`;
                                      const mOpen = expanded.has(mKey);
                                      const mCriteria = m.node
                                        ? parseAcceptanceCriteria(m.node.extra_data)
                                        : [];
                                      const canExpand =
                                        m.projects.length > 0 || mCriteria.length > 0;
                                      const showKids = Boolean(mOpen && canExpand);
                                      const aKey = `accept:${m.node?.id ?? mKey}`;
                                      const aOpen = expanded.has(aKey);
                                      return (
                                        <View key={mKey}>
                                          <NodeRow
                                            kindLabel={monthLabel(m.month)}
                                            title={
                                              m.node?.title?.trim() ||
                                              (m.isCurrent ? '本月焦点' : '尚未落子')
                                            }
                                            empty={!m.node?.title?.trim()}
                                            current={m.isCurrent}
                                            showNow={m.isCurrent}
                                            open={canExpand ? mOpen : undefined}
                                            onToggle={
                                              canExpand ? () => toggle(mKey) : undefined
                                            }
                                            onPress={() => {
                                              if (m.node)
                                                openNode({ mode: 'edit', node: m.node });
                                              else
                                                openNode({
                                                  mode: 'create',
                                                  kind: 'month',
                                                  calendar_year: yearBranch.year,
                                                  quarter: m.quarter,
                                                  month: m.month,
                                                  parent_id: q.node?.id ?? null,
                                                });
                                            }}
                                            status={m.node?.status}
                                            meta={joinMeta(
                                              acceptanceMetaLabel(mCriteria, '任务'),
                                              m.projects.length > 0
                                                ? `${m.projects.length} 个项目`
                                                : null,
                                            )}
                                            lr={lr}
                                          />
                                          {m.node && mCriteria.length > 0 ? (
                                            <View style={styles.metaActions}>
                                              <Pressable
                                                onPress={() => toggle(aKey)}
                                                style={[
                                                  styles.metaChip,
                                                  {
                                                    borderColor: lr.syncBorder,
                                                    backgroundColor: lr.chipSoft,
                                                  },
                                                ]}>
                                                <Text style={{ fontSize: 11, color: lr.ink3 }}>
                                                  任务{' '}
                                                  <Text style={{ fontWeight: '700' }}>
                                                    {acceptanceMetaLabel(
                                                      mCriteria,
                                                      '任务',
                                                    )?.replace('任务 ', '') ?? '0'}
                                                  </Text>
                                                </Text>
                                                <ChevronIcon open={aOpen} color={lr.muted} />
                                              </Pressable>
                                              {m.projects.length > 0 ? (
                                                <View
                                                  style={[
                                                    styles.metaChip,
                                                    {
                                                      borderColor: lr.syncBorder,
                                                      backgroundColor: lr.chipSoft,
                                                    },
                                                  ]}>
                                                  <Text style={{ fontSize: 11, color: lr.ink3 }}>
                                                    {m.projects.length} 个项目
                                                  </Text>
                                                </View>
                                              ) : null}
                                              {m.isCurrent ? (
                                                <View
                                                  style={[
                                                    styles.metaChip,
                                                    {
                                                      borderColor: lr.syncBorder,
                                                      backgroundColor: lr.chipSoft,
                                                    },
                                                  ]}>
                                                  <Text style={{ fontSize: 11, color: lr.ink3 }}>
                                                    当前月
                                                  </Text>
                                                </View>
                                              ) : null}
                                            </View>
                                          ) : null}
                                          {(aOpen || (mOpen && mCriteria.length > 0)) &&
                                          m.node ? (
                                            <AcceptanceInline
                                              items={mCriteria}
                                              lr={lr}
                                              noun="任务"
                                            />
                                          ) : null}
                                          {showKids && m.node ? (
                                            <MonthWeekProjectsInline
                                              year={yearBranch.year}
                                              month={m.month}
                                              projects={m.projects}
                                              weekGoalsExtra={m.node.extra_data}
                                              lr={lr}
                                              onOpenProject={(projectId) =>
                                                router.push({
                                                  pathname: '/edit-project',
                                                  params: { id: projectId },
                                                })
                                              }
                                            />
                                          ) : null}
                                          {m.node &&
                                          mCriteria.length === 0 &&
                                          m.projects.length === 0 ? (
                                            <Text
                                              style={{
                                                fontSize: 11,
                                                color: lr.muted,
                                                paddingHorizontal: 10,
                                                paddingVertical: 6,
                                              }}>
                                              可写月任务；项目请在编辑页按周新建或引入。
                                            </Text>
                                          ) : null}
                                        </View>
                                      );
                                    })}
                                  </View>
                                ) : null}
                              </View>
                            );
                          })}
                          {yearBranch.isCurrent && emptyQuarters.length > 0 ? (
                            <Pressable
                              onPress={() => setRevealEmptySeason((v) => !v)}
                              style={styles.revealEmpty}>
                              <Text style={{ color: lr.clay, fontSize: 14 }}>+</Text>
                              <Text style={{ fontSize: 12, color: lr.muted }}>
                                空白季已自动收起{' '}
                                <Text
                                  style={{
                                    color: lr.clay,
                                    textDecorationLine: 'underline',
                                  }}>
                                  {revealEmptySeason ? '收起' : '显示'}
                                </Text>
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </FoldRiseIn>

            <Pressable
              onPress={() =>
                openNode({
                  mode: 'create',
                  kind: 'year',
                  calendar_year: yearNow + 1,
                })
              }
              style={({ pressed }) => [
                styles.nextYearBtn,
                {
                  borderColor: lr.line2,
                  backgroundColor: lr.nextYearBg,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}>
              <View style={[styles.nextYearPlus, { backgroundColor: lr.pineWashStrong }]}>
                <Text style={{ color: lr.pine, fontSize: 16 }}>+</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: lr.ink3 }}>
                下一年目标
              </Text>
              <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                {yearNow + 1} · YEAR
              </Text>
            </Pressable>

            <View style={styles.roadFoot}>
              <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                ATELIER · LIFE ROAD
              </Text>
              <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                SYNCED {syncStamp}
              </Text>
            </View>

            {__DEV__ && model ? (
              <Pressable
                onPress={() => {
                  const first = model.aboveYear[0] ?? model.years[0]?.node;
                  if (first) confirmDelete(first);
                }}
                style={{ marginTop: 16, opacity: 0.4 }}>
                <Text style={{ color: lr.muted2, fontSize: 10 }}>
                  DEV · 长按节点可在编辑页删除
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 8,
    gap: 9,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0, alignItems: 'center' },
  pillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
  },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sdot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  stext: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
  },
  refreshChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  roadHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  northCard: {
    marginTop: 12,
    paddingHorizontal: 15,
    paddingTop: 14,
    paddingBottom: 13,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  northOrbit: {
    position: 'absolute',
    right: -26,
    top: -38,
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 1,
  },
  northHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    zIndex: 1,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  northEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  northFoot: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    zIndex: 1,
  },
  footDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  sideCard: {
    marginTop: 11,
    paddingHorizontal: 5,
    paddingTop: 4,
    paddingBottom: 8,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  treeCard: {
    marginTop: 11,
    paddingHorizontal: 5,
    paddingTop: 6,
    paddingBottom: 9,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  treeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  trow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 7,
    paddingRight: 7,
    paddingLeft: 5,
    borderRadius: 13,
  },
  tchev: {
    width: 20,
    height: 20,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tchevBlank: {
    width: 20,
    height: 20,
    marginTop: 1,
  },
  emptyPlus: {
    width: 20,
    height: 20,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  tmain: {
    flex: 1,
    minWidth: 0,
  },
  ttitle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  tmeta: {
    marginTop: 2,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  nowTag: {
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  childrenPad: {
    paddingLeft: 17,
    marginLeft: 9,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(213,201,182,0.78)',
    gap: 1,
  },
  accInner: {
    marginLeft: 31,
    marginRight: 8,
    marginBottom: 2,
    paddingLeft: 9,
    paddingVertical: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(140,173,156,0.3)',
    gap: 2,
  },
  accItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  accCheck: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  accTxt: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 18,
  },
  metaActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginLeft: 26,
    marginBottom: 4,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  projCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 10,
    marginRight: 8,
    marginTop: 4,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  projIco: {
    width: 27,
    height: 27,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  projCopy: { flex: 1, minWidth: 0 },
  projGo: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accCreateProj: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  addProject: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 26,
    marginRight: 8,
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  addProjectPlus: {
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFar: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    marginTop: 3,
  },
  revealEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingLeft: 2,
    marginTop: 4,
  },
  nextYearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 11,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  nextYearPlus: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roadFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 17,
    paddingHorizontal: 3,
    paddingBottom: 6,
  },
});
