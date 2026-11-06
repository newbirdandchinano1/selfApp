/**
 * 全局助手 ActionCard 契约（对齐《全局AI助手方案》§5）。
 * 写库类必须 needs_confirm；推荐 id 只能来自 brief_context 白名单。
 */

export type AssistantDomain =
  | 'finance'
  | 'food'
  | 'task'
  | 'habit'
  | 'memo'
  | 'wardrobe'
  | 'recipe'
  | 'wish'
  | 'review'
  | 'general';

export type AssistantIntent =
  | 'create'
  | 'insight'
  | 'navigate'
  | 'clarify'
  | 'suggest_today'
  | 'multi';

export type AssistantConfirmAction =
  | 'preview_finance_txn'
  | 'preview_food_intake'
  | 'preview_task'
  | 'preview_habit'
  | 'preview_memo'
  | 'preview_wardrobe_item'
  | 'preview_wish'
  | 'preview_recipe'
  | 'preview_profile'
  | 'open_route'
  | 'frog_assign'
  | 'review_quick_create';

/** 敏感操作永不作为 confirm_action（兑奖/删库/改余额/批量完成等） */
export const FORBIDDEN_CONFIRM_ACTIONS = [
  'redeem_wish',
  'delete',
  'delete_record',
  'adjust_balance',
  'complete_task',
  'batch_complete',
  'arrive_road',
] as const;

export type ForbiddenConfirmAction = (typeof FORBIDDEN_CONFIRM_ACTIONS)[number];

export const ASSISTANT_CONFIRM_ACTIONS: readonly AssistantConfirmAction[] = [
  'preview_finance_txn',
  'preview_food_intake',
  'preview_task',
  'preview_habit',
  'preview_memo',
  'preview_wardrobe_item',
  'preview_wish',
  'preview_recipe',
  'preview_profile',
  'open_route',
  'frog_assign',
  'review_quick_create',
] as const;

export type ActionCard = {
  id: string;
  domain: AssistantDomain;
  intent: AssistantIntent;
  title: string;
  summary?: string;
  confidence: number;
  needs_confirm: boolean;
  /** 对齐 L1 场景草稿；字段名与对应域 parse 响应一致 */
  draft?: Record<string, unknown>;
  /** 推荐/指派类：必须是请求摘要里出现过的 id */
  ref_ids?: string[];
  confirm_action?: AssistantConfirmAction;
  route_href?: string;
  route_params?: Record<string, string>;
  clarify_question?: string;
  clarify_choices?: string[];
};

const DOMAINS = new Set<string>([
  'finance',
  'food',
  'task',
  'habit',
  'memo',
  'wardrobe',
  'recipe',
  'wish',
  'review',
  'general',
]);

const INTENTS = new Set<string>([
  'create',
  'insight',
  'navigate',
  'clarify',
  'suggest_today',
  'multi',
]);

const CONFIRM_SET = new Set<string>(ASSISTANT_CONFIRM_ACTIONS);
const FORBIDDEN_SET = new Set<string>(FORBIDDEN_CONFIRM_ACTIONS);

/** draft / route_params 内可能出现的实体 id 字段（白名单校验） */
export const ASSISTANT_DRAFT_ID_KEYS = [
  'frog_task_id',
  'task_id',
  'taskId',
  'habit_id',
  'habitId',
  'memo_id',
  'memoId',
  'item_id',
  'itemId',
  'outfit_id',
  'outfitId',
  'recipe_id',
  'recipeId',
  'wish_id',
  'wishId',
  'project_id',
  'projectId',
  'account_id',
  'accountId',
  'tag_id',
  'tagId',
  'id',
] as const;

export type SanitizeActionCardResult = {
  card: ActionCard;
  /** 被丢弃的 id（不在白名单） */
  dropped_ids: string[];
  /** 因关键 id 整卡降级为 clarify */
  degraded_to_clarify: boolean;
};

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function clampConfidence(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseRouteParams(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v);
    else if (typeof v === 'boolean') out[k] = v ? '1' : '0';
  }
  return Object.keys(out).length ? out : undefined;
}

function parseStringList(raw: unknown, max = 20): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    const s = asTrimmedString(item);
    if (!s) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out.length ? out : undefined;
}

function isWriteConfirmAction(action: AssistantConfirmAction | undefined): boolean {
  if (!action) return false;
  return (
    action.startsWith('preview_') ||
    action === 'frog_assign' ||
    action === 'review_quick_create'
  );
}

/**
 * 将 Agent 原始 JSON 规范为 ActionCard；非法 confirm_action / 敏感动作剔除。
 * 不抛错：坏卡尽量降级为 clarify。
 */
export function parseActionCard(raw: unknown, fallbackId = 'c0'): ActionCard {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const id = asTrimmedString(o.id) || fallbackId;
  const domainRaw = asTrimmedString(o.domain) || 'general';
  const domain: AssistantDomain = DOMAINS.has(domainRaw) ? (domainRaw as AssistantDomain) : 'general';
  const intentRaw = asTrimmedString(o.intent) || 'clarify';
  let intent: AssistantIntent = INTENTS.has(intentRaw) ? (intentRaw as AssistantIntent) : 'clarify';

  const title = asTrimmedString(o.title) || (intent === 'clarify' ? '需要补充' : '助手建议');
  const summary = asTrimmedString(o.summary) ?? undefined;
  const confidence = clampConfidence(o.confidence);

  let confirm_action: AssistantConfirmAction | undefined;
  const confirmRaw = asTrimmedString(o.confirm_action);
  if (confirmRaw) {
    if (FORBIDDEN_SET.has(confirmRaw)) {
      intent = 'clarify';
      confirm_action = undefined;
    } else if (CONFIRM_SET.has(confirmRaw)) {
      confirm_action = confirmRaw as AssistantConfirmAction;
    }
  }

  const draft =
    o.draft && typeof o.draft === 'object' && !Array.isArray(o.draft)
      ? ({ ...(o.draft as Record<string, unknown>) } as Record<string, unknown>)
      : undefined;

  const ref_ids = parseStringList(o.ref_ids);
  const route_href = asTrimmedString(o.route_href) ?? undefined;
  const route_params = parseRouteParams(o.route_params);
  const clarify_question = asTrimmedString(o.clarify_question) ?? undefined;
  const clarify_choices = parseStringList(o.clarify_choices, 8);

  let needs_confirm = o.needs_confirm === true;
  if (isWriteConfirmAction(confirm_action)) {
    needs_confirm = true;
  }
  if (intent === 'clarify') {
    needs_confirm = false;
  }

  return {
    id,
    domain,
    intent,
    title,
    summary,
    confidence,
    needs_confirm,
    draft,
    ref_ids,
    confirm_action,
    route_href,
    route_params,
    clarify_question,
    clarify_choices,
  };
}

export function parseActionCards(raw: unknown): ActionCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => parseActionCard(item, `c${i}`));
}

function collectDraftIds(draft: Record<string, unknown> | undefined): string[] {
  if (!draft) return [];
  const out: string[] = [];
  for (const key of ASSISTANT_DRAFT_ID_KEYS) {
    const v = draft[key];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string' && item.trim()) out.push(item.trim());
      }
    }
  }
  // quick_add_keys / recipe_ids 等数组字段
  for (const key of ['quick_add_keys', 'recipe_ids', 'itemIds', 'item_ids', 'tag_ids', 'focus_task_ids']) {
    const v = draft[key];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      if (typeof item === 'string' && item.trim()) out.push(item.trim());
    }
  }
  return out;
}

function stripUnknownDraftIds(
  draft: Record<string, unknown> | undefined,
  allowed: Set<string>,
): { draft: Record<string, unknown> | undefined; dropped: string[] } {
  if (!draft) return { draft: undefined, dropped: [] };
  const next: Record<string, unknown> = { ...draft };
  const dropped: string[] = [];

  for (const key of ASSISTANT_DRAFT_ID_KEYS) {
    if (!(key in next)) continue;
    const v = next[key];
    if (typeof v === 'string') {
      const id = v.trim();
      if (id && !allowed.has(id)) {
        dropped.push(id);
        delete next[key];
      }
    } else if (Array.isArray(v)) {
      const kept: string[] = [];
      for (const item of v) {
        if (typeof item !== 'string') continue;
        const id = item.trim();
        if (!id) continue;
        if (allowed.has(id)) kept.push(id);
        else dropped.push(id);
      }
      if (kept.length) next[key] = kept;
      else delete next[key];
    }
  }

  for (const key of ['quick_add_keys', 'recipe_ids', 'itemIds', 'item_ids', 'tag_ids', 'focus_task_ids']) {
    if (!(key in next) || !Array.isArray(next[key])) continue;
    const kept: string[] = [];
    for (const item of next[key] as unknown[]) {
      if (typeof item !== 'string') continue;
      const id = item.trim();
      if (!id) continue;
      if (allowed.has(id)) kept.push(id);
      else dropped.push(id);
    }
    if (kept.length) next[key] = kept;
    else delete next[key];
  }

  return { draft: next, dropped };
}

function degradeToClarify(card: ActionCard, reason: string): ActionCard {
  return {
    id: card.id,
    domain: card.domain === 'general' ? 'general' : card.domain,
    intent: 'clarify',
    title: '需要补充',
    summary: reason,
    confidence: Math.min(card.confidence, 0.45),
    needs_confirm: false,
    clarify_question: card.clarify_question || reason,
    clarify_choices: card.clarify_choices,
  };
}

/**
 * id 白名单校验：ref_ids / draft 内实体 id 不在 allowedIds → 丢弃该字段；
 * 若写操作依赖的核心 id 全部失效，整卡降级为 clarify。
 */
export function sanitizeActionCardAgainstWhitelist(
  card: ActionCard,
  allowedIds: Iterable<string>,
): SanitizeActionCardResult {
  const allowed = new Set<string>();
  for (const id of allowedIds) {
    const s = String(id ?? '').trim();
    if (s) allowed.add(s);
  }

  const dropped_ids: string[] = [];
  const next: ActionCard = { ...card };

  if (next.ref_ids?.length) {
    const kept: string[] = [];
    for (const id of next.ref_ids) {
      if (allowed.has(id)) kept.push(id);
      else dropped_ids.push(id);
    }
    next.ref_ids = kept.length ? kept : undefined;
  }

  if (next.route_params) {
    const rp: Record<string, string> = { ...next.route_params };
    for (const key of ['id', 'taskId', 'habitId', 'memoId', 'itemId', 'outfitId', 'wishId', 'recipeId']) {
      const v = rp[key]?.trim();
      if (!v) continue;
      if (!allowed.has(v)) {
        dropped_ids.push(v);
        delete rp[key];
      }
    }
    next.route_params = Object.keys(rp).length ? rp : undefined;
  }

  const stripped = stripUnknownDraftIds(next.draft, allowed);
  next.draft = stripped.draft;
  dropped_ids.push(...stripped.dropped);

  const needsEntity =
    next.confirm_action === 'frog_assign' ||
    next.intent === 'suggest_today' ||
    (next.confirm_action === 'open_route' && Boolean(next.route_params?.id));

  const coreIds = [
    ...(next.ref_ids ?? []),
    ...collectDraftIds(next.draft),
    next.route_params?.id,
    typeof next.draft?.frog_task_id === 'string' ? next.draft.frog_task_id : null,
  ].filter((x): x is string => typeof x === 'string' && !!x.trim());

  let degraded_to_clarify = false;
  if (needsEntity && coreIds.length === 0 && dropped_ids.length > 0) {
    degraded_to_clarify = true;
    return {
      card: degradeToClarify(next, '推荐条目不在今日摘要中，请换一种说法或打开对应页面。'),
      dropped_ids: [...new Set(dropped_ids)],
      degraded_to_clarify,
    };
  }

  if (next.confirm_action && FORBIDDEN_SET.has(next.confirm_action)) {
    degraded_to_clarify = true;
    return {
      card: degradeToClarify(next, '该操作不能由助手直接执行，请到对应页面手动完成。'),
      dropped_ids: [...new Set(dropped_ids)],
      degraded_to_clarify,
    };
  }

  return {
    card: next,
    dropped_ids: [...new Set(dropped_ids)],
    degraded_to_clarify,
  };
}

export function sanitizeActionCardsAgainstWhitelist(
  cards: ActionCard[],
  allowedIds: Iterable<string>,
): { cards: ActionCard[]; dropped_ids: string[] } {
  const allDropped: string[] = [];
  const out = cards.map(c => {
    const r = sanitizeActionCardAgainstWhitelist(c, allowedIds);
    allDropped.push(...r.dropped_ids);
    return r.card;
  });
  return { cards: out, dropped_ids: [...new Set(allDropped)] };
}
