/**
 * 组装菜谱 AI 场景请求上下文（周排餐 / 食材选菜）。
 * Agent 只吃摘要，不直连业务库。
 */

import type { RecipeAiPlanSummaryItem, RecipeAiSummaryItem } from '@/lib/ai-api-client';
import { averageRating, loadRecipeCookLogStore, logsForRecipe } from '@/lib/recipe-cook-log';
import {
  formatLocalYmd,
  parseLocalYmd,
  type MealSlot,
  type RecipePlanStore,
} from '@/lib/recipe-plan';
import { recipeListPreviewTitle, type RecipeItem, type RecipeStore } from '@/lib/recipes';

const MAX_RECIPES = 60;
const MAX_ING_NAMES = 12;

/** 含 focusYmd 的自然周（周一～周日） */
export function weekRangeContaining(ymd: string): { start: string; end: string } | null {
  const d = parseLocalYmd(ymd);
  if (!d) return null;
  const monOffset = (d.getDay() + 6) % 7;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - monOffset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start: formatLocalYmd(start), end: formatLocalYmd(end) };
}

export function parsePantryText(raw: string): string[] {
  const parts = raw
    .split(/[,，、;\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.length > 40 ? p.slice(0, 40) : p);
    if (out.length >= 40) break;
  }
  return out;
}

function ingredientNames(recipe: RecipeItem): string[] {
  const names: string[] = [];
  for (const ing of recipe.ingredients) {
    const n = ing.name.trim();
    if (!n) continue;
    names.push(n.length > 40 ? n.slice(0, 40) : n);
    if (names.length >= MAX_ING_NAMES) break;
  }
  return names;
}

/** 优先常做 / 最近更新，截断后供 Agent */
export async function buildRecipeAiSummaries(
  store: RecipeStore,
  opts?: { max?: number },
): Promise<RecipeAiSummaryItem[]> {
  const max = Math.max(1, Math.min(opts?.max ?? MAX_RECIPES, 80));
  const cookStore = await loadRecipeCookLogStore();
  const ranked = [...store.recipes].sort((a, b) => {
    if (b.times_cooked !== a.times_cooked) return b.times_cooked - a.times_cooked;
    return b.updated_at.localeCompare(a.updated_at);
  });

  const out: RecipeAiSummaryItem[] = [];
  for (const r of ranked.slice(0, max)) {
    const avg = averageRating(logsForRecipe(cookStore, r.id));
    out.push({
      id: r.id,
      title: recipeListPreviewTitle(r),
      ingredients: ingredientNames(r),
      times_cooked: r.times_cooked,
      ...(avg != null ? { avg_rating: avg } : {}),
    });
  }
  return out;
}

export function buildExistingPlanSummaries(
  plan: RecipePlanStore,
  start: string,
  end: string,
): RecipeAiPlanSummaryItem[] {
  return plan.entries
    .filter(e => e.date >= start && e.date <= end)
    .slice(0, 60)
    .map(e => ({
      date: e.date,
      slot: e.slot,
      recipeId: e.recipeId,
      recipeTitle: e.recipeTitle,
    }));
}

export function isMealSlot(v: string): v is MealSlot {
  return v === 'breakfast' || v === 'lunch' || v === 'dinner' || v === 'snack';
}
