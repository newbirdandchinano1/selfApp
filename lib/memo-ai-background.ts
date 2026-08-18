import { memoContextForAiReview, runMemoAiReviewOnServer, setMemoAiReview, type MemoItem } from '@/lib/memos';
import { analyzeMemoReviewFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

const memoAiInFlight = new Set<string>();
const memoAiPendingAnalysisIds = new Set<string>();
const memoAiPendingListeners = new Set<(ids: ReadonlySet<string>) => void>();
const memoAiReviewSavedListeners = new Set<(row: MemoItem) => void>();

function emitMemoAiPendingSnapshot(): void {
  const snap = new Set(memoAiPendingAnalysisIds);
  for (const cb of memoAiPendingListeners) {
    try {
      cb(snap);
    } catch {
      // ignore
    }
  }
}

/** 订阅「分析中」占位集合变化；注册时立即回调当前快照。 */
export function addMemoAiPendingAnalysisListener(cb: (ids: ReadonlySet<string>) => void): () => void {
  memoAiPendingListeners.add(cb);
  cb(new Set(memoAiPendingAnalysisIds));
  return () => {
    memoAiPendingListeners.delete(cb);
  };
}

export function markMemoAiAnalysisPending(id: string): void {
  memoAiPendingAnalysisIds.add(id);
  emitMemoAiPendingSnapshot();
}

export function clearMemoAiAnalysisPending(id: string): void {
  if (!memoAiPendingAnalysisIds.delete(id)) return;
  emitMemoAiPendingSnapshot();
}

/** AI 评价与建议已成功写入本地后触发，用于列表页即时刷新。 */
export function addMemoAiReviewSavedListener(cb: (row: MemoItem) => void): () => void {
  memoAiReviewSavedListeners.add(cb);
  return () => {
    memoAiReviewSavedListeners.delete(cb);
  };
}

function notifyMemoAiReviewSaved(row: MemoItem): void {
  for (const cb of memoAiReviewSavedListeners) {
    try {
      cb(row);
    } catch {
      // ignore listener errors
    }
  }
}

/**
 * 新建备忘保存后调用：优先 `POST /memos/:id/ai-review` 落库；失败再回退纯分析接口。
 */
export function startMemoAiReviewInBackground(row: MemoItem): void {
  if (!memoContextForAiReview(row)) return;
  if (memoAiInFlight.has(row.id)) return;

  memoAiInFlight.add(row.id);
  markMemoAiAnalysisPending(row.id);

  void (async () => {
    try {
      try {
        const saved = await runMemoAiReviewOnServer(row.id);
        if (saved) {
          notifyMemoAiReviewSaved(saved);
          return;
        }
      } catch {
        // fall through
      }

      const key = getActiveAiLlmApiKey().trim();
      if (!key) return;
      const ctx = memoContextForAiReview(row);
      if (!ctx) return;
      const r = await analyzeMemoReviewFromText({ apiKey: key, memoContextText: ctx });
      if (!r.ok) return;
      const saved = await setMemoAiReview(row.id, { evaluation: r.evaluation, suggestions: r.suggestions });
      if (saved) notifyMemoAiReviewSaved(saved);
    } catch {
      // 静默失败，用户可在列表页手动重试
    } finally {
      memoAiInFlight.delete(row.id);
      clearMemoAiAnalysisPending(row.id);
    }
  })();
}
