import { memoContextForAiReview, setMemoAiReview, type MemoItem } from '@/lib/memos';
import { analyzeMemoReviewFromText, getZhipuApiKey } from '@/lib/zhipu-image-parse';

/**
 * 新建备忘保存后调用：在后台请求智谱生成评价与建议并写入本地（不阻塞 UI；无密钥或内容为空则静默跳过）。
 */
export function startMemoAiReviewInBackground(row: MemoItem): void {
  void (async () => {
    try {
      const key = getZhipuApiKey().trim();
      if (!key) return;
      const ctx = memoContextForAiReview(row);
      if (!ctx) return;
      const r = await analyzeMemoReviewFromText({ apiKey: key, memoContextText: ctx });
      if (!r.ok) return;
      await setMemoAiReview(row.id, { evaluation: r.evaluation, suggestions: r.suggestions });
    } catch {
      // 静默失败，用户可在列表页手动重试
    }
  })();
}
