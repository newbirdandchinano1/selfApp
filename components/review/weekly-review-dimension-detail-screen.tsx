import { ReviewDimensionDetailScreen } from '@/components/review/review-dimension-detail-screen';

/** @deprecated 使用 ReviewDimensionDetailScreen({ scope: 'weekly' }) */
export function WeeklyReviewDimensionDetailScreen() {
  return <ReviewDimensionDetailScreen scope="weekly" />;
}
