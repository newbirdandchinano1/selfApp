import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DayBoundaryProvider } from '@/contexts/day-boundary-context';
import { ThemePreferenceProvider } from '@/contexts/theme-preference-context';
import { loadTasksDayBoundary } from '@/lib/tasks-logical-day';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { initDatabase } from '@/lib/database';
import { loadPersistedIntakeTargets } from '@/lib/global-intake-targets';
import { loadAiLlmProviderPreference } from '@/lib/ai-llm-provider-preference';
import { loadGithubBackupTokenCache } from '@/lib/github-backup-user-config';
import { loadThemePreference } from '@/lib/theme-preference';
import { ensurePersonaPortraitsForTodayInBackground } from '@/lib/persona-portrait-sync';
import { hydrateGithubCloudDirtyFromStorage } from '@/lib/github-sqlite-dirty-track';
import { runSilentGithubCloudSyncIfRemoteNewer } from '@/lib/github-cloud-launch';
import { AutoLedgerCoordinator } from '@/components/auto-ledger-coordinator';
import { FinanceSheetHost } from '@/components/finance/finance-sheet-host';
import { ScreenshotDeepLinkListener } from '@/components/screenshot-deeplink-listener';
import { TaskReminderNotificationListener } from '@/components/task-reminder-notification-listener';

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

function RootLayoutInner() {
  const colorScheme = useColorScheme();
  const [isDbReady, setIsDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await initDatabase();
        await hydrateGithubCloudDirtyFromStorage();
        if (Platform.OS !== 'web') {
          void runSilentGithubCloudSyncIfRemoteNewer();
        }
        await loadPersistedIntakeTargets();
        await loadThemePreference();
        await loadTasksDayBoundary();
        await loadAiLlmProviderPreference();
        await loadGithubBackupTokenCache();
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
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {!isDbReady ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colorScheme === 'dark' ? '#000000' : '#ffffff',
            }}
          >
            <ActivityIndicator size="large" />
            {dbError ? (
              <View style={{ marginTop: 14, alignItems: 'center', paddingHorizontal: 24 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', opacity: 0.8 }}>{dbError}</Text>
                <Pressable
                  onPress={async () => {
                    setDbError(null);
                    try {
                      await initDatabase();
                      await hydrateGithubCloudDirtyFromStorage();
                      if (Platform.OS !== 'web') {
                        void runSilentGithubCloudSyncIfRemoteNewer();
                      }
                      await loadPersistedIntakeTargets();
                      await loadThemePreference();
                      await loadTasksDayBoundary();
                      await loadAiLlmProviderPreference();
                      await loadGithubBackupTokenCache();
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
          <>
            <ScreenshotDeepLinkListener />
            <AutoLedgerCoordinator dbReady={isDbReady} />
            <TaskReminderNotificationListener />
            <FinanceSheetHost />
            <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="add-frog" />
            <Stack.Screen name="add-task" />
            <Stack.Screen name="add-standalone-todo" />
            <Stack.Screen
              name="edit-task"
              options={{ gestureEnabled: false, headerBackButtonMenuEnabled: false }}
            />
            <Stack.Screen name="add-project" />
            <Stack.Screen name="add-subtask" />
            <Stack.Screen name="add-account" />
            <Stack.Screen name="add-account-type" />
            <Stack.Screen name="account-detail" />
            <Stack.Screen name="assets" />
            <Stack.Screen name="vision-wall" />
            <Stack.Screen name="vision-create" />
            <Stack.Screen name="edit-goal-dimension/[id]" />
            <Stack.Screen name="vision-detail/[id]" />
            <Stack.Screen
              name="task/[id]"
              options={{ gestureEnabled: false, headerBackButtonMenuEnabled: false }}
            />
            <Stack.Screen name="health-calendar" />
            <Stack.Screen name="intake-history" />
            <Stack.Screen name="finance-calendar" />
            <Stack.Screen name="tasks-calendar" />
            <Stack.Screen name="tasks-overview" />
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
            <Stack.Screen name="memo-list" />
            <Stack.Screen name="memo-view/[id]" />
            <Stack.Screen name="memo-edit/[id]" />
            <Stack.Screen name="add-wish-item" />
            <Stack.Screen name="edit-wish-item/[id]" />
            <Stack.Screen name="persona-detail/[slug]" />
            <Stack.Screen name="weekly-review" />
            <Stack.Screen name="my-skills" />
            <Stack.Screen name="my-recipes" />
            <Stack.Screen name="recipe-view/[id]" />
            <Stack.Screen name="recipe-edit/[id]" />
            <Stack.Screen name="zhipu-api-test" />
            <Stack.Screen name="category-sort" />
            <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
            <Stack.Screen name="screenshot" />
            <Stack.Screen name="auto-ledger" />
          </Stack>
          </>
        )}
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemePreferenceProvider>
        <DayBoundaryProvider>
          <RootLayoutInner />
        </DayBoundaryProvider>
      </ThemePreferenceProvider>
    </GestureHandlerRootView>
  );
}
