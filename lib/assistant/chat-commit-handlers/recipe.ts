/**
 * S9.3：commit_recipe / category / delete（动态 import）。
 * shop / cook_log / basket / plan 仅保留原生 UI，不走 Agent chat-commit。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftString, fail, ok, requestPushPending } from './shared';

function parseIngredientsText(text: string): Array<{
  name: string;
  amount: string;
  remark?: string;
}> {
  const out: Array<{ name: string; amount: string; remark?: string }> = [];
  for (const line of text.split(/\n/).slice(0, 80)) {
    const raw = line.trim();
    if (!raw) continue;
    const parts = raw.split(/[｜|]/).map(s => s.trim());
    const name = (parts[0] || '').slice(0, 200);
    const amount = (parts[1] || '').slice(0, 200);
    const remark = (parts[2] || '').slice(0, 200);
    if (!name && !amount && !remark) continue;
    out.push({
      name,
      amount,
      ...(remark ? { remark } : {}),
    });
  }
  return out;
}

function readIngredients(draft: Record<string, unknown>): Array<{
  name: string;
  amount: string;
  remark?: string;
}> {
  const text = draftString(draft, 'ingredients_text');
  if (text) return parseIngredientsText(text);

  const raw = draft.ingredients;
  if (typeof raw === 'string' && raw.trim()) return parseIngredientsText(raw);
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
  const cats = await listRecipeCategories();
  const needle = hint.trim().toLowerCase();
  if (needle) {
    const exact = cats.find(c => c.name.trim().toLowerCase() === needle);
    if (exact) return exact.id;
    const fuzzy = cats.find(c => c.name.trim().toLowerCase().includes(needle));
    if (fuzzy) return fuzzy.id;
  }
  // 不按 AI 编造的分类名新建；优先落「未分类」，否则第一个现有分类
  const fallback = cats.find(c => c.name.trim() === '未分类') ?? cats[0];
  if (fallback) return fallback.id;
  const created = await createRecipeCategory('未分类');
  return created.id;
}

function readRecipeIds(draft: Record<string, unknown>): string[] {
  const raw = draft.recipe_ids;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, 200)) {
    const id = typeof row === 'string' ? row.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function resolveCategoryLabel(
  categoryHint: string,
  explicitCategoryId: string,
): Promise<string> {
  if (categoryHint) return categoryHint.slice(0, 40);
  if (!explicitCategoryId) return '目标分类';
  try {
    const { listRecipeCategories } = await import('@/lib/recipes');
    const cats = await listRecipeCategories();
    return (
      cats.find(c => c.id === explicitCategoryId)?.name.slice(0, 40) ||
      explicitCategoryId.slice(0, 40)
    );
  } catch {
    return explicitCategoryId.slice(0, 40);
  }
}

async function moveRecipesToCategory(opts: {
  recipeIds: string[];
  categoryId: string;
  destLabel: string;
  fromCategoryName?: string;
}): Promise<ChatCommitHandlerResult> {
  const { updateRecipe } = await import('@/lib/recipes');
  let moved = 0;
  let lastTitle = '';
  for (const id of opts.recipeIds) {
    const updated = await updateRecipe(id, { category_id: opts.categoryId });
    if (!updated) continue;
    moved += 1;
    lastTitle = updated.title;
  }
  if (moved === 0) {
    return fail('recipe_missing', '找不到要移动的菜谱');
  }
  await requestPushPending();
  const srcHint = opts.fromCategoryName
    ? `「${opts.fromCategoryName.slice(0, 40)}」`
    : '';
  return ok(
    opts.recipeIds[0]!,
    srcHint
      ? `已将${srcHint}下 ${moved} 道菜移到「${opts.destLabel}」`
      : `已将 ${moved} 道菜移到「${opts.destLabel}」${
          lastTitle ? `（含「${lastTitle.slice(0, 24)}」）` : ''
        }`,
  );
}

async function resolveSourceCategoryId(
  fromCategoryId: string,
  fromCategoryName: string,
): Promise<string | null> {
  if (fromCategoryId) return fromCategoryId;
  if (!fromCategoryName) return null;
  const { listRecipeCategories } = await import('@/lib/recipes');
  const cats = await listRecipeCategories();
  const needle = fromCategoryName.trim().toLowerCase();
  const exact = cats.find(c => c.name.trim().toLowerCase() === needle);
  if (exact) return exact.id;
  const fuzzy = cats.find(c => c.name.trim().toLowerCase().includes(needle));
  return fuzzy?.id ?? null;
}

export async function commitRecipe(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const title = draftString(draft, 'title') || draftString(draft, 'name');
  const hasIngredients =
    Array.isArray(draft.ingredients) ||
    typeof draft.ingredients === 'string' ||
    typeof draft.ingredients_text === 'string';
  const hasSteps =
    Array.isArray(draft.steps) ||
    typeof draft.steps_text === 'string' ||
    typeof draft.steps === 'string';
  const hasNotes = 'notes' in draft || 'note' in draft;
  const ingredients = hasIngredients ? readIngredients(draft) : [];
  const steps = hasSteps ? readSteps(draft) : [];
  const notes = draftString(draft, 'notes') || draftString(draft, 'note') || undefined;

  const { createRecipe, updateRecipe, listRecipes } = await import('@/lib/recipes');
  let existingId =
    draftString(draft, 'recipe_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'recipeId');
  let bulkIds = readRecipeIds(draft);
  const categoryHint =
    draftString(draft, 'category_hint') ||
    draftString(draft, 'category_name') ||
    draftString(draft, 'category');
  const explicitCategoryId = draftString(draft, 'category_id');
  const finishedImage =
    draftString(draft, 'finished_image_uri') ||
    draftString(draft, 'image_uri') ||
    null;
  const fromCategoryName =
    draftString(draft, 'from_category_name') || draftString(draft, 'from_category');
  const fromCategoryId = draftString(draft, 'from_category_id');
  const recipeTitleHint = draftString(draft, 'recipe_title');
  const moveOnlyIntent =
    Boolean(explicitCategoryId || categoryHint) &&
    !hasIngredients &&
    !hasSteps &&
    !hasNotes &&
    !finishedImage &&
    !title;

  // 整类移动兜底：白名单可能剃掉 recipe_ids，按源分类本地重解析
  if (
    bulkIds.length === 0 &&
    moveOnlyIntent &&
    (fromCategoryId || fromCategoryName)
  ) {
    const srcId = await resolveSourceCategoryId(fromCategoryId, fromCategoryName);
    if (srcId) {
      const rows = await listRecipes(srcId);
      bulkIds = rows.map(r => r.id);
    }
  }

  // 单道移动兜底：recipe_id 被剃掉时按菜名定位
  if (!existingId && moveOnlyIntent && recipeTitleHint && bulkIds.length === 0) {
    const needle = recipeTitleHint.trim().toLowerCase();
    const rows = await listRecipes();
    const exact = rows.find(r => r.title.trim().toLowerCase() === needle);
    const fuzzy =
      exact || rows.find(r => r.title.trim().toLowerCase().includes(needle));
    if (fuzzy) existingId = fuzzy.id;
  }

  // 整类移动：recipe_ids[]（或本地重解析）+ 目标分类
  if (bulkIds.length > 0 && (explicitCategoryId || categoryHint)) {
    const categoryId =
      explicitCategoryId || (await resolveRecipeCategoryId(categoryHint));
    const destLabel = await resolveCategoryLabel(categoryHint, explicitCategoryId);
    return moveRecipesToCategory({
      recipeIds: bulkIds,
      categoryId,
      destLabel,
      fromCategoryName: fromCategoryName || undefined,
    });
  }

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
    const movedOnly =
      Boolean(patch.category_id) &&
      !patch.title &&
      !hasIngredients &&
      !hasSteps &&
      !hasNotes &&
      !finishedImage;
    if (movedOnly) {
      const dest = (categoryHint || '目标分类').slice(0, 40);
      return ok(updated.id, `已将「${updated.title.slice(0, 40)}」移到「${dest}」`);
    }
    return ok(updated.id, `已更新菜谱「${updated.title.slice(0, 40)}」`);
  }

  // 移动意图但解析失败：勿落到新建空菜谱
  if (moveOnlyIntent || fromCategoryName || fromCategoryId || recipeTitleHint) {
    return fail(
      'incomplete_draft',
      fromCategoryName || fromCategoryId
        ? '未能定位源分类下的菜谱，请确认分类名后重试'
        : '未能定位要移动的菜谱，请确认菜名后重试',
    );
  }

  if (!title && ingredients.length === 0 && steps.length === 0) {
    return fail('incomplete_draft', '菜谱标题、食材与步骤不能都为空');
  }

  if (!explicitCategoryId && !categoryHint.trim()) {
    return fail('incomplete_draft', '请先在确认卡选择目标分类（须为现有分类）');
  }

  let categoryId = explicitCategoryId;
  if (!categoryId) {
    const { listRecipeCategories } = await import('@/lib/recipes');
    const cats = await listRecipeCategories();
    const needle = categoryHint.trim().toLowerCase();
    const hit =
      cats.find(c => c.name.trim().toLowerCase() === needle) ||
      cats.find(c => c.name.trim().toLowerCase().includes(needle));
    if (!hit) {
      return fail(
        'incomplete_draft',
        `「${categoryHint.slice(0, 40)}」不是现有分类，请在确认卡重新选择`,
      );
    }
    categoryId = hit.id;
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
  commit_recipe_category: async input => commitRecipeCategory(input.draft),
  commit_recipe_delete: async input => commitRecipeDelete(input.draft),
  commit_recipe_category_delete: async input =>
    commitRecipeCategoryDelete(input.draft),
};
