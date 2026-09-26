import { ReviewDimensionDetailScreen } from '@/components/review/review-dimension-detail-screen';

/** @deprecated 使用 ReviewDimensionDetailScreen({ scope: 'daily' }) */
export function DailyReviewDimensionDetailScreen() {
  return <ReviewDimensionDetailScreen scope="daily" />;
}
