import { analyzeWishItemAiCommentFromText, getZhipuApiKey } from '@/lib/zhipu-image-parse';

import { patchWishItemAiReview } from './wish-list';
import type { WishItemRow } from './wish-list.types';

export type WishItemAiSummaryInput = {
  name: string;
  price: number;
  categoryLabel: string | null;
  desire_level: number;
  reason: string | null;
};

export function wishItemAiInputFromRow(row: WishItemRow): WishItemAiSummaryInput {
  return {
    name: row.name,
    price: row.price,
    categoryLabel: row.category_label?.trim() || null,
    desire_level: row.desire_level,
    reason: row.reason?.trim() || null,
  };
}

export function buildWishItemAiSummaryText(input: WishItemAiSummaryInput): string {
  const name = input.name.trim() || '（未命名）';
  const price = Number.isFinite(input.price) ? input.price : 0;
  const cat = input.categoryLabel?.trim() || '未分类';
  const lines = [
    `好物名称：${name}`,
    `预估价格（元）：${price}`,
    `欲望等级：${input.desire_level}/5（5 为最强）`,
    `类别：${cat}`,
  ];
  const reason = input.reason?.trim().replace(/\s+/g, ' ');
  if (reason) {
    lines.push(`心动理由：${reason.length > 500 ? `${reason.slice(0, 497)}…` : reason}`);
  }
  return lines.join('\n');
}

/**
 * 调用智谱生成单条心愿评价并写入 `wish_items.ai_comment`（不更新 `updated_at`）。
 */
export async function tryPersistWishItemAiComment(
  id: string,
  input: WishItemAiSummaryInput,
): Promise<{ ok: true; comment: string } | { ok: false }> {
  const key = getZhipuApiKey().trim();
  if (!key) return { ok: false };
  const summaryText = buildWishItemAiSummaryText(input);
  const r = await analyzeWishItemAiCommentFromText({
    apiKey: key,
    summaryText,
    maxAttempts: 8,
    retryDelayMs: 800,
  });
  if (!r.ok) return { ok: false };
  await patchWishItemAiReview(id, r.comment);
  return { ok: true, comment: r.comment };
}
