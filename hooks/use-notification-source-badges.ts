/**
 * 业务页来源红点：挂载拉取 + 订阅收件箱变更。
 */
import { subscribeNotificationInboxChanged } from '@/lib/notification-inbox-events';
import {
  emptyUnreadSourceSnapshot,
  type InboxEntityKind,
  type InboxSourceAnchor,
  type UnreadSourceSnapshot,
} from '@/lib/notification-inbox-source';
import { getUnreadSourceSnapshot } from '@/lib/repositories/notifications/notification-inbox';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type NotificationSourceBadges = UnreadSourceSnapshot & {
  hasAnchor: (anchor: InboxSourceAnchor) => boolean;
  hasEntity: (kind: InboxEntityKind, id: string) => boolean;
  /** 任务页分区：习惯 / 待办 / 项目 / 日程任一未读 */
  hasTasksSectionUnread: boolean;
  /** 财务页分区：预算 / 储蓄 / 定时 / 截图记账 / 收口 */
  hasFinanceHomeUnread: boolean;
};

function buildEntitySet(ids: readonly string[]): Set<string> {
  return new Set(ids.filter(Boolean));
}

export function useNotificationSourceBadges(): NotificationSourceBadges {
  const [snap, setSnap] = useState<UnreadSourceSnapshot>(emptyUnreadSourceSnapshot);

  const refresh = useCallback(() => {
    void getUnreadSourceSnapshot()
      .then(setSnap)
      .catch(e => {
        if (__DEV__) console.warn('[source-badges] load failed', e);
      });
  }, []);

  useEffect(() => {
    refresh();
    return subscribeNotificationInboxChanged(refresh);
  }, [refresh]);

  const habitSet = useMemo(() => buildEntitySet(snap.entities.habit), [snap.entities.habit]);
  const taskSet = useMemo(() => buildEntitySet(snap.entities.task), [snap.entities.task]);
  const projectSet = useMemo(() => buildEntitySet(snap.entities.project), [snap.entities.project]);
  const expenseSet = useMemo(
    () => buildEntitySet(snap.entities.scheduledExpense),
    [snap.entities.scheduledExpense],
  );

  const hasAnchor = useCallback(
    (anchor: InboxSourceAnchor) => (snap.byAnchor[anchor] ?? 0) > 0,
    [snap.byAnchor],
  );

  const hasEntity = useCallback(
    (kind: InboxEntityKind, id: string) => {
      const key = String(id ?? '').trim();
      if (!key) return false;
      if (kind === 'habit') return habitSet.has(key);
      if (kind === 'task') return taskSet.has(key);
      if (kind === 'project') return projectSet.has(key);
      return expenseSet.has(key);
    },
    [expenseSet, habitSet, projectSet, taskSet],
  );

  const hasTasksSectionUnread = useMemo(() => {
    const a = snap.byAnchor;
    return a.habit + a.task + a.project + a.schedule > 0;
  }, [snap.byAnchor]);

  const hasFinanceHomeUnread = useMemo(() => {
    const a = snap.byAnchor;
    return a.budget + a.savings + a['scheduled-expense'] + a['auto-ledger'] + a['ledger-wrap'] > 0;
  }, [snap.byAnchor]);

  return {
    ...snap,
    hasAnchor,
    hasEntity,
    hasTasksSectionUnread,
    hasFinanceHomeUnread,
  };
}
