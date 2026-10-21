import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';

export type RecipeBasketItem = {
  recipeId: string;
  /** 冗余标题，菜谱删除后仍可显示 */
  recipeTitle: string;
  /** 冗余分类名，便于列表副标题 */
  categoryName: string;
  added_at: string;
};

export type RecipeBasketStore = {
  version: 1;
  items: RecipeBasketItem[];
};

function emptyStore(): RecipeBasketStore {
  return { version: 1, items: [] };
}

function parseStore(raw: unknown): RecipeBasketStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyStore();
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.items)) return emptyStore();
  const items: RecipeBasketItem[] = [];
  const seen = new Set<string>();
  for (const row of o.items) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const recipeId = typeof r.recipeId === 'string' ? r.recipeId.trim() : '';
    if (!recipeId || seen.has(recipeId)) continue;
    const recipeTitle =
      typeof r.recipeTitle === 'string' && r.recipeTitle.trim()
        ? r.recipeTitle.trim().slice(0, 80)
        : '未命名菜谱';
    const categoryName =
      typeof r.categoryName === 'string' ? r.categoryName.trim().slice(0, 40) : '';
    const added_at = typeof r.added_at === 'string' ? r.added_at : new Date().toISOString();
    seen.add(recipeId);
    items.push({ recipeId, recipeTitle, categoryName, added_at });
  }
  return { version: 1, items };
}

export async function loadRecipeBasketStore(): Promise<RecipeBasketStore> {
  const raw = await getAppSetting<unknown>(AppSettingKey.recipeMenuBasket);
  return parseStore(raw);
}

async function persist(store: RecipeBasketStore): Promise<void> {
  await setAppSetting(AppSettingKey.recipeMenuBasket, store);
}

/** 菜谱列表加号：加入菜单篮（已存在则视为成功且标记 alreadyAdded） */
export async function addRecipeToBasket(input: {
  recipeId: string;
  recipeTitle: string;
  categoryName?: string;
}): Promise<{ store: RecipeBasketStore; alreadyAdded: boolean }> {
  const recipeId = input.recipeId.trim();
  if (!recipeId) {
    const store = await loadRecipeBasketStore();
    return { store, alreadyAdded: false };
  }
  const store = await loadRecipeBasketStore();
  if (store.items.some(i => i.recipeId === recipeId)) {
    return { store, alreadyAdded: true };
  }
  const title = input.recipeTitle.trim() || '未命名菜谱';
  const categoryName = (input.categoryName ?? '').trim();
  store.items.push({
    recipeId,
    recipeTitle: title.length > 80 ? title.slice(0, 80) : title,
    categoryName: categoryName.length > 40 ? categoryName.slice(0, 40) : categoryName,
    added_at: new Date().toISOString(),
  });
  await persist(store);
  return { store, alreadyAdded: false };
}

export async function removeRecipeFromBasket(recipeId: string): Promise<RecipeBasketStore> {
  const store = await loadRecipeBasketStore();
  const next = store.items.filter(i => i.recipeId !== recipeId);
  if (next.length === store.items.length) return store;
  const updated: RecipeBasketStore = { version: 1, items: next };
  await persist(updated);
  return updated;
}

export async function removeRecipesFromBasket(recipeIds: string[]): Promise<RecipeBasketStore> {
  const idSet = new Set(recipeIds.map(id => id.trim()).filter(Boolean));
  if (idSet.size === 0) return loadRecipeBasketStore();
  const store = await loadRecipeBasketStore();
  const next = store.items.filter(i => !idSet.has(i.recipeId));
  if (next.length === store.items.length) return store;
  const updated: RecipeBasketStore = { version: 1, items: next };
  await persist(updated);
  return updated;
}

export async function clearRecipeBasket(): Promise<RecipeBasketStore> {
  const next = emptyStore();
  await persist(next);
  return next;
}
