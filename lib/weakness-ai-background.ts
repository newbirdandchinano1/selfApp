import {
  setUserWeaknessAiReview,
  weaknessContextForAiReview,
  type UserWeaknessItem,
} from '@/lib/user-weaknesses';
import { analyzeWeaknessReviewFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

const weaknessAiInFlight = new Set<string>();

/** 正在等待智谱返回的缺点 id（与接口是否已返回无关，先占位「分析中」） */
const weaknessAiPendingAnalysisIds = new Set<string>();

const weaknessAiPendingListeners = new Set<(ids: ReadonlySet<string>) => void>();

function emitWeaknessAiPendingSnapshot(): void {
  const snap = new Set(weaknessAiPendingAnalysisIds);
  for (const cb of weaknessAiPendingListeners) {
    try {
      cb(snap);
    } catch {
      // ignore
    }
  }
}

/** 订阅「分析中」占位集合变化；注册时立即回调当前快照。 */
export function addWeaknessAiPendingAnalysisListener(cb: (ids: ReadonlySet<string>) => void): () => void {
  weaknessAiPendingListeners.add(cb);
  cb(new Set(weaknessAiPendingAnalysisIds));
  return () => weaknessAiPendingListeners.delete(cb);
}

export function markWeaknessAiAnalysisPending(id: string): void {
  weaknessAiPendingAnalysisIds.add(id);
  emitWeaknessAiPendingSnapshot();
}

export function clearWeaknessAiAnalysisPending(id: string): void {
  if (!weaknessAiPendingAnalysisIds.delete(id)) return;
  emitWeaknessAiPendingSnapshot();
}

const weaknessAiReviewSavedListeners = new Set<(row: UserWeaknessItem) => void>();

/** AI 分析与建议已成功写入本地后触发，用于列表页等即时刷新。 */
export function addWeaknessAiReviewSavedListener(cb: (row: UserWeaknessItem) => void): () => void {
  weaknessAiReviewSavedListeners.add(cb);
  return () => weaknessAiReviewSavedListeners.delete(cb);
}

function notifyWeaknessAiReviewSaved(row: UserWeaknessItem): void {
  for (const cb of weaknessAiReviewSavedListeners) {
    try {
      cb(row);
    } catch {
      // ignore listener errors
    }
  }
}

export type RunWeaknessAiReviewResult =
  | { ok: true; row: UserWeaknessItem; skipped: boolean }
  | { ok: false; error: string };

/**
 * 请求智谱生成缺点的分析与建议并写入本地。非 force 时若已有持久化结果（ai_review_at）则跳过。
 * 同一 id 并发请求会去重。
 */
export async function runWeaknessAiReview(
  row: UserWeaknessItem,
  opts?: { force?: boolean },
): Promise<RunWeaknessAiReviewResult> {
  if (weaknessAiInFlight.has(row.id)) {
    return { ok: false, error: '正在请求 AI，请稍候' };
  }
  if (!opts?.force && row.ai_review_at?.trim()) {
    return { ok: true, row, skipped: true };
  }

  const key = getActiveAiLlmApiKey().trim();
  if (!key) {
    clearWeaknessAiAnalysisPending(row.id);
    return { ok: false, error: '未配置智谱 API 密钥' };
  }
  const ctx = weaknessContextForAiReview(row);
  if (!ctx) {
    clearWeaknessAiAnalysisPending(row.id);
    return { ok: false, error: '请填写缺点名称或详情后再试' };
  }

  weaknessAiInFlight.add(row.id);
  if (!row.ai_review_at?.trim()) {
    markWeaknessAiAnalysisPending(row.id);
  }
  try {
    const r = await analyzeWeaknessReviewFromText({ apiKey: key, weaknessContextText: ctx });
    if (!r.ok) {
      return { ok: false, error: r.error };
    }
    const saved = await setUserWeaknessAiReview(row.id, { evaluation: r.evaluation, suggestions: r.suggestions });
    if (!saved) {
      return { ok: false, error: '保存失败' };
    }
    notifyWeaknessAiReviewSaved(saved);
    return { ok: true, row: saved, skipped: false };
  } finally {
    weaknessAiInFlight.delete(row.id);
    clearWeaknessAiAnalysisPending(row.id);
  }
}

/**
 * 保存条目后调用：后台生成并持久化（无密钥、无正文或已有结果则静默跳过）。
 * 会先同步标记「分析中」占位，再异步请求接口。
 */
export function startWeaknessAiReviewInBackground(row: UserWeaknessItem, onDone?: () => void): void {
  if (!weaknessContextForAiReview(row)) {
    onDone?.();
    return;
  }
  markWeaknessAiAnalysisPending(row.id);
  void (async () => {
    try {
      await runWeaknessAiReview(row, { force: false });
    } catch {
      // 静默失败；占位已在 runWeaknessAiReview 的 finally 中清除
    } finally {
      onDone?.();
    }
  })();
}
