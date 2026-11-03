/**
 * 项目卡习惯进度轨：独立于任务树，按条展示养成/戒除进度条。
 */
import { FoldProgressBar } from '@/components/tasks/fold-progress-bar';
import type { ProjectProgressHabitsEvaluation } from '@/lib/repositories/projects/project-progress-habits';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type ProjectHabitProgressBlockProps = {
  evaluation: ProjectProgressHabitsEvaluation;
  muted: string;
  faint: string;
  ink: string;
  trackAccentFrom?: string;
  trackAccentTo?: string;
  breakAccentFrom?: string;
  breakAccentTo?: string;
};

export function ProjectHabitProgressBlock({
  evaluation,
  muted,
  faint,
  ink,
  trackAccentFrom = '#A9C184',
  trackAccentTo,
  breakAccentFrom = '#E3B39C',
  breakAccentTo = '#C4785A',
}: ProjectHabitProgressBlockProps) {
  if (evaluation.ratio == null || evaluation.checks.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <MaterialIcons name="repeat" size={12} color={muted} />
        <Text style={[styles.headText, { color: muted }]}>习惯进度</Text>
        {evaluation.full ? (
          <Text style={[styles.headHint, { color: faint }]}>可考虑结案</Text>
        ) : null}
      </View>
      {evaluation.checks.map((check) => {
        const isBreak = check.mode === 'break_consecutive';
        return (
          <View key={check.habitId} style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={[styles.title, { color: ink }]} numberOfLines={1}>
                {check.title}
              </Text>
              <Text style={[styles.caption, { color: muted }]} numberOfLines={1}>
                {check.missing ? '习惯已失效' : check.progressCaption}
              </Text>
            </View>
            <FoldProgressBar
              ratio={check.ratio}
              height={4}
              colorFrom={isBreak ? breakAccentFrom : trackAccentFrom}
              colorTo={isBreak ? breakAccentTo : trackAccentTo}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    gap: 8,
    paddingTop: 2,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headText: {
    fontSize: 11,
    fontWeight: '700',
  },
  headHint: {
    marginLeft: 'auto',
    fontSize: 10,
    fontWeight: '600',
  },
  row: {
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    maxWidth: '46%',
  },
  caption: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
});
