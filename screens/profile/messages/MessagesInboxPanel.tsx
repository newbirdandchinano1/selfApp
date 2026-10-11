import { ScreenEmptyState } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { subscribeNotificationInboxChanged } from '@/lib/notification-inbox-events';
import { navigateByNotificationType } from '@/lib/notification-navigate';
import {
  serializeStrongReminderPayload,
  stripReminderAccessorySuffix,
} from '@/lib/notification-strong-reminder';
import {
  getInboxByDedupeKey,
  listInbox,
  markAllRead,
  markReadByDedupeKey,
  markReadById,
  type NotificationInboxRow,
} from '@/lib/repositories/notifications/notification-inbox';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';

export type MessagesInboxItem = {
  id: string;
  dedupeKey: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  dataJson: string;
};

type Props = {
  /** 系统通知深链：标已读、滚动定位，再进业务或处置页 */
  focusDedupeKey?: string;
  /** `dispose` = focus 后进强提醒处置页；默认 `navigate` 进业务 */
  focusAfter?: 'dispose' | 'navigate';
  /** 同 dedupe 再次深链时变化，用于强制消费 */
  focusNonce?: string;
};

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

function toListItem(row: NotificationInboxRow): MessagesInboxItem {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    readAt: row.readAt,
    dataJson: row.dataJson,
  };
}

function parseItemData(item: MessagesInboxItem): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(item.dataJson || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isStrongData(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  return data.strong === true || data.strong === 1 || data.strong === 'true';
}

export function MessagesInboxPanel({ focusDedupeKey, focusAfter, focusNonce }: Props) {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const [items, setItems] = useState<MessagesInboxItem[]>([]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const listRef = useRef<FlatList<MessagesInboxItem>>(null);
  const consumedFocusTokenRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const rows = await listInbox({ source: 'local' });
      setItems(rows.map(toListItem));
    } catch (e) {
      console.warn('[MessagesInboxPanel] listInbox failed', e);
    }
  }, []);

  useEffect(() => {
    void reload();
    return subscribeNotificationInboxChanged(() => {
      void reload();
    });
  }, [reload]);

  const unreadCount = useMemo(() => items.filter(i => !i.readAt).length, [items]);

  /** repository 已按未读优先排序；此处保持稳定引用即可 */
  const sorted = items;

  const openDisposeFromItem = useCallback(
    (item: MessagesInboxItem, data: Record<string, unknown>) => {
      const title =
        (typeof data.disposeTitle === 'string' && data.disposeTitle) ||
        item.title ||
        '提醒';
      const body =
        (typeof data.disposeBody === 'string' && data.disposeBody) || item.body || '';
      router.push({
        pathname: '/reminder-dispose',
        params: {
          payload: serializeStrongReminderPayload({
            baseIdentifier: item.dedupeKey,
            title,
            body,
            data,
          }),
        },
      });
    },
    [router],
  );

  const navigateFromItem = useCallback(
    (item: MessagesInboxItem) => {
      const data = parseItemData(item);
      navigateByNotificationType(router, data);
    },
    [router],
  );

  const onPressItem = useCallback(
    (item: MessagesInboxItem) => {
      void markReadById(item.id).then(() => {
        void reload();
        navigateFromItem(item);
      });
    },
    [navigateFromItem, reload],
  );

  /** 系统通知深链：标已读 → 定位高亮 → 短延迟后进业务/处置页 */
  useEffect(() => {
    const rawFocus = focusDedupeKey?.trim();
    if (!rawFocus) return;
    const key = stripReminderAccessorySuffix(rawFocus);
    if (!key) return;
    const token = `${key}::${focusNonce ?? ''}`;
    if (consumedFocusTokenRef.current === token) return;
    consumedFocusTokenRef.current = token;

    let highlightTimer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      await markReadByDedupeKey(key);
      await reload();

      setFocusedKey(key);
      highlightTimer = setTimeout(() => setFocusedKey(null), 2400);

      const row = await getInboxByDedupeKey(key);
      if (!row) return;
      const item = toListItem(row);

      setTimeout(() => {
        const data = parseItemData(item);
        if (focusAfter === 'dispose' || (focusAfter !== 'navigate' && isStrongData(data))) {
          openDisposeFromItem(item, data ?? {});
        } else {
          navigateByNotificationType(router, data);
        }
      }, 320);
    };

    void run();

    return () => {
      // 仅清高亮定时器；导航超时不因依赖重跑而取消（避免丢跳转）
      if (highlightTimer) clearTimeout(highlightTimer);
    };
  }, [focusDedupeKey, focusAfter, focusNonce, openDisposeFromItem, reload, router]);

  // focus 项出现后补一次滚动（写入可能略晚于首帧）
  useEffect(() => {
    if (!focusedKey) return;
    const idx = sorted.findIndex(i => i.dedupeKey === focusedKey);
    if (idx < 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
    });
  }, [focusedKey, sorted]);

  const onMarkAllRead = useCallback(() => {
    if (unreadCount === 0) return;
    void markAllRead({ source: 'local' }).then(() => reload());
  }, [reload, unreadCount]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 40 }).current;
  const onViewableItemsChanged = useRef((_info: { viewableItems: ViewToken[] }) => {
    // 锁定：仅曝光列表不清未读
  }).current;

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={[styles.toolbarHint, { color: colors.textSecondary }]} numberOfLines={1}>
          {items.length === 0 ? '本地提醒收件箱' : `未读 ${unreadCount}`}
        </Text>
        <Pressable
          onPress={onMarkAllRead}
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
        <ScreenEmptyState
          icon="notifications-none"
          title="暂无通知"
          subtitle="本地提醒弹出后会出现在这里"
          style={styles.empty}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={sorted}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          onScrollToIndexFailed={() => {
            /* focus 项尚未挂载时忽略 */
          }}
          renderItem={({ item }) => {
            const unread = !item.readAt;
            const focused = focusedKey != null && item.dedupeKey === focusedKey;
            return (
              <Pressable
                onPress={() => onPressItem(item)}
                accessibilityRole="button"
                accessibilityLabel={`${unread ? '未读，' : ''}${item.title}`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: focused
                      ? isDark
                        ? 'rgba(96,165,250,0.18)'
                        : 'rgba(0,88,190,0.08)'
                      : colors.surface,
                    borderColor: focused ? colors.primary : colors.outline,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}>
                <View style={styles.rowMain}>
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
                </View>
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
  empty: {
    flex: 1,
    paddingHorizontal: Layout.pagePaddingX,
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
  },
  rowMain: { gap: Spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  unreadDotSpacer: { width: 8, height: 8 },
  title: { ...Typography.bodyStrong, flex: 1 },
  body: { ...Typography.caption, marginLeft: 16, lineHeight: 18 },
  time: { ...Typography.caption, marginLeft: 16, marginTop: 2 },
});
