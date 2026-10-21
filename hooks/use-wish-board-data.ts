import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { subscribePointsBalanceChanged } from '@/lib/points-balance-events';
import { fetchProfileWishBoard } from '@/lib/profile-page-api';
import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTasks } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  evaluateWishBoardRedeemEligibilitySync,
  formatWishBoardRedeemConditionsSummary,
  hasWishBoardRedeemConditions,
  loadWishBoardCurrentNetWorth,
  parseWishBoardRedeemConditions,
  type WishBoardRedeemEligibility,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import {
  getPointsBalance,
  listWishBoardItems,
  listWishRedeemRecords,
} from '@/lib/repositories/wish-board/wish-board';
import { getPointsEarnedThisMonth } from '@/lib/repositories/points/points';
import type { WishBoardItemRow, WishRedeemRecord } from '@/lib/repositories/wish-board/wish-board.types';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const PAGE_KEY = 'wish-board';

export type WishBoardEntityLookups = {
  projectsById: Map<string, ProjectRow>;
  tasksById: Map<string, TaskRow>;
};

export type WishBoardBlockedMeta = {
  eligibility: WishBoardRedeemEligibility | undefined;
  condSummary: string | null;
  blockedLabel: string;
  hintLine: string;
};

export function useWishBoardData() {
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_KEY);

  const [balance, setBalance] = useState(0);
  const [monthEarned, setMonthEarned] = useState(0);
  const [items, setItems] = useState<WishBoardItemRow[]>([]);
  const [redeemRecords, setRedeemRecords] = useState<WishRedeemRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [currentNetWorth, setCurrentNetWorth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const entityLookups = useMemo<WishBoardEntityLookups>(() => {
    const projectsById = new Map(projects.map(p => [p.id, p]));
    const tasksById = new Map(tasks.map(t => [t.id, t]));
    return { projectsById, tasksById };
  }, [projects, tasks]);

  const eligibilityById = useMemo(() => {
    const map = new Map<string, WishBoardRedeemEligibility>();
    for (const item of items) {
      if (item.status !== 'active') continue;
      map.set(
        item.id,
        evaluateWishBoardRedeemEligibilitySync(item, balance, {
          ...entityLookups,
          currentNetWorth,
          allTasks: tasks,
        }),
      );
    }
    return map;
  }, [items, balance, currentNetWorth, entityLookups, tasks]);

  const activeItems = useMemo(() => {
    return items
      .filter(i => i.status === 'active')
      .slice()
      .sort((a, b) => {
        const aOk = eligibilityById.get(a.id)?.ok ?? false;
        const bOk = eligibilityById.get(b.id)?.ok ?? false;
        if (aOk !== bOk) return aOk ? -1 : 1;
        if (a.wish_type !== b.wish_type) return a.wish_type === 'once' ? -1 : 1;
        return 0;
      });
  }, [items, eligibilityById]);

  const readyItems = useMemo(
    () => activeItems.filter(i => eligibilityById.get(i.id)?.ok),
    [activeItems, eligibilityById],
  );
  /** 暂不可兑：按「还差多少积分」由近到远排，最接近达成的心愿排前面 */
  const waitingItems = useMemo(() => {
    const list = activeItems.filter(i => !eligibilityById.get(i.id)?.ok);
    return list.slice().sort((a, b) => {
      const gapA = Math.max(0, a.cost_points - balance);
      const gapB = Math.max(0, b.cost_points - balance);
      return gapA - gapB || a.cost_points - b.cost_points;
    });
  }, [activeItems, eligibilityById, balance]);

  const reload = useCallback(
    async (forceRefresh = false) => {
      setLoadError(null);
      try {
        await wrapLoad(async () => {
          await fetchProfileWishBoard();
          const [nextBalance, nextItems, nextRedeems, nextProjects, nextTasks, nextNetWorth] =
            await Promise.all([
              getPointsBalance(),
              listWishBoardItems(),
              listWishRedeemRecords(),
              getProjects(),
              getTasks(),
              loadWishBoardCurrentNetWorth(),
            ]);
          setBalance(nextBalance);
          setItems(nextItems);
          setRedeemRecords(nextRedeems);
          setProjects(nextProjects);
          setTasks(nextTasks);
          setCurrentNetWorth(nextNetWorth);
          setMonthEarned(await getPointsEarnedThisMonth());
        }, forceRefresh);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    return subscribePointsBalanceChanged(setBalance);
  }, []);

  const blockedMeta = useCallback(
    (item: WishBoardItemRow): WishBoardBlockedMeta => {
      const eligibility = eligibilityById.get(item.id);
      const conditions = parseWishBoardRedeemConditions(item.extra_data);
      const condSummary = hasWishBoardRedeemConditions(conditions)
        ? formatWishBoardRedeemConditionsSummary(conditions, entityLookups)
        : null;
      const netWorthPendingOnly =
        Boolean(eligibility && !eligibility.conditionsOk) &&
        eligibility!.pending.length > 0 &&
        eligibility!.pending.every(p => p.kind === 'net_worth');
      const blockedLabel = !eligibility?.pointsOk
        ? '积分不足'
        : netWorthPendingOnly
          ? '净资产不足'
          : eligibility && !eligibility.conditionsOk
            ? '条件未满'
            : '不可兑换';
      const condPendingHint =
        eligibility && !eligibility.conditionsOk
          ? netWorthPendingOnly
            ? '净资产未达标'
            : `未完成 ${eligibility.pending.length} 项`
          : null;
      const hintLine =
        eligibility?.message ??
        (condPendingHint ? `${blockedLabel} · ${condPendingHint}` : blockedLabel);
      return { eligibility, condSummary, blockedLabel, hintLine };
    },
    [eligibilityById, entityLookups],
  );

  return {
    balance,
    monthEarned,
    setBalance,
    items,
    redeemRecords,
    projects,
    tasks,
    currentNetWorth,
    loading,
    loadError,
    eligibilityById,
    readyItems,
    waitingItems,
    activeItems,
    entityLookups,
    reload,
    refreshControl,
    blockedMeta,
    notifyAncestorsDataChanged,
  };
}
