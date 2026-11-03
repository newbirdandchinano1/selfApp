/**
 * 道路导图子页：总方向 → 多年/更远 → 年 → 季 → 月 → 项目。
 * 节点可展开验收标准 checklist；默认只展开当前年 / 季 / 月。
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui/app-icon';
import { getMinTouchTarget, Spacing } from '@/constants/design-tokens';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  acceptanceMetaLabel,
  parseAcceptanceCriteria,
  writeAcceptanceCriteria,
  type LifeRoadAcceptanceItem,
} from '@/lib/life-road/life-road-acceptance';
import {
  LIFE_ROAD_NODE_KIND_LABELS,
  LIFE_ROAD_NODE_STATUS_LABELS,
  monthLabel,
  quarterLabel,
  type LifeRoadNodeKind,
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
  updateLifeRoadNode,
} from '@/lib/repositories/life-road/life-road-node';
import type { LifeRoadNodeRow } from '@/lib/repositories/life-road/life-road-node.types';
import { fetchProfileLifeRoad } from '@/lib/profile-page-api';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_KEY = 'life-road';
const MIN_TOUCH = getMinTouchTarget(Platform.OS);

function joinMeta(...parts: Array<string | null | undefined>): string | undefined {
  const s = parts.filter((p) => p && String(p).trim()).join(' · ');
  return s || undefined;
}

function AcceptanceInline({
  depth,
  items,
  fold,
  onToggleItem,
}: {
  depth: number;
  items: LifeRoadAcceptanceItem[];
  fold: ReturnType<typeof useFoldTheme>['fold'];
  onToggleItem: (itemId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ marginLeft: depth * 14 + 22, marginBottom: 6, gap: 4 }}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onToggleItem(item.id)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          style={[
            styles.acceptRow,
            {
              borderColor: fold.line,
              backgroundColor: 'rgba(255,252,245,0.72)',
            },
          ]}>
          <View
            style={[
              styles.acceptCheck,
              {
                borderColor: item.done ? fold.pine2 : fold.line,
                backgroundColor: item.done ? fold.sage2 : 'transparent',
              },
            ]}>
            <Text style={{ color: fold.pine2, fontSize: 10, fontWeight: '800' }}>
              {item.done ? '✓' : ''}
            </Text>
          </View>
          <Text
            style={[
              styles.acceptTxt,
              {
                color: item.done ? fold.muted : fold.ink2,
                textDecorationLine: item.done ? 'line-through' : 'none',
              },
            ]}
            numberOfLines={2}>
            {item.text}
          </Text>
        </Pressable>
      ))}
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

function Chevron({ open, color }: { open: boolean; color: string }) {
  return (
    <Text style={{ color, fontSize: 12, fontWeight: '800', width: 14 }}>
      {open ? '▾' : '▸'}
    </Text>
  );
}

function NodeRow({
  depth,
  label,
  title,
  meta,
  empty,
  current,
  open,
  onToggle,
  onPress,
  fold,
}: {
  depth: number;
  label: string;
  title: string;
  meta?: string;
  empty?: boolean;
  current?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onPress: () => void;
  fold: ReturnType<typeof useFoldTheme>['fold'];
}) {
  return (
    <View
      style={[
        styles.nodeRow,
        {
          marginLeft: depth * 14,
          borderColor: current ? fold.pine2 : fold.line,
          backgroundColor: current ? 'rgba(90,122,90,0.08)' : 'rgba(255,252,245,0.92)',
          opacity: empty ? 0.72 : 1,
        },
      ]}>
      {onToggle ? (
        <Pressable
          onPress={onToggle}
          hitSlop={8}
          accessibilityLabel={open ? '折叠' : '展开'}
          style={styles.chevBtn}>
          <Chevron open={!!open} color={fold.muted} />
        </Pressable>
      ) : (
        <View style={styles.chevBtn}>
          <Text style={{ color: fold.faint, fontSize: 10 }}>·</Text>
        </View>
      )}
      <Pressable onPress={onPress} style={styles.nodeMain} accessibilityRole="button">
        <Text style={[styles.nodeLab, { color: fold.faint }]}>{label}</Text>
        <Text
          style={[
            styles.nodeTitle,
            {
              color: empty ? fold.muted : fold.ink,
              fontFamily: depth <= 1 ? foldFonts.serif : undefined,
              fontStyle: empty ? 'italic' : 'normal',
            },
          ]}
          numberOfLines={2}>
          {title}
        </Text>
        {meta ? (
          <Text style={[styles.nodeMeta, { color: fold.faint }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

export default function LifeRoadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_KEY);

  const [direction, setDirection] = useState<LifeDirectionRow | null>(null);
  const [model, setModel] = useState<RoadMindMapModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seededExpand = useRef(false);

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
      }>(
        `SELECT id, name, status, life_month_goal_id FROM projects
         WHERE life_month_goal_id IS NOT NULL
           AND life_month_goal_id != ''
           AND sync_status != 'pending_delete'
           AND status IN ('active', 'paused', 'completed')`,
      );
      for (const p of linked ?? []) {
        const mid = String(p.life_month_goal_id);
        const list = projectsByMonthId.get(mid) ?? [];
        list.push({
          id: String(p.id),
          name: String(p.name),
          status: String(p.status),
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
      try {
        await wrapLoad(async () => {
          await fetchProfileLifeRoad({ serverFallback: true });
          await rebuild();
        }, force);
      } catch (e) {
        toast.error(toUserMessage(e, '道路加载失败'));
      } finally {
        setLoading(false);
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

  useEffect(() => {
    void reload(false);
  }, [reload]);

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
    const params: Record<string, string> = {
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

  const toggleAcceptanceItem = useCallback(
    (node: LifeRoadNodeRow, itemId: string) => {
      void (async () => {
        try {
          const items = parseAcceptanceCriteria(node.extra_data).map((it) =>
            it.id === itemId ? { ...it, done: !it.done } : it,
          );
          await updateLifeRoadNode(node.id, {
            extra_data: writeAcceptanceCriteria(node.extra_data, items),
          });
          await rebuild();
        } catch (e) {
          toast.error(toUserMessage(e, '更新验收标准失败'));
        }
      })();
    },
    [rebuild],
  );

  const aboveOpen = expanded.has('above');

  const headerRight = useMemo(
    () => (
      <Pressable
        onPress={() =>
          openNode({
            mode: 'create',
            kind: 'multi',
          })
        }
        accessibilityLabel="添加多年目标"
        style={{ paddingHorizontal: 8, minHeight: MIN_TOUCH, justifyContent: 'center' }}>
        <Text style={{ color: fold.pine2, fontWeight: '700', fontSize: 13 }}>+ 多年</Text>
      </Pressable>
    ),
    [fold.pine2],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <Stack.Screen
        options={{
          title: '我的道路',
          headerRight: () => headerRight,
        }}
      />
      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: 8,
          paddingBottom: insets.bottom + Spacing['6xl'],
        }}>
        <FoldRiseIn animate={motionOn} index={0} fromY={10}>
          <Text style={[styles.hint, { color: fold.muted }]}>
            浏览年季月拆解；节点可展开验收标准。具体做法与推进在项目里完成。
          </Text>
        </FoldRiseIn>

        {loading && !model ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={fold.pine} />
        ) : (
          <>
            <FoldRiseIn animate={motionOn} index={1} fromY={12}>
              <NodeRow
                depth={0}
                label="总方向"
                title={direction?.body?.trim() || '点击写下总方向'}
                empty={!direction?.body?.trim()}
                current
                onPress={openDirection}
                fold={fold}
              />
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={2} fromY={12}>
              <NodeRow
                depth={0}
                label="今年之上"
                title={
                  model && model.aboveYear.length > 0
                    ? `${model.aboveYear.length} 条多年 / 更远`
                    : '可写多年或更远方向'
                }
                empty={!model?.aboveYear.length}
                open={aboveOpen}
                onToggle={() => toggle('above')}
                onPress={() => toggle('above')}
                fold={fold}
              />
              {aboveOpen ? (
                <View>
                  {(model?.aboveYear ?? []).map((n) => {
                    const criteria = parseAcceptanceCriteria(n.extra_data);
                    const cKey = `accept:${n.id}`;
                    const cOpen = expanded.has(cKey);
                    return (
                      <View key={n.id}>
                        <NodeRow
                          depth={1}
                          label={LIFE_ROAD_NODE_KIND_LABELS[n.kind]}
                          title={n.title}
                          meta={joinMeta(
                            LIFE_ROAD_NODE_STATUS_LABELS[n.status],
                            acceptanceMetaLabel(criteria),
                          )}
                          open={criteria.length > 0 ? cOpen : undefined}
                          onToggle={
                            criteria.length > 0 ? () => toggle(cKey) : undefined
                          }
                          onPress={() => openNode({ mode: 'edit', node: n })}
                          fold={fold}
                        />
                        {cOpen ? (
                          <AcceptanceInline
                            depth={1}
                            items={criteria}
                            fold={fold}
                            onToggleItem={(itemId) => toggleAcceptanceItem(n, itemId)}
                          />
                        ) : null}
                      </View>
                    );
                  })}
                  <Pressable
                    onPress={() => openNode({ mode: 'create', kind: 'farther' })}
                    style={[styles.addGhost, { marginLeft: 14, borderColor: fold.line }]}>
                    <Text style={{ color: fold.pine2, fontSize: 12, fontWeight: '700' }}>
                      + 更远
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </FoldRiseIn>

            {(model?.years ?? []).map((yearBranch, yi) => {
              const yKey = `year:${yearBranch.year}`;
              const yOpen = expanded.has(yKey);
              const yearCriteria = yearBranch.node
                ? parseAcceptanceCriteria(yearBranch.node.extra_data)
                : [];
              return (
                <FoldRiseIn key={yKey} animate={motionOn} index={3 + yi} fromY={12}>
                  <NodeRow
                    depth={0}
                    label={`${yearBranch.year} 年`}
                    title={yearBranch.node?.title?.trim() || '点击写下今年目标'}
                    empty={!yearBranch.node?.title?.trim()}
                    current={yearBranch.isCurrent}
                    open={yOpen}
                    onToggle={() => toggle(yKey)}
                    meta={acceptanceMetaLabel(yearCriteria) ?? undefined}
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
                    fold={fold}
                  />
                  {yOpen && yearBranch.node ? (
                    <AcceptanceInline
                      depth={0}
                      items={yearCriteria}
                      fold={fold}
                      onToggleItem={(itemId) =>
                        toggleAcceptanceItem(yearBranch.node!, itemId)
                      }
                    />
                  ) : null}
                  {yOpen
                    ? yearBranch.quarters.map((q) => {
                        const qKey = `quarter:${yearBranch.year}:${q.quarter}`;
                        const qOpen = expanded.has(qKey);
                        const qCriteria = q.node
                          ? parseAcceptanceCriteria(q.node.extra_data)
                          : [];
                        const showEmptyQuarter =
                          q.hasContent ||
                          q.isCurrent ||
                          qOpen ||
                          qCriteria.length > 0;
                        if (!showEmptyQuarter && !yearBranch.isCurrent) {
                          // 非当前年：无内容季默认折叠隐藏骨架噪点
                          return null;
                        }
                        return (
                          <View key={qKey}>
                            <NodeRow
                              depth={1}
                              label={quarterLabel(q.quarter)}
                              title={
                                q.node?.title?.trim() ||
                                (q.isCurrent ? '本季焦点（可空）' : '空窗 · 点击填写')
                              }
                              empty={!q.node?.title?.trim()}
                              current={q.isCurrent}
                              open={qOpen}
                              onToggle={() => toggle(qKey)}
                              meta={acceptanceMetaLabel(qCriteria) ?? undefined}
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
                              fold={fold}
                            />
                            {qOpen && q.node ? (
                              <AcceptanceInline
                                depth={1}
                                items={qCriteria}
                                fold={fold}
                                onToggleItem={(itemId) =>
                                  toggleAcceptanceItem(q.node!, itemId)
                                }
                              />
                            ) : null}
                            {qOpen
                              ? q.months.map((m) => {
                                  const mKey = `month:${yearBranch.year}:${m.month}`;
                                  const mOpen = expanded.has(mKey);
                                  const mCriteria = m.node
                                    ? parseAcceptanceCriteria(m.node.extra_data)
                                    : [];
                                  const canExpand =
                                    m.projects.length > 0 || mCriteria.length > 0;
                                  const showKids = Boolean(mOpen && canExpand);
                                  return (
                                    <View key={mKey}>
                                      <NodeRow
                                        depth={2}
                                        label={monthLabel(m.month)}
                                        title={
                                          m.node?.title?.trim() ||
                                          (m.isCurrent ? '本月焦点（可空）' : '空窗')
                                        }
                                        empty={!m.node?.title?.trim()}
                                        current={m.isCurrent}
                                        open={canExpand ? mOpen : undefined}
                                        onToggle={
                                          canExpand ? () => toggle(mKey) : undefined
                                        }
                                        onPress={() => {
                                          if (m.node) openNode({ mode: 'edit', node: m.node });
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
                                        fold={fold}
                                        meta={joinMeta(
                                          acceptanceMetaLabel(mCriteria),
                                          m.projects.length > 0
                                            ? `${m.projects.length} 个项目`
                                            : null,
                                        )}
                                      />
                                      {showKids && m.node ? (
                                        <AcceptanceInline
                                          depth={2}
                                          items={mCriteria}
                                          fold={fold}
                                          onToggleItem={(itemId) =>
                                            toggleAcceptanceItem(m.node!, itemId)
                                          }
                                        />
                                      ) : null}
                                      {showKids
                                        ? m.projects.map((p) => (
                                            <NodeRow
                                              key={p.id}
                                              depth={3}
                                              label="项目"
                                              title={p.name}
                                              onPress={() =>
                                                router.push({
                                                  pathname: '/edit-project',
                                                  params: { id: p.id },
                                                })
                                              }
                                              fold={fold}
                                            />
                                          ))
                                        : null}
                                      {m.node ? (
                                        <Pressable
                                          onPress={() =>
                                            router.push({
                                              pathname: '/add-project',
                                              params: {
                                                life_month_goal_id: m.node!.id,
                                              },
                                            })
                                          }
                                          style={[
                                            styles.addGhost,
                                            { marginLeft: 14 * 3, borderColor: fold.line },
                                          ]}>
                                          <Text
                                            style={{
                                              color: fold.pine2,
                                              fontSize: 12,
                                              fontWeight: '700',
                                            }}>
                                            + 从此月建项目
                                          </Text>
                                        </Pressable>
                                      ) : null}
                                    </View>
                                  );
                                })
                              : null}
                          </View>
                        );
                      })
                    : null}
                </FoldRiseIn>
              );
            })}

            <Pressable
              onPress={() =>
                openNode({
                  mode: 'create',
                  kind: 'year',
                  calendar_year: new Date().getFullYear() + 1,
                })
              }
              style={[styles.addGhost, { borderColor: fold.line, marginTop: 12 }]}>
              <Text style={{ color: fold.pine2, fontSize: 12, fontWeight: '700' }}>
                + 下一年目标
              </Text>
            </Pressable>

            {__DEV__ && model ? (
              <Pressable
                onPress={() => {
                  const first = model.aboveYear[0] ?? model.years[0]?.node;
                  if (first) confirmDelete(first);
                }}
                style={{ marginTop: 24, opacity: 0.4 }}>
                <Text style={{ color: fold.faint, fontSize: 10 }}>
                  <AppIcon name="info" size={10} color={fold.faint} /> 长按节点可在编辑页删除
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
  hint: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  nodeRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  chevBtn: {
    width: 22,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeMain: {
    flex: 1,
    minWidth: 0,
  },
  nodeLab: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  nodeTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 1,
  },
  nodeMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  addGhost: {
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    alignItems: 'flex-start',
  },
  acceptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  acceptCheck: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  acceptTxt: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
});
