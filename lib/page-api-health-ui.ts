import { getActivePageApiKey } from '@/lib/page-api-active';
import { TAB_PAGE_KEYS } from '@/lib/page-api-scope';

const SKELETON_LOADING_TAB_KEYS = new Set<string>([
  TAB_PAGE_KEYS.health,
  TAB_PAGE_KEYS.tasks,
  TAB_PAGE_KEYS.finance,
  TAB_PAGE_KEYS.profile,
  TAB_PAGE_KEYS.review,
]);

/** 使用页面内骨架屏承载加载态，不展示全局 API 遮罩与内容变暗；同步时仅顶部进度条 */
export function isSkeletonLoadingTabPageKey(pageKey: string | null | undefined): boolean {
  return pageKey != null && SKELETON_LOADING_TAB_KEYS.has(pageKey);
}

/** @deprecated 使用 isSkeletonLoadingTabPageKey */
export function isHealthTabPageKey(pageKey: string | null | undefined): boolean {
  return isSkeletonLoadingTabPageKey(pageKey);
}

export function isSkeletonLoadingTabActive(): boolean {
  return isSkeletonLoadingTabPageKey(getActivePageApiKey());
}

/** @deprecated 使用 isSkeletonLoadingTabActive */
export function isHealthTabActive(): boolean {
  return isSkeletonLoadingTabActive();
}
