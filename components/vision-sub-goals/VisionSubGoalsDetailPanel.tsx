import {
  getTaskCompletionStatsByProjectId,
  getTaskCompletionStatsByProjectIds,
  getTasksByProjectId,
  type TaskTreeNode,
} from '@/lib/repositories/tasks/task';
import type { TaskStatus } from '@/lib/repositories/tasks/task.types';
import type { VisionSubGoal } from '@/lib/repositories/visions/vision.types';
import {
  collectLinkedProjectsFromSubGoal,
  isBoundVisionSubGoalTaskComplete,
  isStandaloneVisionSubGoal,
  standaloneSubGoalTaskStats,
} from '@/lib/repositories/visions/vision.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
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

function formatTaskStatusLabel(status: TaskStatus | string): string {
  if (status === 'doing') return '进行中';
  if (status === 'done') return '已完成';
  if (status === 'blocked') return '受阻';
  if (status === 'cancelled') return '已取消';
  if (status === 'shelved') return '暂时搁置';
  return '待办';
}

function filterTaskTreeForDisplay(nodes: TaskTreeNode[]): TaskTreeNode[] {
  return nodes
    .filter(n => n.status !== 'cancelled')
    .map(n => ({
      ...n,
      children: filterTaskTreeForDisplay(n.children),
    }));
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

const PAGE_API_KEY = 'vision-sub-goals-detail';

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
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const [loading, setLoading] = useState(true);
  const [progressById, setProgressById] = useState<Record<string, SubGoalProgress>>({});
  const [progressByProjectId, setProgressByProjectId] = useState<Record<string, ProjectProgress>>({});
  const [tasksByProjectId, setTasksByProjectId] = useState<Record<string, TaskTreeNode[]>>({});
  const [overallProgress, setOverallProgress] = useState<SubGoalProgress>({
    total: 0,
    completed: 0,
    percent: 0,
  });
  const [unbindingKey, setUnbindingKey] = useState<string | null>(null);
  const [togglingDoneId, setTogglingDoneId] = useState<string | null>(null);
  const canUnbind = Boolean(onPersistSubGoals);
  const canToggleDone = Boolean(onPersistSubGoals);

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

  const openTask = useCallback(
    (taskId: string) => {
      router.push({ pathname: '/task/[id]', params: { id: taskId } });
    },
    [router]
  );

  const loadProgress = useCallback(async () => {
    setLoading(true);
    try {
      await wrapLoad(async () => {
        try {
          const allProjectIds = [
        ...new Set(subGoals.flatMap(sg => collectLinkedProjectsFromSubGoal(sg).map(p => p.id))),
      ];

      const [overallStats, projectEntries, sgEntries, taskTreeEntries] = await Promise.all([
        getTaskCompletionStatsByProjectIds(allProjectIds),
        Promise.all(
          allProjectIds.map(async id => {
            const stats = await getTaskCompletionStatsByProjectId(id);
            return [id, progressFromStats(stats)] as const;
          })
        ),
        Promise.all(
          subGoals.map(async sg => {
            if (isStandaloneVisionSubGoal(sg)) {
              return [sg.id, progressFromStats(standaloneSubGoalTaskStats(sg))] as const;
            }
            const ids = collectLinkedProjectsFromSubGoal(sg).map(p => p.id);
            const stats = await getTaskCompletionStatsByProjectIds(ids);
            return [sg.id, progressFromStats(stats)] as const;
          })
        ),
        Promise.all(
          allProjectIds.map(async id => {
            const tree = await getTasksByProjectId(id);
            return [id, filterTaskTreeForDisplay(tree)] as const;
          })
        ),
      ]);

      const standaloneStats = subGoals
        .filter(isStandaloneVisionSubGoal)
        .reduce(
          (acc, sg) => {
            const s = standaloneSubGoalTaskStats(sg);
            return { total: acc.total + s.total, completed: acc.completed + s.completed };
          },
          { total: 0, completed: 0 }
        );
      const mergedOverall = {
        total: overallStats.total + standaloneStats.total,
        completed: overallStats.completed + standaloneStats.completed,
      };
      setOverallProgress(progressFromStats(mergedOverall));
          setProgressByProjectId(Object.fromEntries(projectEntries));
          setProgressById(Object.fromEntries(sgEntries));
          setTasksByProjectId(Object.fromEntries(taskTreeEntries));
        } catch {
          setOverallProgress({ total: 0, completed: 0, percent: 0 });
          setProgressByProjectId({});
          setProgressById({});
          setTasksByProjectId({});
        }
      });
    } catch {
      setOverallProgress({ total: 0, completed: 0, percent: 0 });
      setProgressByProjectId({});
      setProgressById({});
      setTasksByProjectId({});
    } finally {
      setLoading(false);
    }
  }, [subGoals, wrapLoad]);

  useFocusEffect(
    useCallback(() => {
      void loadProgress();
    }, [loadProgress])
  );

  const boundProjectCount = useMemo(
    () => subGoals.reduce((n, sg) => n + collectLinkedProjectsFromSubGoal(sg).length, 0),
    [subGoals]
  );

  const standaloneCount = useMemo(
    () => subGoals.filter(isStandaloneVisionSubGoal).length,
    [subGoals]
  );

  const toggleStandaloneDone = useCallback(
    (sg: VisionSubGoal) => {
      if (!onPersistSubGoals) return;
      const nextDone = !sg.done;
      setTogglingDoneId(sg.id);
      const nextSubGoals = subGoals.map(item => {
        if (item.id !== sg.id) return item;
        if (nextDone) return { ...item, done: true };
        const { done: _omit, ...rest } = item;
        return rest;
      });
      void (async () => {
        try {
          await onPersistSubGoals(nextSubGoals);
          await loadProgress();
        } catch {
          Alert.alert('更新失败', '无法更新本地数据，请稍后重试。');
        } finally {
          setTogglingDoneId(null);
        }
      })();
    },
    [loadProgress, onPersistSubGoals, subGoals]
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

  const renderProjectTaskNodes = useCallback(
    (nodes: TaskTreeNode[], depth = 0): React.ReactNode =>
      nodes.map(node => {
        const isDone = node.status === 'done';
        const doneColor = isDark ? '#34d399' : '#006c49';
        const statusLabel = formatTaskStatusLabel(node.status);
        const iconName =
          isDone
            ? 'check-circle'
            : node.status === 'blocked'
              ? 'lock'
              : node.status === 'shelved'
                ? 'pause-circle-outline'
                : node.status === 'doing'
                  ? 'play-circle-outline'
                  : 'radio-button-unchecked';
        const iconColor = isDone
          ? doneColor
          : node.status === 'blocked'
            ? outline
            : node.status === 'doing'
              ? visionPrimary
              : outline;

        return (
          <View key={node.id}>
            <Pressable
              onPress={() => openTask(node.id)}
              accessibilityRole="button"
              accessibilityLabel={`查看任务 ${node.title}`}
              style={({ pressed }) => [
                styles.taskRow,
                {
                  marginLeft: depth * 12,
                  backgroundColor: projectRowBg,
                  borderColor: projectRowBorder,
                  opacity: pressed ? 0.86 : 1,
                },
              ]}
            >
              <MaterialIcons name={iconName} size={18} color={iconColor} />
              <View style={styles.taskRowBody}>
                <Text
                  style={[
                    styles.taskTitle,
                    {
                      color: textColor,
                      opacity: isDone ? 0.82 : 1,
                      textDecorationLine: isDone ? 'line-through' : 'none',
                    },
                  ]}
                  numberOfLines={2}
                >
                  {node.title}
                </Text>
                <Text style={[styles.taskStatus, { color: outline }]}>{statusLabel}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={outline} />
            </Pressable>
            {node.children.length > 0 ? renderProjectTaskNodes(node.children, depth + 1) : null}
          </View>
        );
      }),
    [isDark, openTask, outline, projectRowBg, projectRowBorder, textColor, visionPrimary]
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
            {standaloneCount > 0 ? ` · ${standaloneCount} 个独立目标` : ''}
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
          {boundProjectCount > 0 || standaloneCount > 0 ? (
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
                  ? boundProjectCount > 0 && standaloneCount > 0
                    ? `绑定任务与独立目标 · ${overallProgress.completed} / ${overallProgress.total}`
                    : standaloneCount > 0
                      ? `独立目标 · ${overallProgress.completed} / ${overallProgress.total}`
                      : `全部绑定项目 · 任务 ${overallProgress.completed} / ${overallProgress.total}`
                  : boundProjectCount > 0
                    ? '已绑定项目，暂无统计任务'
                    : '点击小目标可标记完成'}
              </Text>
            </View>
          ) : null}

          {/* —— 二级：小目标列表 —— */}
          <View style={styles.subGoalList}>
            {subGoals.map((sg, idx) => {
              const bound = collectLinkedProjectsFromSubGoal(sg);
              const standalone = bound.length === 0;
              const prog = progressById[sg.id] ?? { total: 0, completed: 0, percent: 0 };
              const boundAutoDone =
                !standalone &&
                isBoundVisionSubGoalTaskComplete({
                  completed: prog.completed,
                  total: prog.total,
                });
              const isDone = standalone ? Boolean(sg.done) : boundAutoDone;
              const pctLabel = isDone ? '已完成' : `${Math.round(prog.percent * 100)}%`;
              const isLast = idx === subGoals.length - 1;
              const doneColor = isDark ? '#34d399' : '#006c49';
              const isTogglingDone = togglingDoneId === sg.id;

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
                    {standalone && canToggleDone ? (
                      <Pressable
                        onPress={() => toggleStandaloneDone(sg)}
                        disabled={isTogglingDone}
                        hitSlop={6}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: Boolean(sg.done) }}
                        accessibilityLabel={sg.done ? `取消完成 ${sg.name}` : `完成目标 ${sg.name}`}
                        style={({ pressed }) => [
                          styles.standaloneCheckBtn,
                          { opacity: isTogglingDone ? 0.45 : pressed ? 0.75 : 1 },
                        ]}
                      >
                        {isTogglingDone ? (
                          <ActivityIndicator size="small" color={outline} />
                        ) : (
                          <MaterialIcons
                            name={sg.done ? 'check-circle' : 'radio-button-unchecked'}
                            size={26}
                            color={sg.done ? doneColor : outline}
                          />
                        )}
                      </Pressable>
                    ) : boundAutoDone ? (
                      <MaterialIcons name="check-circle" size={26} color={doneColor} style={{ marginTop: 1 }} />
                    ) : (
                      <View style={[styles.indexBadge, { backgroundColor: visionPrimary }]}>
                        <Text style={styles.indexBadgeText}>{idx + 1}</Text>
                      </View>
                    )}
                    <View style={styles.subGoalHeaderMain}>
                      <Text
                        style={[
                          styles.subGoalName,
                          {
                            color: textColor,
                            opacity: isDone ? 0.85 : 1,
                            textDecorationLine: isDone ? 'line-through' : 'none',
                          },
                        ]}
                        numberOfLines={2}
                      >
                        {sg.name}
                      </Text>
                      {sg.description ? (
                        <Text style={[styles.subGoalDesc, { color: outline }]} numberOfLines={3}>
                          {sg.description}
                        </Text>
                      ) : null}
                    </View>
                    {bound.length > 0 || standalone ? (
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
                        {boundAutoDone
                          ? '本小目标 · 关联项目任务已全部完成'
                          : prog.total > 0
                            ? `本小目标 · ${prog.completed} / ${prog.total} 任务`
                            : '已绑定，暂无任务'}
                      </Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={canToggleDone ? () => toggleStandaloneDone(sg) : undefined}
                      disabled={!canToggleDone || isTogglingDone}
                      style={({ pressed }) => [
                        styles.standaloneGoalRow,
                        {
                          borderColor: subGoalCardBorder,
                          backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(234,237,255,0.6)',
                          opacity: !canToggleDone ? 1 : isTogglingDone ? 0.55 : pressed ? 0.88 : 1,
                        },
                      ]}
                    >
                      <MaterialIcons
                        name={sg.done ? 'task-alt' : 'flag'}
                        size={18}
                        color={sg.done ? doneColor : visionPrimary}
                      />
                      <Text style={[styles.standaloneGoalText, { color: sg.done ? doneColor : outline }]}>
                        {sg.done ? '已完成' : canToggleDone ? '点击标记完成' : '独立目标 · 未绑定项目'}
                      </Text>
                    </Pressable>
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

                          const projectTasks = tasksByProjectId[p.id] ?? [];

                          return (
                            <View
                              key={p.id}
                              style={[
                                styles.projectBlock,
                                {
                                  borderColor: projectRowBorder,
                                  marginBottom: isLastProject ? 0 : 8,
                                },
                              ]}
                            >
                              <View style={styles.projectRowWrap}>
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

                              {projectTasks.length > 0 ? (
                                <View style={[styles.taskListSection, { borderTopColor: projectRowBorder }]}>
                                  <Text style={[styles.taskListLabel, { color: outline }]}>任务与子任务</Text>
                                  <View style={styles.taskList}>
                                    {renderProjectTaskNodes(projectTasks)}
                                  </View>
                                </View>
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
  standaloneCheckBtn: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  standaloneGoalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 36,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  standaloneGoalText: {
    fontSize: 13,
    fontWeight: '700',
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
  projectBlock: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  projectRowWrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  taskListSection: {
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  taskListLabel: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.5,
    marginLeft: 2,
  },
  taskList: {
    gap: 6,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  taskRowBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  taskTitle: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  taskStatus: {
    fontSize: 11,
    fontWeight: '600',
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
