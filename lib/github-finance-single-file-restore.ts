import type * as SQLite from 'expo-sqlite';
import { GitHubBackupManager, type GitHubBackupConfig } from '@/lib/github-backup-manager';
import { DEFAULT_GITHUB_BACKUP_PATH } from '@/lib/github-backup-user-config';
import type { GithubFinanceCloudBackupPayload } from '@/lib/github-cloud-sync';
import type {
  FinanceAccountBalanceRow,
  FinanceFlowCategoryRow,
  FinanceTransactionRow,
} from '@/lib/repositories/finance/finance.types';

function sqliteBindingFromJson(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return v;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function isSafeSqliteTableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function stripComputedBalanceFromAccount(row: FinanceAccountBalanceRow): Record<string, unknown> {
  const { balance: _balance, ...rest } = row;
  return { ...rest };
}

export function parseFinanceCloudBackupJson(text: string): GithubFinanceCloudBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (e) {
    throw new Error(`账单单文件 JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('账单单文件根节点不是对象');
  }
  const o = parsed as Record<string, unknown>;
  if (o.schema !== 'finance-cloud-backup/v1') {
    throw new Error(`不支持的账单单文件 schema：${String(o.schema)}`);
  }
  const lastUpdated = typeof o.lastUpdated === 'string' ? o.lastUpdated : new Date().toISOString();
  const bills = Array.isArray(o.bills) ? (o.bills as FinanceTransactionRow[]) : [];
  const accounts = Array.isArray(o.accounts) ? (o.accounts as FinanceAccountBalanceRow[]) : [];
  const flowCategories = Array.isArray(o.flowCategories) ? (o.flowCategories as FinanceFlowCategoryRow[]) : [];
  return { schema: 'finance-cloud-backup/v1', lastUpdated, bills, accounts, flowCategories };
}

async function replaceTableRows(
  db: SQLite.SQLiteDatabase,
  table: string,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (!isSafeSqliteTableName(table)) {
    throw new Error(`非法表名：${table}`);
  }
  const safe = table.replace(/"/g, '""');
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info("${safe}")`);
  const colNames = cols.map(c => c.name).filter(Boolean);
  if (colNames.length === 0) {
    throw new Error(`表 ${table} 不存在或无法读取结构`);
  }

  await db.runAsync(`DELETE FROM "${safe}"`);

  let inserted = 0;
  for (const row of rows) {
    const keys = colNames.filter(c => Object.prototype.hasOwnProperty.call(row, c));
    if (keys.length === 0) continue;
    const qCols = keys.map(c => `"${c.replace(/"/g, '""')}"`).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const vals = keys.map(k => sqliteBindingFromJson(row[k]));
    await db.runAsync(`INSERT INTO "${safe}" (${qCols}) VALUES (${placeholders})`, vals);
    inserted += 1;
  }
  return inserted;
}

/**
 * 将 `backups/user_data.json`（finance-cloud-backup/v1）写入本地 SQLite 财务三表。
 * 调用方应已关闭外键或处于恢复批处理中。
 */
export async function applyFinanceCloudBackupPayload(
  db: SQLite.SQLiteDatabase,
  payload: GithubFinanceCloudBackupPayload,
): Promise<{ bills: number; accounts: number; flowCategories: number }> {
  const accountRows = payload.accounts.map(a =>
    stripComputedBalanceFromAccount(a),
  ) as Record<string, unknown>[];

  const flowCategories = await replaceTableRows(
    db,
    'finance_flow_categories',
    payload.flowCategories as unknown as Record<string, unknown>[],
  );
  const accounts = await replaceTableRows(db, 'finance_accounts', accountRows);
  const bills = await replaceTableRows(
    db,
    'finance_transactions',
    payload.bills as unknown as Record<string, unknown>[],
  );

  return { bills, accounts, flowCategories };
}

export type FinanceSingleFileRestoreOutcome =
  | {
      ok: true;
      lastUpdated: string;
      bills: number;
      accounts: number;
      flowCategories: number;
    }
  | {
      ok: false;
      reason: 'not_found' | 'invalid_payload' | 'apply_failed' | 'fetch_failed';
      message: string;
    };

/** 拉取并应用账单单文件备份（`DEFAULT_GITHUB_BACKUP_PATH`） */
export async function downloadAndApplyFinanceSingleFileBackup(
  cfg: GitHubBackupConfig,
  db: SQLite.SQLiteDatabase,
  opts?: { signal?: AbortSignal },
): Promise<FinanceSingleFileRestoreOutcome> {
  const manager = new GitHubBackupManager({ ...cfg, path: DEFAULT_GITHUB_BACKUP_PATH });
  const dl = await manager.downloadUtf8Text({ signal: opts?.signal });
  if (!dl.ok) {
    const notFound =
      dl.status === 404 ||
      /not found|404|不存在/i.test(dl.message);
    if (notFound) {
      return {
        ok: false,
        reason: 'not_found',
        message: `云端未找到 ${DEFAULT_GITHUB_BACKUP_PATH}`,
      };
    }
    return { ok: false, reason: 'fetch_failed', message: dl.message };
  }

  let payload: GithubFinanceCloudBackupPayload;
  try {
    payload = parseFinanceCloudBackupJson(dl.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'invalid_payload', message: msg };
  }

  try {
    await db.execAsync('PRAGMA foreign_keys = OFF');
    try {
      const counts = await applyFinanceCloudBackupPayload(db, payload);
      const fkViolations = await db.getAllAsync<{ table: string; rowid: number; parent: string }>(
        'PRAGMA foreign_key_check',
      );
      if (fkViolations.length > 0) {
        throw new Error(
          `账单单文件恢复后外键检查失败（${fkViolations.length} 条）`,
        );
      }
      return {
        ok: true,
        lastUpdated: payload.lastUpdated,
        ...counts,
      };
    } finally {
      try {
        await db.execAsync('PRAGMA foreign_keys = ON');
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'apply_failed', message: msg };
  }
}
