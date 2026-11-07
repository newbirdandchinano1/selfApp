/**
 * S9.3 W3：commit_schedule_placement（动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

function mondayOfYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** YYYY-MM-DD → 周一=1 … 周日=7 */
function weekdayOfYmd(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return 1;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

function parseHmToMinutes(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

export async function commitSchedulePlacement(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const placementId =
    draftString(draft, 'placement_id') || draftString(draft, 'id');

  if (placementId) {
    const { updatePlacementSlots } = await import(
      '@/lib/repositories/schedule/schedule-store'
    );
    const startSlot =
      draftNumber(draft, 'start_slot_index') ?? draftNumber(draft, 'startSlotIndex');
    const span = draftNumber(draft, 'span_slots') ?? draftNumber(draft, 'spanSlots') ?? 1;
    await updatePlacementSlots(placementId, {
      startSlotIndex: startSlot == null ? null : Math.max(0, Math.round(startSlot)),
      spanSlots: Math.max(1, Math.round(span)),
      orphaned: false,
      weekStartYmd: draftString(draft, 'week_start_ymd') || undefined,
      weekday: draftNumber(draft, 'weekday') ?? undefined,
    });
    await requestPushPending();
    return ok(placementId, '已更新日程放置');
  }

  const { formatYmd } = await import('@/lib/date');
  const ymd =
    draftString(draft, 'ymd') ||
    draftString(draft, 'date') ||
    formatYmd(new Date());
  let subjectId =
    draftString(draft, 'task_id') ||
    draftString(draft, 'subject_id') ||
    draftString(draft, 'project_id');
  const subjectKindRaw = draftString(draft, 'subject_kind').toLowerCase();
  let subjectKind: 'task' | 'project' =
    subjectKindRaw === 'project' || draftString(draft, 'project_id') ? 'project' : 'task';

  if (!subjectId) {
    const title =
      draftString(draft, 'task_title') ||
      draftString(draft, 'title') ||
      draftString(draft, 'name');
    if (!title) return fail('incomplete_draft', '请指定待办/项目 id 或标题');
    if (subjectKind === 'project') {
      const { getProjects } = await import('@/lib/repositories/projects/project');
      const projects = await getProjects();
      const needle = title.toLowerCase();
      const hit =
        projects.find(p => p.name.trim().toLowerCase() === needle) ||
        projects.find(p => p.name.trim().toLowerCase().includes(needle));
      if (!hit) return fail('incomplete_draft', `找不到项目「${title}」`);
      subjectId = hit.id;
    } else {
      const { getTasks } = await import('@/lib/repositories/tasks/task');
      const tasks = await getTasks();
      const needle = title.toLowerCase();
      const hit =
        tasks.find(t => t.title.trim().toLowerCase() === needle) ||
        tasks.find(t => t.title.trim().toLowerCase().includes(needle));
      if (!hit) return fail('incomplete_draft', `找不到待办「${title}」`);
      subjectId = hit.id;
    }
  }

  const startHm = draftString(draft, 'start_time');
  const endHm = draftString(draft, 'end_time');
  const startMinutes = startHm ? parseHmToMinutes(startHm) : null;
  const endMinutes = endHm ? parseHmToMinutes(endHm) : null;
  const startSlotExplicit =
    draftNumber(draft, 'start_slot_index') ?? draftNumber(draft, 'startSlotIndex');
  // 默认轴 08:00 起、2h/格 → 相对工作格索引
  let startSlotIndex = startSlotExplicit != null ? Math.max(0, Math.round(startSlotExplicit)) : 0;
  if (startSlotExplicit == null && startMinutes != null) {
    startSlotIndex = Math.max(0, Math.floor((startMinutes - 8 * 60) / 120));
  }
  let spanSlots = draftNumber(draft, 'span_slots') ?? draftNumber(draft, 'spanSlots') ?? 1;
  if (startMinutes != null && endMinutes != null && endMinutes > startMinutes) {
    spanSlots = Math.max(1, Math.ceil((endMinutes - startMinutes) / 120));
  }

  const { insertPlacement } = await import('@/lib/repositories/schedule/schedule-store');
  const row = await insertPlacement({
    weekStartYmd: mondayOfYmd(ymd),
    weekday: weekdayOfYmd(ymd),
    startSlotIndex,
    spanSlots: Math.max(1, Math.round(spanSlots)),
    subjectKind,
    subjectId,
    startMinutes: startMinutes ?? undefined,
    endMinutes: endMinutes ?? undefined,
  });
  await requestPushPending();
  return ok(row.id, `已将日程放到 ${ymd}`);
}

export const scheduleCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_schedule_placement: async input => commitSchedulePlacement(input.draft),
};
