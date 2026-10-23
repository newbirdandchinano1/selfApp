/**
 * 消息 · 通知列表：本地收件箱，筛选芯片、未读点、全部已读动效。
 * 对齐设计稿 07。
 */
import {
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon, ScreenEmptyState, type AppIconName } from '@/components/ui';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
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
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type MessagesInboxItem = {
  id: string;
  dedupeKey: string;
  category: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  dataJson: string;
};

export type MessagesInboxPanelHandle = {
  markAllRead: () => void;
};

type Props = {
  focusDedupeKey?: string;
  focusAfter?: 'dispose' | 'navigate';
  focusNonce?: string;
  onStatsChange?: (stats: { total: number; unread: number }) => void;
};

type FilterId = 'all' | 'unread' | 'system' | 'social' | 'health';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'system', label: '系统' },
  { id: 'social', label: '互动' },
  { id: 'health', label: '健康' },
];

function formatListTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYest = startToday - 86_400_000;
  if (t >= startToday) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (t >= startYest) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function toListItem(row: NotificationInboxRow): MessagesInboxItem {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    category: row.category,
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

function filterBucket(category: string): Exclude<FilterId, 'all' | 'unread'> {
  const c = category.trim();
  if (c === 'health-intake-reminder') return 'health';
  if (
    c === 'habit-reminder' ||
    c === 'schedule-slot-reminder' ||
    c === 'daily-review-reminder' ||
    c.includes('points') ||
    c.includes('wish')
  ) {
    return 'social';
  }
  return 'system';
}

function iconForCategory(category: string): { name: AppIconName; bg: string; fg: string } {
  const c = category.trim();
  if (c === 'health-intake-reminder') {
    return { name: 'water-drop', bg: '#E3EFE6', fg: '#3C614F' };
  }
  if (c === 'habit-reminder') {
    return { name: 'stars', bg: '#F4E5CC', fg: '#8B5A1E' };
  }
  if (c === 'schedule-slot-reminder') {
    return { name: 'event', bg: '#E8EFEA', fg: '#3E6556' };
  }
  if (c === 'daily-review-reminder') {
    return { name: 'menu-book', bg: '#E6EBF0', fg: '#2F4557' };
  }
  if (c === 'auto-ledger') {
    return { name: 'receipt-long', bg: '#F0E7DF', fg: '#6B3A26' };
  }
  if (c.includes('wish') || c.includes('points')) {
    return { name: 'card-giftcard', bg: '#F5DED6', fg: '#8F422B' };
  }
  return { name: 'notifications-none', bg: '#ECE8DC', fg: '#5E6D63' };
}

function matchesFilter(item: MessagesInboxItem, filter: FilterId): boolean {
  if (filter === 'all') return true;
  if (filter === 'unread') return !item.readAt;
  return filterBucket(item.category) === filter;
}

type RowProps = {
  item: MessagesInboxItem;
  focused: boolean;
  animate: boolean;
  index: number;
  onPress: () => void;
  markReadAnim: boolean;
};

function InboxRow({ item, focused, animate, index, onPress, markReadAnim }: RowProps) {
  const { fold } = useFoldTheme();
  const unread = !item.readAt;
  const icon = iconForCategory(item.category);
  const dotScale = useRef(new Animated.Value(unread ? 1 : 0)).current;
  const bgFlash = useRef(new Animated.Value(unread ? 1 : 0)).current;

  useEffect(() => {
    if (!markReadAnim || unread) return;
    Animated.parallel([
      Animated.timing(dotScale, {
        toValue: 0,
        duration: 200,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(bgFlash, {
        toValue: 0,
        duration: 480,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: false,
      }),
    ]).start();
  }, [bgFlash, dotScale, markReadAnim, unread]);

  useEffect(() => {
    if (unread) {
      dotScale.setValue(1);
      bgFlash.setValue(1);
    }
  }, [bgFlash, dotScale, unread]);

  const unreadBg = bgFlash.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,252,245,0.86)', '#FBF6E9'],
  });

  return (
    <FoldRiseIn animate={animate} index={Math.min(index, 8)} staggerMs={45} fromY={14}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? '未读，' : ''}${item.title}`}
        style={({ pressed }) => [
          pressed && { transform: [{ scale: 0.985 }] },
        ]}>
        <Animated.View
          style={[
            styles.row,
            {
              backgroundColor: focused ? fold.amber2 : unreadBg,
              borderColor: focused ? fold.amber : unread ? '#E6D6B4' : fold.line,
            },
          ]}>
          <View style={[styles.iconBox, { backgroundColor: icon.bg }]}>
            <AppIcon name={icon.name} size={15} color={icon.fg} />
          </View>
          <View style={styles.rowMain}>
            <View style={styles.titleRow}>
              <Text style={[styles.rowTitle, { color: '#3E4B43' }]} numberOfLines={1}>
                {item.title}
              </Text>
              {unread || markReadAnim ? (
                <Animated.View
                  style={[
                    styles.unreadDot,
                    { backgroundColor: fold.clay, transform: [{ scale: dotScale }] },
                  ]}
                />
              ) : null}
            </View>
            {item.body ? (
              <Text style={styles.rowBody} numberOfLines={2}>
                {item.body}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.rowTime, { fontFamily: foldFonts.mono }]}>
            {formatListTime(item.createdAt)}
          </Text>
        </Animated.View>
      </Pressable>
    </FoldRiseIn>
  );
}

export const MessagesInboxPanel = forwardRef<MessagesInboxPanelHandle, Props>(
  function MessagesInboxPanel(
    { focusDedupeKey, focusAfter, focusNonce, onStatsChange },
    ref,
  ) {
    const router = useRouter();
    const { fold } = useFoldTheme();
    const { animate: motionOn } = useFoldMotionGate();
    const [items, setItems] = useState<MessagesInboxItem[]>([]);
    const [filter, setFilter] = useState<FilterId>('all');
    const [focusedKey, setFocusedKey] = useState<string | null>(null);
    const [markReadAnim, setMarkReadAnim] = useState(false);
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

    const unreadCount = useMemo(() => items.filter((i) => !i.readAt).length, [items]);

    useEffect(() => {
      onStatsChange?.({ total: items.length, unread: unreadCount });
    }, [items.length, onStatsChange, unreadCount]);

    const filtered = useMemo(
      () => items.filter((i) => matchesFilter(i, filter)),
      [filter, items],
    );

    const filterCounts = useMemo(() => {
      const unread = items.filter((i) => !i.readAt).length;
      return {
        all: items.length,
        unread,
        system: items.filter((i) => filterBucket(i.category) === 'system').length,
        social: items.filter((i) => filterBucket(i.category) === 'social').length,
        health: items.filter((i) => filterBucket(i.category) === 'health').length,
      };
    }, [items]);

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
        if (highlightTimer) clearTimeout(highlightTimer);
      };
    }, [focusDedupeKey, focusAfter, focusNonce, openDisposeFromItem, reload, router]);

    useEffect(() => {
      if (!focusedKey) return;
      const idx = filtered.findIndex((i) => i.dedupeKey === focusedKey);
      if (idx < 0) return;
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
      });
    }, [focusedKey, filtered]);

    const doMarkAllRead = useCallback(() => {
      if (unreadCount === 0) return;
      setMarkReadAnim(true);
      void markAllRead({ source: 'local' }).then(() => {
        void reload().then(() => {
          setTimeout(() => setMarkReadAnim(false), 520);
        });
      });
    }, [reload, unreadCount]);

    useImperativeHandle(ref, () => ({ markAllRead: doMarkAllRead }), [doMarkAllRead]);

    const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 40 }).current;
    const onViewableItemsChanged = useRef(() => {}).current;

    const chipLabel = (id: FilterId) => {
      const base = FILTERS.find((f) => f.id === id)?.label ?? '';
      if (id === 'all') return `${base} ${filterCounts.all}`;
      if (id === 'unread') return `${base} ${filterCounts.unread}`;
      return base;
    };

    return (
      <View style={styles.root}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pills}
          style={styles.pillsScroll}>
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <Pressable
                key={f.id}
                onPress={() => setFilter(f.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [
                  styles.pill,
                  {
                    backgroundColor: on ? fold.pineButton : fold.card,
                    borderColor: on ? fold.pineButton : fold.line,
                  },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}>
                <Text
                  style={[
                    styles.pillText,
                    { color: on ? fold.onPineButton : fold.muted, fontWeight: on ? '800' : '650' as never },
                  ]}>
                  {chipLabel(f.id)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {filtered.length === 0 ? (
          <ScreenEmptyState
            icon="notifications-none"
            title={filter === 'unread' ? '没有未读' : '暂无通知'}
            subtitle="本地提醒弹出后会出现在这里"
            style={styles.empty}
          />
        ) : (
          <FlatList
            ref={listRef}
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            onScrollToIndexFailed={() => {}}
            ListFooterComponent={
              <View style={styles.footerBlock}>
                <View style={styles.footerRow}>
                  <Text style={styles.footerHint}>
                    已显示 {filtered.length} 条 · 共 {items.length} 条
                  </Text>
                </View>
                <View style={[styles.noteCard, { borderColor: fold.line, backgroundColor: fold.card }]}>
                  <AppIcon name="notifications-none" size={12} color={fold.sage} />
                  <Text style={[styles.noteText, { color: fold.muted }]}>
                    点任意一条会跳到对应业务，并标记为已读。
                  </Text>
                </View>
              </View>
            }
            renderItem={({ item, index }) => (
              <InboxRow
                item={item}
                index={index}
                animate={motionOn}
                focused={focusedKey != null && item.dedupeKey === focusedKey}
                markReadAnim={markReadAnim && !item.readAt}
                onPress={() => onPressItem(item)}
              />
            )}
          />
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  pillsScroll: { flexGrow: 0, marginBottom: 4 },
  pills: { gap: 5, paddingBottom: 6, paddingRight: 8 },
  pill: {
    height: 27,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontSize: 11 },
  empty: { flex: 1, paddingTop: 40 },
  listContent: { paddingBottom: 40, gap: 5 },
  row: {
    flexDirection: 'row',
    gap: 9,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMain: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowTitle: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  unreadDot: { width: 6, height: 6, borderRadius: 3 },
  rowBody: { fontSize: 11, color: '#8F968E', marginTop: 2, lineHeight: 16 },
  rowTime: { fontSize: 10, color: '#A5A9A1', marginLeft: 4, paddingTop: 2 },
  footerBlock: { marginTop: 8, gap: 8 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  footerHint: { fontSize: 10, color: '#A0A69D' },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noteText: { flex: 1, fontSize: 10, lineHeight: 15 },
});
