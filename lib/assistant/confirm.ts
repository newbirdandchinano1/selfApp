/**
 * ActionCard.confirm_action → App 落点映射（对齐《全局AI助手方案》§5.2 / §8.3）。
 * 纯映射可单测；写库仍由调用方打开现有 Sheet / API，不在此静默落库。
 */

import {
  type ActionCard,
  type AssistantConfirmAction,
  FORBIDDEN_CONFIRM_ACTIONS,
  sanitizeActionCardAgainstWhitelist,
} from './action-card';
import { resolveModuleHref } from './capability-router';

/** 与 expo-router Href 兼容的轻量形态（避免本模块静态依赖 RN） */
export type AssistantHref = string | { pathname: string; params?: Record<string, string> };

export type AssistantConfirmPlan =
  | {
      kind: 'preview_finance_txn';
      draft: Record<string, unknown>;
      card: ActionCard;
    }
  | {
      kind: 'preview_finance_transfer';
      draft: Record<string, unknown>;
      card: ActionCard;
    }
  | {
      kind: 'preview_finance_scheduled';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'preview_finance_cash_flow';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'preview_finance_budget';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'preview_food_intake';
      draft: Record<string, unknown>;
      card: ActionCard;
    }
  | {
      kind: 'preview_task';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'preview_habit';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'preview_memo';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'preview_wardrobe_item';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'preview_wish';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'preview_recipe';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'preview_profile';
      draft: Record<string, unknown>;
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'open_route';
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'frog_assign';
      taskId: string;
      assignYmd: string;
      card: ActionCard;
    }
  | {
      kind: 'review_quick_create';
      href: AssistantHref;
      card: ActionCard;
    }
  | {
      kind: 'clarify';
      question: string;
      choices?: string[];
      card: ActionCard;
    }
  | {
      kind: 'rejected';
      reason: string;
      card: ActionCard;
    };

export type MapConfirmOptions = {
  /** brief_context 白名单；传入则先 sanitize */
  allowedIds?: Iterable<string>;
  /** 青蛙指派日；缺省时由调用方或 execute 再补逻辑今日 */
  assignYmd?: string;
  /** 无 assignYmd 时的回退日（纯函数，避免读日界设置） */
  fallbackAssignYmd?: string;
};

function asHref(pathname: string, params?: Record<string, string>): AssistantHref {
  if (params && Object.keys(params).length > 0) {
    return { pathname, params };
  }
  return pathname;
}

function draftString(draft: Record<string, unknown> | undefined, key: string): string {
  const v = draft?.[key];
  return typeof v === 'string' ? v.trim() : '';
}

function draftNumber(draft: Record<string, unknown> | undefined, key: string): number | null {
  const v = draft?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function hrefForTaskDraft(draft: Record<string, unknown>): AssistantHref {
  const title = draftString(draft, 'title') || '新待办';
  const note = draftString(draft, 'note');
  const params: Record<string, string> = { standalone: '1', title };
  if (note) params.note = note;
  const priority = draftNumber(draft, 'priority');
  if (priority != null && priority > 0) params.priority = String(priority);
  const due = draftString(draft, 'due_ymd');
  if (due) params.due_ymd = due;
  const schedule = draft.schedule;
  if (schedule && typeof schedule === 'object') {
    try {
      params.schedule = JSON.stringify(schedule);
    } catch {
      // ignore
    }
  }
  return asHref('/add-task', params);
}

function hrefForHabitDraft(draft: Record<string, unknown>): AssistantHref {
  const name = draftString(draft, 'name') || draftString(draft, 'title') || '新习惯';
  return asHref('/add-habit', { name });
}

function hrefForMemoDraft(draft: Record<string, unknown>): AssistantHref {
  const title = draftString(draft, 'title') || '新备忘';
  const body =
    draftString(draft, 'body_plain') ||
    draftString(draft, 'body') ||
    draftString(draft, 'content') ||
    '';
  return asHref('/memo-edit/[id]', { id: 'new', title, body });
}

function hrefForWardrobeDraft(draft: Record<string, unknown>, card: ActionCard): AssistantHref {
  const id = draftString(draft, 'itemId') || draftString(draft, 'item_id') || card.ref_ids?.[0] || '';
  if (id) return asHref('/my-wardrobe', { focusItemId: id });
  return asHref('/my-wardrobe');
}

function hrefForWishDraft(draft: Record<string, unknown>): AssistantHref {
  const title = draftString(draft, 'title');
  const params: Record<string, string> = {};
  if (title) params.title = title.slice(0, 80);
  const desc =
    draftString(draft, 'description_text') || draftString(draft, 'description');
  if (desc) params.description = desc.slice(0, 500);
  const cost = draftNumber(draft, 'cost_points');
  if (cost != null) params.cost_points = String(cost);
  const icon = draftString(draft, 'icon_key');
  if (icon) params.icon_key = icon;
  return asHref('/add-wish-board-item', Object.keys(params).length ? params : undefined);
}

function hrefForRecipeDraft(draft: Record<string, unknown>): AssistantHref {
  const title = draftString(draft, 'title');
  const params: Record<string, string> = { id: 'new' };
  if (title) params.title = title;
  return asHref('/recipe-edit/[id]', params);
}

function hrefForProfileDraft(draft: Record<string, unknown>): AssistantHref {
  const persona =
    draftString(draft, 'persona') || draftString(draft, 'text') || draftString(draft, 'prefill_text');
  if (persona) return asHref('/edit-profile', { persona: persona.slice(0, 500) });
  return asHref('/edit-profile');
}

function hrefForFinanceScheduledDraft(draft: Record<string, unknown>): AssistantHref {
  const params: Record<string, string> = {};
  const name = draftString(draft, 'name');
  if (name) params.name = name.slice(0, 40);
  const amount = draftNumber(draft, 'amount');
  if (amount != null) params.amount = String(amount);
  const repeat = draftString(draft, 'repeat_hint');
  if (repeat) params.repeat = repeat;
  const account = draftString(draft, 'account_hint');
  if (account) params.account_hint = account.slice(0, 40);
  const days = draft.days;
  if (Array.isArray(days) && days.length) {
    params.days = days
      .map((d) => (typeof d === 'number' ? d : Number(d)))
      .filter((n) => Number.isFinite(n))
      .slice(0, 8)
      .join(',');
  }
  const hour = draftNumber(draft, 'hour');
  if (hour != null) params.hour = String(hour);
  const minute = draftNumber(draft, 'minute');
  if (minute != null) params.minute = String(minute);
  if (draft.include_in_budget === false) params.include_in_budget = '0';
  return asHref('/add-scheduled-expense', params);
}

function hrefForFinanceCashFlowDraft(draft: Record<string, unknown>): AssistantHref {
  const params: Record<string, string> = {};
  const kind = draftString(draft, 'entry_kind');
  if (kind) params.entry_kind = kind;
  const amount = draftNumber(draft, 'amount');
  if (amount != null) params.amount = String(amount);
  const name = draftString(draft, 'name_hint') || draftString(draft, 'name');
  if (name) params.name = name.slice(0, 40);
  const quadrant = draftString(draft, 'quadrant');
  if (quadrant) params.quadrant = quadrant;
  const assetReturn = draftNumber(draft, 'asset_return');
  if (assetReturn != null) params.asset_return = String(assetReturn);
  const liabilityMonths = draftNumber(draft, 'liability_months');
  if (liabilityMonths != null) params.liability_months = String(liabilityMonths);
  return asHref('/cash-flow/entry', params);
}

function hrefForFinanceBudgetDraft(draft: Record<string, unknown>): AssistantHref {
  const amount = draftNumber(draft, 'suggested_base_amount');
  const params: Record<string, string> = {};
  if (amount != null) params.suggested_budget = String(amount);
  return asHref('/(tabs)/finance', params);
}

function hrefForOpenRoute(card: ActionCard): AssistantHref | null {
  const moduleId = (card.module_id ?? '').trim();
  if (moduleId) {
    const fromModule = resolveModuleHref(moduleId, card.route_params);
    if (fromModule) return fromModule;
  }
  const href = (card.route_href ?? '').trim();
  if (!href) return null;
  if (card.route_params && Object.keys(card.route_params).length > 0) {
    return asHref(href, card.route_params);
  }
  return asHref(href);
}

function resolveFrogTaskId(card: ActionCard): string | null {
  const fromDraft =
    draftString(card.draft, 'frog_task_id') ||
    draftString(card.draft, 'task_id') ||
    draftString(card.draft, 'taskId');
  if (fromDraft) return fromDraft;
  const fromRef = card.ref_ids?.[0]?.trim();
  return fromRef || null;
}

function reviewHrefFromCard(card: ActionCard): AssistantHref {
  const draft = card.draft ?? {};
  const actionRaw = draftString(draft, 'action') || 'todo';
  const title = draftString(draft, 'title') || card.title || '新建议';
  const body = draftString(draft, 'body') || draftString(draft, 'note') || card.summary || '';

  if (actionRaw === 'memo') {
    return asHref('/memo-edit/[id]', { id: 'new', title, body });
  }
  if (actionRaw === 'project') {
    return asHref('/add-project', { title });
  }
  if (actionRaw === 'habit') {
    return asHref('/add-habit', { name: title });
  }
  return hrefForTaskDraft({
    title,
    note: body,
    priority: draft.priority,
    due_ymd: draft.due_ymd,
    schedule: draft.schedule,
  });
}

export function isForbiddenConfirmAction(action: string | undefined | null): boolean {
  if (!action) return false;
  return (FORBIDDEN_CONFIRM_ACTIONS as readonly string[]).includes(action);
}

/**
 * 将 ActionCard 映射为确认计划。写库类计划仅描述「打开预览/指派」，不直接写库。
 */
export function mapActionCardToConfirmPlan(
  cardIn: ActionCard,
  opts?: MapConfirmOptions,
): AssistantConfirmPlan {
  let card = cardIn;
  if (opts?.allowedIds) {
    const sanitized = sanitizeActionCardAgainstWhitelist(cardIn, opts.allowedIds);
    card = sanitized.card;
  }

  if (card.intent === 'clarify' || !card.confirm_action) {
    if (card.intent === 'clarify' || card.clarify_question) {
      return {
        kind: 'clarify',
        question: card.clarify_question || card.summary || card.title || '需要补充信息',
        choices: card.clarify_choices,
        card,
      };
    }
    return { kind: 'rejected', reason: '缺少 confirm_action', card };
  }

  if (isForbiddenConfirmAction(card.confirm_action)) {
    return {
      kind: 'rejected',
      reason: '敏感操作禁止由助手确认执行',
      card,
    };
  }

  const action = card.confirm_action as AssistantConfirmAction;
  const draft = card.draft ?? {};

  switch (action) {
    case 'preview_finance_txn':
      return { kind: 'preview_finance_txn', draft, card };
    case 'preview_finance_transfer':
      return { kind: 'preview_finance_transfer', draft, card };
    case 'preview_finance_scheduled':
      return {
        kind: 'preview_finance_scheduled',
        draft,
        href: hrefForFinanceScheduledDraft(draft),
        card,
      };
    case 'preview_finance_cash_flow':
      return {
        kind: 'preview_finance_cash_flow',
        draft,
        href: hrefForFinanceCashFlowDraft(draft),
        card,
      };
    case 'preview_finance_budget':
      return {
        kind: 'preview_finance_budget',
        draft,
        href: hrefForFinanceBudgetDraft(draft),
        card,
      };
    case 'preview_food_intake':
      return { kind: 'preview_food_intake', draft, card };
    case 'preview_task':
      return { kind: 'preview_task', draft, href: hrefForTaskDraft(draft), card };
    case 'preview_habit':
      return { kind: 'preview_habit', draft, href: hrefForHabitDraft(draft), card };
    case 'preview_memo':
      return { kind: 'preview_memo', draft, href: hrefForMemoDraft(draft), card };
    case 'preview_wardrobe_item':
      return {
        kind: 'preview_wardrobe_item',
        draft,
        href: hrefForWardrobeDraft(draft, card),
        card,
      };
    case 'preview_wish':
      return { kind: 'preview_wish', draft, href: hrefForWishDraft(draft), card };
    case 'preview_recipe':
      return { kind: 'preview_recipe', draft, href: hrefForRecipeDraft(draft), card };
    case 'preview_profile':
      return { kind: 'preview_profile', draft, href: hrefForProfileDraft(draft), card };
    case 'open_route': {
      const href = hrefForOpenRoute(card);
      if (!href) {
        return { kind: 'rejected', reason: 'open_route 缺少 module_id / route_href', card };
      }
      return { kind: 'open_route', href, card };
    }
    case 'frog_assign': {
      const taskId = resolveFrogTaskId(card);
      if (!taskId) {
        return { kind: 'rejected', reason: 'frog_assign 缺少任务 id', card };
      }
      const assignYmd =
        opts?.assignYmd?.trim() ||
        draftString(draft, 'assign_ymd') ||
        opts?.fallbackAssignYmd?.trim() ||
        '';
      if (!assignYmd) {
        return { kind: 'rejected', reason: 'frog_assign 缺少 assignYmd', card };
      }
      return { kind: 'frog_assign', taskId, assignYmd, card };
    }
    case 'review_quick_create':
      return { kind: 'review_quick_create', href: reviewHrefFromCard(card), card };
    default:
      return { kind: 'rejected', reason: `未知 confirm_action: ${String(action)}`, card };
  }
}

export type ExecuteConfirmDeps = {
  openFinancePreview?: (draft: Record<string, unknown>, card: ActionCard) => void | Promise<void>;
  openFinanceTransferPreview?: (draft: Record<string, unknown>, card: ActionCard) => void | Promise<void>;
  openFoodPreview?: (draft: Record<string, unknown>, card: ActionCard) => void | Promise<void>;
  push?: (href: AssistantHref) => void | Promise<void>;
  assignFrog?: (taskId: string, assignYmd: string) => Promise<void>;
};

export type ExecuteConfirmResult =
  | { ok: true; plan: AssistantConfirmPlan }
  | { ok: false; plan: AssistantConfirmPlan; error: string };

/**
 * 执行确认计划。preview_* 需注入 open* 回调；未注入则返回错误（不静默写库）。
 * frog_assign 默认动态加载 assignFrogForDay，测试可注入 assignFrog。
 */
export async function executeAssistantConfirm(
  plan: AssistantConfirmPlan,
  deps: ExecuteConfirmDeps = {},
): Promise<ExecuteConfirmResult> {
  switch (plan.kind) {
    case 'rejected':
      return { ok: false, plan, error: plan.reason };
    case 'clarify':
      return { ok: false, plan, error: plan.question };
    case 'preview_finance_txn':
      if (!deps.openFinancePreview) {
        return { ok: false, plan, error: '未接入财务预览 Sheet' };
      }
      await deps.openFinancePreview(plan.draft, plan.card);
      return { ok: true, plan };
    case 'preview_finance_transfer':
      if (!deps.openFinanceTransferPreview) {
        return { ok: false, plan, error: '未接入转账预览 Sheet' };
      }
      await deps.openFinanceTransferPreview(plan.draft, plan.card);
      return { ok: true, plan };
    case 'preview_finance_scheduled':
    case 'preview_finance_cash_flow':
    case 'preview_finance_budget': {
      if (!deps.push) {
        return { ok: false, plan, error: '未接入路由 push' };
      }
      await deps.push(plan.href);
      return { ok: true, plan };
    }
    case 'preview_food_intake':
      if (!deps.openFoodPreview) {
        return { ok: false, plan, error: '未接入饮食预览 Sheet' };
      }
      await deps.openFoodPreview(plan.draft, plan.card);
      return { ok: true, plan };
    case 'preview_task':
    case 'preview_habit':
    case 'preview_memo':
    case 'preview_wardrobe_item':
    case 'preview_wish':
    case 'preview_recipe':
    case 'preview_profile':
    case 'open_route':
    case 'review_quick_create': {
      if (!deps.push) {
        return { ok: false, plan, error: '未接入路由 push' };
      }
      await deps.push(plan.href);
      return { ok: true, plan };
    }
    case 'frog_assign': {
      if (deps.assignFrog) {
        await deps.assignFrog(plan.taskId, plan.assignYmd);
        return { ok: true, plan };
      }
      const { assignFrogForDay } = await import('@/lib/frog-candidates-api');
      await assignFrogForDay({ kind: 'task', id: plan.taskId, assignYmd: plan.assignYmd });
      return { ok: true, plan };
    }
    default:
      return { ok: false, plan, error: '未知计划类型' };
  }
}
