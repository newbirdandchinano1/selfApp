/**
 * 阶段 E：placement upsert 序列化（无网络依赖，可供脚本单测）
 */
import type { SchedulePlacementRow } from '@/lib/schedule/types';

/** 始终带分钟键（含 null），避免后端当成「未传」而跳过更新 */
export function serializeFrogSchedulePlacementUpsert(
  placement: SchedulePlacementRow,
): Record<string, unknown> {
  return {
    id: placement.id,
    weekStartYmd: placement.weekStartYmd,
    weekday: placement.weekday,
    startSlotIndex: placement.startSlotIndex,
    spanSlots: placement.spanSlots,
    startMinutes: placement.startMinutes ?? null,
    endMinutes: placement.endMinutes ?? null,
    allDay: placement.allDay ?? null,
    subjectKind: placement.subjectKind,
    subjectId: placement.subjectId,
    orphaned: placement.orphaned ? 1 : 0,
    createdAt: placement.createdAt,
    updatedAt: placement.updatedAt,
  };
}
