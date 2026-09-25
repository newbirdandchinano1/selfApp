import { getDatabase } from '@/lib/database';

export type WeightLogRow = {
  id: string;
  recorded_ymd: string;
  weight_kg: number;
  created_at: string;
  updated_at: string;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function localYmdFromDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function weightLogId(ymd: string): string {
  return `wl_${ymd.replace(/-/g, '')}`;
}

function clampWeightKg(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw * 10) / 10;
}

/** 本地表，不同步云端 */
export async function ensureWeightLogsTable(): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS weight_logs (
      id TEXT PRIMARY KEY NOT NULL,
      recorded_ymd TEXT NOT NULL UNIQUE,
      weight_kg REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_weight_logs_ymd ON weight_logs(recorded_ymd);
  `);
}

export async function upsertWeightLog(recordedYmd: string, weightKg: number): Promise<void> {
  const ymd = String(recordedYmd ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
  const kg = clampWeightKg(weightKg);
  if (kg <= 0) return;

  await ensureWeightLogsTable();
  const db = await getDatabase();
  if (!db) return;
  const id = weightLogId(ymd);
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM weight_logs WHERE recorded_ymd = ? LIMIT 1`,
    [ymd],
  );
  if (existing) {
    await db.runAsync(
      `UPDATE weight_logs SET weight_kg = ?, updated_at = datetime('now') WHERE recorded_ymd = ?`,
      [kg, ymd],
    );
    return;
  }
  await db.runAsync(
    `INSERT INTO weight_logs (id, recorded_ymd, weight_kg, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [id, ymd, kg],
  );
}

export async function listWeightLogsBetween(
  startYmd: string,
  endYmd: string,
): Promise<WeightLogRow[]> {
  await ensureWeightLogsTable();
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<WeightLogRow>(
    `SELECT id, recorded_ymd, weight_kg, created_at, updated_at
     FROM weight_logs
     WHERE recorded_ymd >= ? AND recorded_ymd <= ?
     ORDER BY recorded_ymd ASC`,
    [startYmd, endYmd],
  );
  return rows ?? [];
}

export async function listWeightLogsLastNDays(
  n: number,
  endYmd?: string,
): Promise<WeightLogRow[]> {
  const end = endYmd && /^\d{4}-\d{2}-\d{2}$/.test(endYmd) ? endYmd : localYmdFromDate();
  const [y, m, d] = end.split('-').map(Number);
  const endDate = new Date(y, (m ?? 1) - 1, d ?? 1);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - Math.max(1, Math.floor(n)) + 1);
  const startYmd = localYmdFromDate(startDate);
  return listWeightLogsBetween(startYmd, end);
}

export async function getLatestWeightLog(): Promise<WeightLogRow | null> {
  await ensureWeightLogsTable();
  const db = await getDatabase();
  if (!db) return null;
  return db.getFirstAsync<WeightLogRow>(
    `SELECT id, recorded_ymd, weight_kg, created_at, updated_at
     FROM weight_logs
     ORDER BY recorded_ymd DESC
     LIMIT 1`,
  );
}
