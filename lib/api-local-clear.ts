import { InteractionManager, Platform } from 'react-native';

import { REST_SKIP_TABLES } from '@/lib/api-incremental-sync';
import { listLocalUserTablesForApiUpload } from '@/lib/cloud-sql-sync';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import {
  clearPageSyncMeta,
  PREFER_LOCAL_READS_META_KEY,
  readAppMeta,
  writeAppMeta,
} from '@/lib/api-local-bootstrap';
import { getDatabase } from '@/lib/database';
import {
  clearPageLoadedInSession,
  markForceFullApiRefreshAfterLocalClear,
  markProcessColdStart,
  resetPageApiSession,
} from '@/lib/page-api-session';
import { getLogicalLocalYmd, loadConfiguredDayBoundary } from '@/lib/tasks-logical-day';

/** 上次按日界清空本地库时对应的逻辑日 YMD（存 app_meta，清库时保留） */
const LOCAL_DB_CLEARED_LOGICAL_YMD_META_KEY = 'local_db_cleared_logical_ymd_v1';

/** 跨日界清库时保留：本地偏好与迁移标记 */
const DAY_BOUNDARY_CLEAR_PRESERVE_TABLES = new Set(['app_settings']);

/** 回前台跨日清库前，尽量推送脏数据的最长等待（避免网络挂死拖垮 UI） */
const DAY_BOUNDARY_PUSH_TIMEOUT_MS = 8_000;

/** 首帧后再动手，避开 AppState→active 与页面 reload 的同一拍 */
const DAY_BOUNDARY_CLEAR_DEFER_MS = 450;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 首启引导前清空本地业务表数据（保留表结构与 app_meta 引导标记）。
 */
export async function clearLocalUserDataTables(opts?: {
  /** 额外保留的表（默认仍跳过 REST_SKIP_TABLES，含 app_meta） */
  preserveTables?: ReadonlySet<string> | readonly string[];
  /** 每清若干表让出主线程，减轻回前台卡死 */
  yieldEvery?: number;
}): Promise<void> {
  if (Platform.OS === 'web') return;

  const db = await getDatabase();
  if (!db) return;

  const preserve = opts?.preserveTables
    ? new Set(opts.preserveTables)
    : null;
  const yieldEvery = Math.max(0, opts?.yieldEvery ?? 0);

  const tables = (await listLocalUserTablesForApiUpload()).filter(
    t => !REST_SKIP_TABLES.has(t) && !(preserve?.has(t) ?? false),
  );
  if (tables.length === 0) return;

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.execAsync('PRAGMA foreign_keys = OFF');
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i]!;
      await db.runAsync(`DELETE FROM ${quoteIdent(table)}`);
      if (yieldEvery > 0 && (i + 1) % yieldEvery === 0) {
        await yieldToUi();
      }
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

  const { clearTasksTableSyncCache } = await import('@/lib/tasks-table-sync');
  await clearTasksTableSyncCache();

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

let dayBoundaryClearInflight: Promise<{ cleared: boolean }> | null = null;
let dayBoundaryClearGate = false;
/** 已调度尚未开始执行：防止 Effect 同 key 重入把闸门提前拆掉 */
let dayBoundaryClearScheduled = false;
let dayBoundaryClearScheduleTimer: ReturnType<typeof setTimeout> | null = null;
let dayBoundaryClearAfterInteractions: { cancel: () => void } | null = null;

/** 跨日界维护进行中：页面回前台 reload 应等待，避免与清库抢 SQLite */
export function isDayBoundaryClearInProgress(): boolean {
  return dayBoundaryClearGate || dayBoundaryClearScheduled || dayBoundaryClearInflight != null;
}

/**
 * 在 bump 日界 clock 之前同步加上闸门，挡住同拍的 AppState reload。
 * 即使随后判定无需清库，也会在 schedule 完成时放下闸门。
 */
export function armDayBoundaryClearGate(): void {
  dayBoundaryClearGate = true;
}

function releaseDayBoundaryClearGate(): void {
  dayBoundaryClearGate = false;
}

/** 误 bump / 同日无需清库时放下闸门，避免页面 reload 永久等待 */
export function disarmDayBoundaryClearGateIfIdle(): void {
  if (dayBoundaryClearInflight || dayBoundaryClearScheduled) return;
  releaseDayBoundaryClearGate();
}

async function pushDirtyBeforeDayBoundaryClear(): Promise<void> {
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      pushLocalChangesToApi({ awaitSync: true, quiet: true }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, DAY_BOUNDARY_PUSH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 逻辑日相对上次清库日向前推进时：尽量先推送脏数据，再清空本地业务表。
 * 保留 app_settings / app_meta；各页下次聚焦从服务端重新拉取。
 * 首次调用仅写入标记、不清库（避免升级后误清）。
 */
export async function clearLocalDatabaseOnDayBoundaryIfNeeded(): Promise<{ cleared: boolean }> {
  if (Platform.OS === 'web') {
    releaseDayBoundaryClearGate();
    return { cleared: false };
  }
  if (dayBoundaryClearInflight) return dayBoundaryClearInflight;

  dayBoundaryClearGate = true;
  dayBoundaryClearInflight = (async () => {
    const boundary = await loadConfiguredDayBoundary();
    const currentYmd = getLogicalLocalYmd(new Date(), boundary);
    const lastYmd = await readAppMeta(LOCAL_DB_CLEARED_LOGICAL_YMD_META_KEY);

    if (!lastYmd) {
      await writeAppMeta(LOCAL_DB_CLEARED_LOGICAL_YMD_META_KEY, currentYmd);
      return { cleared: false };
    }
    if (lastYmd === currentYmd) {
      return { cleared: false };
    }
    if (currentYmd < lastYmd) {
      // 时钟回拨或日界调晚导致逻辑日回退：只对齐标记
      await writeAppMeta(LOCAL_DB_CLEARED_LOGICAL_YMD_META_KEY, currentYmd);
      return { cleared: false };
    }

    try {
      await pushDirtyBeforeDayBoundaryClear();
    } catch (e) {
      if (__DEV__) console.warn('[api-local-clear] 跨日界清库前推送失败，仍继续清库', e);
    }

    await yieldToUi();
    await clearLocalUserDataTables({
      preserveTables: DAY_BOUNDARY_CLEAR_PRESERVE_TABLES,
      yieldEvery: 3,
    });
    await yieldToUi();
    await resetLocalReadCachesAfterClear();
    await writeAppMeta(LOCAL_DB_CLEARED_LOGICAL_YMD_META_KEY, currentYmd);
    return { cleared: true };
  })()
    .catch((e) => {
      if (__DEV__) console.warn('[api-local-clear] 跨日界清库失败', e);
      return { cleared: false };
    })
    .finally(() => {
      dayBoundaryClearInflight = null;
      dayBoundaryClearScheduled = false;
      // 无论是否清库，日界推进后都清会话加载标记，使各 Tab 下次聚焦重读
      clearPageLoadedInSession();
      releaseDayBoundaryClearGate();
    });

  return dayBoundaryClearInflight;
}

/**
 * 回前台/定时跨日：延后到交互结束再清库，避免与首帧绘制、页面 reload 叠打导致卡死/闪退。
 */
export function scheduleClearLocalDatabaseOnDayBoundaryIfNeeded(): void {
  armDayBoundaryClearGate();
  dayBoundaryClearScheduled = true;

  if (dayBoundaryClearScheduleTimer) {
    clearTimeout(dayBoundaryClearScheduleTimer);
    dayBoundaryClearScheduleTimer = null;
  }
  dayBoundaryClearAfterInteractions?.cancel();

  dayBoundaryClearAfterInteractions = InteractionManager.runAfterInteractions(() => {
    dayBoundaryClearAfterInteractions = null;
    dayBoundaryClearScheduleTimer = setTimeout(() => {
      dayBoundaryClearScheduleTimer = null;
      void clearLocalDatabaseOnDayBoundaryIfNeeded()
        .catch((err) => {
          if (__DEV__) console.warn('[api-local-clear] scheduleClear failed', err);
        })
        .finally(() => {
          // clearLocalDatabaseOnDayBoundaryIfNeeded 自身 finally 也会释放；此处兜底取消调度态
          if (!dayBoundaryClearInflight) {
            dayBoundaryClearScheduled = false;
            releaseDayBoundaryClearGate();
          }
        });
    }, DAY_BOUNDARY_CLEAR_DEFER_MS);
  });
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
