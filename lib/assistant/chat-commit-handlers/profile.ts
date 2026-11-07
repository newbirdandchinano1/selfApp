/**
 * S9.3 W2：commit_profile（动态 import；合并现有用户行后 updateDefaultUser）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

export async function commitProfile(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const persona =
    draftString(draft, 'persona_portrait') ||
    draftString(draft, 'persona') ||
    draftString(draft, 'text') ||
    draftString(draft, 'prefill_text');
  const name = draftString(draft, 'name');
  const gender = draftString(draft, 'gender');
  const lifestyle = draftString(draft, 'lifestyle');
  const goal = draftString(draft, 'goal');
  const birthday = draftString(draft, 'birthday');
  const height = draftNumber(draft, 'height');
  const weight = draftNumber(draft, 'weight');

  if (!persona && !name && !gender && !lifestyle && !goal && !birthday && height == null && weight == null) {
    return fail('incomplete_draft', '画像/资料草稿为空，请补充后再确认');
  }

  const { getDefaultUser, updateDefaultUser } = await import('@/lib/repositories/users/user');
  const current = await getDefaultUser();
  if (!current) {
    return fail('no_user', '无法读取当前用户资料，请稍后重试');
  }

  await updateDefaultUser({
    name: name || current.name || '',
    persona_portrait: persona
      ? persona.slice(0, 500)
      : current.persona_portrait ?? null,
    gender: gender || current.gender || '男',
    lifestyle: lifestyle || current.lifestyle || '长期静坐不运动',
    goal: goal || current.goal || '无',
    workout_days: current.workout_days ?? '[]',
    birthday: birthday || current.birthday,
    height: height ?? current.height ?? 0,
    weight: weight ?? current.weight ?? 0,
  });
  await requestPushPending();

  const summary = persona
    ? `已保存人物画像（${persona.slice(0, 24)}${persona.length > 24 ? '…' : ''}）`
    : name
      ? `已更新资料「${name.slice(0, 40)}」`
      : '已更新个人资料';
  return ok(current.id || 'default', summary);
}

export const profileCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_profile: async input => commitProfile(input.draft),
};
