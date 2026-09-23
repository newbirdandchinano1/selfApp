/** 验收标准：优先 description，空则回退旧 note（过渡兼容） */
export function resolveAcceptanceCriteria(
  description: string | null | undefined,
  note?: string | null | undefined,
): string {
  const d = (description ?? '').trim();
  if (d) return d;
  return (note ?? '').trim();
}

/** 保存前：并入旧备注，写入时 note 应置 null */
export function mergeNoteIntoAcceptanceCriteria(
  acceptanceCriteria: string,
  legacyNote: string | null | undefined,
): string {
  const a = acceptanceCriteria.trim();
  const n = (legacyNote ?? '').trim();
  if (a) return a;
  return n;
}
