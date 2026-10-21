import { Tabs } from 'expo-router';
import React from 'react';
import { Dimensions } from 'react-native';

import {
  GlassTabBar,
  glassTabBarFloatHeight,
  type GlassTabMeta,
  type RecipeGlassTabBarProps,
} from '@/components/recipe/recipe-glass-tab-bar';
import { AppIcon } from '@/components/ui/app-icon';
import { DRAWER_WIDTH_FALLBACK, SettingsDrawerHost } from '@/components/settings-drawer/settings-drawer';
import { SettingsDrawerProvider } from '@/components/settings-drawer/settings-drawer-context';
import {
  formatInboxBadgeCount,
  useNotificationInboxBadges,
} from '@/hooks/use-notification-inbox-badges';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DRAWER_WIDTH = Math.min(340, Math.round(Dimensions.get('window').width * 0.88)) || DRAWER_WIDTH_FALLBACK;

/** 与菜谱底栏保持同一图标尺寸 */
const TAB_ICON_SIZE = 22;

/** 主 Tab 图标走 AppIcon（SF Symbols / Material Symbols），配色由玻璃底栏统一处理 */
const MAIN_TAB_META: Record<string, GlassTabMeta> = {
  index: {
    label: '健康',
    renderIcon: ({ color }) => <AppIcon name="insights" size={TAB_ICON_SIZE} color={color} />,
  },
  tasks: {
    label: '任务',
    renderIcon: ({ color }) => (
      <AppIcon name="check-circle-outline" size={TAB_ICON_SIZE} color={color} />
    ),
  },
  finance: {
    label: '财务',
    renderIcon: ({ color }) => (
      <AppIcon name="account-balance-wallet" size={TAB_ICON_SIZE} color={color} />
    ),
  },
  review: {
    label: '复盘',
    renderIcon: ({ color }) => <AppIcon name="edit-note" size={TAB_ICON_SIZE} color={color} />,
  },
  profile: {
    label: '我的',
    renderIcon: ({ color }) => <AppIcon name="person-outline" size={TAB_ICON_SIZE} color={color} />,
  },
};

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const badges = useNotificationInboxBadges();

  // 悬浮底栏总高度：供抽屉左缘手势区避让；底栏本身不占内容布局
  const tabBarHeight = glassTabBarFloatHeight(insets.bottom);

  return (
    <SettingsDrawerProvider>
      <SettingsDrawerHost drawerWidth={DRAWER_WIDTH} tabBarHeight={tabBarHeight}>
        <Tabs
          tabBar={props => (
            <GlassTabBar
              {...(props as unknown as RecipeGlassTabBarProps)}
              meta={MAIN_TAB_META}
              isDark={isDark}
              autoHide
            />
          )}
          screenOptions={{
            headerShown: false,
          }}>
          <Tabs.Screen
            name="index"
            options={{
              title: '健康',
              tabBarBadge: formatInboxBadgeCount(badges.index),
            }}
          />
          <Tabs.Screen
            name="tasks"
            options={{
              title: '任务',
              tabBarBadge: formatInboxBadgeCount(badges.tasks),
            }}
          />
          <Tabs.Screen
            name="finance"
            options={{
              title: '财务',
              tabBarBadge: formatInboxBadgeCount(badges.finance),
            }}
          />
          <Tabs.Screen
            name="review"
            options={{
              title: '复盘',
              tabBarBadge: formatInboxBadgeCount(badges.review),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: '我的',
              // 锁定：我的 Tab 永不设角标；未读只走铃铛
            }}
          />
        </Tabs>
      </SettingsDrawerHost>
    </SettingsDrawerProvider>
  );
}
