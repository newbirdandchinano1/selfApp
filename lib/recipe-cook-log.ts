import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import { makeTimestampEntityId } from '@/lib/entity-id';

export type RecipeCookLog = {
  id: string;
  recipeId: string;
  /** ISO 时间 */
  cookedAt: string;
  /** 1～5 星 */
  rating: number;
  note?: string;
};

export type RecipeCookLogStore = {
  version: 1;
  logs: RecipeCookLog[];
};

function emptyStore(): RecipeCookLogStore {
  return { version: 1, logs: [] };
}

function clampRating(n: unknown): number | null {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN;
  if (!Number.isFinite(v)) return null;
  const r = Math.round(v);
  if (r < 1 || r > 5) return null;
  return r;
}

function parseStore(raw: unknown): RecipeCookLogStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyStore();
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.logs)) return emptyStore();
  const logs: RecipeCookLog[] = [];
  for (const row of o.logs) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    const recipeId = typeof r.recipeId === 'string' ? r.recipeId.trim() : '';
    const cookedAt = typeof r.cookedAt === 'string' ? r.cookedAt.trim() : '';
    const rating = clampRating(r.rating);
    const note = typeof r.note === 'string' ? r.note.trim() : '';
    if (!id || !recipeId || !cookedAt || rating == null) continue;
    logs.push({
      id,
      recipeId,
      cookedAt,
      rating,
      ...(note ? { note: note.length > 200 ? note.slice(0, 200) : note } : {}),
    });
  }
  return { version: 1, logs };
}

async function persist(store: RecipeCookLogStore): Promise<void> {
  await setAppSetting(AppSettingKey.recipeCookLogs, store);
}

export async function loadRecipeCookLogStore(): Promise<RecipeCookLogStore> {
  const raw = await getAppSetting<unknown>(AppSettingKey.recipeCookLogs);
  return parseStore(raw);
}

export function logsForRecipe(store: RecipeCookLogStore, recipeId: string): RecipeCookLog[] {
  const id = recipeId.trim();
  if (!id) return [];
  return store.logs
    .filter(l => l.recipeId === id)
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt));
}

export function averageRating(logs: RecipeCookLog[]): number | null {
  if (logs.length === 0) return null;
  const sum = logs.reduce((acc, l) => acc + l.rating, 0);
  return Math.round((sum / logs.length) * 10) / 10;
}

export async function addRecipeCookLog(input: {
  recipeId: string;
  rating: number;
  note?: string;
  cookedAt?: string;
}): Promise<RecipeCookLog> {
  const recipeId = input.recipeId.trim();
  const rating = clampRating(input.rating);
  if (!recipeId) throw new Error('缺少菜谱');
  if (rating == null) throw new Error('请选择 1～5 星评分');

  const store = await loadRecipeCookLogStore();
  const note = (input.note ?? '').trim();
  const entry: RecipeCookLog = {
    id: makeTimestampEntityId('rcook_', 8),
    recipeId,
    cookedAt: input.cookedAt?.trim() || new Date().toISOString(),
    rating,
    ...(note ? { note: note.length > 200 ? note.slice(0, 200) : note } : {}),
  };
  store.logs.push(entry);
  await persist(store);
  return entry;
}

export function formatCookLogTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatAverageRating(avg: number | null): string {
  if (avg == null) return '暂无评分';
  return avg % 1 === 0 ? `${avg}.0` : String(avg);
}
