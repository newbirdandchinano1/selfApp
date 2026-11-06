/**
 * 全局助手 brief_context 类型与纯组装（对齐《全局AI助手方案》§4）。
 * 读库聚合见 `brief-context-load.ts`。
 */

export type AssistantDayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export type AssistantBriefMeta = {
  today_ymd: string;
  day_boundary: { hour: number; minute: number };
  timezone?: string;
  day_part: AssistantDayPart;
};

export type AssistantBriefTaskItem = {
  id: string;
  title: string;
  priority?: number;
  due_ymd?: string | null;
  status?: string;
};

export type AssistantBriefTasks = {
  overdue_count: number;
  frog_candidates: AssistantBriefTaskItem[];
  open_todos: AssistantBriefTaskItem[];
};

export type AssistantBriefHabitItem = {
  id: string;
  name: string;
  today_count: number;
  daily_goal: number;
};

export type AssistantBriefHabits = {
  gaps: AssistantBriefHabitItem[];
};

export type AssistantBriefHealth = {
  calories: number;
  protein_g: number;
  carbohydrate_g: number;
  hydration_ml: number;
  target_calories: number;
  target_protein_g: number;
  target_carbohydrate_g: number;
  target_hydration_ml: number;
  recent_meal_summary?: string | null;
};

export type AssistantBriefFinanceTxn = {
  id: string;
  name: string;
  amount: number;
  type_label?: string;
};

export type AssistantBriefScheduledExpense = {
  id: string;
  name: string;
  amount: number;
  due_ymd: string;
};

export type AssistantBriefFinance = {
  budget_remaining?: number | null;
  recent_txns: AssistantBriefFinanceTxn[];
  today_unlogged: boolean;
  upcoming_scheduled: AssistantBriefScheduledExpense[];
};

export type AssistantBriefWardrobe = {
  wore_today?: boolean | null;
  season_hint?: string | null;
  weather_hint?: string | null;
};

export type AssistantBriefReview = {
  daily_done: boolean;
  weekly_done?: boolean | null;
  execution_score?: number | null;
};

export type AssistantBriefPrefs = {
  diet_avoid?: string[];
  account_aliases?: string[];
  schedule_hint?: string | null;
};

export type AssistantBriefContext = {
  meta: AssistantBriefMeta;
  tasks: AssistantBriefTasks;
  habits: AssistantBriefHabits;
  health: AssistantBriefHealth;
  finance: AssistantBriefFinance;
  wardrobe?: AssistantBriefWardrobe;
  review?: AssistantBriefReview;
  prefs?: AssistantBriefPrefs;
};

/** 供组装器使用的健康摘要（与 ReviewDayFacts.health 字段对齐，避免本文件依赖复盘模块） */
export type AssistantBriefHealthFacts = {
  calories: number;
  protein: number;
  carbohydrate: number;
  hydration: number;
  targetCalories: number;
  targetProtein: number;
  targetCarbohydrate: number;
  targetHydration: number;
  records: { title: string; calories: number }[];
};

export type AssistantBriefContextParts = {
  todayYmd: string;
  boundary: { hour: number; minute: number };
  now?: Date;
  timezone?: string;
  healthFacts?: AssistantBriefHealthFacts | null;
  frogCandidates?: AssistantBriefTaskItem[];
  openTodos?: AssistantBriefTaskItem[];
  overdueCount?: number;
  habitGaps?: AssistantBriefHabitItem[];
  recentTxns?: AssistantBriefFinanceTxn[];
  budgetRemaining?: number | null;
  todayUnlogged?: boolean;
  upcomingScheduled?: AssistantBriefScheduledExpense[];
  wardrobe?: AssistantBriefWardrobe;
  review?: AssistantBriefReview;
  prefs?: AssistantBriefPrefs;
};

export function dayPartFromDate(now: Date): AssistantDayPart {
  const h = now.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

function emptyHealth(): AssistantBriefHealth {
  return {
    calories: 0,
    protein_g: 0,
    carbohydrate_g: 0,
    hydration_ml: 0,
    target_calories: 0,
    target_protein_g: 0,
    target_carbohydrate_g: 0,
    target_hydration_ml: 0,
    recent_meal_summary: null,
  };
}

/** 纯函数：由已裁剪零件组装 brief_context（便于单测） */
export function buildAssistantBriefContext(parts: AssistantBriefContextParts): AssistantBriefContext {
  const now = parts.now ?? new Date();
  const hf = parts.healthFacts;
  const health = hf
    ? {
        calories: hf.calories,
        protein_g: hf.protein,
        carbohydrate_g: hf.carbohydrate,
        hydration_ml: hf.hydration,
        target_calories: hf.targetCalories,
        target_protein_g: hf.targetProtein,
        target_carbohydrate_g: hf.targetCarbohydrate,
        target_hydration_ml: hf.targetHydration,
        recent_meal_summary: hf.records[0]
          ? `${hf.records[0].title} · ${Math.round(hf.records[0].calories)}kcal`
          : null,
      }
    : emptyHealth();

  return {
    meta: {
      today_ymd: parts.todayYmd,
      day_boundary: { hour: parts.boundary.hour, minute: parts.boundary.minute },
      timezone: parts.timezone,
      day_part: dayPartFromDate(now),
    },
    tasks: {
      overdue_count: parts.overdueCount ?? 0,
      frog_candidates: (parts.frogCandidates ?? []).slice(0, 5),
      open_todos: (parts.openTodos ?? []).slice(0, 8),
    },
    habits: {
      gaps: (parts.habitGaps ?? []).slice(0, 5),
    },
    health,
    finance: {
      budget_remaining: parts.budgetRemaining ?? null,
      recent_txns: (parts.recentTxns ?? []).slice(0, 3),
      today_unlogged: parts.todayUnlogged ?? false,
      upcoming_scheduled: (parts.upcomingScheduled ?? []).slice(0, 3),
    },
    wardrobe: parts.wardrobe,
    review: parts.review,
    prefs: parts.prefs,
  };
}

/** 从 brief_context 收集允许出现在 ActionCard 的实体 id */
export function collectAllowedIdsFromBriefContext(ctx: AssistantBriefContext): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) ids.add(v.trim());
  };

  for (const t of ctx.tasks.frog_candidates) add(t.id);
  for (const t of ctx.tasks.open_todos) add(t.id);
  for (const h of ctx.habits.gaps) add(h.id);
  for (const t of ctx.finance.recent_txns) add(t.id);
  for (const s of ctx.finance.upcoming_scheduled) add(s.id);

  return [...ids];
}

/** 规则生成的今日 facts 短句（数字以 brief_context 为准；供 daily-brief 回传展示） */
export function buildAssistantBriefFactLines(ctx: AssistantBriefContext): { domain: string; text: string }[] {
  const lines: { domain: string; text: string }[] = [];
  const { tasks, habits, health, finance } = ctx;

  const frogTitle = tasks.frog_candidates[0]?.title?.trim();
  if (tasks.overdue_count > 0 || frogTitle) {
    const parts: string[] = [];
    if (tasks.overdue_count > 0) parts.push(`逾期 ${tasks.overdue_count} 项`);
    if (frogTitle) parts.push(`青蛙候选「${frogTitle}」`);
    lines.push({ domain: 'task', text: parts.join('；') });
  }

  if (health.target_protein_g > 0 || health.target_calories > 0) {
    lines.push({
      domain: 'health',
      text: `蛋白已摄入 ${Math.round(health.protein_g)}g / 目标 ${Math.round(health.target_protein_g)}g`,
    });
  }

  if (finance.budget_remaining != null && Number.isFinite(finance.budget_remaining)) {
    const sched = finance.upcoming_scheduled[0];
    const base = `本月预算剩余约 ¥${Math.round(finance.budget_remaining).toLocaleString('zh-CN')}`;
    lines.push({
      domain: 'finance',
      text: sched ? `${base}；临近定时支出「${sched.name}」` : base,
    });
  } else if (finance.today_unlogged) {
    lines.push({ domain: 'finance', text: '今日尚未记账' });
  }

  const gap = habits.gaps[0];
  if (gap) {
    lines.push({ domain: 'habit', text: `「${gap.name}」今日未打卡` });
  }

  return lines;
}
