import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing } from '@/constants/design-tokens';
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
        { backgroundColor: colors.cardBg, borderColor: colors.outline },
      ]}
    >
      <View style={styles.budgetTopRow}>
        <View style={styles.budgetTopMain}>
          <Skeleton width={88} height={12} borderRadius={6} />
          <View style={styles.budgetPeriodRow}>
            <Skeleton width={72} height={11} borderRadius={5} />
            <Skeleton width={96} height={11} borderRadius={5} />
          </View>
          <Skeleton width={148} height={28} borderRadius={8} style={styles.budgetAmount} />
          <Skeleton width={44} height={22} borderRadius={11} />
          <View style={styles.budgetProgressBlock}>
            <View style={styles.budgetProgressLabels}>
              <Skeleton width={64} height={10} borderRadius={5} />
              <Skeleton width={64} height={10} borderRadius={5} />
            </View>
            <Skeleton width="100%" height={5} borderRadius={3} />
          </View>
        </View>
        <Skeleton width={78} height={78} borderRadius={39} />
      </View>

      <View style={styles.trendBlock}>
        <View style={styles.trendHeader}>
          <Skeleton width={72} height={14} borderRadius={6} />
          <Skeleton width={96} height={12} borderRadius={6} />
        </View>
        <Skeleton width="100%" height={120} borderRadius={10} style={styles.trendChart} />
        <Skeleton width={160} height={10} borderRadius={5} style={styles.trendHint} />
      </View>

      <View style={styles.assetsBtnRow}>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} width={96} height={36} borderRadius={12} />
        ))}
      </View>
    </View>
  );
}

export function FinanceAccountCarouselSkeleton({ colors }: Pick<FinanceSkeletonProps, 'colors'>) {
  return (
    <View>
      <View style={styles.sectionHeaderRow}>
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
            <Skeleton width={22} height={22} borderRadius={11} />
            <Skeleton width="72%" height={11} borderRadius={5} style={styles.accountKicker} />
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
      <View style={[styles.sectionHeaderRow, { marginTop: 6 }]}>
        <Skeleton width={72} height={18} borderRadius={6} />
        <Skeleton width={48} height={11} borderRadius={5} />
      </View>
      <View style={styles.sectionMetaRow}>
        <Skeleton width={120} height={12} borderRadius={6} />
        <Skeleton width={140} height={11} borderRadius={5} />
      </View>
      <View style={[styles.sectionDivider, { backgroundColor: colors.outline }]} />
      <View style={styles.txnList}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.txnRow,
              { backgroundColor: colors.surface, borderColor: colors.outline },
            ]}
          >
            <Skeleton width={40} height={40} borderRadius={20} />
            <View style={styles.txnMain}>
              <View style={styles.txnTopRow}>
                <View style={styles.txnTextCol}>
                  <Skeleton width="62%" height={14} borderRadius={6} />
                  <Skeleton width="44%" height={11} borderRadius={5} style={styles.txnMeta} />
                </View>
                <Skeleton width={56} height={14} borderRadius={6} />
              </View>
              <Skeleton width="88%" height={24} borderRadius={8} style={styles.txnInsight} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  budgetCard: {
    borderRadius: 18,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    gap: 14,
  },
  budgetTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  budgetTopMain: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  budgetPeriodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: -2,
  },
  budgetAmount: {
    marginTop: 2,
  },
  budgetProgressBlock: {
    gap: 8,
    marginTop: 4,
    paddingRight: 4,
  },
  budgetProgressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  trendBlock: {
    gap: 8,
    marginTop: 4,
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
    alignSelf: 'center',
    marginTop: 4,
  },
  assetsBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  carousel: {
    flexDirection: 'row',
    paddingVertical: 10,
    gap: 12,
    paddingRight: 20,
  },
  accountCard: {
    width: 200,
    borderRadius: Radius.lg,
    padding: Spacing['4xl'],
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  accountKicker: {
    marginTop: 2,
  },
  sectionMetaRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
  },
  sectionDivider: {
    height: 1,
    marginTop: 14,
    marginBottom: 4,
    opacity: 0.72,
  },
  txnList: {
    gap: 10,
    marginTop: 8,
  },
  txnRow: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  txnMain: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  txnTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  txnTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  txnMeta: {
    marginTop: 2,
  },
  txnInsight: {
    marginTop: 2,
  },
});
