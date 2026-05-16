import { getTaskCompletionStatsByProjectIds } from '@/lib/repositories/tasks/task';
import type { VisionSubGoal } from '@/lib/repositories/visions/vision.types';
import { collectLinkedProjectsFromSubGoal } from '@/lib/repositories/visions/vision.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type SubGoalProgress = {
  total: number;
  completed: number;
  percent: number;
};

type VisionSubGoalsDetailPanelProps = {
  subGoals: VisionSubGoal[];
  textColor: string;
  outline: string;
  isDark: boolean;
  panelBg: string;
  panelBorder: string;
  visionPrimary?: string;
};

const visionPrimaryDefault = '#0058be';

export function VisionSubGoalsDetailPanel({
  subGoals,
  textColor,
  outline,
  isDark,
  panelBg,
  panelBorder,
  visionPrimary = visionPrimaryDefault,
}: VisionSubGoalsDetailPanelProps) {
  const [loading, setLoading] = useState(true);
  const [progressById, setProgressById] = useState<Record<string, SubGoalProgress>>({});

  const loadProgress = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await Promise.all(
        subGoals.map(async sg => {
          const ids = collectLinkedProjectsFromSubGoal(sg).map(p => p.id);
          if (ids.length === 0) {
            return [sg.id, { total: 0, completed: 0, percent: 0 }] as const;
          }
          const stats = await getTaskCompletionStatsByProjectIds(ids);
          const percent = stats.total > 0 ? stats.completed / stats.total : 0;
          return [sg.id, { ...stats, percent }] as const;
        })
      );
      setProgressById(Object.fromEntries(entries));
    } catch {
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

  if (subGoals.length === 0) return null;

  const trackBg = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)';

  return (
    <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
      <View style={styles.panelHeaderRow}>
        <MaterialIcons name="flag" size={18} color={visionPrimary} />
        <Text style={[styles.panelTitle, { color: textColor }]}>小目标</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={visionPrimary} />
        </View>
      ) : (
        <View style={{ gap: 18 }}>
          {subGoals.map((sg, idx) => {
            const bound = collectLinkedProjectsFromSubGoal(sg);
            const prog = progressById[sg.id] ?? { total: 0, completed: 0, percent: 0 };
            const pctLabel = `${Math.round(prog.percent * 100)}%`;

            return (
              <View key={sg.id} style={styles.item}>
                <View style={styles.itemHeader}>
                  <Text style={[styles.itemName, { color: textColor }]}>
                    {idx + 1}. {sg.name}
                  </Text>
                  {bound.length > 0 ? (
                    <Text style={[styles.itemPct, { color: visionPrimary }]}>{pctLabel}</Text>
                  ) : null}
                </View>

                {sg.description ? (
                  <Text style={[styles.itemDesc, { color: outline }]}>{sg.description}</Text>
                ) : null}

                {bound.length > 0 ? (
                  <>
                    <View style={[styles.progressTrack, { backgroundColor: trackBg }]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min(100, Math.round(prog.percent * 100))}%` as `${number}%`,
                            backgroundColor: visionPrimary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.progressMeta, { color: outline }]}>
                      {prog.total > 0
                        ? `任务 ${prog.completed} / ${prog.total}`
                        : '已绑定项目，暂无统计任务'}
                    </Text>
                    <View style={styles.projectTags}>
                      {bound.map(p => (
                        <View
                          key={p.id}
                          style={[
                            styles.projectTag,
                            { backgroundColor: isDark ? 'rgba(30,41,59,0.5)' : 'rgba(234,237,255,0.85)' },
                          ]}
                        >
                          <MaterialIcons name="folder-special" size={14} color={visionPrimary} />
                          <Text style={[styles.projectTagText, { color: textColor }]} numberOfLines={1}>
                            {p.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : (
                  <Text style={[styles.unboundHint, { color: outline }]}>未绑定项目</Text>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
    gap: 14,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  loadingWrap: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  item: {
    gap: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  itemName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
  },
  itemPct: {
    fontSize: 14,
    fontWeight: '900',
  },
  itemDesc: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressMeta: {
    fontSize: 12,
    fontWeight: '700',
  },
  projectTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  projectTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    maxWidth: '100%',
  },
  projectTagText: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  unboundHint: {
    fontSize: 12,
    fontWeight: '600',
    fontStyle: 'italic',
  },
});
