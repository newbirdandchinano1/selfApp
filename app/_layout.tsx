import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform, AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { AppSplashScreen } from '@/components/app-splash-screen';
import { PendingFlushBlockOverlay } from '@/components/pending-flush-block-overlay';
import { ApiLoadingShell } from '@/components/api-loading-shell';
import { AppErrorBoundary } from '@/components/app-error-boundary';
import { AutoLedgerCoordinator } from '@/components/auto-ledger-coordinator';
import { ScheduledExpenseCoordinator } from '@/components/scheduled-expense-coordinator';
import { CompletionCelebrationHost } from '@/components/completion-celebration-host';
import { PointsEarnedToastHost } from '@/components/points-earned-toast-host';
import { FinanceTransactionSheet } from '@/components/finance/finance-transaction-sheet';
import { ScreenshotDeepLinkListener } from '@/components/screenshot-deeplink-listener';
import { NotificationRouter } from '@/components/notification-router';
import {
  shouldSuppressDailyReviewReminderNotification,
} from '@/lib/daily-review-reminder-notifications';
import {
  shouldSuppressHabitReminderNotification,
} from '@/lib/habit-reminder-notifications';
import { shouldSuppressHealthIntakeReminderNotification } from '@/lib/health-intake-reminder-notifications';
import { resyncAppNotificationsAfterPreferenceChange } from '@/lib/notification-center';
import { DayBoundaryProvider } from '@/contexts/day-boundary-context';
import { ThemePreferenceProvider } from '@/contexts/theme-preference-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { loadAiLlmProviderPreference } from '@/lib/ai-llm-provider-preference';
import { initDatabase } from '@/lib/database';
import { loadCloudBackupTokenCache } from '@/lib/cloud-backup-config';
import { hydrateCloudDirtyFromStorage } from '@/lib/cloud-sql-dirty-track';
import { hydrateApiDirtyFromStorage, markAllPendingTablesDirty } from '@/lib/api-incremental-sync';
import {
  formatPendingFlushError,
  runStartupPendingFlush,
  subscribePendingFlushBlock,
} from '@/lib/pending-flush-gate';
import { startCloudPeriodicAlignScheduler } from '@/lib/cloud-sync-scheduler';
import { loadPersistedIntakeTargets } from '@/lib/global-intake-targets';
import { loadPersistedIntakeAssistantSelections } from '@/lib/intake-assistant-selection';
import { loadThemePreference } from '@/lib/theme-preference';
import { runInitialRestSyncIfNeeded, type InitialSyncProgress } from '@/lib/api-initial-sync';
import { hydratePageApiSession } from '@/lib/page-api-session';
import {
  clearExpoSandboxNotifications,
  isExpoSandboxNotificationDisabled,
} from '@/lib/notification-policy';
import { isNotificationCategoryAllowed } from '@/lib/notification-center-settings';
import { ApiDebugOverlay } from '@/components/api-debug-overlay';
import { loadApiDebugEnabled } from '@/lib/api-debug';
import {
  resolveNotificationCategoryFromData,
} from '@/lib/notification-catalog';
import { resyncReminderAfterAcknowledge } from '@/lib/notification-navigate';
import {
  acknowledgeStrongReminder,
  stripReminderAccessorySuffix,
} from '@/lib/notification-strong-reminder';

/** 本地初始化超过此时长则强制进入主界面，避免启动页无限等待 */
const BOOTSTRAP_MAX_MS = 15_000;

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      if (isExpoSandboxNotificationDisabled()) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }

      const data = notification.request.content.data;
      const category = resolveNotificationCategoryFromData(data);
      if (category && !(await isNotificationCategoryAllowed(category))) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }

      let suppress = false;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const record = data as Record<string, unknown>;
        if (record.type === 'habit-reminder' && typeof record.habitId === 'string') {
          suppress = await shouldSuppressHabitReminderNotification(record.habitId);
        } else if (record.type === 'daily-review-reminder') {
          suppress = await shouldSuppressDailyReviewReminderNotification();
        } else if (record.type === 'health-intake-reminder') {
          suppress = await shouldSuppressHealthIntakeReminderNotification();
        }
      }
      if (suppress) {
        // 已完成/无需提醒时清掉主提醒与升级链，并重排下一次
        const record =
          data && typeof data === 'object' && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : null;
        const base =
          typeof record?.baseIdentifier === 'string' && record.baseIdentifier
            ? record.baseIdentifier
            : notification.request.identifier;
        void acknowledgeStrongReminder(stripReminderAccessorySuffix(base)).then(() => {
          resyncReminderAfterAcknowledge(record);
        });
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    },
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
  const [flushStatus, setFlushStatus] = useState<string | null>(null);
  const [flushError, setFlushError] = useState<string | null>(null);
  const [flushReady, setFlushReady] = useState(false);
  const [flushRetrying, setFlushRetrying] = useState(false);
  const deferredStartedRef = useRef(false);
  const hasBeenBlockedRef = useRef(false);

  /** pending 冲刷成功后才启动 SyncManager，避免 Pull 抢在上传前覆盖缓存。 */
  const runDeferredBootstrapOnce = () => {
    if (deferredStartedRef.current) return;
    deferredStartedRef.current = true;
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
            void import('@/lib/sync-manager').then((m) => m.SyncManager.start());
            if (isExpoSandboxNotificationDisabled()) {
              await clearExpoSandboxNotifications();
            } else {
              void resyncAppNotificationsAfterPreferenceChange();
            }
          } else {
            void import('@/lib/sync-manager').then((m) => m.SyncManager.start());
          }
        } catch (e) {
          console.warn('后台初始化失败', e);
        }
      })();
    });
  };

  const runPendingFlushGate = async (): Promise<boolean> => {
    setFlushStatus('正在同步未上传的本地修改…');
    setFlushError(null);
    try {
      const result = await runStartupPendingFlush();
      if (!result.ok) {
        setFlushReady(false);
        setFlushError(result.error ?? '有未同步到服务器的本地修改，请保持网络后重试');
        if (__DEV__) {
          console.warn('[bootstrap] pending 冲刷未完成', result.inventoryAfter);
        }
        return false;
      }
      setFlushError(null);
      setFlushReady(true);
      runDeferredBootstrapOnce();
      return true;
    } catch (e) {
      console.warn('[bootstrap] pending 冲刷异常', e);
      setFlushReady(false);
      setFlushError(formatPendingFlushError(e));
      return false;
    } finally {
      setFlushStatus(null);
    }
  };

  const handleDbRetry = async () => {
    setDbError(null);
    setFlushError(null);
    try {
      await initDatabase();
      await hydratePageApiSession();
      await hydrateCloudDirtyFromStorage();
      await hydrateApiDirtyFromStorage();
      await markAllPendingTablesDirty();
      setIsDbReady(true);
      await runPendingFlushGate();
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

  const handleFlushRetry = async () => {
    if (flushRetrying) return;
    setFlushRetrying(true);
    try {
      await runPendingFlushGate();
    } finally {
      setFlushRetrying(false);
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
      // P0-03：历史 Worker 脏表迁入 API Outbox；日常写入只走 markApiTableDirty
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
        await runPendingFlushGate();
      } catch (e) {
        if (e instanceof Error && e.message === 'BOOTSTRAP_TIMEOUT') {
          console.warn('启动初始化超时，仍继续冲刷 pending');
          if (mounted) {
            setSyncProgress(null);
            setIsDbReady(true);
          }
          await runPendingFlushGate();
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

  useEffect(() => {
    return subscribePendingFlushBlock((blocked, message) => {
      if (blocked) {
        hasBeenBlockedRef.current = true;
        setFlushReady(false);
        setFlushError(message);
        return;
      }
      if (!hasBeenBlockedRef.current) return;
      hasBeenBlockedRef.current = false;
      setFlushError(null);
      setFlushReady(true);
      runDeferredBootstrapOnce();
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active') return;
      if (isExpoSandboxNotificationDisabled()) return;
      void resyncAppNotificationsAfterPreferenceChange();
    });
    return () => sub.remove();
  }, []);

  return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {showMainApp && isDbReady ? (
          <View style={{ flex: 1 }}>
            <ScreenshotDeepLinkListener />
            <AutoLedgerCoordinator dbReady={isDbReady} />
            <ScheduledExpenseCoordinator dbReady={isDbReady} />
            <NotificationRouter />
            <FinanceTransactionSheet />
            <AppErrorBoundary>
            <ApiLoadingShell>
            <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
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
            <Stack.Screen name="account-detail" />
            <Stack.Screen name="assets" />
            <Stack.Screen
              name="task/[id]"
              options={{ gestureEnabled: false, headerBackButtonMenuEnabled: false }}
            />
            <Stack.Screen name="intake-history" />
            <Stack.Screen name="health-analysis" />
            <Stack.Screen name="finance-calendar" />
            <Stack.Screen name="scheduled-expenses" />
            <Stack.Screen name="add-scheduled-expense" />
            <Stack.Screen name="tasks-calendar" />
            <Stack.Screen name="tasks-overview" />
            <Stack.Screen name="edit-finance-transaction/[id]" />
            <Stack.Screen name="cash-flow" />
            <Stack.Screen name="schedule-picker" />
            <Stack.Screen name="edit-profile" />
            <Stack.Screen name="quick-add-edit" />
            <Stack.Screen name="habit-detail" />
            <Stack.Screen name="add-item" />
            <Stack.Screen name="points-ledger" />
            <Stack.Screen name="project-completion-logs" />
            <Stack.Screen name="wish-board" />
            <Stack.Screen name="add-wish-board-item" />
            <Stack.Screen name="edit-wish-board-item/[id]" />
            <Stack.Screen name="memo-list" />
            <Stack.Screen name="memo-view/[id]" />
            <Stack.Screen name="memo-edit/[id]" />
            <Stack.Screen name="notification-center" />
            <Stack.Screen name="notification-center-scheduled" />
            <Stack.Screen
              name="reminder-dispose"
              options={{
                presentation: 'fullScreenModal',
                animation: 'fade',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen name="weekly-review" />
            <Stack.Screen name="weekly-review-form" />
            <Stack.Screen name="weekly-review/[weekStartYmd]/[dimensionId]" />
            <Stack.Screen name="monthly-review/[monthStartYmd]/[dimensionId]" />
            <Stack.Screen name="daily-review" />
            <Stack.Screen name="daily-review/[ymd]" />
            <Stack.Screen name="daily-review/[ymd]/[dimensionId]" />
            <Stack.Screen name="review-settings" />
            <Stack.Screen name="review-calendar" />
            <Stack.Screen name="review-template-settings" />
            <Stack.Screen name="my-recipes" />
            <Stack.Screen name="recipe-view/[id]" />
            <Stack.Screen name="recipe-edit/[id]" />
            {__DEV__ ? <Stack.Screen name="zhipu-api-test" /> : null}
            <Stack.Screen name="api-request-monitor" />
            <Stack.Screen name="category-sort" />
            <Stack.Screen name="project-tags" />
            <Stack.Screen name="screenshot" />
            <Stack.Screen name="auto-ledger" />
          </Stack>
            </ApiLoadingShell>
            </AppErrorBoundary>
            <PointsEarnedToastHost />
            <CompletionCelebrationHost />
            {flushError ? (
              <PendingFlushBlockOverlay
                message={flushError}
                retrying={flushRetrying}
                onRetry={() => {
                  void handleFlushRetry();
                }}
              />
            ) : null}
          </View>
        ) : null}
        {!showMainApp ? (
          <AppSplashScreen
            exitReady={isDbReady && flushReady && !dbError && !flushError}
            onFinish={() => setShowMainApp(true)}
            dbError={dbError ?? flushError}
            syncProgress={syncProgress}
            statusText={flushStatus}
            retrying={flushRetrying}
            onRetry={() => {
              if (dbError) {
                void handleDbRetry();
                return;
              }
              void handleFlushRetry();
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
