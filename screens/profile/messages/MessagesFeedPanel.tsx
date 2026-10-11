import { ScreenEmptyState } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import {
  fetchRemoteInboxPage,
  markAllRemoteInboxRead,
  markRemoteInboxRead,
  type RemoteInboxItem,
} from '@/lib/api/remote-inbox';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  try {
    return new Date(t).toLocaleDateString();
  } catch {
    return '';
  }
}

export function MessagesFeedPanel() {
  const { colors } = useAppTheme();
  const [items, setItems] = useState<RemoteInboxItem[]>([]);

  const unreadCount = useMemo(() => items.filter((i) => !i.readAt).length, [items]);

  const reload = useCallback(async () => {
    try {
      const page = await fetchRemoteInboxPage();
      setItems(Array.isArray(page?.items) ? page.items : []);
    } catch (e) {
      // 失败静默空态，不崩
      if (__DEV__) console.warn('[messages/feed] fetch failed', e);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const { refreshControl } = usePullToRefresh(reload);

  const onMarkAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.readAt ? i : { ...i, readAt: now })));
    try {
      await markAllRemoteInboxRead();
    } catch (e) {
      if (__DEV__) console.warn('[messages/feed] mark-all failed', e);
    }
  }, [unreadCount]);

  const onPressItem = useCallback((item: RemoteInboxItem) => {
    if (!item.readAt) {
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((i) => (i.id === item.id && !i.readAt ? { ...i, readAt: now } : i)),
      );
    }
    void markRemoteInboxRead(item.id).catch((e) => {
      if (__DEV__) console.warn('[messages/feed] mark-read failed', e);
    });
  }, []);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const aUnread = a.readAt ? 0 : 1;
      const bUnread = b.readAt ? 0 : 1;
      if (aUnread !== bUnread) return bUnread - aUnread;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }, [items]);

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={[styles.toolbarHint, { color: colors.textSecondary }]} numberOfLines={1}>
          {items.length === 0 ? '采集资讯' : `未读 ${unreadCount}`}
        </Text>
        <Pressable
          onPress={() => void onMarkAllRead()}
          disabled={unreadCount === 0}
          accessibilityRole="button"
          accessibilityLabel="全部已读"
          accessibilityState={{ disabled: unreadCount === 0 }}
          style={({ pressed }) => [
            styles.markAllBtn,
            {
              opacity: unreadCount === 0 ? 0.4 : pressed ? 0.75 : 1,
              borderColor: colors.outline,
              backgroundColor: colors.surface,
            },
          ]}>
          <Text style={[styles.markAllText, { color: colors.primary }]}>全部已读</Text>
        </Pressable>
      </View>

      {sorted.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyList}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <ScreenEmptyState
            icon="article"
            title="暂无资讯"
            subtitle="下拉刷新；内容将由采集推送填充"
            style={styles.empty}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          refreshControl={refreshControl}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const unread = !item.readAt;
            return (
              <Pressable
                onPress={() => onPressItem(item)}
                accessibilityRole="button"
                accessibilityLabel={`${unread ? '未读，' : ''}${item.title}`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.outline,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}>
                <View style={styles.titleRow}>
                  {unread ? (
                    <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
                  ) : (
                    <View style={styles.unreadDotSpacer} />
                  )}
                  <Text
                    style={[
                      styles.title,
                      { color: colors.text, fontWeight: unread ? '700' : '600' },
                    ]}
                    numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
                {item.body ? (
                  <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={2}>
                    {item.body}
                  </Text>
                ) : null}
                <Text style={[styles.time, { color: colors.textMuted }]}>
                  {formatRelativeTime(item.createdAt)}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.pagePaddingX,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  toolbarHint: {
    ...Typography.caption,
    flex: 1,
  },
  markAllBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  markAllText: {
    ...Typography.label,
    fontWeight: '700',
  },
  emptyList: { flexGrow: 1 },
  empty: {
    flex: 1,
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing['6xl'],
  },
  listContent: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingBottom: Spacing['6xl'],
    gap: Spacing.md,
  },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: Spacing['3xl'],
    gap: Spacing.xs,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  unreadDotSpacer: { width: 8, height: 8 },
  title: { ...Typography.bodyStrong, flex: 1 },
  body: { ...Typography.caption, marginLeft: 16, lineHeight: 18 },
  time: { ...Typography.caption, marginLeft: 16, marginTop: 2 },
});
