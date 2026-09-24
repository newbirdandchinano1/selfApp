import { Layout, Spacing } from '@/constants/design-tokens';

const TABLET_MIN_WIDTH = 768;

/** 复盘页水平边距：比全局 20 更紧，减少两侧空档感 */
export const REVIEW_PAGE_PADDING_X = Spacing['3xl']; // 16

/** 手机全宽；平板才限宽 */
export function reviewContentMaxWidth(windowWidth: number): number | undefined {
  if (windowWidth >= TABLET_MIN_WIDTH) return Layout.contentMaxWidthWide;
  return undefined;
}

export function isReviewTabletWidth(windowWidth: number): boolean {
  return windowWidth >= TABLET_MIN_WIDTH;
}
