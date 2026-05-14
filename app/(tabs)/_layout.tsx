import { MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const baseHeight = 48;
  const paddingTop = 6;
  const paddingBottom = insets.bottom > 0 ? insets.bottom + 12 : 8;
  const tabBarHeight = baseHeight + paddingBottom;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: colorScheme === 'dark' ? '#1e293b' : '#f1f5f9',
          elevation: 0,
          height: tabBarHeight,
          paddingBottom,
          paddingTop,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
        }
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
          /** 键盘弹出时隐藏底栏，避免 ScrollView 键盘 inset 与 Tab 占位叠加产生大块空白 */
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
  );
}
