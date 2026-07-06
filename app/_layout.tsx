import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { InteractionManager, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { AppSplashScreen } from '@/components/app-splash-screen';
import { ApiContentTransition } from '@/components/api-content-transition';
import { ApiDebugOverlay } from '@/components/api-debug-overlay';
import { ApiLoadingIndicator } from '@/components/api-loading-indicator';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { AutoLedgerCoordinator } from '@/components/auto-ledger-coordinator';
import { ScheduledExpenseCoordinator } from '@/components/scheduled-expense-coordinator';
import { FinanceSheetHost } from '@/components/finance/finance-sheet-host';
import { ScreenshotDeepLinkListener } from '@/components/screenshot-deeplink-listener';
import { DailyReviewReminderNotificationListener } from '@/components/daily-review-reminder-notification-listener';
import { TaskReminderNotificationListener } from '@/components/task-reminder-notification-listener';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { DayBoundaryProvider } from '@/contexts/day-boundary-context';
import { ThemePreferenceProvider } from '@/contexts/theme-preference-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { loadAiLlmProviderPreference } from '@/lib/ai-llm-provider-preference';
import { loadApiDebugEnabled } from '@/lib/api-debug';
import { initDatabase } from '@/lib/database';
import { loadCloudBackupTokenCache } from '@/lib/cloud-backup-config';
import { hydrateCloudDirtyFromStorage } from '@/lib/cloud-sql-dirty-track';
import { hydrateApiDirtyFromStorage, markAllPendingTablesDirty } from '@/lib/api-incremental-sync';
import { startCloudPeriodicAlignScheduler } from '@/lib/cloud-sync-scheduler';
import { loadPersistedIntakeTargets } from '@/lib/global-intake-targets';
import { loadPersistedIntakeAssistantSelections } from '@/lib/intake-assistant-selection';
import { loadThemePreference } from '@/lib/theme-preference';
import { runInitialRestSyncIfNeeded, type InitialSyncProgress } from '@/lib/api-initial-sync';
import { hydratePageApiSession } from '@/lib/page-api-session';

/** 本地初始化超过此时长则强制进入主界面，避免启动页无限等待 */
const BOOTSTRAP_MAX_MS = 15_000;

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
  const [showMainApp, setShowMainApp] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<InitialSyncProgress | null>(null);

  const runDeferredBootstrap = () => {
    InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          await loadPersistedIntakeTargets();
          await loadPersistedIntakeAssistantSelections();
          await loadThemePreference();
          await loadAiLlmProviderPreference();
          await loadApiDebugEnabled();
          await loadCloudBackupTokenCache();
          if (Platform.OS !== 'web') {
            startCloudPeriodicAlignScheduler();
            void syncDailyReviewReminderNotification();
          }
        } catch (e) {
          console.warn('后台初始化失败', e);
        }
      })();
    });
  };

  const handleDbRetry = async () => {
    setDbError(null);
    try {
      await initDatabase();
      await hydratePageApiSession();
      await hydrateCloudDirtyFromStorage();
      setIsDbReady(true);
      runDeferredBootstrap();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.warn('数据库初始化失败', detail, e);
      setDbError(
        __DEV__ && detail.trim()
          ? `数据库初始化失败，请重试。\n${detail}`
          : '数据库初始化失败，请重试。',
      );
    }
  };

  useEffect(() => {
    let mounted = true;

    const bootstrapWork = async () => {
      await initDatabase();

      if (Platform.OS !== 'web') {
        const syncResult = await runInitialRestSyncIfNeeded({
          onProgress: (progress) => {
            if (mounted) setSyncProgress(progress);
          },
        });
        if (!syncResult.ok && syncResult.error) {
          console.warn('[bootstrap] 首启准备未完成', syncResult.error);
        }
      }

      await hydratePageApiSession();
      await hydrateCloudDirtyFromStorage();
      await hydrateApiDirtyFromStorage();
      await loadApiDebugEnabled();
    };

    const run = async () => {
      try {
        await Promise.race([
          bootstrapWork(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('BOOTSTRAP_TIMEOUT')), BOOTSTRAP_MAX_MS);
          }),
        ]);

        if (mounted) {
          setSyncProgress(null);
          setDbError(null);
          setIsDbReady(true);
        }
        runDeferredBootstrap();
        void markAllPendingTablesDirty();
      } catch (e) {
        if (e instanceof Error && e.message === 'BOOTSTRAP_TIMEOUT') {
          console.warn('启动初始化超时，仍进入应用');
          if (mounted) {
            setSyncProgress(null);
            setIsDbReady(true);
          }
          runDeferredBootstrap();
          return;
        }

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
        {showMainApp && isDbReady ? (
          <View style={{ flex: 1 }}>
            <ScreenshotDeepLinkListener />
            <AutoLedgerCoordinator dbReady={isDbReady} />
            <ScheduledExpenseCoordinator dbReady={isDbReady} />
            <TaskReminderNotificationListener />
            <DailyReviewReminderNotificationListener />
            <FinanceSheetHost />
            <AppErrorBoundary>
            <ApiContentTransition>
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
            <Stack.Screen name="pick-parent-task" />
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
            <Stack.Screen name="scheduled-expenses" />
            <Stack.Screen name="add-scheduled-expense" />
            <Stack.Screen name="tasks-calendar" />
            <Stack.Screen name="tasks-overview" />
            <Stack.Screen name="edit-finance-transaction/[id]" />
            <Stack.Screen name="savings-plan" />
            <Stack.Screen name="cash-flow" />
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
            <Stack.Screen name="weekly-review" />
            <Stack.Screen name="weekly-review-form" />
            <Stack.Screen name="weekly-review/[weekStartYmd]/[dimensionId]" />
            <Stack.Screen name="daily-review" />
            <Stack.Screen name="daily-review/[ymd]" />
            <Stack.Screen name="daily-review/[ymd]/[dimensionId]" />
            <Stack.Screen name="review-settings" />
            <Stack.Screen name="review-calendar" />
            <Stack.Screen name="review-template-settings" />
            <Stack.Screen name="my-recipes" />
            <Stack.Screen name="recipe-view/[id]" />
            <Stack.Screen name="recipe-edit/[id]" />
            <Stack.Screen name="zhipu-api-test" />
            <Stack.Screen name="category-sort" />
            <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
            <Stack.Screen name="screenshot" />
            <Stack.Screen name="auto-ledger" />
          </Stack>
            </ApiContentTransition>
            </AppErrorBoundary>
            <ApiLoadingIndicator />
          </View>
        ) : null}
        {!showMainApp ? (
          <AppSplashScreen
            exitReady={isDbReady && !dbError}
            onFinish={() => setShowMainApp(true)}
            dbError={dbError}
            syncProgress={syncProgress}
            onRetry={() => {
              void handleDbRetry();
            }}
          />
        ) : null}
        <ApiDebugOverlay />
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
