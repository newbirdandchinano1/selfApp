import { apiRequest } from '@/lib/api/http';
import { readAppMeta, writeAppMeta } from '@/lib/api-local-bootstrap';
import { getDatabase } from '@/lib/database.native';
import { allowAlignCursor, allowBootstrapDone, shouldSkipSnapshotRow } from '@/lib/sync-apply-core';
import { setSyncChangeCursor } from '@/lib/sync-cursor';

export const BOOTSTRAP_DONE_KEY = 'sync_bootstrap_done_v1';
export const BOOTSTRAP_PHASE_KEY = 'sync_bootstrap_phase_v1';
export const BOOTSTRAP_CURSOR0_KEY = 'sync_bootstrap_cursor0_v1';

export type BootstrapPhase =
  | 'idle' | 'snapshot_streaming' | 'snapshot_complete'
  | 'cursor_aligned' | 'window_pulling' | 'bootstrap_done' | 'failed';

let cachedBootstrapDone: boolean | null = null;

export async function getBootstrapPhase(): Promise<BootstrapPhase> {
  const v = await readAppMeta(BOOTSTRAP_PHASE_KEY);
  return (v as BootstrapPhase) || 'idle';
}
export async function isBootstrapDone(): Promise<boolean> {
  const done = (await readAppMeta(BOOTSTRAP_DONE_KEY)) === '1'
    && (await getBootstrapPhase()) === 'bootstrap_done';
  cachedBootstrapDone = done;
  return done;
}

export function isBootstrapDoneCached(): boolean {
  return cachedBootstrapDone === true;
}

export async function hydrateBootstrapDoneCache(): Promise<void> {
  await isBootstrapDone();
}
async function setPhase(p: BootstrapPhase): Promise<void> {
  await writeAppMeta(BOOTSTRAP_PHASE_KEY, p);
}

type BootstrapPayload = { meta?: { syncCursor?: number; snapshotComplete?: boolean };
  projects?: unknown[]; projectCategories?: unknown[]; tasks?: unknown[];
  taskCategories?: unknown[]; taskItems?: unknown[]; taskExecutionEvents?: unknown[];
  frogCompletionEvents?: unknown[]; pointsWallet?: unknown;
  habits?: unknown[]; habitContexts?: unknown[]; habitCheckIns?: unknown[]; };

type SnapshotMeta = { syncCursor: number; serverTime: string };
type SnapshotPage = { table: string; rows: Record<string, unknown>[]; nextAfter: string | null; done: boolean; meta: { syncCursor: number } };

const SNAPSHOT_TABLES = [
  'tasks', 'task_items', 'habits', 'habit_contexts', 'habit_check_ins',
  'projects', 'project_categories', 'task_categories',
  'frog_completion_events', 'task_execution_events', 'project_completion_logs',
  'schedule_placements', 'schedule_week_axis_snapshot',
  'finance_transactions', 'finance_accounts', 'finance_account_types',
  'finance_flow_categories', 'finance_scheduled_expenses',
  'cash_flow_profile', 'cash_flow_incomes', 'cash_flow_holdings',
  'cash_flow_expense_lines', 'savings_plans', 'savings_plan_deposits',
  'points_wallet', 'points_ledger', 'wish_board_items',
  'memos', 'memo_dimensions', 'tags', 'tag_links',
  'recipe_categories', 'recipe_items',
  'health_records', 'health_daily_targets',
  'daily_review_journal', 'weekly_review_journal', 'monthly_review_journal',
  'review_dimensions', 'review_columns',
];

/** 全量快照：按表分页拉当前数据（无日期过滤），失败则回退到任务域 bootstrap */
async function runFullSnapshot(cursor0: number): Promise<boolean> {
  for (const table of SNAPSHOT_TABLES) {
    let after: string | null = null;
    for (let pages = 0; pages < 500; pages++) {
      const qs = `table=${encodeURIComponent(table)}&limit=200${after ? `&after=${encodeURIComponent(after)}` : ''}&cursor0=${cursor0}`;
      let page: SnapshotPage;
      try {
        page = await apiRequest<SnapshotPage>(`/api/app/sync/snapshot?${qs}`, {
          method: 'GET', skipGlobalLoading: true, perAttemptTimeoutMs: 30_000,
        });
      } catch {
        return false;
      }
      try {
        await applySnapshotTable(table, page.rows ?? []);
      } catch (e) {
        console.warn('[sync-bootstrap] snapshot apply 失败', table, e);
        return false;
      }
      if (page.done) break;
      after = page.nextAfter;
      if (!after) break;
    }
  }
  return true;
}

async function applySnapshotTable(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows || rows.length === 0) {
    await deleteSyncedAbsent(table, new Set());
    return;
  }
  const db = await getDatabase();
  let pkCol = 'id';
  try {
    const info = await db.getAllAsync<{ name: string; pk: number }>(`PRAGMA table_info(\`${table}\`)`);
    const pk = (info ?? []).find((c) => Number(c.pk) === 1);
    if (pk?.name) pkCol = String(pk.name);
  } catch { /* ignore */ }
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(\`${table}\`)`);
  const colSet = new Set((cols ?? []).map((c) => String(c.name)));
  if (!colSet.has('sync_status')) return;
  const hasRev = colSet.has('server_rev');
  for (const row of rows) {
    const pk = String((row as Record<string, unknown>)[pkCol] ?? (row as Record<string, unknown>).id ?? '');
    if (!pk) continue;
    const local = await db.getFirstAsync<{ sync_status: string }>(
      `SELECT sync_status FROM \`${table}\` WHERE \`${pkCol}\` = ? LIMIT 1`, [pk],
    );
    // 快照只保护 pending，不做 A/B/C：pending 整行不动
    if (shouldSkipSnapshotRow(!!local, local?.sync_status)) continue;
    const keys = Object.keys(row).filter((k) => k !== 'sync_status' && k !== 'last_pushed_mutation_id');
    if (!keys.includes(pkCol)) continue;
    const placeholders = keys.map(() => '?').join(',');
    const vals = keys.map((k) => (row as Record<string, unknown>)[k] ?? null);
    const updates = keys.filter((k) => k !== pkCol).map((k) => `\`${k}\`=excluded.\`${k}\``).join(',');
    const extra = `, \`sync_status\`='synced'` + (hasRev ? `, \`server_rev\`=COALESCE(excluded.\`server_rev\`, \`server_rev\`)` : '');
    if (!updates && !extra) continue;
    await db.runAsync(
      `INSERT INTO \`${table}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders}) ON CONFLICT(\`${pkCol}\`) DO UPDATE SET ${updates}${extra}`,
      vals,
    );
  }
  const pkSet = new Set(rows.map((r) => String((r as Record<string, unknown>)[pkCol] ?? (r as Record<string, unknown>).id ?? '')));
  await deleteSyncedAbsent(table, pkSet, pkCol);
}

async function deleteSyncedAbsent(table: string, present: Set<string>, pkCol = 'id'): Promise<void> {
  const db = await getDatabase();
  try {
    const locals = await db.getAllAsync<{ pk: string }>(
      `SELECT \`${pkCol}\` AS pk FROM \`${table}\` WHERE sync_status = 'synced'`,
    );
    for (const r of locals ?? []) {
      if (!present.has(String(r.pk))) {
        await db.runAsync(`DELETE FROM \`${table}\` WHERE \`${pkCol}\` = ?`, [String(r.pk)]);
      }
    }
  } catch { /* 表不存在则跳过 */ }
}

let bootstrapInFlight: Promise<boolean> | null = null;

async function finishWindowPullAndDone(): Promise<boolean> {
  await setPhase('window_pulling');
  try {
    const { pullChanges } = await import('@/lib/sync-manager');
    const res = await pullChanges();
    if (!allowBootstrapDone({
      snapshotComplete: true,
      cursorAligned: true,
      windowPullSucceeded: true,
      needFullSync: res.needFullSync,
    })) {
      await setPhase('failed');
      return false;
    }
  } catch (e) {
    await setPhase('failed');
    console.warn('[sync-bootstrap] window pull 失败', e);
    return false;
  }
  await writeAppMeta(BOOTSTRAP_DONE_KEY, '1');
  await setPhase('bootstrap_done');
  cachedBootstrapDone = true;
  return true;
}

/** snapshotComplete 之后才允许 SET cursor，再抽干 window pull 才 bootstrap_done */
async function alignCursorThenPull(cursor0: number): Promise<boolean> {
  if (!allowAlignCursor(true)) {
    await setPhase('failed');
    return false;
  }
  await setPhase('snapshot_complete');
  await writeAppMeta(BOOTSTRAP_CURSOR0_KEY, String(Math.floor(cursor0)));
  await setSyncChangeCursor(Math.floor(cursor0));
  await setPhase('cursor_aligned');
  return finishWindowPullAndDone();
}

/** Phase 3 四段闸门：snapshotComplete → SET cursor=cursor0 → pull → bootstrap_done */
export async function runBootstrapGate(opts?: { signal?: AbortSignal }): Promise<boolean> {
  if (bootstrapInFlight) return bootstrapInFlight;
  bootstrapInFlight = (async () => {
    await setPhase('snapshot_streaming');
    // 会话开始：cursor0 读一次，后续分页原样回传
    let cursor0 = NaN;
    try {
      const meta = await apiRequest<SnapshotMeta>('/api/app/sync/snapshot-meta', {
        method: 'GET', skipGlobalLoading: true, perAttemptTimeoutMs: 15_000, signal: opts?.signal as never,
      });
      cursor0 = Number(meta?.syncCursor ?? NaN);
    } catch {
      cursor0 = NaN;
    }
    if (Number.isFinite(cursor0) && (cursor0 as number) >= 0) {
      const ok = await runFullSnapshot(Math.floor(cursor0 as number));
      if (ok) return alignCursorThenPull(Math.floor(cursor0 as number));
    }
    // 回退：任务域 bootstrap（旧服务端无 snapshot 接口时）
    let payload: BootstrapPayload;
    try {
      payload = await apiRequest<BootstrapPayload>('/api/app/pages/tasks', {
        method: 'GET', skipGlobalLoading: true, perAttemptTimeoutMs: 30_000, signal: opts?.signal as never,
      });
    } catch (e) {
      await setPhase('failed');
      console.warn('[sync-bootstrap] snapshot 拉取失败', e);
      return false;
    }
    const fallbackCursor0 = Number(payload?.meta?.syncCursor ?? NaN);
    const complete = payload?.meta?.snapshotComplete === true;
    if (!allowAlignCursor(complete) || !Number.isFinite(fallbackCursor0) || fallbackCursor0 < 0) {
      await setPhase('failed');
      console.warn('[sync-bootstrap] snapshot 未完成，拒绝写 cursor/done');
      return false;
    }
    const tables: Array<[string, unknown[]]> = [
      ['projects', payload.projects ?? []], ['project_categories', payload.projectCategories ?? []],
      ['tasks', payload.tasks ?? []], ['task_categories', payload.taskCategories ?? []],
      ['task_items', payload.taskItems ?? []], ['habits', payload.habits ?? []],
      ['habit_contexts', payload.habitContexts ?? []], ['habit_check_ins', payload.habitCheckIns ?? []],
    ];
    try {
      for (const [t, rows] of tables) {
        await applySnapshotTable(t, rows as Record<string, unknown>[]);
      }
    } catch (e) {
      await setPhase('failed');
      console.warn('[sync-bootstrap] snapshot apply 失败', e);
      return false;
    }
    return alignCursorThenPull(Math.floor(fallbackCursor0));
  })();
  try {
    return await bootstrapInFlight;
  } finally {
    bootstrapInFlight = null;
  }
}

export async function bootstrapIfNeeded(opts?: { signal?: AbortSignal }): Promise<boolean> {
  if (await isBootstrapDone()) return true;
  const phase = await getBootstrapPhase();
  if (phase === 'failed' || phase === 'idle') return runBootstrapGate(opts);
  // window_pulling 失败重试：cursor 已是 cursor0，只重试 pull
  if (phase === 'window_pulling' || phase === 'cursor_aligned') {
    return finishWindowPullAndDone();
  }
  return runBootstrapGate(opts);
}

/** needFullSync → bootstrap（禁止把 cursor 先跳到 max；禁止另开 /sync/full） */
export async function handleNeedFullSync(): Promise<boolean> {
  cachedBootstrapDone = false;
  await writeAppMeta(BOOTSTRAP_DONE_KEY, '');
  return runBootstrapGate();
}
