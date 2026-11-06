/**
 * compose 意图粗判（纯函数，可单测；与 Agent looks_like_compose_goal 对齐）。
 */

export const ASSISTANT_COMPOSE_MAX_CARDS = 5;

/** 跨域编排句走 compose；宁可漏判走 route。 */
export function looksLikeComposeGoal(text: string): boolean {
  const t = (text || '').trim();
  if (!t || t.length < 4) return false;
  if (
    /\d+(\.\d+)?\s*(元|块|¥|￥)/.test(t) &&
    /微信|支付宝|现金|银行卡|记一笔|花了|收入/.test(t)
  ) {
    return false;
  }
  return /按缺口|安排晚上|安排今晚|今晚安排|根据.{0,12}缺口|复盘后|给三件|三件能做|跨域编排|今天还能吃|蛋白还差|补齐缺口|本周.{0,8}建议|缺口安排/.test(
    t,
  );
}
