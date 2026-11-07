/**
 * S9.3 W1+W3：commit_habit / commit_habit_checkin / commit_habit_context（动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftString, fail, ok, requestPushPending } from './shared';

async function resolveHabitId(draft: Record<string, unknown>): Promise<
  { id: string; name: string } | { error: string }
> {
  const explicit =
    draftString(draft, 'habit_id') || draftString(draft, 'id') || draftString(draft, 'habitId');
  const name = draftString(draft, 'habit_name') || draftString(draft, 'name');
  if (!explicit && !name) return { error: '请指定习惯名称或 id' };

  const { getHabitById, getHabits } = await import('@/lib/repositories/habits/habit');
  if (explicit) {
    const row = await getHabitById(explicit);
    if (row) return { id: row.id, name: row.name };
    return { error: '找不到该习惯，请刷新列表后重试' };
  }
  const habits = await getHabits();
  const needle = name.toLowerCase();
  const hit =
    habits.find(h => h.name.trim().toLowerCase() === needle) ||
    habits.find(h => h.name.trim().toLowerCase().includes(needle));
  if (!hit) return { error: `找不到习惯「${name}」，请先创建或核对名称` };
  return { id: hit.id, name: hit.name };
}

export async function commitHabit(draft: Record<string, unknown>): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name') || draftString(draft, 'title');
  const existingId =
    draftString(draft, 'habit_id') || draftString(draft, 'id') || draftString(draft, 'habitId');

  if (existingId) {
    const { updateHabit, getHabitById } = await import('@/lib/repositories/habits/habit');
    const current = await getHabitById(existingId);
    if (!current) return fail('habit_missing', '找不到要更新的习惯');
    const nextName = (name || current.name).slice(0, 40);
    let context =
      draftString(draft, 'context') || draftString(draft, 'context_name') || current.context;
    await updateHabit(existingId, {
      name: nextName,
      context,
      note: draftString(draft, 'note') || current.note,
      icon: draftString(draft, 'icon') || current.icon,
      tag: draftString(draft, 'tag') || current.tag,
    });
    return ok(existingId, `已更新习惯「${nextName}」`);
  }

  if (!name) {
    return fail('incomplete_draft', '缺少习惯名称');
  }

  const { DEFAULT_HABIT_ICON } = await import('@/lib/constants/entity-icon-choices');
  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createHabit } = await import('@/lib/repositories/habits/habit');

  let context = draftString(draft, 'context') || draftString(draft, 'context_name');
  if (!context) {
    try {
      const { getHabitContexts } = await import('@/lib/repositories/habits/habit-context');
      const contexts = await getHabitContexts();
      context = contexts[0]?.name?.trim() || '全天';
    } catch {
      context = '全天';
    }
  }

  const icon = draftString(draft, 'icon') || DEFAULT_HABIT_ICON;
  const habitId = makeTimestampEntityId('hab_', 8);
  await createHabit({
    id: habitId,
    name: name.slice(0, 40),
    context,
    icon,
    note: draftString(draft, 'note') || null,
    tag: draftString(draft, 'tag') || null,
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });

  return ok(habitId, `已创建习惯「${name.slice(0, 40)}」`);
}

export async function commitHabitCheckin(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const resolved = await resolveHabitId(draft);
  if ('error' in resolved) return fail('incomplete_draft', resolved.error);

  const { formatYmd } = await import('@/lib/date');
  const ymd = draftString(draft, 'ymd') || draftString(draft, 'record_date') || formatYmd(new Date());
  const mode = draftString(draft, 'mode').toLowerCase();
  const subId = draftString(draft, 'sub_habit_id') || draftString(draft, 'subHabitId');

  if (subId) {
    const { toggleSubHabitCheckIn } = await import('@/lib/repositories/habits/habit-sub');
    await toggleSubHabitCheckIn({
      habitId: resolved.id,
      subHabitId: subId,
      ymd,
      done: true,
    });
    return ok(resolved.id, `已勾选「${resolved.name}」子习惯`);
  }

  if (mode === 'break_clean' || mode === 'break' || mode === 'clean') {
    const { confirmBreakHabitDayClean } = await import(
      '@/lib/repositories/habits/habit-check-in'
    );
    await confirmBreakHabitDayClean(resolved.id, ymd);
    return ok(resolved.id, `已确认「${resolved.name}」今日守住`);
  }

  const { incrementHabitCheckInForDay } = await import(
    '@/lib/repositories/habits/habit-check-in'
  );
  const maxDaily = draft.max_daily != null ? Number(draft.max_daily) : null;
  const result = await incrementHabitCheckInForDay(
    resolved.id,
    ymd,
    Number.isFinite(maxDaily) ? maxDaily : null,
  );
  if (!result.increased) {
    return ok(resolved.id, `「${resolved.name}」今日已达上限（${result.nextCount}）`);
  }
  return ok(resolved.id, `已为「${resolved.name}」打卡（${result.nextCount}）`);
}

export async function commitHabitContext(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name') || draftString(draft, 'context');
  if (!name) return fail('incomplete_draft', '缺少习惯场景名称');

  const contextId = draftString(draft, 'context_id') || draftString(draft, 'id');
  if (contextId) {
    const { renameHabitContext } = await import('@/lib/repositories/habits/habit-context');
    await renameHabitContext(contextId, name.slice(0, 40));
    await requestPushPending();
    return ok(contextId, `已重命名习惯场景为「${name.slice(0, 40)}」`);
  }

  const { createHabitContext } = await import('@/lib/repositories/habits/habit-context');
  await createHabitContext(name.slice(0, 40));
  await requestPushPending();
  return ok(name.slice(0, 40), `已创建习惯场景「${name.slice(0, 40)}」`);
}

export const habitCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_habit: async input => commitHabit(input.draft),
  commit_habit_checkin: async input => commitHabitCheckin(input.draft),
  commit_habit_context: async input => commitHabitContext(input.draft),
};
