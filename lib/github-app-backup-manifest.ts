/**
 * 全量 / 增量云端多 key 备份共用的 manifest 结构（与云端 `manifest.json` 一致）。
 */

import { parseSqliteBackupRepoPath } from '@/lib/github-sqlite-backup-chunk';

export type ManifestFileEntry = {
  path: string;
  kind: 'sqlite' | 'kv' | 'meta';
  name: string;
  rowCount?: number;
};

export type AppBackupManifestV1 = {
  schema: string;
  lastUpdated?: string;
  lastFullBackupAt?: string;
  bundledDbVersion?: number;
  dbSchemaVersion?: number | null;
  backupRoot: string;
  files: ManifestFileEntry[];
  sqliteTableErrors?: Record<string, string>;
};

export function parseGithubAppBackupManifestV1(text: string): AppBackupManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (e) {
    throw new Error(`manifest.json 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error('manifest.json 根节点不是对象');
  const o = parsed as Record<string, unknown>;
  if (o.schema !== 'app-backup-manifest/v1') throw new Error(`不支持的 manifest schema：${String(o.schema)}`);
  if (typeof o.backupRoot !== 'string' || !o.backupRoot.trim()) throw new Error('manifest 缺少 backupRoot');
  const filesRaw = o.files;
  if (!Array.isArray(filesRaw)) throw new Error('manifest.files 不是数组');
  const files: ManifestFileEntry[] = [];
  for (const f of filesRaw) {
    if (f === null || typeof f !== 'object') continue;
    const fr = f as Record<string, unknown>;
    const path = typeof fr.path === 'string' ? fr.path : '';
    const kind = fr.kind;
    const name = typeof fr.name === 'string' ? fr.name : '';
    if (!path || (kind !== 'sqlite' && kind !== 'kv' && kind !== 'meta') || !name) continue;
    const rowCount = typeof fr.rowCount === 'number' && Number.isFinite(fr.rowCount) ? fr.rowCount : undefined;
    files.push({ path, kind, name, ...(rowCount != null ? { rowCount } : {}) });
  }

  let sqliteTableErrors: Record<string, string> | undefined;
  const ste = o.sqliteTableErrors;
  if (ste !== null && typeof ste === 'object' && !Array.isArray(ste)) {
    const acc: Record<string, string> = {};
    for (const [k, v] of Object.entries(ste as Record<string, unknown>)) {
      if (typeof v === 'string' && k) acc[k] = v;
    }
    if (Object.keys(acc).length > 0) sqliteTableErrors = acc;
  }

  return {
    schema: 'app-backup-manifest/v1',
    lastUpdated: typeof o.lastUpdated === 'string' ? o.lastUpdated : undefined,
    lastFullBackupAt: typeof o.lastFullBackupAt === 'string' ? o.lastFullBackupAt : undefined,
    bundledDbVersion: typeof o.bundledDbVersion === 'number' ? o.bundledDbVersion : undefined,
    dbSchemaVersion:
      o.dbSchemaVersion === null
        ? null
        : typeof o.dbSchemaVersion === 'number'
          ? o.dbSchemaVersion
          : null,
    backupRoot: o.backupRoot.trim(),
    files,
    ...(sqliteTableErrors ? { sqliteTableErrors } : {}),
  };
}

/** 从 manifest.files 中移除指定逻辑表的所有 sqlite 路径（含分片） */
export function filterManifestFilesRemovingSqliteTables(
  files: ManifestFileEntry[],
  tablesToRemove: Set<string>,
): ManifestFileEntry[] {
  return files.filter(f => {
    if (f.kind !== 'sqlite') return true;
    try {
      const { table } = parseSqliteBackupRepoPath(f.path);
      return !tablesToRemove.has(table);
    } catch {
      return true;
    }
  });
}

/** 从 manifest.files 中移除指定 KV 切片（`kv/{name}.json`） */
export function filterManifestFilesRemovingKvSlices(files: ManifestFileEntry[], keys: Set<string>): ManifestFileEntry[] {
  return files.filter(f => !(f.kind === 'kv' && keys.has(f.name)));
}
