import { Skeleton } from '@/components/ui/skeleton';
import { Layout, Radius, Shadows, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import React from 'react';
import { StyleSheet, View } from 'react-native';

function ReviewSkeletonCard({ children }: { children: React.ReactNode }) {
  const { colors, shadows } = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        shadows.card,
        { backgroundColor: colors.surface, borderColor: colors.outline },
      ]}>
      {children}
    </View>
  );
}

export function ReviewHubSkeleton() {
  return (
    <View style={styles.page}>
      <View style={styles.scopeTrack}>
        <Skeleton width="31%" height={36} borderRadius={Radius.md} />
        <Skeleton width="31%" height={36} borderRadius={Radius.md} />
        <Skeleton width="31%" height={36} borderRadius={Radius.md} />
      </View>
      <ReviewGridSkeleton />
    </View>
  );
}

export function ReviewGridSkeleton() {
  return (
    <View style={styles.gridBlock}>
      <ReviewSkeletonCard>
        <View style={styles.metaRow}>
          <Skeleton width={72} height={28} borderRadius={Radius.sm} />
          <Skeleton width={96} height={16} borderRadius={6} />
          <Skeleton width={88} height={28} borderRadius={Radius.sm} />
        </View>
      </ReviewSkeletonCard>

      <View style={styles.gridCells}>
        {Array.from({ length: 4 }).map((_, index) => (
          <View key={index} style={styles.gridCell}>
            <ReviewSkeletonCard>
              <Skeleton width="55%" height={14} borderRadius={6} />
              <Skeleton width="100%" height={12} borderRadius={5} style={styles.cellLine} />
              <Skeleton width="82%" height={12} borderRadius={5} />
              <Skeleton width="68%" height={12} borderRadius={5} />
            </ReviewSkeletonCard>
          </View>
        ))}
      </View>

      <ReviewSkeletonCard>
        <View style={styles.aiHead}>
          <Skeleton width={88} height={16} borderRadius={6} />
          <Skeleton width={72} height={30} borderRadius={Radius.sm} />
        </View>
        <Skeleton width="100%" height={12} borderRadius={5} style={styles.cellLine} />
        <Skeleton width="90%" height={12} borderRadius={5} />
        <Skeleton width="74%" height={12} borderRadius={5} />
      </ReviewSkeletonCard>
    </View>
  );
}

export function ReviewDimensionSkeleton() {
  return (
    <View style={styles.page}>
      {Array.from({ length: 2 }).map((_, index) => (
        <ReviewSkeletonCard key={index}>
          <Skeleton width={96} height={14} borderRadius={6} />
          <Skeleton width="100%" height={120} borderRadius={Radius.md} style={styles.fieldBody} />
        </ReviewSkeletonCard>
      ))}
    </View>
  );
}

export function ReviewListSkeleton() {
  return (
    <View style={styles.page}>
      <View style={styles.chipRow}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} width={56} height={32} borderRadius={Radius.pill} />
        ))}
      </View>
      {Array.from({ length: 4 }).map((_, index) => (
        <ReviewSkeletonCard key={index}>
          <View style={styles.listRow}>
            <Skeleton width={10} height={10} borderRadius={5} />
            <View style={styles.listMain}>
              <Skeleton width="42%" height={14} borderRadius={6} />
              <Skeleton width="68%" height={12} borderRadius={5} style={styles.cellLine} />
            </View>
          </View>
        </ReviewSkeletonCard>
      ))}
    </View>
  );
}

export function ReviewCalendarSkeleton() {
  return (
    <View style={styles.page}>
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
      <ReviewSkeletonCard>
        <Skeleton width="48%" height={16} borderRadius={6} />
        <Skeleton width="100%" height={12} borderRadius={5} style={styles.cellLine} />
        <Skeleton width="86%" height={12} borderRadius={5} />
      </ReviewSkeletonCard>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    width: '100%',
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Layout.pagePaddingX,
    gap: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  scopeTrack: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  gridBlock: {
    gap: Spacing.xl,
  },
  card: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing.md,
    ...Shadows.card,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  gridCells: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  gridCell: {
    width: '48.5%',
    flexGrow: 1,
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
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
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
