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
  const ingredients = readIngredients(draft);
  const steps = readSteps(draft);
  const notes = draftString(draft, 'notes') || draftString(draft, 'note') || undefined;

  if (!title && ingredients.length === 0 && steps.length === 0) {
    return fail('incomplete_draft', '菜谱标题、食材与步骤不能都为空');
  }

  const { createRecipe, updateRecipe } = await import('@/lib/recipes');
  const existingId =
    draftString(draft, 'recipe_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'recipeId');
  const categoryHint =
    draftString(draft, 'category_hint') ||
    draftString(draft, 'category_name') ||
    draftString(draft, 'category');
  const categoryId =
    draftString(draft, 'category_id') || (await resolveRecipeCategoryId(categoryHint));
  const finishedImage =
    draftString(draft, 'finished_image_uri') ||
    draftString(draft, 'image_uri') ||
    null;

  if (existingId) {
    const updated = await updateRecipe(existingId, {
      title: (title || '未命名菜谱').slice(0, 120),
      category_id: categoryId,
      ingredients,
      steps,
      notes: notes ?? null,
      ...(finishedImage ? { finished_image_uri: finishedImage } : {}),
    });
    if (!updated) {
      return fail('recipe_missing', '找不到要更新的菜谱，请改为新建或打开菜谱页');
    }
    await requestPushPending();
    return ok(updated.id, `已更新菜谱「${updated.title.slice(0, 40)}」`);
  }

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
  const planRaw = draft.plan ?? draft.entries ?? draft.days;
  const rows = Array.isArray(planRaw) ? planRaw : [];
  if (!rows.length) {
    return fail('incomplete_draft', '周排餐草稿为空，请先生成排餐候选');
  }

  const { addRecipePlanEntry } = await import('@/lib/recipe-plan');
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

export async function commitRecipeBasket(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ref = await resolveRecipeRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);
  const { addRecipeToBasket } = await import('@/lib/recipe-basket');
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

export async function commitRecipeShop(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ref = await resolveRecipeRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);
  const { addRecipeToShop } = await import('@/lib/recipe-shop');
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
  const rating = draftNumber(draft, 'rating') ?? 5;
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  const { addRecipeCookLog } = await import('@/lib/recipe-cook-log');
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
  const name = draftString(draft, 'name') || draftString(draft, 'title');
  if (!name) return fail('incomplete_draft', '缺少菜谱分类名称');
  const existingId =
    draftString(draft, 'category_id') || draftString(draft, 'id');
  const { createRecipeCategory, renameRecipeCategory } = await import('@/lib/recipes');
  if (existingId) {
    const renamed = await renameRecipeCategory(existingId, name.slice(0, 40));
    if (!renamed) return fail('category_missing', '找不到要改名的分类');
    return ok(renamed.id, `已重命名菜谱分类为「${renamed.name}」`);
  }
  const created = await createRecipeCategory(name.slice(0, 40));
  return ok(created.id, `已创建菜谱分类「${created.name}」`);
}

export const recipeCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_recipe: async input => commitRecipe(input.draft),
  commit_recipe_plan: async input => commitRecipePlan(input.draft),
  commit_recipe_basket: async input => commitRecipeBasket(input.draft),
  commit_recipe_shop: async input => commitRecipeShop(input.draft),
  commit_recipe_cook_log: async input => commitRecipeCookLog(input.draft),
  commit_recipe_category: async input => commitRecipeCategory(input.draft),
};
