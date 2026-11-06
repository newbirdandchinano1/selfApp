/**
 * P0-4：澄清选项 → 再次投递给 assistant/route 的文案拼装。
 * 用途：用户点 clarify_choices 后，把短选项与原文合成可再分类的句子。
 */

/** 纯域标签（需拼上原文） */
const DOMAIN_LABELS = new Set([
  '记账',
  '记饮食',
  '建待办',
  '备忘点评',
  '建习惯',
  '衣橱',
  '记菜谱',
  '心愿',
  '完善资料',
  '取消',
]);

/**
 * 将澄清选项与用户原文合成下一次 route 的文本。
 *
 * @param originalText 用户原始输入（可为空）
 * @param choice 澄清卡上的选项文案
 * @returns 供 `runAssistantRoute` 使用的文本；空选项回退原文
 */
export function composeClarifyResubmitText(originalText: string, choice: string): string {
  const choiceT = (choice ?? '').trim();
  const orig = (originalText ?? '').trim();
  if (!choiceT) return orig;
  if (choiceT === '取消') return orig;
  if (!orig) return choiceT;

  // 选项已包含原文（如「记账 28 元」且原文为「28」）→ 直接用选项
  if (choiceT.includes(orig)) return choiceT;

  // 短域标签 → 「记账 咖啡 18」
  if (DOMAIN_LABELS.has(choiceT)) {
    return `${choiceT} ${orig}`;
  }

  // 「记账 xxx」类短前缀且未带原文 → 追加原文
  if (/^(记账|记饮食|建待办|备忘点评|建习惯|衣橱|记菜谱|心愿|完善资料)\s*$/.test(choiceT)) {
    return `${choiceT} ${orig}`;
  }

  return choiceT;
}

/**
 * 判断 ActionCard 是否为澄清卡（需展示选项、禁止当确认写库）。
 *
 * @param intent ActionCard.intent
 * @param clarifyQuestion 可选澄清问题
 * @returns 是否按澄清 UI 处理
 */
export function isClarifyCard(
  intent: string | undefined,
  clarifyQuestion?: string | null,
): boolean {
  if (intent === 'clarify') return true;
  return Boolean(clarifyQuestion && clarifyQuestion.trim());
}
