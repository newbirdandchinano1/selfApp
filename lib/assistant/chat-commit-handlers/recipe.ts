/**
 * S9.3 W2：commit_recipe / commit_recipe_plan（动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

function readIngredients(draft: Record<string, unknown>): Array<{
  name: string;
  amount: string;
  remark?: string;
}> {
  const raw = draft.ingredients;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; amount: string; remark?: string }> = [];
  for (const row of raw.slice(0, 80)) {
    if (typeof row === 'string') {
      const name = row.trim();
      if (name) out.push({ name: name.slice(0, 200), amount: '' });
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const amount = typeof o.amount === 'string' ? o.amount.trim() : '';
    const remark = typeof o.remark === 'string' ? o.remark.trim() : '';
    if (!name && !amount && !remark) continue;
    out.push({
      name: name.slice(0, 200),
      amount: amount.slice(0, 200),
      ...(remark ? { remark: remark.slice(0, 200) } : {}),
    });
  }
  return out;
}

function readSteps(draft: Record<string, unknown>): string[] {
  const raw = draft.steps;
  if (!Array.isArray(raw)) {
    const text = draftString(draft, 'steps_text');
    return text
      ? text
          .split(/\n/)
          .map(s => s.trim())
          .filter(Boolean)
          .slice(0, 80)
      : [];
  }
  return raw
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, 80);
}

async function resolveRecipeCategoryId(hint: string): Promise<string> {
  const { listRecipeCategories, createRecipeCategory } = await import('@/lib/recipes');
  let cats = await listRecipeCategories();
  const needle = hint.trim().toLowerCase();
  if (needle) {
    const exact = cats.find(c => c.name.trim().toLowerCase() === needle);
    if (exact) return exact.id;
    const fuzzy = cats.find(c => c.name.trim().toLowerCase().includes(needle));
    if (fuzzy) return fuzzy.id;
  }
  if (!cats.length) {
    const created = await createRecipeCategory(hint.trim() || '未分类');
    return created.id;
  }
  if (hint.trim()) {
    try {
      const created = await createRecipeCategory(hint.trim().slice(0, 40));
      return created.id;
    } catch {
      cats = await listRecipeCategories();
    }
  }
  const fallback =
    cats.find(c => c.name.trim() === '未分类') ?? cats[0];
  return fallback.id;
}

function asMealSlot(raw: unknown): 'breakfast' | 'lunch' | 'dinner' | 'snack' | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'breakfast' || s === '早' || s === '早餐') return 'breakfast';
  if (s === 'lunch' || s === '午' || s === '午餐' || s === '中餐') return 'lunch';
  if (s === 'dinner' || s === '晚' || s === '晚餐') return 'dinner';
  if (s === 'snack' || s === '加餐' || s === '点心') return 'snack';
  return null;
}

export async function commitRecipe(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const title = draftString(draft, 'title') || draftString(draft, 'name');
  const hasIngredients =
    Array.isArray(draft.ingredients) || typeof draft.ingredients === 'string';
  const hasSteps =
    Array.isArray(draft.steps) ||
    typeof draft.steps_text === 'string' ||
    typeof draft.steps === 'string';
  const hasNotes = 'notes' in draft || 'note' in draft;
  const ingredients = hasIngredients ? readIngredients(draft) : [];
  const steps = hasSteps ? readSteps(draft) : [];
  const notes = draftString(draft, 'notes') || draftString(draft, 'note') || undefined;

  const { createRecipe, updateRecipe } = await import('@/lib/recipes');
  const existingId =
    draftString(draft, 'recipe_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'recipeId');
  const categoryHint =
    draftString(draft, 'category_hint') ||
    draftString(draft, 'category_name') ||
    draftString(draft, 'category');
  const explicitCategoryId = draftString(draft, 'category_id');
  const finishedImage =
    draftString(draft, 'finished_image_uri') ||
    draftString(draft, 'image_uri') ||
    null;

  if (existingId) {
    const patch: {
      title?: string;
      category_id?: string;
      ingredients?: Array<{ name: string; amount: string; remark?: string }>;
      steps?: string[];
      notes?: string | null;
      finished_image_uri?: string | null;
    } = {};
    if (title) patch.title = title.slice(0, 120);
    if (explicitCategoryId || categoryHint) {
      patch.category_id =
        explicitCategoryId || (await resolveRecipeCategoryId(categoryHint));
    }
    if (hasIngredients) patch.ingredients = ingredients;
    if (hasSteps) patch.steps = steps;
    if (hasNotes) patch.notes = notes ?? null;
    if (finishedImage) patch.finished_image_uri = finishedImage;
    if (Object.keys(patch).length === 0) {
      return fail('incomplete_draft', '没有可更新的菜谱字段');
    }
    const updated = await updateRecipe(existingId, patch);
    if (!updated) {
      return fail('recipe_missing', '找不到要更新的菜谱，请改为新建或打开菜谱页');
    }
    await requestPushPending();
    return ok(updated.id, `已更新菜谱「${updated.title.slice(0, 40)}」`);
  }

  if (!title && ingredients.length === 0 && steps.length === 0) {
    return fail('incomplete_draft', '菜谱标题、食材与步骤不能都为空');
  }

  const categoryId =
    explicitCategoryId || (await resolveRecipeCategoryId(categoryHint));
  const item = await createRecipe({
    category_id: categoryId,
    title: (title || '新菜谱').slice(0, 120),
    ingredients,
    steps,
    ...(notes ? { notes } : {}),
    finished_image_uri: finishedImage,
  });
  await requestPushPending();
  return ok(item.id, `已保存菜谱「${item.title.slice(0, 40)}」`);
}

export async function commitRecipePlan(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const action = (
    draftString(draft, 'action') ||
    draftString(draft, 'op') ||
    ''
  ).toLowerCase();
  const { addRecipePlanEntry, removeRecipePlanEntry } = await import(
    '@/lib/recipe-plan'
  );

  if (action === 'remove' || action === 'delete') {
    const entryId =
      draftString(draft, 'entry_id') ||
      draftString(draft, 'plan_entry_id') ||
      draftString(draft, 'id');
    if (!entryId) return fail('incomplete_draft', '缺少要移除的计划条目 id');
    const removed = await removeRecipePlanEntry(entryId);
    if (!removed) return fail('plan_missing', '找不到该计划条目');
    return ok(entryId, '已移除用餐计划条目');
  }

  const planRaw = draft.plan ?? draft.entries ?? draft.days;
  let rows = Array.isArray(planRaw) ? planRaw : [];

  // 单条添加：周五晚饭做红烧肉（可仅菜名，对齐 recipe.draft_plan_add）
  if (!rows.length) {
    const date =
      draftString(draft, 'date') ||
      draftString(draft, 'ymd') ||
      draftString(draft, 'day');
    const slot =
      asMealSlot(draft.slot) ||
      asMealSlot(draft.meal) ||
      asMealSlot(draft.meal_slot);
    if (date && slot) {
      const ref = await resolveRecipeRef(draft);
      if (!('error' in ref)) {
        rows = [{ recipe_id: ref.id, recipe_title: ref.title, date, slot }];
      }
    }
  }

  if (!rows.length) {
    return fail('incomplete_draft', '周排餐草稿为空，请先生成排餐候选或指定日期/餐次/菜谱');
  }

  let saved = 0;
  let lastId = '';

  for (const row of rows.slice(0, 40)) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const recipeId =
      (typeof o.recipeId === 'string' && o.recipeId.trim()) ||
      (typeof o.recipe_id === 'string' && o.recipe_id.trim()) ||
      '';
    const recipeTitle =
      (typeof o.recipeTitle === 'string' && o.recipeTitle.trim()) ||
      (typeof o.recipe_title === 'string' && o.recipe_title.trim()) ||
      (typeof o.title === 'string' && o.title.trim()) ||
      '未命名菜谱';
    const date =
      (typeof o.date === 'string' && o.date.trim()) ||
      (typeof o.ymd === 'string' && o.ymd.trim()) ||
      '';
    const slot = asMealSlot(o.slot ?? o.meal_slot ?? o.meal);
    if (!recipeId || !date || !slot) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const entry = await addRecipePlanEntry({
      date,
      slot,
      recipeId,
      recipeTitle: recipeTitle.slice(0, 80),
    });
    saved += 1;
    lastId = entry.id;
  }

  if (!saved) {
    return fail(
      'incomplete_draft',
      '排餐条目缺少有效的日期/餐次/菜谱 id，请补充后再确认',
    );
  }
  return ok(lastId || `plan_${saved}`, `已写入 ${saved} 条周排餐`);
}

async function resolveRecipeRef(draft: Record<string, unknown>): Promise<
  { id: string; title: string } | { error: string }
> {
  const explicit =
    draftString(draft, 'recipe_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'recipeId');
  const titleHint =
    draftString(draft, 'recipe_title') ||
    draftString(draft, 'title') ||
    draftString(draft, 'name');
  if (!explicit && !titleHint) return { error: '请指定菜谱 id 或名称' };

  const { getRecipe, listRecipes } = await import('@/lib/recipes');
  if (explicit) {
    const row = await getRecipe(explicit);
    if (row) return { id: row.id, title: row.title };
    if (titleHint) return { id: explicit, title: titleHint };
    return { error: '找不到该菜谱' };
  }
  const recipes = await listRecipes();
  const needle = titleHint.toLowerCase();
  const hit =
    recipes.find(r => r.title.trim().toLowerCase() === needle) ||
    recipes.find(r => r.title.trim().toLowerCase().includes(needle));
  if (!hit) return { error: `找不到菜谱「${titleHint}」` };
  return { id: hit.id, title: hit.title };
}

function basketAction(draft: Record<string, unknown>): string {
  return (
    draftString(draft, 'action') ||
    draftString(draft, 'op') ||
    'add'
  ).toLowerCase();
}

export async function commitRecipeBasket(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const action = basketAction(draft);
  const {
    addRecipeToBasket,
    removeRecipeFromBasket,
    clearRecipeBasket,
    loadRecipeBasketStore,
  } = await import('@/lib/recipe-basket');

  if (action === 'clear') {
    await clearRecipeBasket();
    return ok('basket_cleared', '已清空菜单篮');
  }

  if (action === 'to_shop' || action === 'to-shop' || action === 'generate_shop') {
    const store = await loadRecipeBasketStore();
    if (!store.items.length) return fail('empty_basket', '菜单篮是空的');
    const { addRecipeToShop } = await import('@/lib/recipe-shop');
    let added = 0;
    for (const item of store.items) {
      const r = await addRecipeToShop({
        recipeId: item.recipeId,
        recipeTitle: item.recipeTitle,
      });
      if (!r.alreadyAdded) added += 1;
    }
    return ok('basket_to_shop', `已从菜单篮写入采购（新增 ${added} 道）`);
  }

  if (action === 'to_plan' || action === 'to-plan' || action === 'arrange_plan') {
    const store = await loadRecipeBasketStore();
    if (!store.items.length) return fail('empty_basket', '菜单篮是空的');
    const date =
      draftString(draft, 'date') ||
      draftString(draft, 'ymd') ||
      new Date().toISOString().slice(0, 10);
    const slot =
      asMealSlot(draft.slot) ||
      asMealSlot(draft.meal) ||
      asMealSlot(draft.meal_slot) ||
      'dinner';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return fail('incomplete_draft', '日期须为 YYYY-MM-DD');
    }
    const { addRecipePlanEntry } = await import('@/lib/recipe-plan');
    let added = 0;
    for (const item of store.items) {
      await addRecipePlanEntry({
        date,
        slot,
        recipeId: item.recipeId,
        recipeTitle: item.recipeTitle,
      });
      added += 1;
    }
    return ok('basket_to_plan', `已将菜单篮 ${added} 道安排到 ${date} ${slot}`);
  }

  const ref = await resolveRecipeRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);

  if (action === 'remove' || action === 'delete') {
    await removeRecipeFromBasket(ref.id);
    return ok(ref.id, `已从菜单篮移出「${ref.title.slice(0, 40)}」`);
  }

  const categoryName =
    draftString(draft, 'category_name') || draftString(draft, 'category') || undefined;
  const result = await addRecipeToBasket({
    recipeId: ref.id,
    recipeTitle: ref.title,
    categoryName,
  });
  return ok(
    ref.id,
    result.alreadyAdded
      ? `「${ref.title.slice(0, 40)}」已在菜篮子中`
      : `已将「${ref.title.slice(0, 40)}」加入菜篮子`,
  );
}

function shopAction(draft: Record<string, unknown>): string {
  return (
    draftString(draft, 'action') ||
    draftString(draft, 'op') ||
    'add'
  ).toLowerCase();
}

function readShopKeys(draft: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const pushSplit = (raw: string) => {
    for (const part of raw.split(/[,，、\n]/)) {
      const k = part.trim();
      if (k) keys.push(k);
    }
  };
  const one =
    draftString(draft, 'key') ||
    draftString(draft, 'item_key') ||
    draftString(draft, 'name') ||
    draftString(draft, 'item');
  if (one) pushSplit(one);
  const raw = draft.keys ?? draft.item_keys ?? draft.items;
  if (typeof raw === 'string' && raw.trim()) {
    pushSplit(raw);
  } else if (Array.isArray(raw)) {
    for (const row of raw) {
      if (typeof row === 'string' && row.trim()) pushSplit(row);
      else if (row && typeof row === 'object') {
        const o = row as Record<string, unknown>;
        const k =
          (typeof o.key === 'string' && o.key.trim()) ||
          (typeof o.name === 'string' && o.name.trim()) ||
          '';
        if (k) pushSplit(k);
      }
    }
  }
  return [...new Set(keys.map(k => k.trim().toLowerCase()).filter(Boolean))];
}

export async function commitRecipeShop(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const action = shopAction(draft);
  const {
    addRecipeToShop,
    setShopItemStatus,
    setShopItemsStatus,
    dismissShopItems,
    clearRecipeShopState,
    buildShopList,
    loadRecipeShopState,
  } = await import('@/lib/recipe-shop');

  if (action === 'clear') {
    const state = await loadRecipeShopState();
    const { loadRecipePlanStore } = await import('@/lib/recipe-plan');
    const { loadRecipeStore } = await import('@/lib/recipes');
    const [plan, recipes] = await Promise.all([
      loadRecipePlanStore(),
      loadRecipeStore(),
    ]);
    const visible = buildShopList(plan, recipes, state).map(i => i.key);
    await clearRecipeShopState(visible);
    return ok('shop_cleared', '已清空采购清单');
  }

  if (action === 'status' || action === 'mark') {
    const keys = readShopKeys(draft);
    if (!keys.length) return fail('incomplete_draft', '请指定要标记的食材');
    const statusRaw =
      draftString(draft, 'status') || draftString(draft, 'shop_status') || 'bought';
    const status =
      statusRaw === 'stock' || statusRaw === '库存' || statusRaw === '已有库存'
        ? 'stock'
        : statusRaw === 'todo' || statusRaw === '待采购' || statusRaw === '待买'
          ? 'todo'
          : 'bought';
    if (keys.length === 1) await setShopItemStatus(keys[0], status);
    else await setShopItemsStatus(keys, status);
    return ok(keys[0], `已将 ${keys.length} 项标为${status}`);
  }

  if (action === 'dismiss' || action === 'remove' || action === 'delete') {
    const keys = readShopKeys(draft);
    if (!keys.length) return fail('incomplete_draft', '请指定要移除的食材');
    await dismissShopItems(keys);
    return ok(keys[0], `已从采购清单移除 ${keys.length} 项`);
  }

  const ref = await resolveRecipeRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);
  const result = await addRecipeToShop({
    recipeId: ref.id,
    recipeTitle: ref.title,
  });
  return ok(
    ref.id,
    result.alreadyAdded
      ? `「${ref.title.slice(0, 40)}」已在购物清单`
      : `已将「${ref.title.slice(0, 40)}」加入购物清单`,
  );
}

export async function commitRecipeCookLog(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ref = await resolveRecipeRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);
  const action = (
    draftString(draft, 'action') ||
    draftString(draft, 'op') ||
    'add'
  ).toLowerCase();
  const noteOnly =
    action === 'note' ||
    draft.note_only === true ||
    draft.noteOnly === true ||
    (draft.rating == null && Boolean(draftString(draft, 'note')));

  const { addRecipeCookLog, loadRecipeCookLogStore, logsForRecipe } = await import(
    '@/lib/recipe-cook-log'
  );
  const { setAppSetting, AppSettingKey } = await import('@/lib/app-settings-store');

  if (noteOnly) {
    const note = draftString(draft, 'note');
    if (!note) return fail('incomplete_draft', '缺少备注内容');
    const store = await loadRecipeCookLogStore();
    const logs = logsForRecipe(store, ref.id);
    const logId = draftString(draft, 'log_id') || draftString(draft, 'id');
    const target = logId
      ? store.logs.find(l => l.id === logId)
      : logs[0];
    if (!target) return fail('cook_log_missing', '还没有制作记录，请先评分记账');
    target.note = note.slice(0, 200);
    await setAppSetting(AppSettingKey.recipeCookLogs, store);
    return ok(target.id, `已更新「${ref.title.slice(0, 40)}」制作备注`);
  }

  const rating = draftNumber(draft, 'rating') ?? 5;
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  const { recordRecipeCooked } = await import('@/lib/recipes');
  const log = await addRecipeCookLog({
    recipeId: ref.id,
    rating: clamped,
    note: draftString(draft, 'note') || undefined,
    cookedAt: draftString(draft, 'cooked_on') || draftString(draft, 'cooked_at') || undefined,
  });
  try {
    await recordRecipeCooked(ref.id);
  } catch {
    /* ignore */
  }
  return ok(log.id, `已记录「${ref.title.slice(0, 40)}」做菜 ${clamped} 星`);
}

export async function commitRecipeCategory(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name =
    draftString(draft, 'name') ||
    draftString(draft, 'title') ||
    draftString(draft, 'new_name');
  if (!name) return fail('incomplete_draft', '缺少菜谱分类名称');
  let existingId =
    draftString(draft, 'category_id') || draftString(draft, 'id');
  const oldNameHint =
    draftString(draft, 'old_name') || draftString(draft, 'category_name');
  const {
    createRecipeCategory,
    renameRecipeCategory,
    getRecipeCategory,
    listRecipeCategories,
  } = await import('@/lib/recipes');
  if (existingId) {
    let row = await getRecipeCategory(existingId);
    if (!row) {
      // Agent 偶发把旧分类名塞进 category_id
      const cats = await listRecipeCategories();
      const needle = existingId.trim().toLowerCase();
      row =
        cats.find(c => c.name.trim().toLowerCase() === needle) ||
        (oldNameHint
          ? cats.find(
              c => c.name.trim().toLowerCase() === oldNameHint.trim().toLowerCase(),
            )
          : undefined) ||
        null;
      if (row) existingId = row.id;
    }
    if (!existingId) return fail('category_missing', '找不到要改名的分类');
    const renamed = await renameRecipeCategory(existingId, name.slice(0, 40));
    if (!renamed) return fail('category_missing', '找不到要改名的分类');
    return ok(renamed.id, `已重命名菜谱分类为「${renamed.name}」`);
  }
  const created = await createRecipeCategory(name.slice(0, 40));
  return ok(created.id, `已创建菜谱分类「${created.name}」`);
}

export async function commitRecipeDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ref = await resolveRecipeRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);
  const { deleteRecipe } = await import('@/lib/recipes');
  const deleted = await deleteRecipe(ref.id);
  if (!deleted) return fail('recipe_missing', '找不到要删除的菜谱');
  await requestPushPending();
  return ok(ref.id, `已删除菜谱「${ref.title.slice(0, 40)}」`);
}

async function resolveCategoryRef(draft: Record<string, unknown>): Promise<
  { id: string; name: string } | { error: string }
> {
  const explicit =
    draftString(draft, 'category_id') || draftString(draft, 'id');
  const nameHint =
    draftString(draft, 'name') ||
    draftString(draft, 'title') ||
    draftString(draft, 'category_name');
  if (!explicit && !nameHint) return { error: '请指定分类 id 或名称' };

  const { getRecipeCategory, listRecipeCategories } = await import('@/lib/recipes');
  if (explicit) {
    const row = await getRecipeCategory(explicit);
    if (row) return { id: row.id, name: row.name };
    if (nameHint) return { id: explicit, name: nameHint };
    return { error: '找不到该分类' };
  }
  const cats = await listRecipeCategories();
  const needle = nameHint.toLowerCase();
  const hit =
    cats.find(c => c.name.trim().toLowerCase() === needle) ||
    cats.find(c => c.name.trim().toLowerCase().includes(needle));
  if (!hit) return { error: `找不到分类「${nameHint}」` };
  return { id: hit.id, name: hit.name };
}

export async function commitRecipeCategoryDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ref = await resolveCategoryRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);

  const { listRecipes, deleteRecipe, deleteRecipeCategory } = await import(
    '@/lib/recipes'
  );
  const children = await listRecipes(ref.id);
  for (const row of children) {
    await deleteRecipe(row.id);
  }
  const deleted = await deleteRecipeCategory(ref.id);
  if (!deleted) return fail('category_missing', '找不到要删除的分类');
  try {
    const { forgetRecipeCategoryMeta } = await import('@/lib/recipe-category-meta');
    await forgetRecipeCategoryMeta(ref.id);
  } catch {
    /* ignore meta cleanup */
  }
  await requestPushPending();
  const childHint =
    children.length > 0 ? `（含其下 ${children.length} 道菜）` : '';
  return ok(ref.id, `已删除菜谱分类「${ref.name.slice(0, 40)}」${childHint}`);
}

export const recipeCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_recipe: async input => commitRecipe(input.draft),
  commit_recipe_plan: async input => commitRecipePlan(input.draft),
  commit_recipe_basket: async input => commitRecipeBasket(input.draft),
  commit_recipe_shop: async input => commitRecipeShop(input.draft),
  commit_recipe_cook_log: async input => commitRecipeCookLog(input.draft),
  commit_recipe_category: async input => commitRecipeCategory(input.draft),
  commit_recipe_delete: async input => commitRecipeDelete(input.draft),
  commit_recipe_category_delete: async input =>
    commitRecipeCategoryDelete(input.draft),
};
