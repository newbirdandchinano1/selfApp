import {
  GitHubBackupManager,
  getGitHubBackupConfigFromEnv,
  getGitHubFullBackupRootFromEnv,
  type GitHubBackupConfig,
} from '@/lib/github-backup-manager';
import { DB_VERSION, getDatabase } from '@/lib/database';
import { serializeErrorForDiagnostic } from '@/lib/github-cloud-sync';
import { parseSqliteBackupRepoPath } from '@/lib/github-sqlite-backup-chunk';
import { memoItemsFromBackupPayload, replaceMemosFromCloudRestore } from '@/lib/memos';
import {
  replaceUserWeaknessesFromCloudRestore,
  userWeaknessItemsFromBackupPayload,
} from '@/lib/user-weaknesses';
import { saveUserSkills, normalizeUserSkillsSnapshot } from '@/lib/user-skills';
import {
  clearWeeklyReviewConfiguredWeekday,
  setWeeklyReviewConfiguredWeekday,
} from '@/lib/weekly-review-settings';
import { setPreferredAiLlmProvider, type AiLlmProviderId } from '@/lib/ai-llm-provider-preference';
import { setLastFullGithubBackupAtIso } from '@/lib/github-full-backup-local-meta';
import { sleep, throwIfAborted, isAbortError } from '@/lib/github-fetch-retry';
import { parseGithubAppBackupManifestV1, type AppBackupManifestV1, type ManifestFileEntry } from '@/lib/github-app-backup-manifest';
import {
  beginGithubSqliteDirtyIgnoreBatch,
  endGithubSqliteDirtyIgnoreBatch,
} from '@/lib/github-sqlite-dirty-track';
import { setSilentGithubCloudRestoreInFlight } from '@/lib/github-cloud-sync-flags';

class GithubRestoreAbortError extends Error {
  readonly diagnosticText: string;
  constructor(message: string, diagnosticText: string) {
    super(message);
    this.name = 'GithubRestoreAbortError';
    this.diagnosticText = diagnosticText;
  }
}

function isGithubRestoreAbort(e: unknown): e is GithubRestoreAbortError {
  return e instanceof GithubRestoreAbortError;
}

export type GithubCloudRestoreResult =
  | {
      ok: true;
      cloudLastUpdated: string;
      sqliteTables: number;
      sqliteRows: number;
      kvKeys: string[];
      /** 非致命提示（如备份时的 schema 版本与当前应用不一致） */
      warnings: string[];
      /** 本机存在但未出现在本次 manifest 的 SQLite 表（未覆盖，仍保留旧数据） */
      tablesNotInBackup: string[];
    }
  | {
      ok: false;
      reason: 'no_config' | 'fetch_failed' | 'invalid_manifest' | 'apply_failed' | 'unsupported_platform' | 'aborted';
      message: string;
      diagnosticText: string;
    };

function isSafeSqliteTableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

type SqliteEntryWithPart = { ent: ManifestFileEntry; partIndex: number | null };

function groupSqliteManifestEntries(entries: ManifestFileEntry[]): Map<string, SqliteEntryWithPart[]> {
  const byTable = new Map<string, SqliteEntryWithPart[]>();
  for (const ent of entries) {
    let parsed: { table: string; partIndex: number | null };
    try {
      parsed = parseSqliteBackupRepoPath(ent.path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg);
    }
    if (!isSafeSqliteTableName(parsed.table) || parsed.table !== ent.name) {
      throw new Error(`表「${ent.name}」：manifest 中 path 与 name 不一致（path=${ent.path}）`);
    }
    const list = byTable.get(parsed.table) ?? [];
    list.push({ ent, partIndex: parsed.partIndex });
    byTable.set(parsed.table, list);
  }
  for (const [, list] of byTable) {
    list.sort((a, b) => {
      if (a.partIndex === null && b.partIndex === null) return 0;
      if (a.partIndex === null) return -1;
      if (b.partIndex === null) return 1;
      return a.partIndex - b.partIndex;
    });
  }
  return byTable;
}

function validateSqlitePartSequence(tableLabel: string, parts: SqliteEntryWithPart[]): void {
  if (parts.length === 0) return;
  const allNull = parts.every(p => p.partIndex === null);
  const allNum = parts.every(p => p.partIndex !== null);
  if (!allNull && !allNum) {
    throw new Error(`表 ${tableLabel}：manifest 中与同一表混用了整表与分片路径`);
  }
  if (allNull) {
    if (parts.length !== 1) {
      throw new Error(`表 ${tableLabel}：存在多个整表 JSON 条目`);
    }
    return;
  }
  const sorted = [...parts.map(p => p.partIndex as number)].sort((a, b) => a - b);
  if (sorted[0] !== 0 || sorted[sorted.length - 1] !== sorted.length - 1) {
    throw new Error(`表 ${tableLabel}：分片序号必须从 0 连续到 n-1，实际：${sorted.join(', ')}`);
  }
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i) {
      throw new Error(`表 ${tableLabel}：分片序号不连续：${sorted.join(', ')}`);
    }
  }
}

function readDumpV1Rows(entName: string, o: Record<string, unknown>): { table: string; rows: unknown[] } {
  if (o.schema !== 'sqlite-table-dump/v1') {
    throw new Error(`表 ${entName}：schema 不是 sqlite-table-dump/v1`);
  }
  const tbl = typeof o.table === 'string' ? o.table : '';
  if (!isSafeSqliteTableName(tbl) || tbl !== entName) {
    throw new Error(`表 ${entName}：非法或 mismatched 表名`);
  }
  return { table: tbl, rows: Array.isArray(o.rows) ? o.rows : [] };
}

function mergeChunkFiles(entName: string, parsedList: Record<string, unknown>[]): unknown[] {
  const meta: { chunkIndex: number; chunkCount: number; rows: unknown[] }[] = [];
  for (const o of parsedList) {
    if (o.schema !== 'sqlite-table-dump-chunk/v1') {
      throw new Error(`表 ${entName}：分片文件的 schema 不是 sqlite-table-dump-chunk/v1`);
    }
    const tbl = typeof o.table === 'string' ? o.table : '';
    if (!isSafeSqliteTableName(tbl) || tbl !== entName) {
      throw new Error(`表 ${entName}：分片中表名不匹配`);
    }
    const chunkIndex = typeof o.chunkIndex === 'number' && Number.isInteger(o.chunkIndex) ? o.chunkIndex : -1;
    const chunkCount = typeof o.chunkCount === 'number' && Number.isInteger(o.chunkCount) ? o.chunkCount : -1;
    if (chunkIndex < 0 || chunkCount < 1 || chunkIndex >= chunkCount) {
      throw new Error(`表 ${entName}：非法 chunkIndex / chunkCount`);
    }
    meta.push({
      chunkIndex,
      chunkCount,
      rows: Array.isArray(o.rows) ? o.rows : [],
    });
  }
  const chunkCount = meta[0]!.chunkCount;
  if (meta.length !== chunkCount) {
    throw new Error(`表 ${entName}：分片文件数（${meta.length}）与 chunkCount（${chunkCount}）不一致`);
  }
  for (const m of meta) {
    if (m.chunkCount !== chunkCount) {
      throw new Error(`表 ${entName}：各分片 chunkCount 不一致`);
    }
  }
  const byIdx = new Map<number, unknown[]>();
  for (const m of meta) {
    if (byIdx.has(m.chunkIndex)) {
      throw new Error(`表 ${entName}：重复的 chunkIndex ${m.chunkIndex}`);
    }
    byIdx.set(m.chunkIndex, m.rows);
  }
  const rows: unknown[] = [];
  for (let i = 0; i < chunkCount; i++) {
    if (!byIdx.has(i)) {
      throw new Error(`表 ${entName}：缺少分片 chunkIndex=${i}`);
    }
    rows.push(...(byIdx.get(i) ?? []));
  }
  return rows;
}

async function downloadPathUtf8(
  base: GitHubBackupConfig,
  repoPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const manager = new GitHubBackupManager({ ...base, path: repoPath.replace(/^\/+/, '') });
  const r = await manager.downloadUtf8Text({ signal });
  if (!r.ok) {
    if (r.aborted) {
      throw new GithubRestoreAbortError(r.message, r.diagnosticText);
    }
    const err = new Error(r.message);
    (err as Error & { diagnosticText?: string }).diagnosticText = r.diagnosticText;
    throw err;
  }
  return r.text;
}

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

async function applyKvFromDump(key: string, payload: unknown): Promise<void> {
  switch (key) {
    case 'memos': {
      const items = memoItemsFromBackupPayload(payload);
      await replaceMemosFromCloudRestore(items);
      break;
    }
    case 'user_weaknesses': {
      const items = userWeaknessItemsFromBackupPayload(payload);
      await replaceUserWeaknessesFromCloudRestore(items);
      break;
    }
    case 'user_skills': {
      await saveUserSkills(normalizeUserSkillsSnapshot(payload));
      break;
    }
    case 'weekly_review': {
      if (payload !== null && typeof payload === 'object') {
        const dow = (payload as { configuredWeekday?: unknown }).configuredWeekday;
        if (dow == null) {
          await clearWeeklyReviewConfiguredWeekday();
        } else if (typeof dow === 'number' && Number.isInteger(dow) && dow >= 0 && dow <= 6) {
          await setWeeklyReviewConfiguredWeekday(dow);
        } else {
          await clearWeeklyReviewConfiguredWeekday();
        }
      } else {
        await clearWeeklyReviewConfiguredWeekday();
      }
      break;
    }
    case 'ai_llm_provider': {
      const id = (payload as { providerId?: unknown } | null)?.providerId;
      const normalized: AiLlmProviderId = id === 'gemini' ? 'gemini' : 'zhipu';
      await setPreferredAiLlmProvider(normalized);
      break;
    }
    default:
      break;
  }
}

async function applyKvFromDumpWithRetry(
  key: string,
  payload: unknown,
  opts: { signal?: AbortSignal; maxAttempts?: number },
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 4;
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    throwIfAborted(opts.signal);
    try {
      await applyKvFromDump(key, payload);
      return;
    } catch (e) {
      lastErr = e;
      if (i === maxAttempts - 1) break;
      await sleep(Math.min(8000, 400 * 2 ** i), opts.signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * 从 GitHub 全量备份目录拉取 `manifest.json`、各 `sqlite/*.json` 与 `kv/*.json`，覆盖写入本机 SQLite 与 AsyncStorage。
 * 与 `triggerGithubCloudSync` 使用同一 `EXPO_PUBLIC_GITHUB_*` 与 `EXPO_PUBLIC_GITHUB_BACKUP_ROOT`。
 */
export async function triggerGithubCloudRestoreFromFullBackup(opts?: {
  signal?: AbortSignal;
}): Promise<GithubCloudRestoreResult> {
  const signal = opts?.signal;
  const cfg = getGitHubBackupConfigFromEnv();
  if (!cfg) {
    const message =
      '未配置 GitHub：请在项目根目录 .env.local 中设置 EXPO_PUBLIC_GITHUB_TOKEN / OWNER / REPO。';
    return { ok: false, reason: 'no_config', message, diagnosticText: message };
  }

  const db = await getDatabase();
  if (!db) {
    const message = '当前运行环境无本地 SQLite（例如 Web），无法执行全量恢复。';
    return { ok: false, reason: 'unsupported_platform', message, diagnosticText: message };
  }

  setSilentGithubCloudRestoreInFlight(true);
  beginGithubSqliteDirtyIgnoreBatch();
  try {
  const root = getGitHubFullBackupRootFromEnv();
  const manifestPath = `${root}/manifest.json`;

  let manifestText: string;
  try {
    throwIfAborted(signal);
    manifestText = await downloadPathUtf8(cfg, manifestPath, signal);
  } catch (e) {
    if (isGithubRestoreAbort(e)) {
      return { ok: false, reason: 'aborted', message: e.message, diagnosticText: e.diagnosticText };
    }
    const diag =
      (e as Error & { diagnosticText?: string }).diagnosticText ??
      [e instanceof Error ? e.message : String(e), '', serializeErrorForDiagnostic(e)].join('\n');
    return {
      ok: false,
      reason: 'fetch_failed',
      message: `拉取 manifest 失败：${manifestPath}`,
      diagnosticText: diag,
    };
  }

  let manifest: AppBackupManifestV1;
  try {
    manifest = parseGithubAppBackupManifestV1(manifestText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'invalid_manifest',
      message: msg,
      diagnosticText: [msg, '', '----- manifest 原文（截断）-----', manifestText.slice(0, 8000)].join('\n'),
    };
  }

  const cloudLastUpdated = manifest.lastFullBackupAt ?? manifest.lastUpdated ?? new Date().toISOString();

  const sqliteEntries = manifest.files.filter(f => f.kind === 'sqlite');
  const kvEntries = manifest.files.filter(f => f.kind === 'kv');

  let groupedSqlite: Map<string, SqliteEntryWithPart[]>;
  try {
    groupedSqlite = groupSqliteManifestEntries(sqliteEntries);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'invalid_manifest',
      message: msg,
      diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  const tablesInManifest = new Set<string>(groupedSqlite.keys());

  let localTableNames: string[] = [];
  try {
    throwIfAborted(signal);
    const masterRows = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    localTableNames = masterRows.map(r => r.name).filter(Boolean);
  } catch {
    localTableNames = [];
  }
  const tablesNotInBackup = localTableNames.filter(n => !tablesInManifest.has(n));

  const warnings: string[] = [];
  if (manifest.bundledDbVersion != null && manifest.bundledDbVersion !== DB_VERSION) {
    warnings.push(
      `备份时的 bundledDbVersion=${manifest.bundledDbVersion}，当前应用 DB_VERSION=${DB_VERSION}；若版本跨度较大，请留意数据或迁移是否异常。`,
    );
  }
  if (tablesNotInBackup.length > 0) {
    const preview = tablesNotInBackup.slice(0, 12).join('、');
    const more = tablesNotInBackup.length > 12 ? ` 等共 ${tablesNotInBackup.length} 张` : '';
    warnings.push(`以下本机表未出现在云端 manifest，未覆盖（仍保留本机原数据）：${preview}${more}`);
  }

  const sqliteSnapshots: { table: string; rows: unknown[] }[] = [];

  try {
    const tableOrder = [...groupedSqlite.keys()].sort((a, b) => a.localeCompare(b));
    for (const table of tableOrder) {
      throwIfAborted(signal);
      const parts = groupedSqlite.get(table)!;
      validateSqlitePartSequence(table, parts);

      if (parts.length === 1 && parts[0]!.partIndex === null) {
        const raw = await downloadPathUtf8(cfg, parts[0]!.ent.path, signal);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch (e) {
          throw new Error(`表 ${table}：JSON 解析失败 — ${e instanceof Error ? e.message : String(e)}`);
        }
        if (parsed === null || typeof parsed !== 'object') throw new Error(`表 ${table}：根节点不是对象`);
        const snap = readDumpV1Rows(table, parsed as Record<string, unknown>);
        sqliteSnapshots.push(snap);
        continue;
      }

      const parsedChunks: Record<string, unknown>[] = [];
      for (const { ent } of parts) {
        const raw = await downloadPathUtf8(cfg, ent.path, signal);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch (e) {
          throw new Error(
            `表 ${table}（${ent.path}）：JSON 解析失败 — ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        if (parsed === null || typeof parsed !== 'object') {
          throw new Error(`表 ${table}（${ent.path}）：分片根节点不是对象`);
        }
        parsedChunks.push(parsed as Record<string, unknown>);
      }
      const mergedRows = mergeChunkFiles(table, parsedChunks);
      sqliteSnapshots.push({ table, rows: mergedRows });
    }
  } catch (e) {
    if (isGithubRestoreAbort(e)) {
      return { ok: false, reason: 'aborted', message: e.message, diagnosticText: e.diagnosticText };
    }
    const diag =
      (e as Error & { diagnosticText?: string }).diagnosticText ??
      [e instanceof Error ? e.message : String(e), '', serializeErrorForDiagnostic(e)].join('\n');
    return {
      ok: false,
      reason: 'fetch_failed',
      message: '拉取或解析 SQLite 快照失败',
      diagnosticText: diag,
    };
  }

  const kvPayloads: { key: string; payload: unknown }[] = [];

  try {
    for (const ent of kvEntries) {
      throwIfAborted(signal);
      const raw = await downloadPathUtf8(cfg, ent.path, signal);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch (e) {
        throw new Error(`KV ${ent.name}：JSON 解析失败 — ${e instanceof Error ? e.message : String(e)}`);
      }
      if (parsed === null || typeof parsed !== 'object') throw new Error(`KV ${ent.name}：根节点不是对象`);
      const o = parsed as Record<string, unknown>;
      if (o.schema !== 'kv-dump/v1') throw new Error(`KV ${ent.name}：schema 不是 kv-dump/v1`);
      const key = typeof o.key === 'string' ? o.key : '';
      if (!key || key !== ent.name) throw new Error(`KV ${ent.name}：key 不匹配`);
      kvPayloads.push({ key, payload: o.payload });
    }
  } catch (e) {
    if (isGithubRestoreAbort(e)) {
      return { ok: false, reason: 'aborted', message: e.message, diagnosticText: e.diagnosticText };
    }
    const diag =
      (e as Error & { diagnosticText?: string }).diagnosticText ??
      [e instanceof Error ? e.message : String(e), '', serializeErrorForDiagnostic(e)].join('\n');
    return {
      ok: false,
      reason: 'fetch_failed',
      message: '拉取或解析 KV 快照失败',
      diagnosticText: diag,
    };
  }

  let sqliteRows = 0;
  let sqliteTables = 0;

  try {
    throwIfAborted(signal);
    await db.execAsync('PRAGMA foreign_keys = OFF');
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      for (const snap of sqliteSnapshots) {
        throwIfAborted(signal);
        const safe = snap.table.replace(/"/g, '""');
        const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info("${safe}")`);
        const colNames = cols.map(c => c.name).filter(Boolean);
        if (colNames.length === 0) {
          throw new Error(`表 ${snap.table} 在本机库中不存在或无法读取 PRAGMA table_info`);
        }
        await db.runAsync(`DELETE FROM "${safe}"`);
        for (const row of snap.rows) {
          if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
          const obj = row as Record<string, unknown>;
          const keys = colNames.filter(c => Object.prototype.hasOwnProperty.call(obj, c));
          if (keys.length === 0) continue;
          const qCols = keys.map(c => `"${c.replace(/"/g, '""')}"`).join(', ');
          const placeholders = keys.map(() => '?').join(', ');
          const vals = keys.map(k => sqliteBindingFromJson(obj[k]));
          await db.runAsync(`INSERT INTO "${safe}" (${qCols}) VALUES (${placeholders})`, vals);
          sqliteRows += 1;
        }
        sqliteTables += 1;
      }

      const fkViolations = await db.getAllAsync<{ table: string; rowid: number; parent: string; fkid: number }>(
        'PRAGMA foreign_key_check',
      );
      if (fkViolations.length > 0) {
        throw new Error(
          `外键检查失败（${fkViolations.length} 条）：${JSON.stringify(fkViolations.slice(0, 8), null, 2)}`,
        );
      }

      await db.execAsync('COMMIT');
    } catch (inner) {
      try {
        await db.execAsync('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw inner;
    }
  } catch (e) {
    if (isAbortError(e) || signal?.aborted) {
      return {
        ok: false,
        reason: 'aborted',
        message: '恢复已中止（如应用进入后台）',
        diagnosticText: [e instanceof Error ? e.message : String(e), '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'apply_failed',
      message: `写入 SQLite 失败：${msg}`,
      diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  } finally {
    try {
      await db.execAsync('PRAGMA foreign_keys = ON');
    } catch {
      /* ignore */
    }
  }

  const kvKeys: string[] = [];
  try {
    for (const { key, payload } of kvPayloads) {
      throwIfAborted(signal);
      await applyKvFromDumpWithRetry(key, payload, { signal });
      kvKeys.push(key);
    }
  } catch (e) {
    if (isAbortError(e) || signal?.aborted) {
      return {
        ok: false,
        reason: 'aborted',
        message: '恢复在写入 KV 阶段已中止；SQLite 可能已更新，请返回应用后检查或再次同步。',
        diagnosticText: [e instanceof Error ? e.message : String(e), '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'apply_failed',
      message: `SQLite 已提交，但写入 KV 失败：${msg}。已自动重试多次，仍失败时请检查网络或稍后重试。`,
      diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  try {
    await setLastFullGithubBackupAtIso(cloudLastUpdated);
  } catch {
    /* 非致命 */
  }

  void import('@/lib/github-cloud-sync')
    .then(m => m.triggerGithubFinanceCloudSync())
    .catch(() => {
      /* 账单单文件同步失败不阻恢复结论 */
    });

  return {
    ok: true,
    cloudLastUpdated,
    sqliteTables,
    sqliteRows,
    kvKeys,
    warnings,
    tablesNotInBackup,
  };
  } finally {
    endGithubSqliteDirtyIgnoreBatch();
    setSilentGithubCloudRestoreInFlight(false);
  }
}
