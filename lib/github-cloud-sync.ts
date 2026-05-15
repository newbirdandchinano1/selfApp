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
import type {
  FinanceAccountBalanceRow,
  FinanceFlowCategoryRow,
  FinanceTransactionRow,
} from '@/lib/repositories/finance/finance.types';

function serializeErrorForDiagnostic(err: unknown): string {
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
    }
  | {
      ok: false;
      reason: 'no_config' | 'collect_failed' | 'upload_failed';
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

async function uploadGithubBackupWithConfig(
  cfg: GitHubBackupConfig,
  json: string,
  commitMessage: string,
): Promise<GithubCloudSyncResult> {
  const manager = new GitHubBackupManager(cfg);
  const upload = await manager.uploadBackup(json, { message: commitMessage });
  if (upload.ok) {
    return { ok: true, upload };
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
): Promise<GithubCloudSyncResult> {
  let lastOk: Extract<GitHubBackupUploadResult, { ok: true }> | null = null;
  const donePaths: string[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const manager = new GitHubBackupManager({ ...baseCfg, path: spec.path });
    const upload = await manager.uploadBackup(spec.body, {
      message: `备份 ${spec.commitSuffix}`,
    });
    if (!upload.ok) {
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
    kind: 'sqlite' | 'kv';
    name: string;
    rowCount?: number;
  }[] = [];

  const tableNames = Object.keys(sqlite).sort();
  for (const table of tableNames) {
    const rows = sqlite[table] ?? [];
    const body = JSON.stringify(
      {
        schema: 'sqlite-table-dump/v1' as const,
        table,
        lastUpdated,
        rowCount: rows.length,
        rows,
      },
      null,
      2,
    );
    const path = `${root}/sqlite/${table}.json`;
    specs.push({ path, body, commitSuffix: `sqlite/${table}.json` });
    manifestFiles.push({ path, kind: 'sqlite', name: table, rowCount: rows.length });
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
    const path = `${root}/kv/${kv.name}.json`;
    specs.push({ path, body, commitSuffix: `kv/${kv.name}.json` });
    manifestFiles.push({
      path,
      kind: 'kv',
      name: kv.name,
      ...(kv.rowCount != null ? { rowCount: kv.rowCount } : {}),
    });
  }

  const manifestBody = JSON.stringify(
    {
      schema: 'app-backup-manifest/v1' as const,
      lastUpdated,
      bundledDbVersion: DB_VERSION,
      dbSchemaVersion,
      backupRoot: root,
      files: manifestFiles,
      ...(Object.keys(sqliteTableErrors).length > 0 ? { sqliteTableErrors } : {}),
    },
    null,
    2,
  );

  specs.push({
    path: `${root}/manifest.json`,
    body: manifestBody,
    commitSuffix: 'manifest.json',
  });

  return specs;
}

/** 仅账单：供财务页防抖自动同步，避免每次改账都上传整库 */
export async function triggerGithubFinanceCloudSync(): Promise<GithubCloudSyncResult> {
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

  return uploadGithubBackupWithConfig(cfg, json, `账单云备份 ${new Date().toISOString()}`);
}

/**
 * 全量备份：每张 SQLite 表 → `/{root}/sqlite/{表名}.json`，AsyncStorage 类数据 → `/{root}/kv/*.json`，
 * 最后写入 `manifest.json`。账单自动同步仍使用 `EXPO_PUBLIC_GITHUB_BACKUP_PATH` 单文件。
 */
export async function triggerGithubCloudSync(): Promise<GithubCloudSyncResult> {
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

  const specs = buildMultiFileFullBackupSpecs(root, {
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

  const r = await uploadGithubBackupMultiFiles(cfg, specs);
  if (!r.ok) return r;
  return {
    ok: true,
    upload: r.upload,
    multiFileBackup: { root, fileCount: specs.length },
  };
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
