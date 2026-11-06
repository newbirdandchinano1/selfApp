/**
 * 全局饮食预览 Sheet 启动（镜像 openFinanceSheet）。
 * 由根布局挂载的 GlobalFoodIntakeSheet 订阅。
 */
import type { FoodTextIntakeJson } from '@/lib/ai-types';

export type FoodIntakeSheetLaunchIntent = {
  seedAiDraft: FoodTextIntakeJson;
  /** 逻辑日 YYYY-MM-DD；缺省由宿主取今日 */
  recordDateYmd?: string;
};

type OpenListener = (intent: FoodIntakeSheetLaunchIntent) => void;

const openListeners = new Set<OpenListener>();

export function subscribeFoodIntakeSheetOpen(listener: OpenListener): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

export function openFoodIntakeSheet(intent: FoodIntakeSheetLaunchIntent): void {
  for (const listener of openListeners) {
    listener(intent);
  }
}
