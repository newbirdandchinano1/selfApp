/**
 * 心愿板周期摘要：本地拼装进周复盘 `related_digest`（P2 · 5.9，不必新 Agent 路由）。
 */

import { ymdFromDatetime } from '@/lib/api-mysql-datetime';
import { isYmdInRange } from '@/lib/date';
import { getPointsBalance } from '@/lib/repositories/points/points';
import {
  listWishBoardItems,
  listWishRedeemRecords,
} from '@/lib/repositories/wish-board/wish-board';

export type WishBoardPeriodDigestOpts = {
  startYmd: string;
  endYmd: string;
  /** 不传则本地读余额 */
  balance?: number;
};

/**
 * 例：`本周兑了 2 次心愿（周末电影、咖啡）；余额约 480；「短途旅行」还差 1320 分解锁`
 * 无数据时返回空串。
 */
export async function buildWishBoardPeriodDigest(
  opts: WishBoardPeriodDigestOpts,
): Promise<string> {
  const start = (opts.startYmd || '').trim();
  const end = (opts.endYmd || '').trim();
  if (!start || !end) return '';

  const [items, redeemed, balance] = await Promise.all([
    listWishBoardItems().catch(() => []),
    listWishRedeemRecords().catch(() => []),
    opts.balance != null && Number.isFinite(opts.balance)
      ? Promise.resolve(opts.balance)
      : getPointsBalance().catch(() => 0),
  ]);

  const inPeriod = redeemed.filter(r => {
    const ymd = ymdFromDatetime(r.redeemed_at);
    return ymd ? isYmdInRange(ymd, start, end) : false;
  });

  const parts: string[] = [];

  if (inPeriod.length > 0) {
    const titles = inPeriod
      .slice(0, 4)
      .map(r => r.title.trim())
      .filter(Boolean);
    const titleHint = titles.length ? `（${titles.join('、')}）` : '';
    parts.push(`本周兑了 ${inPeriod.length} 次心愿${titleHint}`);
  } else {
    parts.push('本周尚未兑换心愿');
  }

  parts.push(`余额约 ${Math.max(0, Math.round(balance))}`);

  const active = items.filter(i => i.status === 'active');
  let nearest: { title: string; gap: number } | null = null;
  for (const item of active) {
    const gap = Math.max(0, Math.round(item.cost_points) - Math.round(balance));
    if (gap <= 0) continue;
    if (!nearest || gap < nearest.gap) {
      nearest = { title: item.title.trim() || '心愿', gap };
    }
  }
  if (nearest) {
    parts.push(`「${nearest.title}」还差 ${nearest.gap} 分解锁`);
  } else if (active.length > 0) {
    parts.push(`当前有 ${active.length} 颗活跃心愿可关注兑换`);
  }

  return parts.join('；');
}
