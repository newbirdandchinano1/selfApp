import { Tabs } from 'expo-router';
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { AppIcon } from '@/components/ui/app-icon';
import { DRAWER_WIDTH_FALLBACK, SettingsDrawerHost } from '@/components/settings-drawer/settings-drawer';
import { SettingsDrawerProvider } from '@/components/settings-drawer/settings-drawer-context';
import { getPalette } from '@/constants/design-tokens';
import {
  formatInboxBadgeCount,
  useNotificationInboxBadges,
} from '@/hooks/use-notification-inbox-badges';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DRAWER_WIDTH = Math.min(340, Math.round(Dimensions.get('window').width * 0.88)) || DRAWER_WIDTH_FALLBACK;

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = getPalette(isDark ? 'dark' : 'light');
  const insets = useSafeAreaInsets();
  const badges = useNotificationInboxBadges();

  const baseHeight = 48;
  const paddingTop = 6;
  const paddingBottom = insets.bottom > 0 ? insets.bottom + 12 : 8;
  const tabBarHeight = baseHeight + paddingBottom;

  // dark：稍亮红底 + 白字，保证对比度
  const tabBarBadgeStyle = {
    backgroundColor: isDark ? '#ef4444' : theme.danger,
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700' as const,
    minWidth: 18,
    height: 18,
    lineHeight: 18,
    borderRadius: 9,
  };

  return (
    <SettingsDrawerProvider>
      <SettingsDrawerHost drawerWidth={DRAWER_WIDTH} tabBarHeight={tabBarHeight}>
        <Tabs
          screenOptions={{
            tabBarActiveTintColor: theme.primary,
            tabBarInactiveTintColor: theme.textSecondary,
            headerShown: false,
            tabBarButton: HapticTab,
            tabBarBadgeStyle,
            tabBarStyle: {
              backgroundColor: theme.surface,
              borderTopColor: theme.tabBarBorder,
              borderTopWidth: StyleSheet.hairlineWidth,
              elevation: 0,
              height: tabBarHeight,
              paddingBottom,
              paddingTop,
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '500',
            },
          }}>
          <Tabs.Screen
            name="index"
            options={{
              title: '健康',
              tabBarBadge: formatInboxBadgeCount(badges.index),
              tabBarIcon: ({ color }) => <AppIcon name="insights" size={24} color={color} />,
            }}
          />
          <Tabs.Screen
            name="tasks"
            options={{
              title: '任务',
              tabBarHideOnKeyboard: true,
              tabBarBadge: formatInboxBadgeCount(badges.tasks),
              tabBarIcon: ({ color }) => <AppIcon name="check-circle-outline" size={24} color={color} />,
            }}
          />
          <Tabs.Screen
            name="finance"
            options={{
              title: '财务',
              tabBarBadge: formatInboxBadgeCount(badges.finance),
              tabBarIcon: ({ color }) => <AppIcon name="account-balance-wallet" size={24} color={color} />,
            }}
          />
          <Tabs.Screen
            name="review"
            options={{
              title: '复盘',
              tabBarHideOnKeyboard: true,
              tabBarBadge: formatInboxBadgeCount(badges.review),
              tabBarIcon: ({ color }) => <AppIcon name="edit-note" size={24} color={color} />,
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: '我的',
              // 锁定：我的 Tab 永不设角标；未读只走铃铛
              tabBarIcon: ({ color }) => <AppIcon name="person-outline" size={24} color={color} />,
            }}
          />
        </Tabs>
      </SettingsDrawerHost>
    </SettingsDrawerProvider>
  );
}
