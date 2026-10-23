/**
 * 「我的 · 消息」壳页：通知 / 资讯 / 提醒设置。
 * 对齐设计稿 07–09 与动效规范（分段指示片 300ms、列表上移淡入、全部已读）。
 * Query：`?tab=inbox|feed|settings`、`focus=<dedupeKey>`（系统通知深链）。
 */
import {
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { NotificationCenterScreen } from '@/screens/profile/NotificationCenterScreen';
import {
  MessagesFeedPanel,
  type MessagesFeedPanelHandle,
} from '@/screens/profile/messages/MessagesFeedPanel';
import {
  MessagesInboxPanel,
  type MessagesInboxPanelHandle,
} from '@/screens/profile/messages/MessagesInboxPanel';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export type MessagesTabId = 'inbox' | 'feed' | 'settings';

const TABS: { key: MessagesTabId; label: string }[] = [
  { key: 'inbox', label: '通知' },
  { key: 'feed', label: '资讯' },
  { key: 'settings', label: '提醒设置' },
];

function firstParam(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function parseTab(raw: string | string[] | undefined): MessagesTabId {
  const value = firstParam(raw);
  if (value === 'feed' || value === 'settings' || value === 'inbox') return value;
  return 'inbox';
}

function tabIndex(tab: MessagesTabId): number {
  return TABS.findIndex((t) => t.key === tab);
}

export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const params = useLocalSearchParams<{
    tab?: string | string[];
    focus?: string | string[];
    after?: string | string[];
    focusNonce?: string | string[];
  }>();
  const tab = parseTab(params.tab);
  const focusDedupeKey = firstParam(params.focus);
  const focusNonce = firstParam(params.focusNonce);
  const focusAfterRaw = firstParam(params.after);
  const focusAfter =
    focusAfterRaw === 'dispose' || focusAfterRaw === 'navigate' ? focusAfterRaw : undefined;

  const inboxRef = useRef<MessagesInboxPanelHandle>(null);
  const feedRef = useRef<MessagesFeedPanelHandle>(null);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [feedUnread, setFeedUnread] = useState(0);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [masterEnabled, setMasterEnabled] = useState(true);

  const [segWidth, setSegWidth] = useState(0);
  const segAnim = useRef(new Animated.Value(tabIndex(tab))).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentY = useRef(new Animated.Value(0)).current;
  const prevTabRef = useRef(tab);

  useEffect(() => {
    const next = tabIndex(tab);
    Animated.timing(segAnim, {
      toValue: next,
      duration: motionOn ? 300 : 1,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start();

    if (prevTabRef.current !== tab) {
      prevTabRef.current = tab;
      if (!motionOn) {
        contentOpacity.setValue(1);
        contentY.setValue(0);
        return;
      }
      contentOpacity.setValue(0);
      contentY.setValue(18);
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 300,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(contentY, {
          toValue: 0,
          duration: 300,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [contentOpacity, contentY, motionOn, segAnim, tab]);

  const setTab = useCallback(
    (next: MessagesTabId) => {
      if (next === tab) return;
      router.setParams({ tab: next });
    },
    [router, tab],
  );

  const onMarkAllRead = useCallback(() => {
    if (tab === 'inbox') inboxRef.current?.markAllRead();
    else if (tab === 'feed') feedRef.current?.markAllRead();
  }, [tab]);

  const headerMeta = useMemo(() => {
    if (tab === 'feed') {
      return {
        title: '消息',
        sub: '资讯 · 每日精选',
        action: 'readall' as const,
        actionDisabled: feedUnread === 0,
      };
    }
    if (tab === 'settings') {
      return {
        title: '提醒设置',
        sub: '本地调度 · 不上传服务器',
        action: 'status' as const,
        actionDisabled: false,
      };
    }
    return {
      title: '消息',
      sub: inboxTotal > 0 ? `收件箱 · 本机通知 ${inboxTotal} 条` : '收件箱 · 本机通知',
      action: 'readall' as const,
      actionDisabled: inboxUnread === 0,
    };
  }, [feedUnread, inboxTotal, inboxUnread, tab]);

  const indW = segWidth > 0 ? (segWidth - 6) / 3 : 0;
  const indX = segAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0, indW, indW * 2],
  });

  const unreadFor = (key: MessagesTabId) => {
    if (key === 'inbox') return inboxUnread;
    if (key === 'feed') return feedUnread;
    return 0;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <View style={[styles.appBar, { paddingTop: insets.top + 4 }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88, transform: [{ scale: 0.96 }] },
          ]}>
          <AppIcon name="arrow-back" size={18} color={fold.ink2} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: fold.ink }]}>{headerMeta.title}</Text>
          <Text style={[styles.sub, { color: fold.muted }]} numberOfLines={1}>
            {headerMeta.sub}
          </Text>
        </View>
        {headerMeta.action === 'readall' ? (
          <Pressable
            onPress={onMarkAllRead}
            disabled={headerMeta.actionDisabled}
            accessibilityRole="button"
            accessibilityLabel="全部已读"
            style={({ pressed }) => [
              styles.pillBtn,
              {
                borderColor: fold.line2,
                backgroundColor: 'rgba(255,252,245,0.66)',
                opacity: headerMeta.actionDisabled ? 0.4 : pressed ? 0.85 : 1,
              },
            ]}>
            <AppIcon name="check-circle-outline" size={12} color={fold.ink2} />
            <Text style={[styles.pillLabel, { color: fold.ink2 }]}>全部已读</Text>
          </Pressable>
        ) : (
          <View
            style={[
              styles.statusTag,
              {
                backgroundColor: masterEnabled ? fold.sage2 : fold.paper2,
              },
            ]}>
            <Text
              style={[
                styles.statusTagText,
                { color: masterEnabled ? '#36594D' : fold.muted },
              ]}>
              {masterEnabled ? '已开启' : '已关闭'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <FoldRiseIn animate={motionOn} index={0} staggerMs={40} fromY={8}>
          <View
            style={[styles.mseg, { backgroundColor: '#E9E4D9' }]}
            onLayout={(e) => setSegWidth(e.nativeEvent.layout.width)}
            accessibilityRole="tablist">
            {indW > 0 ? (
              <Animated.View
                style={[
                  styles.msegInd,
                  {
                    width: indW,
                    backgroundColor: fold.card,
                    transform: [{ translateX: indX }],
                  },
                ]}
              />
            ) : null}
            {TABS.map((item) => {
              const selected = item.key === tab;
              const unread = unreadFor(item.key);
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setTab(item.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item.label}
                  style={styles.msegBtn}>
                  <Text
                    style={[
                      styles.msegLabel,
                      { color: selected ? fold.pine : '#8B948D' },
                      selected && styles.msegLabelOn,
                    ]}
                    numberOfLines={1}>
                    {item.label}
                  </Text>
                  {unread > 0 ? (
                    <View style={[styles.ndot, { backgroundColor: fold.clay }]} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </FoldRiseIn>

        <Animated.View
          style={[
            styles.panel,
            { opacity: contentOpacity, transform: [{ translateY: contentY }] },
          ]}>
          {tab === 'inbox' ? (
            <MessagesInboxPanel
              ref={inboxRef}
              focusDedupeKey={focusDedupeKey}
              focusAfter={focusAfter}
              focusNonce={focusNonce}
              onStatsChange={({ total, unread }) => {
                setInboxTotal(total);
                setInboxUnread(unread);
              }}
            />
          ) : null}
          {tab === 'feed' ? (
            <MessagesFeedPanel
              ref={feedRef}
              onStatsChange={({ unread }) => setFeedUnread(unread)}
            />
          ) : null}
          {tab === 'settings' ? (
            <NotificationCenterScreen
              embedded
              onMasterEnabledChange={setMasterEnabled}
            />
          ) : null}
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  appBar: {
    height: undefined,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 10,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
  sub: { fontSize: 10, marginTop: 2 },
  pillBtn: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pillLabel: { fontSize: 10, fontWeight: '650' as never },
  statusTag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTagText: { fontSize: 10, fontWeight: '700' },
  body: { flex: 1, paddingHorizontal: 15, paddingTop: 2 },
  mseg: {
    height: 34,
    borderRadius: 11,
    padding: 3,
    flexDirection: 'row',
    position: 'relative',
    marginBottom: 9,
  },
  msegInd: {
    position: 'absolute',
    left: 3,
    top: 3,
    height: 28,
    borderRadius: 8,
    shadowColor: '#23443A',
    shadowOpacity: 0.09,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  msegBtn: {
    flex: 1,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  msegLabel: { fontSize: 11, fontWeight: '700' },
  msegLabelOn: { fontWeight: '800' },
  ndot: { width: 5, height: 5, borderRadius: 3 },
  panel: { flex: 1, minHeight: 0 },
});
