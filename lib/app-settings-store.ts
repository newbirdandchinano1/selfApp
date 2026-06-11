import AsyncStorage from '@react-native-async-storage/async-storage';
import { readApiRecord } from '@/lib/api-read';
import { getDatabase } from '@/lib/database';
import { markCloudSqliteTableDirty } from '@/lib/cloud-sql-dirty-track';

/** 与历史 AsyncStorage 键一致，便于迁移与排查 */
export const AppSettingKey = {
  theme: '@selfapp/theme_preference_v1',
  tasksProjectExpanded: '@tasks_project_expanded_v1',
  tasksHideCompletedProjectTasks: '@tasks_hide_completed_project_tasks_v1',
  tasksMainListView: '@tasks_main_list_view_v1',
  quickAddSelected: '@quick_add_cards_v1',
  quickAddCustomItems: '@quick_add_custom_items_v1',
  wishCustomCategories: '@wish_custom_categories_v1',
  wishDefaultCategoryPriorities: '@wish_default_category_priorities_v1',
  wishDefaultCategoryNames: '@wish_default_category_names_v1',
  wishHiddenDefaultCategoryIds: '@wish_hidden_default_category_ids_v1',
  financeDefaultAccounts: '@finance_default_accounts_v1',
  financeMonthlyBudget: '@finance_monthly_budget_settings_v2',
  financeBudgetRefreshDay: '@finance_budget_refresh_day_v1',
  financeMonthlyBudgetLegacy: '@finance_monthly_budget_override_v1',
  financeScheduledExpenses: '@finance_scheduled_expenses_v1',
  savingsOverview: '@selfapp/savings_overview_settings_v2',
  savingsOverviewLegacy: '@selfapp/savings_overview_settings_v1',
  globalIntakeTargets: '@global_intake_targets_v1',
  dailyIntakeAiTargets: '@daily_intake_ai_targets_v1',
  intakeAssistantSelection: '@intake_assistant_selection_v1',
  tasksCompletionDayStart: '@tasks_completion_day_start_v1',
  aiLlmProvider: '@selfapp/ai_llm_provider_id',
  weeklyReviewWeekday: 'weekly_review_weekday_dow',
  dailyReviewReminderEnabled: 'daily_review_reminder_enabled_v1',
  dailyReviewReminderHour: 'daily_review_reminder_hour_v1',
  dailyReviewReminderMinute: 'daily_review_reminder_minute_v1',
} as const;

const MIGRATION_ASYNC_KEYS: string[] = Object.values(AppSettingKey);

const APP_SETTINGS_ASYNC_MIGRATED_META = 'app_settings_async_migrated_v1';

function markAppSettingsDirty(): void {
  markCloudSqliteTableDirty('app_settings');
}

function serializeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function parseStoredValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === 'light' || trimmed === 'dark' || trimmed === 'system') return trimmed;
  if (trimmed === 'projects' || trimmed === 'tasks') return trimmed;
  if (trimmed === '0' || trimmed === '1') {
    if (/^\d$/.test(trimmed)) return trimmed;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

/** 启动时：将设置类 AsyncStorage 键一次性迁入 `app_settings` */
export async function migrateAppSettingsFromAsyncStorageIfNeeded(): Promise<void> {
  const db = await getDatabase();
  const flag = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    [APP_SETTINGS_ASYNC_MIGRATED_META],
  );
  if (flag?.value === '1') return;

  const now = new Date().toISOString();
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    for (const key of MIGRATION_ASYNC_KEYS) {
      const existing = await db.getFirstAsync<{ key: string }>(
        'SELECT key FROM app_settings WHERE key = ? LIMIT 1',
        [key],
      );
      if (existing) continue;

      const raw = await AsyncStorage.getItem(key);
      if (raw == null || raw === '') continue;

      await db.runAsync(
        `INSERT INTO app_settings (key, value_json, updated_at, sync_status) VALUES (?, ?, ?, 'pending_create')
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at,
           sync_status = CASE
             WHEN app_settings.sync_status = 'synced' THEN 'pending_update'
             ELSE app_settings.sync_status
           END`,
        [key, raw, now],
      );
    }
    await db.execAsync('COMMIT');
  } catch (e) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  await AsyncStorage.multiRemove(MIGRATION_ASYNC_KEYS);
  await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
    APP_SETTINGS_ASYNC_MIGRATED_META,
    '1',
  ]);
}

export async function getAppSettingRaw(key: string): Promise<string | null> {
  await migrateAppSettingsFromAsyncStorageIfNeeded();
  const db = await getDatabase();
  const localRow = await db.getFirstAsync<{ value_json: string; sync_status: string }>(
    'SELECT value_json, sync_status FROM app_settings WHERE key = ? LIMIT 1',
    [key],
  );
  if (localRow) {
    if (localRow.sync_status === 'pending_delete') return null;
    if (localRow.value_json != null && localRow.value_json !== '') {
      return localRow.value_json;
    }
  }
  const row = await readApiRecord<{ value_json: string }>('app_settings', key, { offlineFallback: true });
  if (!row?.value_json) return null;
  return row.value_json;
}

export async function getAppSetting<T>(key: string): Promise<T | null> {
  const raw = await getAppSettingRaw(key);
  if (raw == null) return null;
  return parseStoredValue(raw) as T;
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  const db = await getDatabase();
  await migrateAppSettingsFromAsyncStorageIfNeeded();
  const now = new Date().toISOString();
  const value_json = serializeValue(value);
  await db.runAsync(
    `INSERT INTO app_settings (key, value_json, updated_at, sync_status) VALUES (?, ?, ?, 'pending_create')
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at,
       sync_status = CASE
         WHEN app_settings.sync_status = 'synced' THEN 'pending_update'
         ELSE app_settings.sync_status
       END`,
    [key, value_json, now],
  );
  markAppSettingsDirty();
}

export async function removeAppSetting(key: string): Promise<void> {
  const db = await getDatabase();
  await migrateAppSettingsFromAsyncStorageIfNeeded();
  await db.runAsync('DELETE FROM app_settings WHERE key = ?', [key]);
  markAppSettingsDirty();
}
