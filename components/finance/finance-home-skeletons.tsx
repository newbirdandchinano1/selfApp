import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Shadows, Spacing } from '@/constants/design-tokens';
import React from 'react';
import { StyleSheet, View } from 'react-native';

export type FinanceSkeletonColors = {
  surface: string;
  outline: string;
  cardBg: string;
};

type FinanceSkeletonProps = {
  colors: FinanceSkeletonColors;
};

export function FinanceBudgetCardSkeleton({ colors }: FinanceSkeletonProps) {
  return (
    <View
      style={[
        styles.budgetCard,
        Shadows.card,
        { backgroundColor: colors.cardBg, borderColor: colors.outline },
      ]}
    >
      <View style={styles.budgetTopRow}>
        <View style={styles.budgetTopMain}>
          <View style={styles.budgetTitleRow}>
            <Skeleton width={88} height={13} borderRadius={6} />
            <Skeleton width={64} height={20} borderRadius={10} />
          </View>
          <Skeleton width={110} height={11} borderRadius={5} />
          <Skeleton width={148} height={28} borderRadius={8} style={styles.budgetAmount} />
          <View style={styles.budgetProgressBlock}>
            <View style={styles.budgetProgressLabels}>
              <Skeleton width={72} height={11} borderRadius={5} />
              <Skeleton width={88} height={11} borderRadius={5} />
            </View>
            <Skeleton width="100%" height={6} borderRadius={3} />
          </View>
        </View>
        <Skeleton width={96} height={96} borderRadius={48} />
      </View>

      <View style={[styles.trendDivider, { backgroundColor: colors.outline }]} />

      <View style={styles.trendBlock}>
        <View style={styles.trendHeader}>
          <Skeleton width={64} height={15} borderRadius={6} />
          <Skeleton width={64} height={24} borderRadius={12} />
        </View>
        <Skeleton width={132} height={24} borderRadius={8} />
        <Skeleton width={96} height={12} borderRadius={5} />
        <Skeleton width="100%" height={120} borderRadius={14} style={styles.trendChart} />
        <Skeleton width={140} height={10} borderRadius={5} style={styles.trendHint} />
      </View>

      <View style={styles.assetsBtnRow}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View key={index} style={styles.assetsBtn}>
            <Skeleton width="100%" height={52} borderRadius={12} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function FinanceAccountCarouselSkeleton({ colors }: Pick<FinanceSkeletonProps, 'colors'>) {
  return (
    <View>
      <View style={[styles.sectionHeaderRow, { borderBottomColor: colors.outline }]}>
        <Skeleton width={72} height={18} borderRadius={6} />
        <Skeleton width={36} height={12} borderRadius={6} />
      </View>
      <View style={styles.carousel}>
        {Array.from({ length: 2 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.accountCard,
              { backgroundColor: colors.surface, borderColor: colors.outline },
            ]}
          >
            <Skeleton width={36} height={36} borderRadius={12} />
            <Skeleton width="72%" height={12} borderRadius={5} style={styles.accountKicker} />
            <Skeleton width="48%" height={18} borderRadius={6} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function FinanceTxnListSkeleton({ colors }: Pick<FinanceSkeletonProps, 'colors'>) {
  return (
    <View>
      <View style={[styles.sectionHeaderRow, { borderBottomColor: colors.outline }]}>
        <Skeleton width={72} height={18} borderRadius={6} />
        <Skeleton width={48} height={11} borderRadius={5} />
      </View>
      <View style={[styles.dayGroup, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
        <View style={[styles.dayGroupHeader, { borderBottomColor: colors.outline }]}>
          <View style={styles.dayGroupTitleCol}>
            <Skeleton width={36} height={15} borderRadius={5} />
            <Skeleton width={96} height={11} borderRadius={5} />
          </View>
          <View style={styles.dayGroupTotals}>
            <Skeleton width={72} height={11} borderRadius={5} />
            <Skeleton width={64} height={11} borderRadius={5} />
          </View>
        </View>
        {Array.from({ length: 3 }).map((_, index) => (
          <View key={index} style={styles.txnRow}>
            <Skeleton width={36} height={36} borderRadius={12} />
            <View style={[styles.txnMain, index < 2 ? { borderBottomColor: colors.outline, borderBottomWidth: StyleSheet.hairlineWidth } : null]}>
              <View style={styles.txnTopRow}>
                <Skeleton width="58%" height={14} borderRadius={6} />
                <Skeleton width={56} height={15} borderRadius={6} />
              </View>
              <View style={styles.txnTagRow}>
                <Skeleton width={40} height={18} borderRadius={7} />
                <Skeleton width={32} height={18} borderRadius={7} />
                <Skeleton width={56} height={18} borderRadius={7} />
              </View>
              <Skeleton width="78%" height={12} borderRadius={5} style={styles.txnInsight} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  budgetCard: {
    borderRadius: Radius['2xl'],
    padding: Spacing['4xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  budgetTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  budgetTopMain: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  budgetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  budgetAmount: {
    marginTop: 2,
  },
  budgetProgressBlock: {
    gap: 8,
    marginTop: 6,
  },
  budgetProgressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  trendDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 18,
    marginBottom: 14,
  },
  trendBlock: {
    gap: 8,
  },
  trendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trendChart: {
    marginTop: 4,
  },
  trendHint: {
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  assetsBtnRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  assetsBtn: {
    flex: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: Spacing.xl,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  carousel: {
    flexDirection: 'row',
    paddingVertical: 4,
    gap: 12,
  },
  accountCard: {
    width: 168,
    borderRadius: Radius.xl,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  accountKicker: {
    marginTop: 2,
  },
  dayGroup: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  dayGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayGroupTitleCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  dayGroupTotals: {
    alignItems: 'flex-end',
    gap: 4,
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    paddingLeft: 14,
    paddingRight: 14,
  },
  txnMain: {
    flex: 1,
    minWidth: 0,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 6,
  },
  txnTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  txnTagRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 5,
  },
  txnInsight: {
    marginTop: 2,
  },
});
