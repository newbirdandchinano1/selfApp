import { AppScreen, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { NotificationCenterScreen } from '@/screens/profile/NotificationCenterScreen';
import { MessagesFeedPanel } from '@/screens/profile/messages/MessagesFeedPanel';
import { MessagesInboxPanel } from '@/screens/profile/messages/MessagesInboxPanel';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

/**
 * 消息模块壳页：通知 / 资讯·采集 / 提醒设置。
 * Query：`?tab=inbox|feed|settings`、`focus=<dedupeKey>`（系统通知深链）。
 */
export default function MessagesScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
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

  const setTab = useCallback(
    (next: MessagesTabId) => {
      router.setParams({ tab: next });
    },
    [router],
  );

  const segment = useMemo(
    () => (
      <View
        style={[
          styles.segmentTrack,
          { backgroundColor: colors.surface, borderColor: colors.outline },
        ]}
        accessibilityRole="tablist">
        {TABS.map((item) => {
          const selected = item.key === tab;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={item.label}
              style={({ pressed }) => [
                styles.segmentBtn,
                selected && {
                  backgroundColor: colors.primaryMuted,
                  borderColor: colors.primary,
                },
                { opacity: pressed ? 0.88 : 1 },
              ]}>
              <Text
                style={[
                  styles.segmentText,
                  { color: selected ? colors.primary : colors.textSecondary },
                  selected && styles.segmentTextActive,
                ]}
                numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    ),
    [colors, setTab, tab],
  );

  return (
    <AppScreen
      scrollable={false}
      header={<ScreenHeader title="消息" onBack={() => router.back()} />}
      contentContainerStyle={styles.screenContent}>
      {segment}
      <View style={styles.panel}>
        {tab === 'inbox' ? (
          <MessagesInboxPanel
            focusDedupeKey={focusDedupeKey}
            focusAfter={focusAfter}
            focusNonce={focusNonce}
          />
        ) : null}
        {tab === 'feed' ? <MessagesFeedPanel /> : null}
        {tab === 'settings' ? <NotificationCenterScreen embedded /> : null}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: Spacing.md,
    gap: Spacing.md,
    maxWidth: undefined,
  },
  segmentTrack: {
    marginHorizontal: Layout.pagePaddingX,
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.xs,
    gap: Spacing.xs,
  },
  segmentBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    minHeight: Layout.minTouchTarget,
  },
  segmentText: {
    ...Typography.label,
    fontWeight: '600',
    textAlign: 'center',
  },
  segmentTextActive: {
    fontWeight: '800',
  },
  panel: {
    flex: 1,
    minHeight: 0,
  },
});
