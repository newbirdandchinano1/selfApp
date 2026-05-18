import { MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Dimensions } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { DRAWER_WIDTH_FALLBACK, SettingsDrawerHost } from '@/components/settings-drawer/settings-drawer';
import { SettingsDrawerProvider } from '@/components/settings-drawer/settings-drawer-context';
import { getPalette } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DRAWER_WIDTH = Math.min(340, Math.round(Dimensions.get('window').width * 0.88)) || DRAWER_WIDTH_FALLBACK;

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const theme = getPalette(colorScheme === 'dark' ? 'dark' : 'light');
  const insets = useSafeAreaInsets();

  const baseHeight = 48;
  const paddingTop = 6;
  const paddingBottom = insets.bottom > 0 ? insets.bottom + 12 : 8;
  const tabBarHeight = baseHeight + paddingBottom;

  return (
    <SettingsDrawerProvider>
      <SettingsDrawerHost drawerWidth={DRAWER_WIDTH} tabBarHeight={tabBarHeight}>
        <Tabs
          screenOptions={{
            tabBarActiveTintColor: theme.primary,
            tabBarInactiveTintColor: theme.textSecondary,
            headerShown: false,
            tabBarButton: HapticTab,
            tabBarStyle: {
              backgroundColor: theme.surface,
              borderTopColor: theme.tabBarBorder,
              elevation: 0,
              height: tabBarHeight,
              paddingBottom,
              paddingTop,
            },
            tabBarLabelStyle: {
              fontSize: 10,
              fontWeight: '500',
            },
          }}>
          <Tabs.Screen
            name="index"
            options={{
              title: '健康',
              tabBarIcon: ({ color }) => <MaterialIcons size={24} name="insights" color={color} />,
            }}
          />
          <Tabs.Screen
            name="tasks"
            options={{
              title: '任务',
              tabBarHideOnKeyboard: true,
              tabBarIcon: ({ color }) => <MaterialIcons size={24} name="check-circle-outline" color={color} />,
            }}
          />
          <Tabs.Screen
            name="finance"
            options={{
              title: '财务',
              tabBarIcon: ({ color }) => <MaterialIcons size={24} name="account-balance-wallet" color={color} />,
            }}
          />
          <Tabs.Screen
            name="calendar"
            options={{
              title: '日历',
              tabBarIcon: ({ color }) => <MaterialIcons size={24} name="calendar-today" color={color} />,
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: '我的',
              tabBarIcon: ({ color }) => <MaterialIcons size={24} name="person-outline" color={color} />,
            }}
          />
        </Tabs>
      </SettingsDrawerHost>
    </SettingsDrawerProvider>
  );
}
