import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export type UsePullToRefreshResult = {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  refreshControl: React.ReactElement<RefreshControlProps>;
};

/** 下拉刷新：管理 refreshing 状态并生成 RefreshControl */
export function usePullToRefresh(onRefreshData: () => Promise<void>): UsePullToRefreshResult {
  const { colors } = useAppTheme();
  const [refreshing, setRefreshing] = useState(false);
  const inFlightRef = useRef(false);
  const onRefreshDataRef = useRef(onRefreshData);
  onRefreshDataRef.current = onRefreshData;

  const onRefresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRefreshing(true);
    try {
      await onRefreshDataRef.current();
    } catch (e) {
      if (__DEV__) console.warn('[pull-to-refresh]', e);
    } finally {
      inFlightRef.current = false;
      setRefreshing(false);
    }
  }, []);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        colors={[colors.primary]}
        tintColor={colors.primary}
      />
    ),
    [refreshing, onRefresh, colors.primary],
  );

  return { refreshing, onRefresh, refreshControl };
}
