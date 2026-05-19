import {
  getTaskCompletionStatsByProjectId,
  getTaskCompletionStatsByProjectIds,
} from '@/lib/repositories/tasks/task';
import type { VisionSubGoal } from '@/lib/repositories/visions/vision.types';
import { collectLinkedProjectsFromSubGoal } from '@/lib/repositories/visions/vision.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type SubGoalProgress = {
  total: number;
  completed: number;
  percent: number;
};

type ProjectProgress = SubGoalProgress;

type VisionSubGoalsDetailPanelProps = {
  subGoals: VisionSubGoal[];
  textColor: string;
  outline: string;
  isDark: boolean;
  panelBg: string;
  panelBorder: string;
  visionPrimary?: string;
  /** 解绑后持久化到小目标列表 */
  onPersistSubGoals?: (next: VisionSubGoal[]) => Promise<void>;
};

const visionPrimaryDefault = '#0058be';

function progressFromStats(stats: { total: number; completed: number }): SubGoalProgress {
  const percent = stats.total > 0 ? stats.completed / stats.total : 0;
  return { ...stats, percent };
}

function ProgressBar({
  percent,
  trackBg,
  fillColor,
  height = 6,
}: {
  percent: number;
  trackBg: string;
  fillColor: string;
  height?: number;
}) {
  return (
    <View style={[styles.progressTrack, { backgroundColor: trackBg, height, borderRadius: height / 2 }]}>
      <View
        style={[
          styles.progressFill,
          {
            width: `${Math.min(100, Math.round(percent * 100))}%` as `${number}%`,
            backgroundColor: fillColor,
            borderRadius: height / 2,
          },
        ]}
      />
    </View>
  );
}

export function VisionSubGoalsDetailPanel({
  subGoals,
  textColor,
  outline,
  isDark,
  panelBg,
  panelBorder,
  visionPrimary = visionPrimaryDefault,
  onPersistSubGoals,
}: VisionSubGoalsDetailPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [progressById, setProgressById] = useState<Record<string, SubGoalProgress>>({});
  const [progressByProjectId, setProgressByProjectId] = useState<Record<string, ProjectProgress>>({});
  const [overallProgress, setOverallProgress] = useState<SubGoalProgress>({
    total: 0,
    completed: 0,
    percent: 0,
  });
  const [unbindingKey, setUnbindingKey] = useState<string | null>(null);
  const canUnbind = Boolean(onPersistSubGoals);

  const trackBg = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.45)';
  const summaryBg = isDark ? 'rgba(0,88,190,0.14)' : 'rgba(0,88,190,0.07)';
  const summaryBorder = isDark ? 'rgba(0,88,190,0.28)' : 'rgba(0,88,190,0.16)';
  const subGoalCardBg = isDark ? 'rgba(15,23,42,0.55)' : 'rgba(248,250,255,0.98)';
  const subGoalCardBorder = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.5)';
  const projectRowBg = isDark ? 'rgba(30,41,59,0.65)' : '#fff';
  const projectRowBorder = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(194,198,214,0.4)';

  const openProject = useCallback(
    (projectId: string) => {
      router.push({ pathname: '/edit-project', params: { id: projectId } });
    },
    [router]
  );

  const loadProgress = useCallback(async () => {
    setLoading(true);
    try {
      const allProjectIds = [
        ...new Set(subGoals.flatMap(sg => collectLinkedProjectsFromSubGoal(sg).map(p => p.id))),
      ];

      const [overallStats, projectEntries, sgEntries] = await Promise.all([
        getTaskCompletionStatsByProjectIds(allProjectIds),
        Promise.all(
          allProjectIds.map(async id => {
            const stats = await getTaskCompletionStatsByProjectId(id);
            return [id, progressFromStats(stats)] as const;
          })
        ),
        Promise.all(
          subGoals.map(async sg => {
            const ids = collectLinkedProjectsFromSubGoal(sg).map(p => p.id);
            if (ids.length === 0) {
              return [sg.id, progressFromStats({ total: 0, completed: 0 })] as const;
            }
            const stats = await getTaskCompletionStatsByProjectIds(ids);
            return [sg.id, progressFromStats(stats)] as const;
          })
        ),
      ]);

      setOverallProgress(progressFromStats(overallStats));
      setProgressByProjectId(Object.fromEntries(projectEntries));
      setProgressById(Object.fromEntries(sgEntries));
    } catch {
      setOverallProgress({ total: 0, completed: 0, percent: 0 });
      setProgressByProjectId({});
      setProgressById({});
    } finally {
      setLoading(false);
    }
  }, [subGoals]);

  useFocusEffect(
    useCallback(() => {
      void loadProgress();
    }, [loadProgress])
  );

  const boundProjectCount = useMemo(
    () => subGoals.reduce((n, sg) => n + collectLinkedProjectsFromSubGoal(sg).length, 0),
    [subGoals]
  );

  const requestUnbind = useCallback(
    (sg: VisionSubGoal, projectId: string, projectName: string) => {
      if (!onPersistSubGoals) return;
      Alert.alert('解绑项目', `确定将「${projectName || '该项目'}」从小目标「${sg.name}」解绑吗？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '解绑',
          style: 'destructive',
          onPress: () => {
            const key = `${sg.id}:${projectId}`;
            setUnbindingKey(key);
            const next = collectLinkedProjectsFromSubGoal(sg).filter(p => p.id !== projectId);
            const nextSubGoals = subGoals.map(item =>
              item.id === sg.id
                ? { ...item, linkedProjects: next.length > 0 ? next : undefined }
                : item
            );
            void (async () => {
              try {
                await onPersistSubGoals(nextSubGoals);
                await loadProgress();
              } catch {
                Alert.alert('解绑失败', '无法更新本地数据，请稍后重试。');
              } finally {
                setUnbindingKey(null);
              }
            })();
          },
        },
      ]);
    },
    [loadProgress, onPersistSubGoals, subGoals]
  );

  if (subGoals.length === 0) return null;

  const overallPctLabel = `${Math.round(overallProgress.percent * 100)}%`;

  return (
    <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
      {/* —— 一级：面板标题 —— */}
      <View style={styles.panelHeaderRow}>
        <View style={[styles.panelIconWrap, { backgroundColor: isDark ? 'rgba(0,88,190,0.2)' : 'rgba(0,88,190,0.1)' }]}>
          <MaterialIcons name="flag" size={18} color={visionPrimary} />
        </View>
        <View style={styles.panelHeaderText}>
          <Text style={[styles.panelTitle, { color: textColor }]}>小目标</Text>
          <Text style={[styles.panelSubtitle, { color: outline }]}>
            {subGoals.length} 项
            {boundProjectCount > 0 ? ` · ${boundProjectCount} 个绑定项目` : ''}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={visionPrimary} />
        </View>
      ) : (
        <>
          {/* —— 二级：整体进度摘要 —— */}
          {boundProjectCount > 0 ? (
            <View
              style={[
                styles.summaryCard,
                { backgroundColor: summaryBg, borderColor: summaryBorder },
              ]}
            >
              <View style={styles.summaryHeader}>
                <Text style={[styles.summaryLabel, { color: outline }]}>整体进度</Text>
                <Text style={[styles.summaryPct, { color: visionPrimary }]}>{overallPctLabel}</Text>
              </View>
              <ProgressBar
                percent={overallProgress.percent}
                trackBg={trackBg}
                fillColor={visionPrimary}
                height={8}
              />
              <Text style={[styles.summaryMeta, { color: outline }]}>
                {overallProgress.total > 0
                  ? `全部绑定项目 · 任务 ${overallProgress.completed} / ${overallProgress.total}`
                  : '已绑定项目，暂无统计任务'}
              </Text>
            </View>
          ) : null}

          {/* —— 二级：小目标列表 —— */}
          <View style={styles.subGoalList}>
            {subGoals.map((sg, idx) => {
              const bound = collectLinkedProjectsFromSubGoal(sg);
              const prog = progressById[sg.id] ?? { total: 0, completed: 0, percent: 0 };
              const pctLabel = `${Math.round(prog.percent * 100)}%`;
              const isLast = idx === subGoals.length - 1;

              return (
                <View
                  key={sg.id}
                  style={[
                    styles.subGoalCard,
                    {
                      backgroundColor: subGoalCardBg,
                      borderColor: subGoalCardBorder,
                      marginBottom: isLast ? 0 : 12,
                    },
                  ]}
                >
                  {/* 小目标标题行 */}
                  <View style={styles.subGoalHeader}>
                    <View style={[styles.indexBadge, { backgroundColor: visionPrimary }]}>
                      <Text style={styles.indexBadgeText}>{idx + 1}</Text>
                    </View>
                    <View style={styles.subGoalHeaderMain}>
                      <Text style={[styles.subGoalName, { color: textColor }]} numberOfLines={2}>
                        {sg.name}
                      </Text>
                      {sg.description ? (
                        <Text style={[styles.subGoalDesc, { color: outline }]} numberOfLines={3}>
                          {sg.description}
                        </Text>
                      ) : null}
                    </View>
                    {bound.length > 0 ? (
                      <View style={[styles.pctPill, { backgroundColor: isDark ? 'rgba(0,88,190,0.25)' : 'rgba(0,88,190,0.1)' }]}>
                        <Text style={[styles.pctPillText, { color: visionPrimary }]}>{pctLabel}</Text>
                      </View>
                    ) : null}
                  </View>

                  {bound.length > 0 ? (
                    <View style={styles.subGoalProgressBlock}>
                      <ProgressBar
                        percent={prog.percent}
                        trackBg={trackBg}
                        fillColor={visionPrimary}
                        height={6}
                      />
                      <Text style={[styles.subGoalProgressMeta, { color: outline }]}>
                        {prog.total > 0
                          ? `本小目标 · ${prog.completed} / ${prog.total} 任务`
                          : '已绑定，暂无任务'}
                      </Text>
                    </View>
                  ) : (
                    <View style={[styles.emptyBindRow, { borderColor: subGoalCardBorder }]}>
                      <MaterialIcons name="link" size={16} color={outline} />
                      <Text style={[styles.emptyBindText, { color: outline }]}>未绑定项目</Text>
                    </View>
                  )}

                  {/* —— 三级：关联项目 —— */}
                  {bound.length > 0 ? (
                    <View style={[styles.projectsSection, { borderTopColor: subGoalCardBorder }]}>
                      <Text style={[styles.projectsSectionLabel, { color: outline }]}>关联项目</Text>
                      <View style={styles.projectList}>
                        {bound.map((p, pIdx) => {
                          const pProg = progressByProjectId[p.id] ?? {
                            total: 0,
                            completed: 0,
                            percent: 0,
                          };
                          const pPct = `${Math.round(pProg.percent * 100)}%`;
                          const bindKey = `${sg.id}:${p.id}`;
                          const isUnbinding = unbindingKey === bindKey;
                          const isLastProject = pIdx === bound.length - 1;

                          return (
                            <View
                              key={p.id}
                              style={[
                                styles.projectRowWrap,
                                {
                                  borderColor: projectRowBorder,
                                  marginBottom: isLastProject ? 0 : 8,
                                },
                              ]}
                            >
                              <Pressable
                                onPress={() => openProject(p.id)}
                                accessibilityRole="button"
                                accessibilityLabel={`打开项目 ${p.name}`}
                                style={({ pressed }) => [
                                  styles.projectRowMain,
                                  {
                                    backgroundColor: projectRowBg,
                                    opacity: pressed ? 0.88 : 1,
                                  },
                                ]}
                              >
                                <View
                                  style={[
                                    styles.projectIconWrap,
                                    {
                                      backgroundColor: isDark
                                        ? 'rgba(0,88,190,0.22)'
                                        : 'rgba(0,88,190,0.08)',
                                    },
                                  ]}
                                >
                                  <MaterialIcons name="folder-special" size={18} color={visionPrimary} />
                                </View>
                                <View style={styles.projectRowBody}>
                                  <View style={styles.projectTitleLine}>
                                    <Text
                                      style={[styles.projectName, { color: textColor }]}
                                      numberOfLines={1}
                                    >
                                      {p.name || '未命名项目'}
                                    </Text>
                                    <Text style={[styles.projectPct, { color: visionPrimary }]}>
                                      {pPct}
                                    </Text>
                                  </View>
                                  <ProgressBar
                                    percent={pProg.percent}
                                    trackBg={trackBg}
                                    fillColor={visionPrimary}
                                    height={4}
                                  />
                                  <Text style={[styles.projectMeta, { color: outline }]}>
                                    {pProg.total > 0
                                      ? `${pProg.completed} / ${pProg.total} 任务`
                                      : '暂无任务'}
                                  </Text>
                                </View>
                                <MaterialIcons name="chevron-right" size={22} color={outline} />
                              </Pressable>

                              {canUnbind ? (
                                <Pressable
                                  onPress={() => requestUnbind(sg, p.id, p.name)}
                                  disabled={isUnbinding}
                                  hitSlop={8}
                                  accessibilityLabel="解绑项目"
                                  style={({ pressed }) => [
                                    styles.unbindBtn,
                                    {
                                      borderLeftColor: projectRowBorder,
                                      backgroundColor: isDark
                                        ? 'rgba(30,41,59,0.9)'
                                        : 'rgba(248,250,252,0.98)',
                                      opacity: isUnbinding ? 0.45 : pressed ? 0.7 : 1,
                                    },
                                  ]}
                                >
                                  {isUnbinding ? (
                                    <ActivityIndicator size="small" color={outline} />
                                  ) : (
                                    <MaterialIcons name="link-off" size={20} color={outline} />
                                  )}
                                </Pressable>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  panelIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelHeaderText: {
    flex: 1,
    gap: 2,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  panelSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  loadingWrap: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  summaryPct: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  summaryMeta: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  subGoalList: {},
  subGoalCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  subGoalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  indexBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  indexBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  subGoalHeaderMain: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  subGoalName: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
    letterSpacing: -0.15,
  },
  subGoalDesc: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
  pctPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 1,
  },
  pctPillText: {
    fontSize: 13,
    fontWeight: '900',
  },
  subGoalProgressBlock: {
    gap: 6,
    paddingLeft: 36,
  },
  subGoalProgressMeta: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyBindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 36,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  emptyBindText: {
    fontSize: 12,
    fontWeight: '600',
  },
  projectsSection: {
    gap: 8,
    paddingTop: 10,
    marginTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  projectsSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginLeft: 2,
  },
  projectList: {
    gap: 0,
  },
  projectRowWrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  projectRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 6,
    minWidth: 0,
  },
  projectIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectRowBody: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  projectTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  projectName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  projectPct: {
    fontSize: 12,
    fontWeight: '900',
  },
  projectMeta: {
    fontSize: 11,
    fontWeight: '600',
  },
  unbindBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  progressTrack: {
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
});
