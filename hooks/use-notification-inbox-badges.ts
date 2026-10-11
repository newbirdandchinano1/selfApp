import { formatInboxBadgeCount } from '@/lib/notification-inbox-badge';
import { subscribeNotificationInboxChanged } from '@/lib/notification-inbox-events';
import {
  countUnreadByModuleTab,
  type UnreadCountByModuleTab,
} from '@/lib/repositories/notifications/notification-inbox';
import { useCallback, useEffect, useState } from 'react';

export { formatInboxBadgeCount };

const EMPTY_COUNTS: UnreadCountByModuleTab = {
  index: 0,
  tasks: 0,
  finance: 0,
  review: 0,
  profile: 0,
  total: 0,
};

/**
 * 本地收件箱未读聚合：挂载拉取 + 订阅写库变更刷新。
 * - 业务 Tab 数字：仅 local（见 countUnreadByModuleTab）
 * - total：local + remote，供铃铛
 */
export function useNotificationInboxBadges(): UnreadCountByModuleTab {
  const [counts, setCounts] = useState<UnreadCountByModuleTab>(EMPTY_COUNTS);

  const refresh = useCallback(() => {
    void countUnreadByModuleTab()
      .then(setCounts)
      .catch((e) => {
        if (__DEV__) console.warn('[inbox-badges] count failed', e);
      });
  }, []);

  useEffect(() => {
    refresh();
    return subscribeNotificationInboxChanged(refresh);
  }, [refresh]);

  return counts;
}
