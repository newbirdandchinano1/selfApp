import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, InteractionManager, Platform, Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { ApiLoadingOverlay } from '@/components/api-loading-overlay';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { AutoLedgerCoordinator } from '@/components/auto-ledger-coordinator';
import { FinanceSheetHost } from '@/components/finance/finance-sheet-host';
import { ScreenshotDeepLinkListener } from '@/components/screenshot-deeplink-listener';
import { TaskReminderNotificationListener } from '@/components/task-reminder-notification-listener';
import { DayBoundaryProvider } from '@/contexts/day-boundary-context';
import { ThemePreferenceProvider } from '@/contexts/theme-preference-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { loadAiLlmProviderPreference } from '@/lib/ai-llm-provider-preference';
import { initDatabase, repairLocalDatabase } from '@/lib/database';
import { loadCloudBackupTokenCache } from '@/lib/cloud-backup-config';
import { hydrateCloudDirtyFromStorage } from '@/lib/cloud-sql-dirty-track';
import { hydrateApiDirtyFromStorage, markAllPendingTablesDirty } from '@/lib/api-incremental-sync';
import { startCloudPeriodicAlignScheduler } from '@/lib/cloud-sync-scheduler';
import { loadPersistedIntakeTargets } from '@/lib/global-intake-targets';
import { loadPersistedIntakeAssistantSelections } from '@/lib/intake-assistant-selection';
import { ensurePersonaPortraitsForTodayInBackground } from '@/lib/persona-portrait-sync';
import { loadThemePreference } from '@/lib/theme-preference';

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
  const [dbRepairBusy, setDbRepairBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const runDeferredBootstrap = () => {
      void (async () => {
        try {
          await loadPersistedIntakeTargets();
          await loadPersistedIntakeAssistantSelections();
          await loadThemePreference();
          await loadAiLlmProviderPreference();
          await loadCloudBackupTokenCache();
          if (Platform.OS !== 'web') {
            startCloudPeriodicAlignScheduler();
            void ensurePersonaPortraitsForTodayInBackground();
          }
        } catch (e) {
          console.warn('后台初始化失败', e);
        }
      })();
    };

    const run = async () => {
      try {
        await initDatabase();
        await hydrateCloudDirtyFromStorage();
        await hydrateApiDirtyFromStorage();
        await markAllPendingTablesDirty();
        if (mounted) {
          setDbError(null);
          setIsDbReady(true);
        }
        InteractionManager.runAfterInteractions(runDeferredBootstrap);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.warn('数据库初始化失败', detail, e);
        if (mounted) {
          setDbError(
            __DEV__ && detail.trim()
              ? `数据库初始化失败，请重试。\n${detail}`
              : '数据库初始化失败，请重试。',
          );
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
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Pressable
                    onPress={async () => {
                      setDbError(null);
                      try {
                        await initDatabase();
                        await hydrateCloudDirtyFromStorage();
                        setIsDbReady(true);
                        InteractionManager.runAfterInteractions(() => {
                          void loadPersistedIntakeTargets();
                          void loadThemePreference();
                          void loadAiLlmProviderPreference();
                          void loadCloudBackupTokenCache();
                          if (Platform.OS !== 'web') {
                            startCloudPeriodicAlignScheduler();
                            void ensurePersonaPortraitsForTodayInBackground();
                          }
                        });
                      } catch (e) {
                        const detail = e instanceof Error ? e.message : String(e);
                        console.warn('数据库初始化失败', detail, e);
                        setDbError(
                          __DEV__ && detail.trim()
                            ? `数据库初始化失败，请重试。\n${detail}`
                            : '数据库初始化失败，请重试。',
                        );
                      }
                    }}
                    disabled={dbRepairBusy}
                    style={({ pressed }) => ({
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 12,
                      borderWidth: 1,
                      opacity: dbRepairBusy ? 0.5 : pressed ? 0.8 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '800' }}>重试</Text>
                  </Pressable>
                  {Platform.OS !== 'web' ? (
                    <Pressable
                      onPress={async () => {
                        if (dbRepairBusy) return;
                        setDbRepairBusy(true);
                        setDbError(null);
                        try {
                          const repair = await repairLocalDatabase();
                          await initDatabase();
                          await hydrateCloudDirtyFromStorage();
                          setIsDbReady(true);
                          InteractionManager.runAfterInteractions(() => {
                            void loadPersistedIntakeTargets();
                            void loadThemePreference();
                            void loadAiLlmProviderPreference();
                            void loadCloudBackupTokenCache();
                            if (Platform.OS !== 'web') {
                              startCloudPeriodicAlignScheduler();
                            }
                            void ensurePersonaPortraitsForTodayInBackground();
                          });
                          if (repair.remainingFkIssues > 0) {
                            console.warn(
                              `本地库修复后仍有 ${repair.remainingFkIssues} 条外键异常`,
                            );
                          }
                        } catch (e) {
                          const detail = e instanceof Error ? e.message : String(e);
                          console.warn('数据库修复失败', detail, e);
                          setDbError(
                            __DEV__ && detail.trim()
                              ? `修复后仍无法启动。\n${detail}`
                              : '修复后仍无法启动，请到设置中尝试「从云同步到本机」。',
                          );
                        } finally {
                          setDbRepairBusy(false);
                        }
                      }}
                      disabled={dbRepairBusy}
                      style={({ pressed }) => ({
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        opacity: dbRepairBusy ? 0.5 : pressed ? 0.8 : 1,
                      })}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '800' }}>
                        {dbRepairBusy ? '修复中…' : '修复数据库'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <ScreenshotDeepLinkListener />
            <AutoLedgerCoordinator dbReady={isDbReady} />
            <TaskReminderNotificationListener />
            <FinanceSheetHost />
            <AppErrorBoundary>
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
            <Stack.Screen name="earned-rewards" />
            <Stack.Screen name="memo-list" />
            <Stack.Screen name="memo-view/[id]" />
            <Stack.Screen name="memo-edit/[id]" />
            <Stack.Screen name="add-wish-item" />
            <Stack.Screen name="edit-wish-item/[id]" />
            <Stack.Screen name="persona-detail/[slug]" />
            <Stack.Screen name="weekly-review" />
            <Stack.Screen name="review-template-settings" />
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
            </AppErrorBoundary>
            <ApiLoadingOverlay />
          </View>
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
