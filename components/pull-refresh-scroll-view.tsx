import React from 'react';
import { FlatList, ScrollView, type FlatListProps, type ScrollViewProps } from 'react-native';

import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';

type PullRefreshProps = {
  onRefreshData: () => Promise<void>;
};

export type PullRefreshScrollViewProps = ScrollViewProps & PullRefreshProps;

/** 带下拉刷新的 ScrollView */
export function PullRefreshScrollView({ onRefreshData, ...props }: PullRefreshScrollViewProps) {
  const { refreshControl } = usePullToRefresh(onRefreshData);
  return <ScrollView {...props} refreshControl={refreshControl} />;
}

export type PullRefreshFlatListProps<ItemT> = FlatListProps<ItemT> & PullRefreshProps;

/** 带下拉刷新的 FlatList */
export function PullRefreshFlatList<ItemT>({ onRefreshData, ...props }: PullRefreshFlatListProps<ItemT>) {
  const { refreshControl } = usePullToRefresh(onRefreshData);
  return <FlatList {...props} refreshControl={refreshControl} />;
}
