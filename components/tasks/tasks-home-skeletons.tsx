import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing } from '@/constants/design-tokens';
import type { AppPalette } from '@/constants/design-tokens';
import React from 'react';
import { StyleSheet, View } from 'react-native';

type TasksSkeletonProps = {
  colors: AppPalette;
  cardBg: string;
  frogCardWidth?: number;
  habitItemWidth?: number;
};

function SectionCardShell({
  colors,
  cardBg,
  children,
  stacked = false,
}: {
  colors: AppPalette;
  cardBg: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <View style={[stacked ? styles.stackedSection : undefined, { borderTopColor: colors.outline }]}>
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: cardBg, borderColor: colors.outline },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export function TasksFrogSectionSkeleton({ colors, cardBg, frogCardWidth = 168 }: TasksSkeletonProps) {
  return (
    <SectionCardShell colors={colors} cardBg={cardBg}>
      <View style={styles.headerRow}>
        <Skeleton width={72} height={18} borderRadius={6} />
        <Skeleton width={88} height={32} borderRadius={10} />
      </View>
      <View style={[styles.frogCard, { borderColor: colors.outline, width: frogCardWidth }]}>
        <View style={styles.frogTopRow}>
          <Skeleton width={32} height={32} borderRadius={10} />
          <Skeleton width={72} height={18} borderRadius={9} />
        </View>
        <Skeleton width="88%" height={16} borderRadius={6} style={styles.frogTitle} />
        <Skeleton width="100%" height={12} borderRadius={5} />
        <Skeleton width="76%" height={12} borderRadius={5} style={styles.frogDesc} />
        <View style={[styles.frogFooter, { borderTopColor: colors.outline }]}>
          <Skeleton width={28} height={10} borderRadius={5} />
          <Skeleton width={36} height={10} borderRadius={5} />
        </View>
      </View>
    </SectionCardShell>
  );
}

export function TasksHeatmapSkeleton({ colors, cardBg }: Pick<TasksSkeletonProps, 'colors' | 'cardBg'>) {
  return (
    <SectionCardShell colors={colors} cardBg={cardBg} stacked>
      <View style={styles.heatmapHeader}>
        <Skeleton width={96} height={18} borderRadius={6} />
        <View style={styles.heatmapLegend}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} width={14} height={14} borderRadius={4} />
          ))}
        </View>
      </View>
      <View style={[styles.heatmapCard, { borderColor: colors.outline }]}>
        <View style={styles.heatmapMonthRow}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} width={28} height={11} borderRadius={5} style={styles.heatmapMonthCell} />
          ))}
        </View>
        {Array.from({ length: 5 }).map((_, rowIndex) => (
          <View key={rowIndex} style={styles.heatmapGridRow}>
            <Skeleton width={18} height={11} borderRadius={5} />
            <View style={styles.heatmapCells}>
              {Array.from({ length: 12 }).map((__, colIndex) => (
                <Skeleton key={colIndex} width={14} height={14} borderRadius={4} />
              ))}
            </View>
          </View>
        ))}
      </View>
    </SectionCardShell>
  );
}

export function TasksStandaloneSectionSkeleton({ colors, cardBg }: Pick<TasksSkeletonProps, 'colors' | 'cardBg'>) {
  return (
    <SectionCardShell colors={colors} cardBg={cardBg} stacked>
      <View style={styles.headerRow}>
        <View style={styles.headerCol}>
          <Skeleton width={48} height={18} borderRadius={6} />
          <Skeleton width={132} height={11} borderRadius={5} style={styles.subtitle} />
        </View>
        <View style={styles.headerActions}>
          <Skeleton width={76} height={32} borderRadius={10} />
          <Skeleton width={76} height={32} borderRadius={10} />
        </View>
      </View>
      <View style={[styles.quickTodoShell, { borderColor: colors.outline }]}>
        <Skeleton width={36} height={36} borderRadius={18} />
        <Skeleton width="100%" height={14} borderRadius={6} style={styles.quickTodoInput} />
        <Skeleton width={36} height={36} borderRadius={18} />
      </View>
      <View style={styles.todoList}>
        {Array.from({ length: 2 }).map((_, index) => (
          <View key={index} style={[styles.todoRow, { borderColor: colors.outline }]}>
            <Skeleton width={22} height={22} borderRadius={11} />
            <View style={styles.todoBody}>
              <Skeleton width="72%" height={14} borderRadius={6} />
              <Skeleton width="48%" height={11} borderRadius={5} style={styles.todoMeta} />
            </View>
          </View>
        ))}
      </View>
    </SectionCardShell>
  );
}

export function TasksHabitSectionSkeleton({
  colors,
  cardBg,
  habitItemWidth = 72,
}: Pick<TasksSkeletonProps, 'colors' | 'cardBg' | 'habitItemWidth'>) {
  return (
    <SectionCardShell colors={colors} cardBg={cardBg} stacked>
      <View style={styles.headerRow}>
        <Skeleton width={56} height={18} borderRadius={6} />
        <Skeleton width={88} height={32} borderRadius={10} />
      </View>
      <Skeleton width={96} height={28} borderRadius={14} />
      <View style={styles.habitGrid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <View key={index} style={[styles.habitCardSkeleton, { width: habitItemWidth }]}>
            <Skeleton width={44} height={44} borderRadius={14} />
            <View style={styles.habitCardSkeletonBody}>
              <Skeleton width="88%" height={13} borderRadius={6} />
              <Skeleton width="62%" height={10} borderRadius={5} />
            </View>
            <Skeleton width={40} height={16} borderRadius={999} />
            <Skeleton width={48} height={10} borderRadius={5} />
          </View>
        ))}
      </View>
    </SectionCardShell>
  );
}

export function TasksProjectsSectionSkeleton({ colors, cardBg }: Pick<TasksSkeletonProps, 'colors' | 'cardBg'>) {
  return (
    <View style={[styles.stackedSection, { borderTopColor: colors.outline }]}>
      <Skeleton width="100%" height={40} borderRadius={12} style={styles.viewSwitcher} />
      <View style={styles.projectTabs}>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} width={56} height={28} borderRadius={14} />
        ))}
      </View>
      <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: colors.outline }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerCol}>
            <Skeleton width={72} height={18} borderRadius={6} />
            <Skeleton width="88%" height={11} borderRadius={5} style={styles.subtitle} />
          </View>
          <Skeleton width={88} height={32} borderRadius={10} />
        </View>
        {Array.from({ length: 2 }).map((_, index) => (
          <View key={index} style={[styles.projectCard, { borderColor: colors.outline }]}>
            <View style={styles.projectHead}>
              <Skeleton width={40} height={40} borderRadius={12} />
              <View style={styles.projectHeadText}>
                <Skeleton width="68%" height={14} borderRadius={6} />
                <Skeleton width="42%" height={11} borderRadius={5} style={styles.subtitle} />
              </View>
              <Skeleton width={28} height={28} borderRadius={8} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stackedSection: {
    marginTop: Spacing.lg,
    paddingTop: Spacing['2xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xl,
  },
  sectionCard: {
    borderRadius: Radius['2xl'],
    padding: Spacing['4xl'],
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  headerCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  subtitle: {
    marginTop: 4,
  },
  frogCard: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing['2xl'],
    paddingTop: Spacing.xl + 4,
    paddingBottom: Spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  frogTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  frogTitle: {
    marginBottom: 6,
  },
  frogDesc: {
    marginTop: 4,
  },
  frogFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  heatmapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  heatmapLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  heatmapCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing['2xl'],
    gap: 6,
  },
  heatmapMonthRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 2,
    paddingLeft: 26,
    gap: 18,
  },
  heatmapMonthCell: {
    marginRight: 8,
  },
  heatmapGridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heatmapCells: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  quickTodoShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  quickTodoInput: {
    flex: 1,
  },
  todoList: {
    gap: 10,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: 14,
  },
  todoBody: {
    flex: 1,
    minWidth: 0,
    gap: 0,
  },
  todoMeta: {
    marginTop: 6,
  },
  habitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  habitCardSkeleton: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  habitCardSkeletonBody: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  habitItem: {
    alignItems: 'center',
    gap: 10,
  },
  viewSwitcher: {
    marginBottom: Spacing.md,
  },
  projectTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.md,
  },
  projectCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  projectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing['2xl'],
  },
  projectHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
});
