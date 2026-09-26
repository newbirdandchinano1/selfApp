/**
 * 积分变更单一事件总线（P1-03）：
 * 余额刷新 + 获得/扣除 toast 只从这里发出，避免多处各调一套。
 */
import { notifyPointsBalanceChanged, subscribePointsBalanceChanged } from '@/lib/points-balance-events';
import {
  formatPointsToastAmount,
  notifyPointsEarned,
  subscribePointsEarnedToast,
  suppressPointsEarnedToastForMs,
} from '@/lib/points-earned-toast-events';
import { asPoints } from '@/lib/reward-points';

export {
  formatPointsToastAmount,
  subscribePointsBalanceChanged,
  subscribePointsEarnedToast,
  suppressPointsEarnedToastForMs,
};

export type PointsMutationNotify = {
  balance: number;
  /** 本次变动量；省略则只刷新余额、不弹 toast */
  delta?: number;
};

/** 钱包写成功后的统一通知入口 */
export function notifyPointsMutation(opts: PointsMutationNotify): void {
  const balance = asPoints(opts.balance);
  notifyPointsBalanceChanged(balance);
  if (opts.delta != null) {
    const delta = asPoints(opts.delta);
    if (delta !== 0) notifyPointsEarned(delta);
  }
}
