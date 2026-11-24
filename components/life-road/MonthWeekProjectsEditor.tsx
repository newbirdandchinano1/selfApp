/**
 * 月编辑页 · 周目标栏 + 本周项目列表（新建 / 引入现有）。
 */
import {
  lifeRoadType,
  type LifeRoadPalette,
} from '@/constants/life-road-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  listWeeksInMonth,
  type LifeRoadWeekGoalEntry,
  type LifeRoadWeekSlot,
} from '@/lib/life-road/life-road-weeks';
import { mergeLifeWeekKeyIntoExtraData } from '@/lib/life-road/project-road-link';
import { getProjects, updateProject } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { useRouter } from 'expo-router';
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

export type MonthWeekProjectRef = {
  id: string;
  name: string;
  status: string;
  weekKey: string | null;
};

type Props = {
  calendarYear: number;
  month: number;
  /** 已保存的月节点 id；新建未保存时为 null */
  monthNodeId: string | null;
  weekGoals: Record<string, LifeRoadWeekGoalEntry>;
  onChangeWeekGoals: (next: Record<string, LifeRoadWeekGoalEntry>) => void;
  projects: MonthWeekProjectRef[];
  onProjectsChanged: () => void;
  lr: LifeRoadPalette;
};

function ProjectRowView({
  project,
  lr,
  onPress,
  onDetach,
}: {
  project: MonthWeekProjectRef;
  lr: LifeRoadPalette;
  onPress: () => void;
  onDetach: () => void;
}) {
  return (
    <View
      style={[
        styles.projRow,
        { borderColor: lr.line, backgroundColor: lr.chip },
      ]}>
      <Pressable onPress={onPress} style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }} numberOfLines={1}>
          {project.name}
        </Text>
        <Text style={{ fontSize: 10, color: lr.muted, marginTop: 2 }}>{project.status}</Text>
      </Pressable>
      <Pressable onPress={onDetach} hitSlop={8} accessibilityLabel="移出本周">
        <Text style={{ fontSize: 11, color: lr.clay, fontWeight: '600' }}>移出</Text>
      </Pressable>
    </View>
  );
}

export function MonthWeekProjectsEditor({
  calendarYear,
  month,
  monthNodeId,
  weekGoals,
  onChangeWeekGoals,
  projects,
  onProjectsChanged,
  lr,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const weeks = useMemo(
    () => listWeeksInMonth(calendarYear, month),
    [calendarYear, month],
  );

  const [importWeek, setImportWeek] = useState<LifeRoadWeekSlot | null>(null);
  const [importCandidates, setImportCandidates] = useState<ProjectRow[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importBusyId, setImportBusyId] = useState<string | null>(null);

  const projectsByWeek = useMemo(() => {
    const map = new Map<string, MonthWeekProjectRef[]>();
    const unassigned: MonthWeekProjectRef[] = [];
    for (const p of projects) {
      const key = p.weekKey?.trim() || '';
      if (!key) {
        unassigned.push(p);
        continue;
      }
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return { map, unassigned };
  }, [projects]);

  const ensureSaved = useCallback(() => {
    if (!monthNodeId) {
      toast.warn('请先保存月节点，再挂项目');
      return false;
    }
    return true;
  }, [monthNodeId]);

  const openCreate = (week: LifeRoadWeekSlot) => {
    if (!ensureSaved()) return;
    router.push({
      pathname: '/add-project',
      params: {
        life_month_goal_id: monthNodeId!,
        life_week_key: week.weekKey,
      },
    });
  };

  const openImport = async (week: LifeRoadWeekSlot) => {
    if (!ensureSaved()) return;
    setImportWeek(week);
    setImportLoading(true);
    try {
      const all = await getProjects();
      const linkedIds = new Set(
        projects.filter((p) => p.weekKey === week.weekKey).map((p) => p.id),
      );
      const candidates = (all ?? []).filter(
        (p) =>
          !linkedIds.has(p.id) &&
          p.status !== 'cancelled' &&
          p.status !== 'archived',
      );
      setImportCandidates(candidates);
    } catch (e) {
      toast.error(toUserMessage(e, '加载项目失败'));
      setImportWeek(null);
    } finally {
      setImportLoading(false);
    }
  };

  const attachProject = async (project: ProjectRow) => {
    if (!importWeek || !monthNodeId) return;
    setImportBusyId(project.id);
    try {
      await updateProject(project.id, {
        life_month_goal_id: monthNodeId,
        extra_data: mergeLifeWeekKeyIntoExtraData(project.extra_data, importWeek.weekKey),
      });
      toast.success(`已引入「${project.name}」`);
      onProjectsChanged();
      setImportCandidates((prev) => prev.filter((p) => p.id !== project.id));
    } catch (e) {
      toast.error(toUserMessage(e, '引入失败'));
    } finally {
      setImportBusyId(null);
    }
  };

  const detachProject = async (project: MonthWeekProjectRef) => {
    try {
      const rows = await getProjects();
      const full = rows.find((p) => p.id === project.id);
      await updateProject(project.id, {
        life_month_goal_id: null,
        extra_data: mergeLifeWeekKeyIntoExtraData(full?.extra_data ?? null, null),
      });
      toast.success('已移出本周');
      onProjectsChanged();
    } catch (e) {
      toast.error(toUserMessage(e, '移出失败'));
    }
  };

  const setWeekText = (weekKey: string, text: string) => {
    const next = { ...weekGoals };
    const trimmed = text.trim();
    if (!trimmed) {
      delete next[weekKey];
    } else {
      next[weekKey] = {
        text,
        done: weekGoals[weekKey]?.done ?? false,
      };
    }
    onChangeWeekGoals(next);
  };

  useEffect(() => {
    if (!importWeek) {
      setImportCandidates([]);
      setImportBusyId(null);
    }
  }, [importWeek]);

  if (weeks.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.fieldLabel}>
          <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>05</Text>
          <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}>周目标</Text>
        </View>
        <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
          {weeks.length} 周
        </Text>
      </View>
      <Text style={{ fontSize: 11, color: lr.muted, marginBottom: 8, lineHeight: 16 }}>
        按周一至周日切周。栏下可新建或引入任务页项目。
      </Text>

      {weeks.map((week) => {
        const goal = weekGoals[week.weekKey];
        const weekProjects = projectsByWeek.map.get(week.weekKey) ?? [];
        return (
          <View
            key={week.weekKey}
            style={[
              styles.weekCard,
              { borderColor: lr.line, backgroundColor: lr.chipSoft },
            ]}>
            <Text style={[styles.weekTitle, { color: lr.pine }]}>{week.label}</Text>
            <TextInput
              value={goal?.text ?? ''}
              onChangeText={(t) => setWeekText(week.weekKey, t)}
              placeholder="本周目标（可选）"
              placeholderTextColor={lr.muted2}
              style={[
                styles.weekInput,
                {
                  color: lr.ink3,
                  borderColor: lr.line,
                  backgroundColor: lr.softPanel,
                },
              ]}
            />
            <View style={styles.projHead}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: lr.ink3 }}>
                本周项目 · {weekProjects.length}
              </Text>
              <View style={styles.projActions}>
                <Pressable
                  onPress={() => openCreate(week)}
                  style={[styles.miniBtn, { borderColor: lr.pine }]}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: lr.pine }}>
                    新建
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void openImport(week)}
                  style={[styles.miniBtn, { borderColor: lr.line }]}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: lr.ink3 }}>
                    引入
                  </Text>
                </Pressable>
              </View>
            </View>
            {weekProjects.length === 0 ? (
              <Text style={{ fontSize: 11, color: lr.muted, fontStyle: 'italic' }}>
                暂无项目
              </Text>
            ) : (
              weekProjects.map((p) => (
                <ProjectRowView
                  key={p.id}
                  project={p}
                  lr={lr}
                  onPress={() =>
                    router.push({ pathname: '/edit-project', params: { id: p.id } })
                  }
                  onDetach={() => void detachProject(p)}
                />
              ))
            )}
          </View>
        );
      })}

      {projectsByWeek.unassigned.length > 0 ? (
        <View
          style={[
            styles.weekCard,
            { borderColor: lr.line2, backgroundColor: lr.nextYearBg },
          ]}>
          <Text style={[styles.weekTitle, { color: lr.muted }]}>未分周 · 仅挂月</Text>
          {projectsByWeek.unassigned.map((p) => (
            <ProjectRowView
              key={p.id}
              project={p}
              lr={lr}
              onPress={() =>
                router.push({ pathname: '/edit-project', params: { id: p.id } })
              }
              onDetach={() => void detachProject(p)}
            />
          ))}
        </View>
      ) : null}

      <Modal
        visible={importWeek != null}
        animationType="slide"
        transparent
        onRequestClose={() => setImportWeek(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setImportWeek(null)} />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: lr.card,
                paddingBottom: Math.max(insets.bottom, 14),
              },
            ]}>
            <View style={[styles.handle, { backgroundColor: lr.line2 }]} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[lifeRoadType.kickerTiny, { color: lr.clay }]}>
                  IMPORT · 引入项目
                </Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: lr.ink, marginTop: 4 }}>
                  {importWeek?.label ?? '本周'}
                </Text>
                <Text style={{ fontSize: 12, color: lr.muted, marginTop: 4 }}>
                  从任务页现有项目直接挂到本周
                </Text>
              </View>
              <Pressable onPress={() => setImportWeek(null)} hitSlop={10}>
                <Text style={{ fontSize: 13, color: lr.muted }}>关闭</Text>
              </Pressable>
            </View>
            <ScrollView
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12, gap: 6 }}>
              {importLoading ? (
                <ActivityIndicator color={lr.pine} style={{ marginVertical: 24 }} />
              ) : importCandidates.length === 0 ? (
                <Text style={{ color: lr.muted, fontSize: 13, paddingVertical: 16 }}>
                  没有可引入的项目
                </Text>
              ) : (
                importCandidates.map((p) => {
                  const busy = importBusyId === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      disabled={busy}
                      onPress={() => void attachProject(p)}
                      style={[
                        styles.importRow,
                        {
                          borderColor: lr.line,
                          backgroundColor: lr.chip,
                          opacity: busy ? 0.55 : 1,
                        },
                      ]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}
                          numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={{ fontSize: 10, color: lr.muted, marginTop: 2 }}>
                          {p.status}
                          {p.life_month_goal_id ? ' · 已有道路归属' : ''}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: lr.pine }}>
                        {busy ? '…' : '引入'}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fieldLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  weekCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  weekTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  weekInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  projHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  projActions: { flexDirection: 'row', gap: 6 },
  miniBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  projRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,32,26,0.32)',
  },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handle: {
    width: 34,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 8,
    opacity: 0.65,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
