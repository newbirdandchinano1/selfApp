import { makeTimestampEntityId } from '@/lib/entity-id';
import { createWishItem, getWishItemById, updateWishItem } from '@/lib/repositories/wish-list/wish-list';
import {
  getWishSavingsPlanIdFromExtra,
  setWishSavingsPlanIdInExtra,
} from '@/lib/repositories/wish-list/wish-list-extra';
import type { WishItemRow } from '@/lib/repositories/wish-list/wish-list.types';
import {
  createSavingsPlan,
  deleteSavingsPlan,
  getSavingsPlanById,
  getSavingsPlans,
  SAVINGS_PLAN_MAX_TARGET_AMOUNT,
  updateSavingsPlan,
} from '@/lib/repositories/savings-plan/savings-plan';
import {
  getSavingsWishItemIdFromExtra,
  setSavingsWishItemIdInExtra,
} from '@/lib/repositories/savings-plan/savings-plan-extra';
import type { CreateSavingsPlanInput, SavingsPlanRow } from '@/lib/repositories/savings-plan/savings-plan.types';

export type WishSavingsLinkedSaveInput = {
  name: string;
  target_amount: number;
  start_date: string;
  end_date: string;
  avatar_uri: string | null;
  category_id?: string | null;
  category_label?: string | null;
  desire_level?: number;
  reason?: string | null;
};

function clampTargetAmount(value: number) {
  return Math.min(Math.max(0, Math.round(value)), 99_999_999);
}

function createSavingsPlanId() {
  return makeTimestampEntityId('ssp_', 8);
}

function toIsoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addCalendarDays(d: Date, days: number) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function isSavingsPlanDateSpanValid(startIso: string, endIso: string): boolean {
  if (endIso < startIso) return false;
  const [ys, ms, ds] = startIso.split('-').map(x => parseInt(x, 10));
  const [ye, me, de] = endIso.split('-').map(x => parseInt(x, 10));
  if (!ys || !ms || !ds || !ye || !me || !de) return false;
  const spanDays = Math.round(
    (new Date(ye, me - 1, de).getTime() - new Date(ys, ms - 1, ds).getTime()) / 86400000,
  );
  return spanDays >= 1;
}

export function defaultSavingsPlanDates() {
  const start = new Date();
  const end = addCalendarDays(start, 90);
  return { start_date: toIsoDate(start), end_date: toIsoDate(end) };
}

export function getLinkedSavingsPlanId(wish: Pick<WishItemRow, 'extra_data'>): string | null {
  return getWishSavingsPlanIdFromExtra(wish.extra_data);
}

export function getLinkedWishItemId(plan: Pick<SavingsPlanRow, 'extra_data'>): string | null {
  return getSavingsWishItemIdFromExtra(plan.extra_data);
}

async function linkWishAndPlan(wishId: string, planId: string) {
  const wish = await getWishItemById(wishId);
  const plan = await getSavingsPlanById(planId);
  if (!wish || !plan) return;

  await updateWishItem(wishId, {
    extra_data: setWishSavingsPlanIdInExtra(wish.extra_data, planId),
  });
  await updateSavingsPlan(planId, {
    extra_data: setSavingsWishItemIdInExtra(plan.extra_data, wishId),
  });
}

/** 解析计划关联的心愿 id（读 plan.extra，或反向查心愿上的 savings_plan_id） */
export async function resolveLinkedWishIdForPlan(
  plan: Pick<SavingsPlanRow, 'id' | 'extra_data'>,
): Promise<string | null> {
  const fromPlan = getLinkedWishItemId(plan);
  if (fromPlan) return fromPlan;

  const { listWishItems } = await import('@/lib/repositories/wish-list/wish-list');
  const wishes = await listWishItems();
  for (const w of wishes) {
    if (getLinkedSavingsPlanId(w) === plan.id) return w.id;
  }
  return null;
}

/** 解析心愿关联的计划 id（读 wish.extra，或反向查计划上的 wish_item_id） */
export async function resolveLinkedPlanIdForWish(
  wish: Pick<WishItemRow, 'id' | 'extra_data'>,
): Promise<string | null> {
  const fromWish = getLinkedSavingsPlanId(wish);
  if (fromWish) return fromWish;

  const plans = await getSavingsPlans();
  for (const p of plans) {
    if (getLinkedWishItemId(p) === wish.id) return p.id;
  }
  return null;
}

/** 为心愿创建关联存钱计划（名称、目标金额、头像与心愿对齐） */
export async function createLinkedSavingsPlanForWish(wish: WishItemRow): Promise<string> {
  const existingId = getLinkedSavingsPlanId(wish);
  if (existingId) {
    const existing = await getSavingsPlanById(existingId);
    if (existing) return existingId;
  }

  const dates = defaultSavingsPlanDates();
  const planId = createSavingsPlanId();
  const target = Math.min(
    Math.max(0, Math.round(Number.isFinite(wish.price) ? wish.price : 0)),
    99_999_999,
  );

  await createSavingsPlan({
    id: planId,
    name: wish.name.trim() || '存钱计划',
    start_date: dates.start_date,
    end_date: dates.end_date,
    target_amount: target,
    avatar_uri: wish.reference_image_uri,
    extra_data: setSavingsWishItemIdInExtra(null, wish.id),
  });
  await linkWishAndPlan(wish.id, planId);
  return planId;
}

/** 为存钱计划创建关联心愿（名称、价格、参考图与计划对齐） */
export async function createLinkedWishForSavingsPlan(plan: SavingsPlanRow): Promise<string> {
  const existingId = getLinkedWishItemId(plan);
  if (existingId) {
    const existing = await getWishItemById(existingId);
    if (existing) return existingId;
  }

  const wishId = await createWishItem({
    name: plan.name.trim() || '好物',
    price: Math.max(0, plan.target_amount),
    category_id: null,
    category_label: null,
    desire_level: 3,
    reason: null,
    reference_image_uri: plan.avatar_uri,
    extra_data: setWishSavingsPlanIdInExtra(null, plan.id),
  });
  await linkWishAndPlan(wishId, plan.id);
  return wishId;
}

/** 将存钱计划的核心展示字段同步为心愿当前值 */
export async function syncSavingsPlanFromWish(wishId: string) {
  const wish = await getWishItemById(wishId);
  if (!wish) return;

  let planId = getLinkedSavingsPlanId(wish);
  if (!planId) {
    planId = await createLinkedSavingsPlanForWish(wish);
    return;
  }

  const plan = await getSavingsPlanById(planId);
  if (!plan) {
    await createLinkedSavingsPlanForWish(wish);
    return;
  }

  const target = Math.min(
    Math.max(0, Math.round(Number.isFinite(wish.price) ? wish.price : 0)),
    99_999_999,
  );

  await updateSavingsPlan(planId, {
    name: wish.name.trim() || plan.name,
    target_amount: target,
    avatar_uri: wish.reference_image_uri,
    extra_data: setSavingsWishItemIdInExtra(plan.extra_data, wish.id),
  });
}

/** 创建好物并同步创建关联存钱计划（字段与存钱计划添加表单一致） */
export async function createWishWithLinkedPlan(input: WishSavingsLinkedSaveInput): Promise<string> {
  const target = clampTargetAmount(input.target_amount);
  const wishId = await createWishItem({
    name: input.name.trim(),
    price: target,
    category_id: input.category_id ?? null,
    category_label: input.category_label ?? null,
    desire_level: input.desire_level ?? 3,
    reason: input.reason?.trim() ?? null,
    reference_image_uri: input.avatar_uri,
  });

  const planId = createSavingsPlanId();
  await createSavingsPlan({
    id: planId,
    name: input.name.trim(),
    start_date: input.start_date,
    end_date: input.end_date,
    target_amount: target,
    avatar_uri: input.avatar_uri,
    extra_data: setSavingsWishItemIdInExtra(null, wishId),
  });
  await linkWishAndPlan(wishId, planId);
  return wishId;
}

/** 更新好物并同步关联存钱计划 */
export async function updateWishWithLinkedPlan(
  wishId: string,
  input: WishSavingsLinkedSaveInput,
  options?: { avatarChanged?: boolean },
): Promise<void> {
  const target = clampTargetAmount(input.target_amount);
  const current = await getWishItemById(wishId);
  if (!current) throw new Error('未找到该好物');

  await updateWishItem(wishId, {
    name: input.name.trim(),
    price: target,
    category_id: input.category_id ?? null,
    category_label: input.category_label ?? null,
    desire_level: input.desire_level ?? 3,
    reason: input.reason?.trim() ?? null,
    ...(options?.avatarChanged ? { reference_image_uri: input.avatar_uri } : {}),
  });

  let planId = getLinkedSavingsPlanId(current);
  if (!planId) {
    planId = createSavingsPlanId();
    await createSavingsPlan({
      id: planId,
      name: input.name.trim(),
      start_date: input.start_date,
      end_date: input.end_date,
      target_amount: target,
      avatar_uri: input.avatar_uri,
      extra_data: setSavingsWishItemIdInExtra(null, wishId),
    });
    await linkWishAndPlan(wishId, planId);
    return;
  }

  const plan = await getSavingsPlanById(planId);
  if (!plan) {
    await createLinkedSavingsPlanForWish(await getWishItemById(wishId) as WishItemRow);
    return;
  }

  await updateSavingsPlan(planId, {
    name: input.name.trim(),
    start_date: input.start_date,
    end_date: input.end_date,
    target_amount: target,
    avatar_uri: input.avatar_uri,
    extra_data: setSavingsWishItemIdInExtra(plan.extra_data, wishId),
  });
}

/** 创建存钱计划并同步创建关联好物（含类别、心动等级、心动理由） */
export async function createSavingsPlanWithLinkedWish(
  planInput: CreateSavingsPlanInput,
  extras: Pick<WishSavingsLinkedSaveInput, 'category_id' | 'category_label' | 'desire_level' | 'reason'>,
): Promise<void> {
  await createSavingsPlan(planInput);
  const wishId = await createWishItem({
    name: planInput.name.trim(),
    price: clampTargetAmount(planInput.target_amount),
    category_id: extras.category_id ?? null,
    category_label: extras.category_label ?? null,
    desire_level: extras.desire_level ?? 3,
    reason: extras.reason?.trim() ?? null,
    reference_image_uri: planInput.avatar_uri ?? null,
    extra_data: setWishSavingsPlanIdInExtra(null, planInput.id),
  });
  await linkWishAndPlan(wishId, planInput.id);
}

/** 更新存钱计划并同步关联好物（含类别、心动等级、心动理由） */
export async function updateSavingsPlanWithLinkedWish(
  planId: string,
  input: WishSavingsLinkedSaveInput,
  options?: { avatarChanged?: boolean },
): Promise<void> {
  const target = clampTargetAmount(input.target_amount);
  await updateSavingsPlan(planId, {
    name: input.name.trim(),
    start_date: input.start_date,
    end_date: input.end_date,
    target_amount: target,
    avatar_uri: input.avatar_uri,
  });

  const plan = await getSavingsPlanById(planId);
  if (!plan) throw new Error('计划不存在');

  let wishId = getLinkedWishItemId(plan);
  if (!wishId) {
    wishId = await createWishItem({
      name: input.name.trim(),
      price: target,
      category_id: input.category_id ?? null,
      category_label: input.category_label ?? null,
      desire_level: input.desire_level ?? 3,
      reason: input.reason?.trim() ?? null,
      reference_image_uri: input.avatar_uri,
      extra_data: setWishSavingsPlanIdInExtra(null, planId),
    });
    await linkWishAndPlan(wishId, planId);
    return;
  }

  await updateWishWithLinkedPlan(wishId, input, {
    avatarChanged: options?.avatarChanged ?? true,
  });
}

/** 将心愿的名称、预估价格、参考图同步为存钱计划当前值 */
export async function syncWishItemFromSavingsPlan(planId: string) {
  const plan = await getSavingsPlanById(planId);
  if (!plan) return;

  let wishId = getLinkedWishItemId(plan);
  if (!wishId) {
    wishId = await createLinkedWishForSavingsPlan(plan);
    return;
  }

  const wish = await getWishItemById(wishId);
  if (!wish) {
    await createLinkedWishForSavingsPlan(plan);
    return;
  }

  await updateWishItem(wishId, {
    name: plan.name.trim() || wish.name,
    price: Math.max(0, plan.target_amount),
    reference_image_uri: plan.avatar_uri,
    extra_data: setWishSavingsPlanIdInExtra(wish.extra_data, plan.id),
  });
}

/** 创建存钱计划后确保有心愿条目与之对应 */
export async function onSavingsPlanCreated(input: CreateSavingsPlanInput) {
  const plan = await getSavingsPlanById(input.id);
  if (!plan) return;

  const linkedWishId = getLinkedWishItemId(plan);
  if (linkedWishId) {
    await syncWishItemFromSavingsPlan(plan.id);
    return;
  }

  await createLinkedWishForSavingsPlan(plan);
}

/** 更新存钱计划后同步心愿 */
export async function onSavingsPlanUpdated(planId: string) {
  await syncWishItemFromSavingsPlan(planId);
}

/** 删除存钱计划时一并软删关联心愿 */
export async function deleteLinkedWishForPlan(plan: SavingsPlanRow | null) {
  if (!plan) return;
  const wishId = await resolveLinkedWishIdForPlan(plan);
  if (!wishId) return;
  const { deleteWishItem } = await import('@/lib/repositories/wish-list/wish-list');
  await deleteWishItem(wishId);
}

/** 删除心愿时一并软删关联存钱计划 */
export async function deleteLinkedPlanForWish(wish: WishItemRow | null) {
  if (!wish) return;
  const planId = await resolveLinkedPlanIdForWish(wish);
  if (!planId) return;
  await deleteSavingsPlan(planId);
}

/** 按计划 id 索引关联的心愿单条目（用于存钱计划卡片展示） */
export async function loadWishItemsByPlanId(): Promise<Record<string, WishItemRow>> {
  const [plans, wishes] = await Promise.all([
    getSavingsPlans(),
    (await import('@/lib/repositories/wish-list/wish-list')).listWishItems(),
  ]);
  const wishById = new Map(wishes.map((w) => [w.id, w]));
  const map: Record<string, WishItemRow> = {};
  for (const plan of plans) {
    const wishId = getLinkedWishItemId(plan);
    if (!wishId) continue;
    const wish = wishById.get(wishId);
    if (wish) map[plan.id] = wish;
  }
  return map;
}

/**
 * 修复心愿与存钱计划的双向关联（不自动为「从未关联」的计划批量新建心愿）。
 */
export async function repairWishSavingsLinks() {
  const [wishes, plans] = await Promise.all([
    (await import('@/lib/repositories/wish-list/wish-list')).listWishItems(),
    getSavingsPlans(),
  ]);

  const planById = new Map(plans.map((p) => [p.id, p]));
  const wishById = new Map(wishes.map((w) => [w.id, w]));

  for (const wish of wishes) {
    const planId = getLinkedSavingsPlanId(wish);
    if (planId && planById.has(planId)) {
      if (getLinkedWishItemId(planById.get(planId)!) !== wish.id) {
        await linkWishAndPlan(wish.id, planId);
      }
      continue;
    }
    await createLinkedSavingsPlanForWish(wish);
  }

  for (const plan of plans) {
    if (!isSavingsPlanDateSpanValid(plan.start_date, plan.end_date)) continue;
    if (plan.target_amount < 0 || plan.target_amount > SAVINGS_PLAN_MAX_TARGET_AMOUNT) continue;

    const explicitWishId = getLinkedWishItemId(plan);
    if (explicitWishId) {
      if (wishById.has(explicitWishId) && getLinkedSavingsPlanId(wishById.get(explicitWishId)!) !== plan.id) {
        await linkWishAndPlan(explicitWishId, plan.id);
        continue;
      }
      if (wishById.has(explicitWishId)) continue;
      const freshWish = await getWishItemById(explicitWishId);
      if (freshWish) continue;
      await createLinkedWishForSavingsPlan(plan);
    }
  }
}
