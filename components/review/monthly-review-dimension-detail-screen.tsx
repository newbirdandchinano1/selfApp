import { ReviewDimensionDetailScreen } from '@/components/review/review-dimension-detail-screen';

/** @deprecated 使用 ReviewDimensionDetailScreen({ scope: 'monthly' }) */
export function MonthlyReviewDimensionDetailScreen() {
  return <ReviewDimensionDetailScreen scope="monthly" />;
}
