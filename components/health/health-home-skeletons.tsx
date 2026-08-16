import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing } from '@/constants/design-tokens';
import type { AppPalette } from '@/constants/design-tokens';
import React from 'react';
import { StyleSheet, View } from 'react-native';

type HealthSkeletonProps = {
  cardWidth: number;
  colors: AppPalette;
  isDark?: boolean;
};

export function HealthMetricsSkeleton({ cardWidth, colors }: HealthSkeletonProps) {
  return (
    <View style={styles.metricsRow}>
      {Array.from({ length: 4 }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.metricCard,
            { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline, width: cardWidth },
          ]}
        >
          <Skeleton width={64} height={64} borderRadius={32} style={styles.metricCircle} />
          <Skeleton width={36} height={12} borderRadius={6} style={styles.metricLabel} />
          <Skeleton width={44} height={18} borderRadius={6} />
          <Skeleton width={56} height={10} borderRadius={5} style={styles.metricSub} />
        </View>
      ))}
    </View>
  );
}

export function HealthStatusCardSkeleton({ colors }: Pick<HealthSkeletonProps, 'colors'>) {
  return (
    <View style={styles.statusList}>
      {Array.from({ length: 4 }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.statusItem,
            index > 0 && styles.statusItemSpacing,
            { backgroundColor: colors.surfaceSubtle },
          ]}
        >
          <Skeleton width={4} height={52} borderRadius={2} />
          <View style={styles.statusItemBody}>
            <View style={styles.statusLineRow}>
              <Skeleton width={72} height={14} borderRadius={6} />
              <Skeleton width={36} height={18} borderRadius={9} />
            </View>
            <Skeleton width="88%" height={12} borderRadius={6} style={styles.statusDesc} />
            <View style={styles.statusValueRow}>
              <Skeleton width={48} height={22} borderRadius={6} />
              <Skeleton width={72} height={12} borderRadius={6} />
            </View>
            <Skeleton width="100%" height={6} borderRadius={3} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function HealthQuickAddSkeleton({ cardWidth, colors }: HealthSkeletonProps) {
  return (
    <View style={styles.quickAddRow}>
      {Array.from({ length: 4 }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.quickAddCard,
            { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline, width: cardWidth },
          ]}
        >
          <Skeleton width={30} height={30} borderRadius={15} style={styles.quickAddIcon} />
          <Skeleton width={40} height={11} borderRadius={5} style={styles.quickAddLabel} />
          <Skeleton width={48} height={14} borderRadius={6} />
        </View>
      ))}
    </View>
  );
}

export function HealthIntakeListSkeleton({ colors }: Pick<HealthSkeletonProps, 'colors'>) {
  return (
    <View style={styles.intakeList}>
      {Array.from({ length: 2 }).map((_, index) => (
        <View
          key={index}
          style={[styles.intakeRow, { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline }]}
        >
          <View style={styles.intakeRowLeft}>
            <Skeleton width={40} height={40} borderRadius={20} />
            <View style={styles.intakeRowText}>
              <View style={styles.intakeRowHeader}>
                <Skeleton width="55%" height={14} borderRadius={6} />
                <Skeleton width={36} height={11} borderRadius={5} />
              </View>
              <Skeleton width="78%" height={11} borderRadius={5} style={styles.intakeMeta} />
              <Skeleton width="62%" height={11} borderRadius={5} style={styles.intakeMeta} />
            </View>
          </View>
          <Skeleton width={40} height={14} borderRadius={6} />
        </View>
      ))}
    </View>
  );
}

export function HealthTrendCardSkeleton({ colors, isDark = false }: Pick<HealthSkeletonProps, 'colors' | 'isDark'>) {
  return (
    <View
      style={[
        styles.trendCard,
        { backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceSubtle, borderColor: colors.outline },
      ]}
    >
      <View style={styles.trendHeader}>
        <Skeleton width={72} height={16} borderRadius={6} />
        <Skeleton width={88} height={14} borderRadius={6} />
      </View>
      <View style={styles.legendRow}>
        {Array.from({ length: 4 }).map((_, index) => (
          <View key={index} style={styles.legendItem}>
            <Skeleton width={7} height={7} borderRadius={4} />
            <Skeleton width={28} height={12} borderRadius={5} />
            <Skeleton width={18} height={11} borderRadius={5} />
          </View>
        ))}
      </View>
      <View style={styles.chartArea}>
        <View style={styles.chartBars}>
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton
              key={index}
              width={16}
              height={[52, 68, 44, 80, 36, 60, 48][index] ?? 50}
              borderRadius={4}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  metricCard: {
    borderRadius: Radius.xl,
    paddingVertical: Spacing['2xl'],
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  metricCircle: {
    marginBottom: 8,
  },
  metricLabel: {
    marginBottom: 4,
  },
  metricSub: {
    marginTop: 4,
  },
  statusList: {
    gap: 0,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
  },
  statusItemSpacing: {
    marginTop: Spacing.md,
  },
  statusItemBody: {
    flex: 1,
    gap: 0,
  },
  statusLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statusDesc: {
    marginBottom: 8,
  },
  statusValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 8,
  },
  quickAddRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  quickAddCard: {
    borderRadius: Radius.xl,
    paddingVertical: Spacing['2xl'],
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickAddIcon: {
    marginBottom: 8,
  },
  quickAddLabel: {
    marginBottom: 6,
  },
  intakeList: {
    gap: 10,
  },
  intakeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  intakeRowLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  intakeRowText: {
    flex: 1,
    minWidth: 0,
  },
  intakeRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  intakeMeta: {
    marginTop: 4,
  },
  trendCard: {
    borderRadius: Radius.xl,
    padding: Spacing['4xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  chartArea: {
    height: 152,
    justifyContent: 'flex-end',
  },
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    height: 130,
  },
});
