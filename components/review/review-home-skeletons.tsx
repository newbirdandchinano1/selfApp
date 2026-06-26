import { Skeleton } from '@/components/ui/skeleton';
import React from 'react';
import { StyleSheet, View } from 'react-native';

export type ReviewSkeletonColors = {
  surface: string;
  outline: string;
};

type ReviewSkeletonProps = {
  colors: ReviewSkeletonColors;
  isDark?: boolean;
};

export function ReviewWeekStripSkeleton({ colors, isDark = false }: ReviewSkeletonProps) {
  return (
    <View style={styles.weekStripWrap}>
      <View style={styles.weekStripHead}>
        <Skeleton width={52} height={14} borderRadius={6} />
        <Skeleton width={96} height={14} borderRadius={6} />
      </View>
      <View style={styles.weekStripRow}>
        {Array.from({ length: 7 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.weekDay,
              {
                backgroundColor: isDark ? 'rgba(15,23,42,0.4)' : colors.surface,
                borderColor: colors.outline,
              },
            ]}
          >
            <Skeleton width={20} height={9} borderRadius={4} />
            <Skeleton width={16} height={16} borderRadius={6} style={styles.weekDayNum} />
            <Skeleton width={6} height={6} borderRadius={3} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function ReviewDailyContentCardSkeleton({ colors, isDark = false }: ReviewSkeletonProps) {
  return (
    <View
      style={[
        styles.reviewContentCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.outline,
          shadowColor: isDark ? '#000' : '#006c49',
        },
      ]}
    >
      <View style={[styles.reviewContentAccent, { backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.24)' }]} />
      <View style={styles.reviewContentInner}>
        <View style={styles.reviewContentHead}>
          <View style={styles.reviewContentHeadText}>
            <Skeleton width={36} height={11} borderRadius={5} />
            <Skeleton width={128} height={20} borderRadius={8} style={styles.reviewContentDate} />
          </View>
          <Skeleton width={36} height={36} borderRadius={12} />
        </View>
        <View style={[styles.reviewEmpty, { borderColor: colors.outline }]}>
          <Skeleton width={28} height={28} borderRadius={14} />
          <Skeleton width="72%" height={14} borderRadius={6} style={styles.reviewEmptyHint} />
        </View>
      </View>
    </View>
  );
}

export function ReviewQuickActionsSkeleton({ colors, isDark = false }: ReviewSkeletonProps) {
  return (
    <View style={styles.quickActions}>
      {Array.from({ length: 3 }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.quickAction,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
            },
          ]}
        >
          <Skeleton width={40} height={40} borderRadius={12} />
          <Skeleton width={56} height={12} borderRadius={6} style={styles.quickActionLabel} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  weekStripWrap: { gap: 10 },
  weekStripHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekStripRow: {
    flexDirection: 'row',
    gap: 6,
  },
  weekDay: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 2,
    gap: 3,
    minWidth: 0,
  },
  weekDayNum: {
    marginVertical: 1,
  },
  reviewContentCard: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 2,
  },
  reviewContentAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 1,
  },
  reviewContentInner: {
    paddingLeft: 18,
    paddingRight: 16,
    paddingVertical: 16,
    gap: 14,
  },
  reviewContentHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  reviewContentHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  reviewContentDate: {
    marginTop: 2,
  },
  reviewEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  reviewEmptyHint: {
    marginTop: 8,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    minWidth: 0,
  },
  quickActionLabel: {
    marginTop: 8,
  },
});
