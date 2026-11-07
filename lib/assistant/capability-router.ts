/**
 * module_id → 前端路由（唯一路由真相源）。
 * Agent 只发 module_id，禁止模型拼接 Href。
 * 全量对齐《全局Agent全功能覆盖开发文档》§4.1 与 Agent MODULE_CATALOG。
 */

export type ModuleHref = string | { pathname: string; params?: Record<string, string> };

export type AssistantModuleId =
  | 'finance.home'
  | 'finance.stats'
  | 'finance.cash_flow'
  | 'finance.scheduled'
  | 'health.home'
  | 'health.weight'
  | 'tasks.home'
  | 'tasks.add'
  | 'habit.add'
  | 'tasks.project'
  | 'memo.home'
  | 'memo.add'
  | 'recipe.home'
  | 'recipe.add'
  | 'recipe.plan'
  | 'wardrobe.home'
  | 'wardrobe.outfit'
  | 'wish.home'
  | 'wish.add'
  | 'review.home'
  | 'review.daily'
  | 'review.weekly'
  | 'review.monthly'
  | 'profile.home'
  | 'profile.edit'
  | 'life_road.home';

type ModuleRoute = {
  pathname: string;
  /** 默认 params；可被卡片 route_params 覆盖 */
  defaultParams?: Record<string, string>;
};

const MODULE_ROUTES: Record<AssistantModuleId, ModuleRoute> = {
  'finance.home': { pathname: '/(tabs)/finance' },
  'finance.stats': { pathname: '/finance-stats' },
  'finance.cash_flow': { pathname: '/cash-flow' },
  'finance.scheduled': { pathname: '/scheduled-expenses' },
  'health.home': { pathname: '/(tabs)/' },
  'health.weight': { pathname: '/health-analysis' },
  'tasks.home': { pathname: '/(tabs)/tasks' },
  'tasks.add': { pathname: '/add-task', defaultParams: { standalone: '1' } },
  'habit.add': { pathname: '/add-habit' },
  'tasks.project': { pathname: '/tasks-overview' },
  'memo.home': { pathname: '/memo-list' },
  'memo.add': { pathname: '/memo-edit/[id]', defaultParams: { id: 'new' } },
  'recipe.home': { pathname: '/my-recipes' },
  'recipe.add': { pathname: '/recipe-edit/[id]', defaultParams: { id: 'new' } },
  'recipe.plan': { pathname: '/my-recipes/plan' },
  'wardrobe.home': { pathname: '/my-wardrobe' },
  'wardrobe.outfit': { pathname: '/my-wardrobe', defaultParams: { tab: 'outfits' } },
  'wish.home': { pathname: '/wish-board' },
  'wish.add': { pathname: '/add-wish-board-item' },
  'review.home': { pathname: '/(tabs)/review' },
  'review.daily': { pathname: '/(tabs)/review', defaultParams: { focus: 'daily' } },
  'review.weekly': { pathname: '/(tabs)/review', defaultParams: { focus: 'weekly' } },
  'review.monthly': { pathname: '/(tabs)/review', defaultParams: { focus: 'monthly' } },
  'profile.home': { pathname: '/(tabs)/profile' },
  'profile.edit': { pathname: '/edit-profile' },
  'life_road.home': { pathname: '/life-road' },
};

export const ASSISTANT_MODULE_IDS = Object.keys(MODULE_ROUTES) as AssistantModuleId[];

export function isAssistantModuleId(raw: string | null | undefined): raw is AssistantModuleId {
  if (!raw) return false;
  return Object.prototype.hasOwnProperty.call(MODULE_ROUTES, raw);
}

/**
 * 将 module_id（+ 可选 params）解析为 expo-router Href。
 */
export function resolveModuleHref(
  moduleId: string,
  routeParams?: Record<string, string> | null,
): ModuleHref | null {
  if (!isAssistantModuleId(moduleId)) return null;
  const def = MODULE_ROUTES[moduleId];
  const merged: Record<string, string> = {
    ...(def.defaultParams ?? {}),
    ...(routeParams ?? {}),
  };
  if (Object.keys(merged).length === 0) {
    return def.pathname;
  }
  return { pathname: def.pathname, params: merged };
}
