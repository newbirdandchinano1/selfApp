import {
  GitHubBackupManager,
  getGitHubBackupConfigFromEnv,
  getGitHubFullBackupRootFromEnv,
  type GitHubBackupConfig,
  type GitHubBackupUploadResult,
} from '@/lib/github-backup-manager';
import { loadAiLlmProviderPreference } from '@/lib/ai-llm-provider-preference';
import { DB_VERSION, getDatabase, getSchemaVersion } from '@/lib/database';
import { listMemos } from '@/lib/memos';
import { listUserWeaknesses } from '@/lib/user-weaknesses';
import { loadUserSkills } from '@/lib/user-skills';
import { getWeeklyReviewConfiguredWeekday } from '@/lib/weekly-review-settings';
import {
  getFinanceAccountsWithBalance,
  getFinanceFlowCategories,
  getFinanceTransactions,
} from '@/lib/repositories/finance/finance';
import { setLastFullGithubBackupAtIso } from '@/lib/github-full-backup-local-meta';
import {
  parseGithubAppBackupManifestV1,
  filterManifestFilesRemovingSqliteTables,
  filterManifestFilesRemovingKvSlices,
} from '@/lib/github-app-backup-manifest';
import {
  peekGithubSqliteDirtyTables,
  clearGithubSqliteDirtyTables,
  scheduleGithubIncrementalCloudPushDebounced,
  clearAllGithubSqliteDirtyTables,
  peekGithubKvDirtySlices,
  clearGithubKvDirtySlices,
} from '@/lib/github-sqlite-dirty-track';
import { isSilentGithubCloudRestoreInFlight } from '@/lib/github-cloud-sync-flags';
import {
  buildSqliteTableUploadPieces,
  MAX_GITHUB_SQLITE_JSON_UTF8_BYTES,
  utf8ByteLength,
} from '@/lib/github-sqlite-backup-chunk';
import type {
  FinanceAccountBalanceRow,
  FinanceFlowCategoryRow,
  FinanceTransactionRow,
} from '@/lib/repositories/finance/finance.types';

export function serializeErrorForDiagnostic(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { cause?: unknown };
    const parts = [`${anyErr.name}: ${anyErr.message}`];
    if (typeof anyErr.stack === 'string' && anyErr.stack.trim()) parts.push(anyErr.stack);
    if (anyErr.cause != null) parts.push('', 'cause:', serializeErrorForDiagnostic(anyErr.cause));
    return parts.join('\n');
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

/** 与 Swift `AppData` 思路一致：可序列化快照 + ISO8601 时间 */
export type GithubFinanceCloudBackupPayload = {
  schema: 'finance-cloud-backup/v1';
  lastUpdated: string;
  bills: FinanceTransactionRow[];
  accounts: FinanceAccountBalanceRow[];
  flowCategories: FinanceFlowCategoryRow[];
};

export type GithubCloudSyncResult =
  | {
      ok: true;
      upload: Extract<GitHubBackupUploadResult, { ok: true }>;
      /** 多文件全量备份：最后一次 PUT 一般为 manifest.json */
      multiFileBackup?: { root: string; fileCount: number };
      /** 全量备份写入 manifest / last-full-backup.json 并完成本机记录后的 ISO8601 时间 */
      lastFullBackupAt?: string;
    }
  | {
      ok: false;
      reason: 'no_config' | 'collect_failed' | 'upload_failed' | 'aborted' | 'unsupported_platform';
      message: string;
      /** 完整诊断（URL、HTTP、响应正文、网络错误栈等），用于 Modal 展示 */
      diagnosticText: string;
    };

export async function collectFinanceCloudBackupJson(): Promise<string> {
  const [bills, accounts, flowCategories] = await Promise.all([
    getFinanceTransactions(),
    getFinanceAccountsWithBalance(),
    getFinanceFlowCategories(),
  ]);
  const payload: GithubFinanceCloudBackupPayload = {
    schema: 'finance-cloud-backup/v1',
    lastUpdated: new Date().toISOString(),
    bills,
    accounts,
    flowCategories,
  };
  return JSON.stringify(payload);
}

async function collectAllSqliteTableSnapshots(): Promise<{
  sqlite: Record<string, unknown[]>;
  sqliteTableErrors: Record<string, string>;
}> {
  const db = await getDatabase();
  const meta = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7) != 'sqlite_' ORDER BY name`,
  );
  const sqlite: Record<string, unknown[]> = {};
  const sqliteTableErrors: Record<string, string> = {};
  for (const { name } of meta) {
    const safe = name.replace(/"/g, '""');
    try {
      const rows = await db.getAllAsync(`SELECT * FROM "${safe}"`);
      sqlite[name] = (rows as unknown[]) ?? [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sqliteTableErrors[name] = msg;
      sqlite[name] = [];
    }
  }
  return { sqlite, sqliteTableErrors };
}

type MultiFileUploadSpec = {
  path: string;
  body: string;
  commitSuffix: string;
};

async function buildKvSliceUploadSpec(
  backupRoot: string,
  lastUpdated: string,
  key: string,
): Promise<{
  spec: MultiFileUploadSpec;
  manifestEntry: { path: string; kind: 'kv'; name: string; rowCount?: number };
}> {
  let payload: unknown;
  let rowCount: number | undefined;
  switch (key) {
    case 'memos': {
      const items = await listMemos();
      payload = items;
      rowCount = items.length;
      break;
    }
    case 'user_weaknesses': {
      const items = await listUserWeaknesses();
      payload = items;
      rowCount = items.length;
      break;
    }
    case 'user_skills': {
      payload = await loadUserSkills();
      break;
    }
    case 'weekly_review': {
      const dow = await getWeeklyReviewConfiguredWeekday();
      payload = { configuredWeekday: dow };
      break;
    }
    case 'ai_llm_provider': {
      const id = await loadAiLlmProviderPreference();
      payload = { providerId: id };
      break;
    }
    default:
      throw new Error(`未知 KV 切片：${key}`);
  }
  const body = JSON.stringify(
    {
      schema: 'kv-dump/v1' as const,
      key,
      lastUpdated,
      payload,
    },
    null,
    2,
  );
  if (utf8ByteLength(body) > MAX_GITHUB_SQLITE_JSON_UTF8_BYTES) {
    throw new Error(
      `KV「${key}」序列化后超过 GitHub 单文件建议上限（约 ${Math.round(MAX_GITHUB_SQLITE_JSON_UTF8_BYTES / 1024)}KB）`,
    );
  }
  const path = `${backupRoot}/kv/${key}.json`;
  return {
    spec: { path, body, commitSuffix: `kv/${key}.json` },
    manifestEntry: {
      path,
      kind: 'kv',
      name: key,
      ...(rowCount != null ? { rowCount } : {}),
    },
  };
}

async function uploadGithubBackupWithConfig(
  cfg: GitHubBackupConfig,
  json: string,
  commitMessage: string,
  opts?: { signal?: AbortSignal },
): Promise<GithubCloudSyncResult> {
  if (utf8ByteLength(json) > MAX_GITHUB_SQLITE_JSON_UTF8_BYTES) {
    const message = `账单 JSON 超过 GitHub 单文件建议上限（约 ${Math.round(MAX_GITHUB_SQLITE_JSON_UTF8_BYTES / 1024)}KB），请使用个人页「一键全量备份」或精简数据后再试。`;
    return { ok: false, reason: 'upload_failed', message, diagnosticText: message };
  }
  const manager = new GitHubBackupManager(cfg);
  const upload = await manager.uploadBackup(json, { message: commitMessage, signal: opts?.signal });
  if (upload.ok) {
    return { ok: true, upload };
  }
  if ('aborted' in upload && upload.aborted) {
    return {
      ok: false,
      reason: 'aborted',
      message: upload.message,
      diagnosticText: upload.diagnosticText,
    };
  }
  return {
    ok: false,
    reason: 'upload_failed',
    message: upload.message,
    diagnosticText: upload.diagnosticText,
  };
}

async function uploadGithubBackupMultiFiles(
  baseCfg: GitHubBackupConfig,
  specs: MultiFileUploadSpec[],
  opts?: { signal?: AbortSignal },
): Promise<GithubCloudSyncResult> {
  let lastOk: Extract<GitHubBackupUploadResult, { ok: true }> | null = null;
  const donePaths: string[] = [];
  if (opts?.signal?.aborted) {
    const message = '备份尚未开始即已中止（例如应用进入后台）';
    return { ok: false, reason: 'aborted', message, diagnosticText: message };
  }
  for (let i = 0; i < specs.length; i++) {
    if (opts?.signal?.aborted) {
      const message = `备份已中止：已完成 ${donePaths.length}/${specs.length} 个文件`;
      const diagnosticText = [
        message,
        '',
        donePaths.length > 0 ? `已成功写入：\n${donePaths.join('\n')}` : '尚无文件写入成功。',
        '',
        '可返回应用后重新执行「一键全量备份」；云端可能为不完整快照，以 manifest.json 是否更新为准。',
      ].join('\n');
      return { ok: false, reason: 'aborted', message, diagnosticText };
    }
    const spec = specs[i]!;
    const manager = new GitHubBackupManager({ ...baseCfg, path: spec.path });
    const upload = await manager.uploadBackup(spec.body, {
      message: `备份 ${spec.commitSuffix}`,
      signal: opts?.signal,
    });
    if (!upload.ok) {
      if ('aborted' in upload && upload.aborted) {
        const message = `备份已中止：已完成 ${donePaths.length}/${specs.length} 个文件`;
        const diagnosticText = [
          upload.diagnosticText,
          '',
          message,
          donePaths.length > 0 ? `此前已成功：\n${donePaths.join('\n')}` : '尚无文件写入成功。',
        ].join('\n\n');
        return { ok: false, reason: 'aborted', message: upload.message, diagnosticText };
      }
      const diagnosticText = [
        `在上传第 ${i + 1}/${specs.length} 个文件时失败：${spec.path}`,
        donePaths.length > 0 ? `已成功写入 ${donePaths.length} 个文件：\n${donePaths.join('\n')}` : '尚无文件写入成功。',
        '',
        upload.diagnosticText,
      ].join('\n\n');
      return {
        ok: false,
        reason: 'upload_failed',
        message: `上传失败：${spec.path} — ${upload.message}`,
        diagnosticText,
      };
    }
    lastOk = upload;
    donePaths.push(spec.path);
  }
  return { ok: true, upload: lastOk! };
}

function buildMultiFileFullBackupSpecs(
  root: string,
  input: {
    lastUpdated: string;
    dbSchemaVersion: number | null;
    sqlite: Record<string, unknown[]>;
    sqliteTableErrors: Record<string, string>;
    memos: Awaited<ReturnType<typeof listMemos>>;
    userWeaknesses: Awaited<ReturnType<typeof listUserWeaknesses>>;
    userSkills: Awaited<ReturnType<typeof loadUserSkills>>;
    weeklyReviewWeekday: number | null;
    aiLlmProviderId: Awaited<ReturnType<typeof loadAiLlmProviderPreference>>;
  },
): MultiFileUploadSpec[] {
  const { lastUpdated, dbSchemaVersion, sqlite, sqliteTableErrors, memos, userWeaknesses, userSkills } = input;
  const { weeklyReviewWeekday, aiLlmProviderId } = input;

  const specs: MultiFileUploadSpec[] = [];
  const manifestFiles: {
    path: string;
    kind: 'sqlite' | 'kv' | 'meta';
    name: string;
    rowCount?: number;
  }[] = [];

  const tableNames = Object.keys(sqlite).sort();
  for (const table of tableNames) {
    const rows = sqlite[table] ?? [];
    const built = buildSqliteTableUploadPieces(root, table, lastUpdated, rows);
    if (!built.ok) {
      sqliteTableErrors[table] = built.error;
      continue;
    }
    for (const p of built.pieces) {
      specs.push({ path: p.path, body: p.body, commitSuffix: p.commitSuffix });
      manifestFiles.push({
        path: p.path,
        kind: 'sqlite',
        name: table,
        rowCount: p.manifestRowCount,
      });
    }
  }

  const kvSpecs: { name: string; body: unknown; rowCount?: number }[] = [
    { name: 'memos', body: memos, rowCount: memos.length },
    { name: 'user_weaknesses', body: userWeaknesses, rowCount: userWeaknesses.length },
    { name: 'user_skills', body: userSkills },
    {
      name: 'weekly_review',
      body: { configuredWeekday: weeklyReviewWeekday },
    },
    { name: 'ai_llm_provider', body: { providerId: aiLlmProviderId } },
  ];

  for (const kv of kvSpecs) {
    const body = JSON.stringify(
      {
        schema: 'kv-dump/v1' as const,
        key: kv.name,
        lastUpdated,
        payload: kv.body,
      },
      null,
      2,
    );
    if (utf8ByteLength(body) > MAX_GITHUB_SQLITE_JSON_UTF8_BYTES) {
      throw new Error(
        `KV「${kv.name}」序列化后超过 GitHub 单文件建议上限（约 ${Math.round(MAX_GITHUB_SQLITE_JSON_UTF8_BYTES / 1024)}KB），请精简数据或联系开发者支持分片 KV。`,
      );
    }
    const path = `${root}/kv/${kv.name}.json`;
    specs.push({ path, body, commitSuffix: `kv/${kv.name}.json` });
    manifestFiles.push({
      path,
      kind: 'kv',
      name: kv.name,
      ...(kv.rowCount != null ? { rowCount: kv.rowCount } : {}),
    });
  }

  const lastFullBackupPath = `${root}/last-full-backup.json`;
  const lastFullBackupBody = JSON.stringify(
    {
      schema: 'full-backup-timestamp/v1' as const,
      lastFullBackupAt: lastUpdated,
    },
    null,
    2,
  );
  specs.push({
    path: lastFullBackupPath,
    body: lastFullBackupBody,
    commitSuffix: 'last-full-backup.json',
  });
  manifestFiles.push({
    path: lastFullBackupPath,
    kind: 'meta',
    name: 'last_full_backup',
  });

  const manifestBody = JSON.stringify(
    {
      schema: 'app-backup-manifest/v1' as const,
      lastUpdated,
      lastFullBackupAt: lastUpdated,
      bundledDbVersion: DB_VERSION,
      dbSchemaVersion,
      backupRoot: root,
      files: manifestFiles,
      ...(Object.keys(sqliteTableErrors).length > 0 ? { sqliteTableErrors } : {}),
    },
    null,
    2,
  );

  if (utf8ByteLength(manifestBody) > MAX_GITHUB_SQLITE_JSON_UTF8_BYTES) {
    throw new Error(
      `manifest.json 超过单文件建议上限（约 ${Math.round(MAX_GITHUB_SQLITE_JSON_UTF8_BYTES / 1024)}KB），表数量过多时请联系开发者调整备份策略。`,
    );
  }

  specs.push({
    path: `${root}/manifest.json`,
    body: manifestBody,
    commitSuffix: 'manifest.json',
  });

  return specs;
}

/** 仅账单：供财务页防抖自动同步，避免每次改账都上传整库 */
export async function triggerGithubFinanceCloudSync(
  opts?: { signal?: AbortSignal },
): Promise<GithubCloudSyncResult> {
  const cfg = getGitHubBackupConfigFromEnv();
  if (!cfg) {
    const message =
      '未配置 GitHub：请在项目根目录 .env.local 中设置 EXPO_PUBLIC_GITHUB_TOKEN / OWNER / REPO。';
    return {
      ok: false,
      reason: 'no_config',
      message,
      diagnosticText: message,
    };
  }

  let json: string;
  try {
    json = await collectFinanceCloudBackupJson();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const message = `读取本地数据失败：${msg}`;
    return {
      ok: false,
      reason: 'collect_failed',
      message,
      diagnosticText: [message, '', '----- 异常详情 -----', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  if (opts?.signal?.aborted) {
    const message = '账单备份在读取本地数据后被中止';
    return { ok: false, reason: 'aborted', message, diagnosticText: message };
  }

  return uploadGithubBackupWithConfig(cfg, json, `账单云备份 ${new Date().toISOString()}`, {
    signal: opts?.signal,
  });
}

/**
 * 全量备份：每张 SQLite 表 → `/{root}/sqlite/{表名}.json`，AsyncStorage 类数据 → `/{root}/kv/*.json`，
 * 最后写入 `manifest.json`。账单自动同步仍使用 `EXPO_PUBLIC_GITHUB_BACKUP_PATH` 单文件。
 */
export async function triggerGithubCloudSync(opts?: {
  signal?: AbortSignal;
}): Promise<GithubCloudSyncResult> {
  const cfg = getGitHubBackupConfigFromEnv();
  if (!cfg) {
    const message =
      '未配置 GitHub：请在项目根目录 .env.local 中设置 EXPO_PUBLIC_GITHUB_TOKEN / OWNER / REPO。';
    return {
      ok: false,
      reason: 'no_config',
      message,
      diagnosticText: message,
    };
  }

  const dbProbe = await getDatabase();
  if (!dbProbe) {
    const message = '当前环境无本地 SQLite（例如 Web），无法执行全量备份。';
    return { ok: false, reason: 'unsupported_platform', message, diagnosticText: message };
  }

  const root = getGitHubFullBackupRootFromEnv();
  const lastUpdated = new Date().toISOString();

  let dbSchemaVersion: number | null;
  let sqlite: Record<string, unknown[]>;
  let sqliteTableErrors: Record<string, string>;
  let memos: Awaited<ReturnType<typeof listMemos>>;
  let userWeaknesses: Awaited<ReturnType<typeof listUserWeaknesses>>;
  let userSkills: Awaited<ReturnType<typeof loadUserSkills>>;
  let weeklyReviewWeekday: number | null;
  let aiLlmProviderId: Awaited<ReturnType<typeof loadAiLlmProviderPreference>>;

  try {
    [
      dbSchemaVersion,
      { sqlite, sqliteTableErrors },
      memos,
      userWeaknesses,
      userSkills,
      weeklyReviewWeekday,
      aiLlmProviderId,
    ] = await Promise.all([
      getSchemaVersion(),
      collectAllSqliteTableSnapshots(),
      listMemos(),
      listUserWeaknesses(),
      loadUserSkills(),
      getWeeklyReviewConfiguredWeekday(),
      loadAiLlmProviderPreference(),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const message = `读取本地数据失败：${msg}`;
    return {
      ok: false,
      reason: 'collect_failed',
      message,
      diagnosticText: [message, '', '----- 异常详情 -----', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  let specs: MultiFileUploadSpec[];
  try {
    specs = buildMultiFileFullBackupSpecs(root, {
      lastUpdated,
      dbSchemaVersion,
      sqlite,
      sqliteTableErrors,
      memos,
      userWeaknesses,
      userSkills,
      weeklyReviewWeekday,
      aiLlmProviderId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const message = `构建备份文件失败：${msg}`;
    return {
      ok: false,
      reason: 'collect_failed',
      message,
      diagnosticText: [message, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  if (opts?.signal?.aborted) {
    const message = '备份在读取本地数据完成后被中止（例如进入后台）';
    return { ok: false, reason: 'aborted', message, diagnosticText: message };
  }

  const r = await uploadGithubBackupMultiFiles(cfg, specs, { signal: opts?.signal });
  if (!r.ok) return r;
  await setLastFullGithubBackupAtIso(lastUpdated);
  clearAllGithubSqliteDirtyTables();
  return {
    ok: true,
    upload: r.upload,
    multiFileBackup: { root, fileCount: specs.length },
    lastFullBackupAt: lastUpdated,
  };
}

/**
 * 将脏 SQLite 表与 manifest 中已登记的 KV 切片增量写入 GitHub。
 * 依赖仓库中已存在可解析的全量 manifest；财务相关表仍走 `scheduleGithubFinanceCloudSyncDebounced`。
 */
export async function pushGithubIncrementalCloudDirtyToCloudIfNeeded(): Promise<void> {
  if (isSilentGithubCloudRestoreInFlight()) {
    scheduleGithubIncrementalCloudPushDebounced();
    return;
  }

  const dirtyList = peekGithubSqliteDirtyTables();
  const dirtyKvList = peekGithubKvDirtySlices();
  if (dirtyList.length === 0 && dirtyKvList.length === 0) return;

  const cfg = getGitHubBackupConfigFromEnv();
  if (!cfg) return;

  const db = await getDatabase();
  if (!db) return;

  const envRoot = getGitHubFullBackupRootFromEnv();
  const manifestRelPath = `${envRoot.replace(/^\/+/, '')}/manifest.json`;
  const manMgr = new GitHubBackupManager({ ...cfg, path: manifestRelPath });
  const manRes = await manMgr.downloadUtf8Text();
  if (!manRes.ok) {
    if (__DEV__) {
      console.warn('[github incremental] manifest 下载失败，跳过增量上传：', manRes.message);
    }
    return;
  }

  let manifest;
  try {
    manifest = parseGithubAppBackupManifestV1(manRes.text);
  } catch (e) {
    if (__DEV__) {
      console.warn('[github incremental] manifest 解析失败', e);
    }
    return;
  }

  const backupRoot = manifest.backupRoot.replace(/^\/+/, '').replace(/\/+$/, '');

  if (manifest.bundledDbVersion != null && manifest.bundledDbVersion > DB_VERSION) {
    if (__DEV__) console.warn('[github incremental] 云端 bundledDbVersion 高于本应用，跳过增量上传');
    return;
  }

  const dirty = new Set(dirtyList);
  const dirtyKv = new Set(dirtyKvList);
  const lastUpdated = new Date().toISOString();

  let dbSchemaVersion: number | null;
  try {
    dbSchemaVersion = await getSchemaVersion();
  } catch {
    dbSchemaVersion = null;
  }

  const sqliteTableErrors: Record<string, string> = { ...(manifest.sqliteTableErrors ?? {}) };
  for (const t of dirty) {
    delete sqliteTableErrors[t];
  }

  const manifestJsonPath = `${backupRoot}/manifest.json`;
  const lastFullBackupPath = `${backupRoot}/last-full-backup.json`;

  let manifestFiles = filterManifestFilesRemovingSqliteTables(manifest.files, dirty);
  manifestFiles = filterManifestFilesRemovingKvSlices(manifestFiles, dirtyKv);
  manifestFiles = manifestFiles.filter(f => f.path !== manifestJsonPath && f.path !== lastFullBackupPath);

  const specs: MultiFileUploadSpec[] = [];
  const pushedTables = new Set<string>();

  for (const table of [...dirty].sort()) {
    const safe = table.replace(/"/g, '""');
    try {
      const rows = (await db.getAllAsync(`SELECT * FROM "${safe}"`)) as unknown[];
      const built = buildSqliteTableUploadPieces(backupRoot, table, lastUpdated, rows);
      if (!built.ok) {
        sqliteTableErrors[table] = built.error;
        continue;
      }
      pushedTables.add(table);
      for (const p of built.pieces) {
        specs.push({ path: p.path, body: p.body, commitSuffix: p.commitSuffix });
        manifestFiles.push({
          path: p.path,
          kind: 'sqlite',
          name: table,
          rowCount: p.manifestRowCount,
        });
      }
    } catch (e) {
      sqliteTableErrors[table] = e instanceof Error ? e.message : String(e);
    }
  }

  const pushedKv = new Set<string>();
  for (const key of [...dirtyKv].sort()) {
    try {
      const { spec, manifestEntry } = await buildKvSliceUploadSpec(backupRoot, lastUpdated, key);
      specs.push(spec);
      manifestFiles.push(manifestEntry);
      pushedKv.add(key);
    } catch (e) {
      if (__DEV__) {
        console.warn(`[github incremental] KV「${key}」构建失败`, e);
      }
    }
  }

  if (pushedTables.size === 0 && pushedKv.size === 0) {
    if (__DEV__) {
      console.warn('[github incremental] 没有成功构建的脏表或 KV 切片，跳过上传（将稍后重试）');
    }
    scheduleGithubIncrementalCloudPushDebounced();
    return;
  }

  const lastFullBackupBody = JSON.stringify(
    {
      schema: 'full-backup-timestamp/v1' as const,
      lastFullBackupAt: lastUpdated,
    },
    null,
    2,
  );

  manifestFiles.push({ path: lastFullBackupPath, kind: 'meta', name: 'last_full_backup' });

  const manifestBody = JSON.stringify(
    {
      schema: 'app-backup-manifest/v1' as const,
      lastUpdated,
      lastFullBackupAt: lastUpdated,
      bundledDbVersion: DB_VERSION,
      dbSchemaVersion,
      backupRoot,
      files: manifestFiles,
      ...(Object.keys(sqliteTableErrors).length > 0 ? { sqliteTableErrors } : {}),
    },
    null,
    2,
  );

  if (utf8ByteLength(manifestBody) > MAX_GITHUB_SQLITE_JSON_UTF8_BYTES) {
    if (__DEV__) {
      console.warn('[github incremental] manifest 体积过大，跳过上传');
    }
    scheduleGithubIncrementalCloudPushDebounced();
    return;
  }

  specs.push({
    path: lastFullBackupPath,
    body: lastFullBackupBody,
    commitSuffix: 'last-full-backup.json',
  });
  specs.push({
    path: manifestJsonPath,
    body: manifestBody,
    commitSuffix: 'manifest.json',
  });

  const r = await uploadGithubBackupMultiFiles(cfg, specs, {});
  if (!r.ok) {
    if (__DEV__) {
      console.warn('[github incremental] 上传失败', r.message);
    }
    scheduleGithubIncrementalCloudPushDebounced();
    return;
  }

  await setLastFullGithubBackupAtIso(lastUpdated);
  clearGithubSqliteDirtyTables(pushedTables);
  clearGithubKvDirtySlices(pushedKv);
}

let financeBackupDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 账单变更后调用：合并多次操作为一次上传，避免频繁打 GitHub API */
export function scheduleGithubFinanceCloudSyncDebounced(delayMs = 4000): void {
  if (financeBackupDebounceTimer) {
    clearTimeout(financeBackupDebounceTimer);
  }
  financeBackupDebounceTimer = setTimeout(() => {
    financeBackupDebounceTimer = null;
    void triggerGithubFinanceCloudSync().then(result => {
      if (__DEV__ && !result.ok) {
        console.warn('[github cloud sync]', result.diagnosticText);
      }
    });
  }, delayMs);
}
