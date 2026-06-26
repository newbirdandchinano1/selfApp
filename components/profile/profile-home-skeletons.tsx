import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing } from '@/constants/design-tokens';
import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VISION_CARD_WIDTH = SCREEN_WIDTH - 36;

export type ProfileSkeletonColors = {
  surface: string;
  outline: string;
};

type ProfileSkeletonProps = {
  colors: ProfileSkeletonColors;
  isDark?: boolean;
};

export function ProfileHeaderSkeleton({ colors, isDark = false }: ProfileSkeletonProps) {
  return (
    <View style={[styles.header, { backgroundColor: isDark ? colors.surface : '#ffffff' }]}>
      <View style={styles.headerTopRow}>
        <Skeleton width={96} height={96} borderRadius={48} />
        <View style={styles.headerInfo}>
          <Skeleton width={148} height={32} borderRadius={8} />
        </View>
      </View>

      <View style={[styles.statsRow, { borderTopColor: colors.outline }]}>
        {Array.from({ length: 4 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.statCell,
              index > 0 && { borderLeftWidth: 1, borderLeftColor: colors.outline },
            ]}
          >
            <Skeleton width={28} height={10} borderRadius={5} />
            <Skeleton width={40} height={20} borderRadius={6} style={styles.statValue} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function ProfileVisionSectionSkeleton({
  cardWidth = VISION_CARD_WIDTH,
  colors,
  isDark = false,
}: ProfileSkeletonProps & { cardWidth?: number }) {
  return (
    <>
      <View style={styles.sectionHead}>
        <View>
          <Skeleton width={88} height={11} borderRadius={5} />
          <Skeleton width={168} height={28} borderRadius={8} style={styles.sectionTitleGap} />
        </View>
        <Skeleton width={56} height={14} borderRadius={6} />
      </View>

      <View style={styles.visionStackWrap}>
        <View
          style={[
            styles.visionCard,
            {
              width: cardWidth,
              backgroundColor: isDark ? 'rgba(30,41,59,0.58)' : 'rgba(255,255,255,0.92)',
              borderColor: colors.outline,
            },
          ]}
        >
          <Skeleton width={72} height={10} borderRadius={5} />
          <Skeleton width="72%" height={34} borderRadius={8} style={styles.visionTitle} />
          <Skeleton width="100%" height={6} borderRadius={3} style={styles.visionProgress} />
          <View style={styles.progressMetaRow}>
            <Skeleton width={88} height={12} borderRadius={5} />
            <Skeleton width={52} height={20} borderRadius={6} />
          </View>
        </View>

        <View style={styles.visionDots}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} width={index === 0 ? 18 : 8} height={8} borderRadius={999} />
          ))}
        </View>
      </View>
    </>
  );
}

export function ProfileWishListSectionSkeleton({ colors, isDark = false }: ProfileSkeletonProps) {
  return (
    <>
      <View style={styles.sectionHead}>
        <View>
          <Skeleton width={56} height={11} borderRadius={5} />
          <Skeleton width={88} height={28} borderRadius={8} style={styles.sectionTitleGap} />
        </View>
        <Skeleton width={56} height={14} borderRadius={6} />
      </View>

      <View style={styles.wishlistRow}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.wishlistCard,
              {
                backgroundColor: isDark ? 'rgba(30,41,59,0.58)' : '#f2f3ff',
                borderColor: colors.outline,
              },
            ]}
          >
            <Skeleton width={48} height={48} borderRadius={12} />
            <Skeleton width="88%" height={14} borderRadius={6} style={styles.wishTitle} />
            <Skeleton width="88%" height={14} borderRadius={6} style={styles.wishTitle} />
            <Skeleton width={56} height={12} borderRadius={5} style={styles.wishPrice} />
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingTop: 58,
    paddingBottom: 20,
    overflow: 'hidden',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerInfo: {
    flex: 1,
  },
  statsRow: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  statValue: {
    marginTop: 2,
  },
  sectionHead: {
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  sectionTitleGap: {
    marginTop: 3,
  },
  visionStackWrap: {
    minHeight: 344,
    justifyContent: 'flex-end',
  },
  visionCard: {
    minHeight: 300,
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    justifyContent: 'flex-end',
    alignSelf: 'center',
  },
  visionTitle: {
    marginTop: 10,
  },
  visionProgress: {
    marginTop: 20,
  },
  progressMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  visionDots: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  wishlistRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  wishlistCard: {
    width: 160,
    borderRadius: Radius.lg,
    padding: Spacing['4xl'],
    borderWidth: StyleSheet.hairlineWidth,
    gap: 0,
  },
  wishTitle: {
    marginTop: 8,
  },
  wishPrice: {
    marginTop: 8,
  },
});
