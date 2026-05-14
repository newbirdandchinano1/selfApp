import { analyzeFinanceTxnCommentFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';
import { updateFinanceTransaction } from './finance';

/** 生成智谱摘要所需字段（与列表展示口径一致）。 */
export type FinanceTxnAiSummaryInput = {
  name: string;
  happened_at: string;
  transaction_type: string;
  accountLabel: string;
  amount: number;
  note: string | null;
  categoryLabel: string;
};

export function buildFinanceTxnAiSummaryText(input: FinanceTxnAiSummaryInput): string {
  const typeLabel = input.transaction_type === 'transfer' ? '转账' : input.transaction_type === 'income' ? '收入' : '支出';
  const absAmount = Math.abs(input.amount);
  const signedShown =
    input.transaction_type === 'income' ? absAmount : input.transaction_type === 'expense' ? -absAmount : input.amount;
  const happenedAt = new Date(input.happened_at);
  const timeStr = Number.isNaN(happenedAt.getTime())
    ? String(input.happened_at)
    : `${happenedAt.getFullYear()}年${happenedAt.getMonth() + 1}月${happenedAt.getDate()}日 ${String(happenedAt.getHours()).padStart(2, '0')}:${String(happenedAt.getMinutes()).padStart(2, '0')}`;
  const note = input.note?.trim();
  const lines = [
    `记账类型：${typeLabel}`,
    `标题：${input.name?.trim() || '（无标题）'}`,
    `金额（元，与用户列表展示同符号）：${signedShown.toFixed(2)}`,
    `账户：${input.accountLabel}`,
    `分类：${input.categoryLabel}`,
    `发生时间：${timeStr}`,
    ...(note ? [`备注：${note}`] : []),
  ];
  return lines.join('\n');
}

/**
 * 调用智谱生成单条评价并写入 `finance_transactions.ai_comment`。
 * 无密钥或请求失败时返回 `{ ok: false }`（流水仍已成功写入时可依赖列表页补全）。
 */
export async function tryPersistFinanceTxnAiComment(
  txnId: string,
  input: FinanceTxnAiSummaryInput,
): Promise<{ ok: true; comment: string } | { ok: false }> {
  const key = getActiveAiLlmApiKey().trim();
  if (!key) return { ok: false };
  const summaryText = buildFinanceTxnAiSummaryText(input);
  const r = await analyzeFinanceTxnCommentFromText({
    apiKey: key,
    summaryText,
    maxAttempts: 8,
    retryDelayMs: 800,
  });
  if (!r.ok) return { ok: false };
  await updateFinanceTransaction(txnId, { ai_comment: r.comment });
  return { ok: true, comment: r.comment };
}
