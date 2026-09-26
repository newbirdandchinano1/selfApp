import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCard, SkeletonHeaderRow, SkeletonListRows } from '@/components/skeletons/primitives';
import { Radius, Spacing } from '@/constants/design-tokens';
import type { AppPalette } from '@/constants/design-tokens';
import React from 'react';
import { StyleSheet, View } from 'react-native';

type TasksSkeletonProps = {
  colors: AppPalette;
  cardBg: string;
  habitItemWidth?: number;
};

function SectionShell({
  colors,
  cardBg,
  children,
}: {
  colors: AppPalette;
  cardBg: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.stackedSection, { borderTopColor: colors.outline }]}>
      <SkeletonCard
        tone={{ surface: cardBg, outline: colors.outline, cardBg }}
        style={styles.sectionCard}
        shadowed={false}
      >
        {children}
      </SkeletonCard>
    </View>
  );
}

export function TasksHeatmapSkeleton({ colors, cardBg }: Pick<TasksSkeletonProps, 'colors' | 'cardBg'>) {
  return (
    <SectionShell colors={colors} cardBg={cardBg}>
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
    </SectionShell>
  );
}

export function TasksStandaloneSectionSkeleton({ colors, cardBg }: Pick<TasksSkeletonProps, 'colors' | 'cardBg'>) {
  return (
    <SectionShell colors={colors} cardBg={cardBg}>
      <SkeletonHeaderRow
        title={{ width: 48, height: 18 }}
        subtitle={{ width: 132, height: 11 }}
        actions={2}
        action={{ width: 76, height: 32, borderRadius: 10 }}
      />
      <View style={[styles.quickTodoShell, { borderColor: colors.outline }]}>
        <Skeleton width={36} height={36} borderRadius={18} />
        <Skeleton width="100%" height={14} borderRadius={6} style={styles.quickTodoInput} />
        <Skeleton width={36} height={36} borderRadius={18} />
      </View>
      <SkeletonListRows
        count={2}
        leadingSize={22}
        titleWidth="72%"
        metaWidth="48%"
        tone={{ outline: colors.outline }}
      />
    </SectionShell>
  );
}

export function TasksHabitSectionSkeleton({
  colors,
  cardBg,
  habitItemWidth = 72,
}: Pick<TasksSkeletonProps, 'colors' | 'cardBg' | 'habitItemWidth'>) {
  return (
    <SectionShell colors={colors} cardBg={cardBg}>
      <SkeletonHeaderRow title={{ width: 56, height: 18 }} action={{ width: 88, height: 32 }} />
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
    </SectionShell>
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
      <SkeletonCard tone={{ surface: cardBg, outline: colors.outline, cardBg }} style={styles.sectionCard} shadowed={false}>
        <SkeletonHeaderRow
          title={{ width: 72, height: 18 }}
          subtitle={{ width: '88%', height: 11 }}
          action={{ width: 88, height: 32 }}
        />
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
      </SkeletonCard>
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
    gap: Spacing.xl,
  },
  subtitle: {
    marginTop: 4,
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
