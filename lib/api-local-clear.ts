import { Platform } from 'react-native';

import { REST_SKIP_TABLES } from '@/lib/api-incremental-sync';
import { listLocalUserTablesForApiUpload } from '@/lib/cloud-sql-sync';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { clearPageSyncMeta, PREFER_LOCAL_READS_META_KEY, writeAppMeta } from '@/lib/api-local-bootstrap';
import { getDatabase } from '@/lib/database';
import { markForceFullApiRefreshAfterLocalClear, markProcessColdStart, resetPageApiSession } from '@/lib/page-api-session';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * 首启引导前清空本地业务表数据（保留表结构与 app_meta 引导标记）。
 */
export async function clearLocalUserDataTables(): Promise<void> {
  if (Platform.OS === 'web') return;

  const db = await getDatabase();
  if (!db) return;

  const tables = (await listLocalUserTablesForApiUpload()).filter(t => !REST_SKIP_TABLES.has(t));
  if (tables.length === 0) return;

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.execAsync('PRAGMA foreign_keys = OFF');
    for (const table of tables) {
      await db.runAsync(`DELETE FROM ${quoteIdent(table)}`);
    }
    await db.execAsync('PRAGMA foreign_keys = ON');
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }

  resetPageApiSession();
  await clearPageSyncMeta();
}

/** 重置 REST 读缓存、脏表标记与页面会话，供冷启动/调试清库后使用 */
async function resetLocalReadCachesAfterClear(): Promise<void> {
  const { invalidateAllInflightApiTableFetches } = await import('@/lib/api-read');
  invalidateAllInflightApiTableFetches();

  const { invalidateTasksCalendarLocalBaseCache } = await import('@/lib/tasks-calendar-api');
  invalidateTasksCalendarLocalBaseCache();

  const { clearAllApiDirtyTables } = await import('@/lib/api-incremental-sync');
  clearAllApiDirtyTables();

  const { clearAllCloudSqliteDirtyTables } = await import('@/lib/cloud-sql-dirty-track');
  clearAllCloudSqliteDirtyTables();

  const { clearTasksBootstrapVersionCache } = await import('@/lib/api-page-sync');
  await clearTasksBootstrapVersionCache();

  const { clearTasksCatalogSyncCache } = await import('@/lib/tasks-catalog-api');
  await clearTasksCatalogSyncCache();

  await writeAppMeta(PREFER_LOCAL_READS_META_KEY, '0');

  markProcessColdStart();
  markForceFullApiRefreshAfterLocalClear();
  resetPageApiSession(undefined, { force: true });
  await clearPageSyncMeta();
}

/**
 * 冷启动：清空全部本地 SQLite 业务表数据（保留表结构与 app_meta 迁移标记）。
 * 各页面首次访问时从服务端重新拉取并写入本地。
 */
export async function clearLocalDatabaseOnColdStart(): Promise<void> {
  if (Platform.OS === 'web') return;

  await clearLocalUserDataTables();
  await resetLocalReadCachesAfterClear();
}

/**
 * 调试：删除全部本地 SQLite 业务表并重建空库（不可恢复）。
 * 同时重置页面同步标记与 REST 读缓存，便于重新验证后端拉取逻辑。
 */
export async function resetLocalDatabaseForDebug(): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Web 环境无本地 SQLite');
  }

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    const { resetDatabase } = await import('@/lib/database');
    await resetDatabase();
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }

  await resetLocalReadCachesAfterClear();
  await writeAppMeta(PREFER_LOCAL_READS_META_KEY, '0');
}
