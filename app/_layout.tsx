import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { initDatabase } from '@/lib/database';
import { loadPersistedIntakeTargets } from '@/lib/global-intake-targets';
import { ensurePersonaPortraitsForTodayInBackground } from '@/lib/persona-portrait-sync';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [isDbReady, setIsDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await initDatabase();
        await loadPersistedIntakeTargets();
        if (Platform.OS !== 'web') {
          void ensurePersonaPortraitsForTodayInBackground();
        }
        if (mounted) {
          setDbError(null);
          setIsDbReady(true);
        }
      } catch (e) {
        console.warn('数据库初始化失败', e);
        if (mounted) {
          setDbError('数据库初始化失败，请重试。');
          setIsDbReady(false);
        }
      }
    };
    void run();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {!isDbReady ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" />
            {dbError ? (
              <View style={{ marginTop: 14, alignItems: 'center', paddingHorizontal: 24 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', opacity: 0.8 }}>{dbError}</Text>
                <Pressable
                  onPress={async () => {
                    setDbError(null);
                    try {
                      await initDatabase();
                      await loadPersistedIntakeTargets();
                      if (Platform.OS !== 'web') {
                        void ensurePersonaPortraitsForTodayInBackground();
                      }
                      setIsDbReady(true);
                    } catch (e) {
                      console.warn('数据库初始化失败', e);
                      setDbError('数据库初始化失败，请重试。');
                    }
                  }}
                  style={({ pressed }) => ({
                    marginTop: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ fontSize: 14, fontWeight: '800' }}>重试</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="add-frog" />
            <Stack.Screen name="add-task" />
            <Stack.Screen name="add-standalone-todo" />
            <Stack.Screen name="edit-task" />
            <Stack.Screen name="add-project" />
            <Stack.Screen name="add-subtask" />
            <Stack.Screen name="add-account" />
            <Stack.Screen name="add-account-type" />
            <Stack.Screen name="account-detail" />
            <Stack.Screen name="assets" />
            <Stack.Screen name="vision-wall" />
            <Stack.Screen name="vision-create" />
            <Stack.Screen name="vision-detail/[id]" />
            <Stack.Screen name="task/[id]" />
            <Stack.Screen name="health-calendar" />
            <Stack.Screen name="intake-history" />
            <Stack.Screen name="finance-calendar" />
            <Stack.Screen name="edit-finance-transaction/[id]" />
            <Stack.Screen name="savings-plan" />
            <Stack.Screen name="cash-flow" />
            <Stack.Screen name="ai-finance-analysis" />
            <Stack.Screen name="schedule-picker" />
            <Stack.Screen name="edit-profile" />
            <Stack.Screen name="quick-add-edit" />
            <Stack.Screen name="habit-detail" />
            <Stack.Screen name="add-item" />
            <Stack.Screen name="wish-list" />
            <Stack.Screen name="add-wish-item" />
            <Stack.Screen name="edit-wish-item/[id]" />
            <Stack.Screen name="persona-detail/[slug]" />
            <Stack.Screen name="weekly-review" />
            <Stack.Screen name="my-skills" />
            <Stack.Screen name="zhipu-api-test" />
            <Stack.Screen name="category-sort" />
            <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
          </Stack>
        )}
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
