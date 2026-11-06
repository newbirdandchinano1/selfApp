/**
 * 心愿板缺口 Sheet：一期纯模板 headline / sub（资格仍用本地 eligibility）。
 * 需要更自然的文案时可再接 Agent `wish-board/coach-unlock`。
 */

import { formatWishBoxPoints } from '@/constants/wish-box-ui';
import type { WishBoardRedeemEligibility } from '@/lib/repositories/wish-board/wish-board-redeem-conditions';

export function buildWishBoardGapCoachTemplate(
  wishTitle: string,
  eligibility: WishBoardRedeemEligibility,
): { headline: string; sub: string } {
  const pendingCount = eligibility.pending.length;
  const pointsGap = eligibility.pointsOk
    ? 0
    : Math.max(0, eligibility.costPoints - eligibility.balance);
  const pointsRow = pointsGap > 0 ? 1 : 0;
  const total = pendingCount + pointsRow;
  const shortTitle = wishTitle.trim() || '这份心愿';

  if (total <= 0) {
    return {
      headline: '还差一点点就能兑换 ✨',
      sub: `「${shortTitle}」条件已齐，确认后即可兑换`,
    };
  }

  if (total === 1 && pointsRow === 1) {
    return {
      headline: `再攒 ${formatWishBoxPoints(pointsGap)} 分就能兑`,
      sub: `当前 ${formatWishBoxPoints(eligibility.balance)} · 「${shortTitle}」需要 ${formatWishBoxPoints(eligibility.costPoints)}`,
    };
  }

  if (total === 1) {
    const only = eligibility.pending[0];
    const kindHint =
      only?.kind === 'habit'
        ? '打卡达标'
        : only?.kind === 'net_worth'
          ? '攒到净资产门槛'
          : only?.kind === 'available_from'
            ? '等到开放时间'
            : '完成关联事项';
    return {
      headline: `${kindHint}就能解锁 ✨`,
      sub: `搞定下面这一步，「${shortTitle}」就是你的了：`,
    };
  }

  return {
    headline: `还差 ${total} 步就能兑换 ✨`,
    sub: `完成下面 ${total} 件事，「${shortTitle}」就是你的了：`,
  };
}
