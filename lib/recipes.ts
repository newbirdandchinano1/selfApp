import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '@/lib/database';
import {
    beginCloudSqliteDirtyIgnoreBatch,
    endCloudSqliteDirtyIgnoreBatch,
    markCloudSqliteTableDirty,
} from '@/lib/cloud-sql-dirty-track';
import { persistRecipeFinishedImage } from '@/lib/recipe-finished-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as SQLite from 'expo-sqlite';

const RECIPE_STORE_KEY = 'recipe_store_v2';
const LEGACY_RECIPE_LIST_KEY = 'recipe_list_v1';
const RECIPES_SQLITE_MIGRATED_KEY = 'recipes_sqlite_migrated_v1';

export const RECIPE_TITLE_MAX = 120;
export const RECIPE_NOTES_MAX = 2000;
export const CATEGORY_NAME_MAX = 40;

export type RecipeCategory = {
  id: string;
  name: string;
  created_at: string;
};

export type RecipeItem = {
  id: string;
  category_id: string;
  title: string;
  ingredients: string[];
  steps: string[];
  notes?: string;
  finished_image_uri?: string;
  created_at: string;
  updated_at: string;
};

export type RecipeStore = {
  version: 2;
  categories: RecipeCategory[];
  recipes: RecipeItem[];
};

type CategoryRow = {
  id: string;
  name: string;
  created_at: string;
};

type RecipeRow = {
  id: string;
  category_id: string;
  title: string;
  ingredients_json: string;
  steps_json: string;
  notes: string | null;
  finished_image_uri: string | null;
  created_at: string;
  updated_at: string;
};

function newId(prefix: string): string {
  return makeTimestampEntityId(`${prefix}_`, 9);
}

function clampTitle(t: string): string {
  return t.length > RECIPE_TITLE_MAX ? t.slice(0, RECIPE_TITLE_MAX) : t;
}

function clampCategoryName(t: string): string {
  const s = t.trim();
  return s.length > CATEGORY_NAME_MAX ? s.slice(0, CATEGORY_NAME_MAX) : s;
}

function clampNotes(t: string): string {
  return t.length > RECIPE_NOTES_MAX ? t.slice(0, RECIPE_NOTES_MAX) : t;
}

function normalizeLineArray(raw: unknown, legacyText?: string): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const x of raw) {
      if (typeof x !== 'string') continue;
      const t = x.trim();
      if (!t) continue;
      out.push(t.length > 200 ? t.slice(0, 200) : t);
      if (out.length >= 80) break;
    }
    return out;
  }
  if (typeof legacyText === 'string' && legacyText.trim()) {
    return legacyText
      .split(/\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 80);
  }
  return [];
}

function encodeLines(lines: string[]): string {
  return JSON.stringify(normalizeLineArray(lines));
}

function decodeLines(json: string | null | undefined, legacyText?: string): string[] {
  if (json != null && json !== '') {
    try {
      const parsed = JSON.parse(json) as unknown;
      return normalizeLineArray(parsed);
    } catch {
      /* fall through */
    }
  }
  return normalizeLineArray(undefined, legacyText);
}

function rowToCategory(row: CategoryRow): RecipeCategory {
  return { id: row.id, name: row.name, created_at: row.created_at };
}

function rowToRecipe(row: RecipeRow): RecipeItem {
  return {
    id: row.id,
    category_id: row.category_id,
    title: row.title,
    ingredients: decodeLines(row.ingredients_json),
    steps: decodeLines(row.steps_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.notes?.trim() ? { notes: row.notes.trim() } : {}),
    ...(row.finished_image_uri?.trim() ? { finished_image_uri: row.finished_image_uri.trim() } : {}),
  };
}

function markRecipesDirty(): void {
  markCloudSqliteTableDirty('recipe_categories');
  markCloudSqliteTableDirty('recipe_items');
}

async function loadStoreFromDb(db: SQLite.SQLiteDatabase): Promise<RecipeStore> {
  const categories = await db.getAllAsync<CategoryRow>(
    `SELECT id, name, created_at FROM recipe_categories
     WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  );
  const recipes = await db.getAllAsync<RecipeRow>(
    `SELECT id, category_id, title, ingredients_json, steps_json, notes, finished_image_uri, created_at, updated_at
     FROM recipe_items WHERE deleted_at IS NULL`,
  );
  return {
    version: 2,
    categories: categories.map(rowToCategory),
    recipes: recipes.map(rowToRecipe),
  };
}

function parseLegacyRecipeRow(row: Record<string, unknown>): RecipeItem | null {
  const id = typeof row.id === 'string' ? row.id : '';
  const title = typeof row.title === 'string' ? row.title : '';
  const ingredientsText = typeof row.ingredients === 'string' ? row.ingredients : '';
  const stepsText = typeof row.steps === 'string' ? row.steps : '';
  const notes = typeof row.notes === 'string' ? row.notes : undefined;
  const created_at = typeof row.created_at === 'string' ? row.created_at : '';
  const updated_at = typeof row.updated_at === 'string' ? row.updated_at : '';
  const finished_image_uri =
    typeof row.finished_image_uri === 'string' && row.finished_image_uri.trim()
      ? row.finished_image_uri.trim()
      : undefined;
  if (!id || !created_at || !updated_at) return null;
  return {
    id,
    category_id: typeof row.category_id === 'string' ? row.category_id : '',
    title,
    ingredients: normalizeLineArray(row.ingredients, ingredientsText),
    steps: normalizeLineArray(row.steps, stepsText),
    created_at,
    updated_at,
    ...(notes?.trim() ? { notes: clampNotes(notes.trim()) } : {}),
    ...(finished_image_uri ? { finished_image_uri } : {}),
  };
}

function parseStoreFromAsyncJson(raw: string | null): RecipeStore | null {
  if (raw == null || raw === '') return null;
  try {
    const x = JSON.parse(raw) as unknown;
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const o = x as Record<string, unknown>;
      if (o.version !== 2) return null;
      const categories: RecipeCategory[] = [];
      if (Array.isArray(o.categories)) {
        for (const row of o.categories) {
          if (!row || typeof row !== 'object') continue;
          const r = row as Record<string, unknown>;
          const id = typeof r.id === 'string' ? r.id : '';
          const name = typeof r.name === 'string' ? clampCategoryName(r.name) : '';
          const created_at = typeof r.created_at === 'string' ? r.created_at : '';
          if (!id || !name || !created_at) continue;
          categories.push({ id, name, created_at });
        }
      }
      const recipes: RecipeItem[] = [];
      if (Array.isArray(o.recipes)) {
        for (const row of o.recipes) {
          if (!row || typeof row !== 'object') continue;
          const parsed = parseLegacyRecipeRow(row as Record<string, unknown>);
          if (parsed?.category_id) recipes.push(parsed);
        }
      }
      return { version: 2, categories, recipes };
    }
    if (Array.isArray(x)) {
      const legacyRecipes: RecipeItem[] = [];
      for (const row of x) {
        if (!row || typeof row !== 'object') continue;
        const parsed = parseLegacyRecipeRow(row as Record<string, unknown>);
        if (parsed) legacyRecipes.push(parsed);
      }
      if (legacyRecipes.length === 0) return { version: 2, categories: [], recipes: [] };
      const now = new Date().toISOString();
      const defaultCat: RecipeCategory = { id: newId('rcat'), name: '未分类', created_at: now };
      return {
        version: 2,
        categories: [defaultCat],
        recipes: legacyRecipes.map(r => ({ ...r, category_id: defaultCat.id })),
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function readAsyncStorageStore(): Promise<RecipeStore | null> {
  const v2 = await AsyncStorage.getItem(RECIPE_STORE_KEY);
  const fromV2 = parseStoreFromAsyncJson(v2);
  if (fromV2) return fromV2;
  const legacy = await AsyncStorage.getItem(LEGACY_RECIPE_LIST_KEY);
  return parseStoreFromAsyncJson(legacy);
}

async function importStoreToDb(db: SQLite.SQLiteDatabase, store: RecipeStore): Promise<void> {
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.execAsync('BEGIN IMMEDIATE');
    await db.runAsync('DELETE FROM recipe_items');
    await db.runAsync('DELETE FROM recipe_categories');
    const now = new Date().toISOString();
    for (const cat of store.categories) {
      const ts = cat.created_at || now;
      await db.runAsync(
        `INSERT INTO recipe_categories (id, name, created_at, updated_at, deleted_at, sync_status, version)
         VALUES (?, ?, ?, ?, NULL, 'synced', 1)`,
        [cat.id, cat.name, ts, ts],
      );
    }
    for (const item of store.recipes) {
      if (!store.categories.some(c => c.id === item.category_id)) continue;
      await db.runAsync(
        `INSERT INTO recipe_items (
          id, category_id, title, ingredients_json, steps_json, notes, finished_image_uri,
          created_at, updated_at, deleted_at, sync_status, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 1)`,
        [
          item.id,
          item.category_id,
          clampTitle(item.title),
          encodeLines(item.ingredients),
          encodeLines(item.steps),
          item.notes?.trim() ? clampNotes(item.notes.trim()) : null,
          item.finished_image_uri ?? null,
          item.created_at,
          item.updated_at,
        ],
      );
    }
    await db.execAsync('COMMIT');
  } catch (e) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}

/** 启动时：将 AsyncStorage 中的菜谱一次性迁入 SQLite */
export async function migrateRecipesStorageToSqliteIfNeeded(
  db?: SQLite.SQLiteDatabase,
): Promise<void> {
  const database = db ?? (await getDatabase());
  const flag = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    [RECIPES_SQLITE_MIGRATED_KEY],
  );
  if (flag?.value === '1') return;

  const catCount = await database.getFirstAsync<{ c: number }>(
    'SELECT COUNT(1) AS c FROM recipe_categories WHERE deleted_at IS NULL',
  );
  const recipeCount = await database.getFirstAsync<{ c: number }>(
    'SELECT COUNT(1) AS c FROM recipe_items WHERE deleted_at IS NULL',
  );
  const hasSqliteData = Number(catCount?.c ?? 0) > 0 || Number(recipeCount?.c ?? 0) > 0;

  if (!hasSqliteData) {
    const asyncStore = await readAsyncStorageStore();
    if (asyncStore && (asyncStore.categories.length > 0 || asyncStore.recipes.length > 0)) {
      await importStoreToDb(database, asyncStore);
    }
  }

  await AsyncStorage.multiRemove([RECIPE_STORE_KEY, LEGACY_RECIPE_LIST_KEY]);
  await database.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
    RECIPES_SQLITE_MIGRATED_KEY,
    '1',
  ]);
}

export function recipeStoreFromBackupPayload(payload: unknown): RecipeStore {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    if (o.version === 2) {
      const categories: RecipeCategory[] = [];
      if (Array.isArray(o.categories)) {
        for (const row of o.categories) {
          if (!row || typeof row !== 'object') continue;
          const r = row as Record<string, unknown>;
          const id = typeof r.id === 'string' ? r.id : '';
          const name = typeof r.name === 'string' ? clampCategoryName(r.name) : '';
          const created_at = typeof r.created_at === 'string' ? r.created_at : '';
          if (!id || !name || !created_at) continue;
          categories.push({ id, name, created_at });
        }
      }
      const recipes: RecipeItem[] = [];
      if (Array.isArray(o.recipes)) {
        for (const row of o.recipes) {
          if (!row || typeof row !== 'object') continue;
          const parsed = parseLegacyRecipeRow(row as Record<string, unknown>);
          if (parsed?.category_id) recipes.push(parsed);
        }
      }
      return { version: 2, categories, recipes };
    }
  }
  if (Array.isArray(payload)) {
    const legacyRecipes: RecipeItem[] = [];
    for (const row of payload) {
      if (!row || typeof row !== 'object') continue;
      const parsed = parseLegacyRecipeRow(row as Record<string, unknown>);
      if (parsed) legacyRecipes.push(parsed);
    }
    if (legacyRecipes.length === 0) return { version: 2, categories: [], recipes: [] };
    const now = new Date().toISOString();
    const defaultCat: RecipeCategory = { id: newId('rcat'), name: '未分类', created_at: now };
    return {
      version: 2,
      categories: [defaultCat],
      recipes: legacyRecipes.map(r => ({ ...r, category_id: defaultCat.id })),
    };
  }
  return { version: 2, categories: [], recipes: [] };
}

/** @deprecated 兼容旧导入名 */
export function recipeItemsFromBackupPayload(payload: unknown): RecipeItem[] {
  return recipeStoreFromBackupPayload(payload).recipes;
}

export async function loadRecipeStore(): Promise<RecipeStore> {
  const db = await getDatabase();
  await migrateRecipesStorageToSqliteIfNeeded(db);
  return loadStoreFromDb(db);
}

export async function replaceRecipesFromCloudRestore(payload: RecipeStore | RecipeItem[]): Promise<void> {
  const store = Array.isArray(payload) ? recipeStoreFromBackupPayload(payload) : payload;
  const db = await getDatabase();
  await importStoreToDb(db, store);
  markRecipesDirty();
}

export async function listRecipeCategories(): Promise<RecipeCategory[]> {
  const db = await getDatabase();
  await migrateRecipesStorageToSqliteIfNeeded(db);
  const rows = await db.getAllAsync<CategoryRow>(
    `SELECT id, name, created_at FROM recipe_categories
     WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  );
  return rows.map(rowToCategory);
}

export async function listRecipes(categoryId?: string): Promise<RecipeItem[]> {
  const db = await getDatabase();
  await migrateRecipesStorageToSqliteIfNeeded(db);
  const rows = categoryId
    ? await db.getAllAsync<RecipeRow>(
        `SELECT id, category_id, title, ingredients_json, steps_json, notes, finished_image_uri, created_at, updated_at
         FROM recipe_items WHERE deleted_at IS NULL AND category_id = ?`,
        [categoryId],
      )
    : await db.getAllAsync<RecipeRow>(
        `SELECT id, category_id, title, ingredients_json, steps_json, notes, finished_image_uri, created_at, updated_at
         FROM recipe_items WHERE deleted_at IS NULL`,
      );
  return [...rows.map(rowToRecipe)].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getRecipeCategory(id: string): Promise<RecipeCategory | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CategoryRow>(
    `SELECT id, name, created_at FROM recipe_categories WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return row ? rowToCategory(row) : null;
}

export async function getRecipe(id: string): Promise<RecipeItem | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<RecipeRow>(
    `SELECT id, category_id, title, ingredients_json, steps_json, notes, finished_image_uri, created_at, updated_at
     FROM recipe_items WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return row ? rowToRecipe(row) : null;
}

export async function createRecipeCategory(name: string): Promise<RecipeCategory> {
  const trimmed = clampCategoryName(name);
  if (!trimmed) throw new Error('请输入分类名称');
  const db = await getDatabase();
  const dup = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM recipe_categories WHERE deleted_at IS NULL AND name = ? LIMIT 1`,
    [trimmed],
  );
  if (dup) throw new Error('已有同名分类');
  const now = new Date().toISOString();
  const cat: RecipeCategory = { id: newId('rcat'), name: trimmed, created_at: now };
  await db.runAsync(
    `INSERT INTO recipe_categories (id, name, created_at, updated_at, deleted_at, sync_status, version)
     VALUES (?, ?, ?, ?, NULL, 'synced', 1)`,
    [cat.id, cat.name, now, now],
  );
  markRecipesDirty();
  return cat;
}

export async function renameRecipeCategory(id: string, name: string): Promise<RecipeCategory | null> {
  const trimmed = clampCategoryName(name);
  if (!trimmed) throw new Error('请输入分类名称');
  const db = await getDatabase();
  const existing = await db.getFirstAsync<CategoryRow>(
    `SELECT id, name, created_at FROM recipe_categories WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!existing) return null;
  const dup = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM recipe_categories WHERE deleted_at IS NULL AND name = ? AND id != ? LIMIT 1`,
    [trimmed, id],
  );
  if (dup) throw new Error('已有同名分类');
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE recipe_categories SET name = ?, updated_at = ?,
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
      version = version + 1
     WHERE id = ?`,
    [trimmed, now, id],
  );
  markRecipesDirty();
  return { id, name: trimmed, created_at: existing.created_at };
}

export async function deleteRecipeCategory(id: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM recipe_categories WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!row) return false;
  await db.runAsync('DELETE FROM recipe_categories WHERE id = ?', [id]);
  markRecipesDirty();
  return true;
}

export type CreateRecipeInput = {
  category_id: string;
  title: string;
  ingredients: string[];
  steps: string[];
  notes?: string;
  finished_image_uri?: string | null;
};

export async function createRecipe(input: CreateRecipeInput): Promise<RecipeItem> {
  const db = await getDatabase();
  const cat = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM recipe_categories WHERE id = ? AND deleted_at IS NULL`,
    [input.category_id],
  );
  if (!cat) throw new Error('分类不存在');
  const now = new Date().toISOString();
  const id = newId('recipe');
  let imageUri: string | null = null;
  if (input.finished_image_uri?.trim()) {
    imageUri = await persistRecipeFinishedImage(id, input.finished_image_uri);
  }
  const item: RecipeItem = {
    id,
    category_id: input.category_id,
    title: clampTitle(input.title),
    ingredients: normalizeLineArray(input.ingredients),
    steps: normalizeLineArray(input.steps),
    created_at: now,
    updated_at: now,
    ...(input.notes?.trim() ? { notes: clampNotes(input.notes.trim()) } : {}),
    ...(imageUri ? { finished_image_uri: imageUri } : {}),
  };
  await db.runAsync(
    `INSERT INTO recipe_items (
      id, category_id, title, ingredients_json, steps_json, notes, finished_image_uri,
      created_at, updated_at, deleted_at, sync_status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 1)`,
    [
      item.id,
      item.category_id,
      item.title,
      encodeLines(item.ingredients),
      encodeLines(item.steps),
      item.notes ?? null,
      item.finished_image_uri ?? null,
      item.created_at,
      item.updated_at,
    ],
  );
  markRecipesDirty();
  return item;
}

export type UpdateRecipeInput = {
  title?: string;
  ingredients?: string[];
  steps?: string[];
  notes?: string | null;
  finished_image_uri?: string | null;
};

export async function updateRecipe(id: string, patch: UpdateRecipeInput): Promise<RecipeItem | null> {
  const db = await getDatabase();
  const prev = await getRecipe(id);
  if (!prev) return null;

  const title = patch.title !== undefined ? clampTitle(patch.title) : prev.title;
  const ingredients = patch.ingredients !== undefined ? normalizeLineArray(patch.ingredients) : prev.ingredients;
  const steps = patch.steps !== undefined ? normalizeLineArray(patch.steps) : prev.steps;
  const now = new Date().toISOString();

  let notes: string | null = prev.notes ?? null;
  if (patch.notes !== undefined) {
    notes = patch.notes?.trim() ? clampNotes(patch.notes.trim()) : null;
  }

  let finished_image_uri: string | null = prev.finished_image_uri ?? null;
  if (patch.finished_image_uri !== undefined) {
    if (patch.finished_image_uri?.trim()) {
      finished_image_uri = await persistRecipeFinishedImage(id, patch.finished_image_uri);
    } else {
      finished_image_uri = null;
    }
  }

  await db.runAsync(
    `UPDATE recipe_items SET
      title = ?, ingredients_json = ?, steps_json = ?, notes = ?, finished_image_uri = ?, updated_at = ?,
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
      version = version + 1
     WHERE id = ? AND deleted_at IS NULL`,
    [title, encodeLines(ingredients), encodeLines(steps), notes, finished_image_uri, now, id],
  );
  markRecipesDirty();

  const next: RecipeItem = {
    id: prev.id,
    category_id: prev.category_id,
    title,
    ingredients,
    steps,
    created_at: prev.created_at,
    updated_at: now,
  };
  if (notes) next.notes = notes;
  if (finished_image_uri) next.finished_image_uri = finished_image_uri;
  return next;
}

export async function deleteRecipe(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM recipe_items WHERE id = ?', [id]);
  if ((result.changes ?? 0) === 0) return false;
  markRecipesDirty();
  return true;
}

export function recipeListPreviewTitle(row: RecipeItem): string {
  const t = row.title.trim();
  if (t) return t;
  const firstIng = row.ingredients[0]?.trim() ?? '';
  if (firstIng) return firstIng.length > 48 ? `${firstIng.slice(0, 48)}…` : firstIng;
  return '未命名菜谱';
}

export function recipeListPreviewSubtitle(row: RecipeItem): string {
  const parts: string[] = [];
  if (row.steps.length > 0) parts.push(`${row.steps.length} 步`);
  if (row.ingredients.length > 0) parts.push(`${row.ingredients.length} 项食材`);
  if (row.finished_image_uri) parts.push('含成品图');
  return parts.length > 0 ? parts.join(' · ') : '（暂无内容）';
}

export function countRecipesInCategory(store: RecipeStore, categoryId: string): number {
  return store.recipes.filter(r => r.category_id === categoryId).length;
}
