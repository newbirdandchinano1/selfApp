import { Platform } from 'react-native';

import { REST_SKIP_TABLES } from '@/lib/api-incremental-sync';
import { listLocalUserTablesForApiUpload } from '@/lib/cloud-sql-sync';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { clearPageSyncMeta } from '@/lib/api-local-bootstrap';
import { getDatabase } from '@/lib/database';
import { resetPageApiSession } from '@/lib/page-api-session';

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
