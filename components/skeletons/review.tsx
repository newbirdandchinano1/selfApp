import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCard,
  SkeletonChipRow,
  SkeletonGrid,
  SkeletonPage,
} from '@/components/skeletons/primitives';
import { Radius, Spacing } from '@/constants/design-tokens';
import React from 'react';
import { StyleSheet, View } from 'react-native';

/** 复盘 Hub：范围切换 + 网格 */
export function ReviewHubSkeleton() {
  return (
    <SkeletonPage>
      <View style={styles.scopeTrack}>
        <Skeleton width="31%" height={36} borderRadius={Radius.md} />
        <Skeleton width="31%" height={36} borderRadius={Radius.md} />
        <Skeleton width="31%" height={36} borderRadius={Radius.md} />
      </View>
      <ReviewGridSkeleton />
    </SkeletonPage>
  );
}

export function ReviewGridSkeleton() {
  return (
    <View style={styles.gridBlock}>
      <SkeletonCard shadowed>
        <View style={styles.metaRow}>
          <Skeleton width={72} height={28} borderRadius={Radius.sm} />
          <Skeleton width={96} height={16} borderRadius={6} />
          <Skeleton width={88} height={28} borderRadius={Radius.sm} />
        </View>
      </SkeletonCard>

      <SkeletonGrid
        count={4}
        columns={2}
        renderCell={() => (
          <SkeletonCard shadowed>
            <Skeleton width="55%" height={14} borderRadius={6} />
            <Skeleton width="100%" height={12} borderRadius={5} style={styles.cellLine} />
            <Skeleton width="82%" height={12} borderRadius={5} />
            <Skeleton width="68%" height={12} borderRadius={5} />
          </SkeletonCard>
        )}
      />

      <SkeletonCard shadowed>
        <View style={styles.aiHead}>
          <Skeleton width={88} height={16} borderRadius={6} />
          <Skeleton width={72} height={30} borderRadius={Radius.sm} />
        </View>
        <Skeleton width="100%" height={12} borderRadius={5} style={styles.cellLine} />
        <Skeleton width="90%" height={12} borderRadius={5} />
        <Skeleton width="74%" height={12} borderRadius={5} />
      </SkeletonCard>
    </View>
  );
}

export function ReviewDimensionSkeleton() {
  return (
    <SkeletonPage>
      {Array.from({ length: 2 }).map((_, index) => (
        <SkeletonCard key={index} shadowed>
          <Skeleton width={96} height={14} borderRadius={6} />
          <Skeleton width="100%" height={120} borderRadius={Radius.md} style={styles.fieldBody} />
        </SkeletonCard>
      ))}
    </SkeletonPage>
  );
}

export function ReviewListSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonChipRow count={5} chipWidth={56} chipHeight={32} />
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonCard key={index} shadowed>
          <View style={styles.listRow}>
            <Skeleton width={10} height={10} borderRadius={5} />
            <View style={styles.listMain}>
              <Skeleton width="42%" height={14} borderRadius={6} />
              <Skeleton width="68%" height={12} borderRadius={5} style={styles.cellLine} />
            </View>
          </View>
        </SkeletonCard>
      ))}
    </SkeletonPage>
  );
}

export function ReviewCalendarSkeleton() {
  return (
    <SkeletonPage>
      <View style={styles.monthNav}>
        <Skeleton width={36} height={36} borderRadius={Radius.icon} />
        <Skeleton width={120} height={22} borderRadius={8} />
        <Skeleton width={36} height={36} borderRadius={Radius.icon} />
      </View>
      <View style={styles.calendarGrid}>
        {Array.from({ length: 35 }).map((_, index) => (
          <Skeleton key={index} width="12.5%" height={40} borderRadius={Radius.sm} style={styles.calCell} />
        ))}
      </View>
      <SkeletonCard shadowed>
        <Skeleton width="48%" height={16} borderRadius={6} />
        <Skeleton width="100%" height={12} borderRadius={5} style={styles.cellLine} />
        <Skeleton width="86%" height={12} borderRadius={5} />
      </SkeletonCard>
    </SkeletonPage>
  );
}

const styles = StyleSheet.create({
  scopeTrack: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  gridBlock: {
    gap: Spacing.xl,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  cellLine: {
    marginTop: Spacing.xs,
  },
  aiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  fieldBody: {
    marginTop: Spacing.md,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  listMain: {
    flex: 1,
    gap: Spacing.sm,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  calCell: {
    marginBottom: Spacing.xs,
  },
});
