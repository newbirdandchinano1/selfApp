import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import type { RecipePlanStore } from '@/lib/recipe-plan';
import type { RecipeItem, RecipeStore } from '@/lib/recipes';
import { recipeListPreviewTitle } from '@/lib/recipes';

export type ShopItemStatus = 'todo' | 'stock' | 'bought';

export type RecipeShopAddedRecipe = {
  recipeId: string;
  /** 冗余标题，菜谱删除后仍可显示来源 */
  recipeTitle: string;
};

export type RecipeShopState = {
  version: 1;
  /** itemKey → 用户覆盖状态 */
  overrides: Record<string, ShopItemStatus>;
  /** 从详情页「加入采购」的菜谱（不依赖用餐计划） */
  addedRecipes: RecipeShopAddedRecipe[];
};

export type ShopListItem = {
  key: string;
  name: string;
  amount: string;
  recipeIds: string[];
  recipeTitles: string[];
  /** 是否常见调料（默认库存） */
  isCommonSeasoning: boolean;
  status: ShopItemStatus;
};

/** 常见调料 / 常备料：默认归入「已有库存」，不进待采购 */
const COMMON_SEASONING_NAMES = [
  '盐',
  '食盐',
  '糖',
  '白糖',
  '冰糖',
  '红糖',
  '酱油',
  '生抽',
  '老抽',
  '醋',
  '香醋',
  '米醋',
  '陈醋',
  '料酒',
  '黄酒',
  '胡椒',
  '胡椒粉',
  '白胡椒',
  '黑胡椒',
  '花椒',
  '八角',
  '大料',
  '桂皮',
  '香叶',
  '干辣椒',
  '辣椒粉',
  '辣椒面',
  '花椒粉',
  '五香粉',
  '十三香',
  '味精',
  '鸡精',
  '蚝油',
  '香油',
  '芝麻油',
  '麻油',
  '淀粉',
  '生粉',
  '玉米淀粉',
  '食用油',
  '油',
  '植物油',
  '菜籽油',
  '花生油',
  '大豆油',
  '橄榄油',
  '色拉油',
  '水',
  '开水',
  '温水',
  '冷水',
];

function emptyState(): RecipeShopState {
  return { version: 1, overrides: {}, addedRecipes: [] };
}

function parseAddedRecipes(raw: unknown): RecipeShopAddedRecipe[] {
  if (!Array.isArray(raw)) return [];
  const out: RecipeShopAddedRecipe[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const recipeId = typeof r.recipeId === 'string' ? r.recipeId.trim() : '';
    const recipeTitle = typeof r.recipeTitle === 'string' ? r.recipeTitle.trim() : '';
    if (!recipeId || seen.has(recipeId)) continue;
    seen.add(recipeId);
    out.push({
      recipeId,
      recipeTitle: recipeTitle || '未命名菜谱',
    });
  }
  return out;
}

function parseState(raw: unknown): RecipeShopState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState();
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return emptyState();
  const overrides: Record<string, ShopItemStatus> = {};
  if (o.overrides && typeof o.overrides === 'object' && !Array.isArray(o.overrides)) {
    for (const [k, v] of Object.entries(o.overrides as Record<string, unknown>)) {
      if (v === 'todo' || v === 'stock' || v === 'bought') overrides[k] = v;
    }
  }
  return {
    version: 1,
    overrides,
    addedRecipes: parseAddedRecipes(o.addedRecipes),
  };
}

export function normalizeShopName(name: string): string {
  return name.trim().replace(/\s+/g, '').toLowerCase();
}

export function shopItemKey(name: string): string {
  return normalizeShopName(name);
}

export function isCommonSeasoning(name: string): boolean {
  const n = normalizeShopName(name);
  if (!n) return false;
  return COMMON_SEASONING_NAMES.some(s => normalizeShopName(s) === n);
}

function mergeAmounts(amounts: string[]): string {
  const cleaned = amounts.map(a => a.trim()).filter(Boolean);
  if (cleaned.length === 0) return '适量';
  const uniq = [...new Set(cleaned)];
  if (uniq.length === 1) return uniq[0];
  return uniq.join('、');
}

type IngredientAcc = {
  name: string;
  amounts: string[];
  recipeIds: Set<string>;
  recipeTitles: Set<string>;
};

function absorbRecipeIngredients(
  byKey: Map<string, IngredientAcc>,
  recipeId: string,
  title: string,
  ingredients: RecipeItem['ingredients'],
) {
  for (const ing of ingredients) {
    const name = ing.name.trim();
    if (!name) continue;
    const key = shopItemKey(name);
    let acc = byKey.get(key);
    if (!acc) {
      acc = { name, amounts: [], recipeIds: new Set(), recipeTitles: new Set() };
      byKey.set(key, acc);
    }
    if (ing.amount.trim()) acc.amounts.push(ing.amount.trim());
    acc.recipeIds.add(recipeId);
    acc.recipeTitles.add(title);
  }
}

/**
 * 从用餐计划 + 详情页「加入采购」+ 菜谱库汇总采购清单。
 * 同名食材合并；常见调料默认 stock，其余默认 todo；用户覆盖优先。
 */
export function buildShopList(
  plan: RecipePlanStore,
  recipes: RecipeStore,
  state: RecipeShopState,
): ShopListItem[] {
  const recipeById = new Map(recipes.recipes.map(r => [r.id, r]));
  const byKey = new Map<string, IngredientAcc>();

  for (const entry of plan.entries) {
    const recipe: RecipeItem | undefined = recipeById.get(entry.recipeId);
    const title = recipe ? recipeListPreviewTitle(recipe) : entry.recipeTitle;
    absorbRecipeIngredients(byKey, entry.recipeId, title, recipe?.ingredients ?? []);
  }

  for (const added of state.addedRecipes) {
    const recipe: RecipeItem | undefined = recipeById.get(added.recipeId);
    const title = recipe ? recipeListPreviewTitle(recipe) : added.recipeTitle;
    absorbRecipeIngredients(byKey, added.recipeId, title, recipe?.ingredients ?? []);
  }

  const items: ShopListItem[] = [];
  for (const [key, acc] of byKey) {
    const common = isCommonSeasoning(acc.name);
    const override = state.overrides[key];
    const status: ShopItemStatus = override ?? (common ? 'stock' : 'todo');
    items.push({
      key,
      name: acc.name,
      amount: mergeAmounts(acc.amounts),
      recipeIds: [...acc.recipeIds],
      recipeTitles: [...acc.recipeTitles],
      isCommonSeasoning: common,
      status,
    });
  }

  return items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export function formatShopSources(item: ShopListItem): string {
  if (item.recipeTitles.length === 0) return '来自：菜单';
  if (item.recipeTitles.length === 1) return `来自：${item.recipeTitles[0]}`;
  if (item.recipeTitles.length === 2) {
    return `来自：${item.recipeTitles[0]}、${item.recipeTitles[1]}`;
  }
  return `来自：${item.recipeTitles[0]} 等 ${item.recipeTitles.length} 道菜`;
}

export async function loadRecipeShopState(): Promise<RecipeShopState> {
  const raw = await getAppSetting<unknown>(AppSettingKey.recipeShopList);
  return parseState(raw);
}

async function persist(state: RecipeShopState): Promise<void> {
  await setAppSetting(AppSettingKey.recipeShopList, state);
}

/** 详情页「加入采购」：记录菜谱 id，清单按当前食材实时汇总 */
export async function addRecipeToShop(input: {
  recipeId: string;
  recipeTitle: string;
}): Promise<{ state: RecipeShopState; alreadyAdded: boolean }> {
  const recipeId = input.recipeId.trim();
  if (!recipeId) {
    const state = await loadRecipeShopState();
    return { state, alreadyAdded: false };
  }
  const state = await loadRecipeShopState();
  if (state.addedRecipes.some(r => r.recipeId === recipeId)) {
    return { state, alreadyAdded: true };
  }
  const title = input.recipeTitle.trim() || '未命名菜谱';
  state.addedRecipes.push({
    recipeId,
    recipeTitle: title.length > 80 ? title.slice(0, 80) : title,
  });
  await persist(state);
  return { state, alreadyAdded: false };
}

export async function setShopItemStatus(
  key: string,
  status: ShopItemStatus,
): Promise<RecipeShopState> {
  const state = await loadRecipeShopState();
  state.overrides[key] = status;
  await persist(state);
  return state;
}

export async function setShopItemsStatus(
  keys: string[],
  status: ShopItemStatus,
): Promise<RecipeShopState> {
  const state = await loadRecipeShopState();
  for (const key of keys) state.overrides[key] = status;
  await persist(state);
  return state;
}

/**
 * 清空：去掉详情页手动加入的菜谱，并清除状态覆盖。
 * 用餐计划里的菜仍会留在清单中。
 */
export async function clearRecipeShopState(): Promise<RecipeShopState> {
  const next = emptyState();
  await persist(next);
  return next;
}

export const SHOP_STATUS_META: {
  key: ShopItemStatus;
  label: string;
}[] = [
  { key: 'todo', label: '待采购' },
  { key: 'stock', label: '已有库存' },
  { key: 'bought', label: '已采购' },
];
