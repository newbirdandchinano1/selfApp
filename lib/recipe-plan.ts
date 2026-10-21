import { getAppSetting, setAppSetting, AppSettingKey } from '@/lib/app-settings-store';
import { makeTimestampEntityId } from '@/lib/entity-id';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type RecipePlanEntry = {
  id: string;
  /** 本地日历日 YYYY-MM-DD */
  date: string;
  slot: MealSlot;
  recipeId: string;
  /** 冗余标题，菜谱删除后仍可显示 */
  recipeTitle: string;
  created_at: string;
};

export type RecipePlanStore = {
  version: 1;
  entries: RecipePlanEntry[];
};

export const MEAL_SLOTS: { key: MealSlot; label: string; short: string }[] = [
  { key: 'breakfast', label: '早餐', short: '早' },
  { key: 'lunch', label: '午餐', short: '午' },
  { key: 'dinner', label: '晚餐', short: '晚' },
  { key: 'snack', label: '加餐', short: '加' },
];

const SLOT_ORDER: Record<MealSlot, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snack: 3,
};

function emptyStore(): RecipePlanStore {
  return { version: 1, entries: [] };
}

function parseStore(raw: unknown): RecipePlanStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyStore();
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.entries)) return emptyStore();
  const entries: RecipePlanEntry[] = [];
  for (const row of o.entries) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    const date = typeof r.date === 'string' ? r.date : '';
    const slot = r.slot as MealSlot;
    const recipeId = typeof r.recipeId === 'string' ? r.recipeId : '';
    const recipeTitle = typeof r.recipeTitle === 'string' ? r.recipeTitle.trim() : '';
    const created_at = typeof r.created_at === 'string' ? r.created_at : '';
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!MEAL_SLOTS.some(s => s.key === slot)) continue;
    if (!recipeId || !recipeTitle || !created_at) continue;
    entries.push({ id, date, slot, recipeId, recipeTitle, created_at });
  }
  return { version: 1, entries };
}

export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function mealSlotLabel(slot: MealSlot): string {
  return MEAL_SLOTS.find(s => s.key === slot)?.label ?? slot;
}

export function mealSlotShort(slot: MealSlot): string {
  return MEAL_SLOTS.find(s => s.key === slot)?.short ?? '';
}

export function sortPlanEntries(entries: RecipePlanEntry[]): RecipePlanEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const so = SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
    if (so !== 0) return so;
    return a.created_at.localeCompare(b.created_at);
  });
}

export async function loadRecipePlanStore(): Promise<RecipePlanStore> {
  const raw = await getAppSetting<unknown>(AppSettingKey.recipeMealPlan);
  return parseStore(raw);
}

async function persist(store: RecipePlanStore): Promise<void> {
  await setAppSetting(AppSettingKey.recipeMealPlan, store);
}

export async function addRecipePlanEntry(input: {
  date: string;
  slot: MealSlot;
  recipeId: string;
  recipeTitle: string;
}): Promise<RecipePlanEntry> {
  const store = await loadRecipePlanStore();
  const title = input.recipeTitle.trim() || '未命名菜谱';
  const dup = store.entries.find(
    e => e.date === input.date && e.slot === input.slot && e.recipeId === input.recipeId,
  );
  if (dup) return dup;

  const now = new Date().toISOString();
  const entry: RecipePlanEntry = {
    id: makeTimestampEntityId('rplan_', 8),
    date: input.date,
    slot: input.slot,
    recipeId: input.recipeId,
    recipeTitle: title.length > 80 ? title.slice(0, 80) : title,
    created_at: now,
  };
  store.entries.push(entry);
  await persist(store);
  return entry;
}

export async function removeRecipePlanEntry(id: string): Promise<boolean> {
  const store = await loadRecipePlanStore();
  const next = store.entries.filter(e => e.id !== id);
  if (next.length === store.entries.length) return false;
  await persist({ version: 1, entries: next });
  return true;
}

/** 某日已安排的条目（按餐次排序） */
export function entriesForDate(store: RecipePlanStore, date: string): RecipePlanEntry[] {
  return sortPlanEntries(store.entries.filter(e => e.date === date));
}

/** 日历格子：取当日最早餐次短标（早/午/晚/加） */
export function daySlotMark(store: RecipePlanStore, date: string): string | null {
  const list = entriesForDate(store, date);
  if (list.length === 0) return null;
  return mealSlotShort(list[0].slot);
}

/** 当月有安排的日期集合 */
export function plannedDatesInMonth(
  store: RecipePlanStore,
  year: number,
  monthIndex: number,
): Set<string> {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
  const out = new Set<string>();
  for (const e of store.entries) {
    if (e.date.startsWith(prefix)) out.add(e.date);
  }
  return out;
}
