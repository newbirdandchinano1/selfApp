/** 验收标准 checklist 项（与子任务独立：提示目标达成，非拆分执行） */
export type AcceptanceCriterionItem = {
  id: string;
  text: string;
  done: boolean;
};

const CHECKLIST_KEY = 'acceptanceChecklist';

function parseExtraRecord(extraData: string | null | undefined): Record<string, unknown> {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function newItemId(): string {
  return `ac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 将纯文本（换行分隔）转为 checklist；用于旧数据兼容 */
export function linesToAcceptanceChecklist(
  text: string | null | undefined,
  opts?: { preserveDone?: boolean },
): AcceptanceCriterionItem[] {
  const lines = (text ?? '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const checked = /^\[x\]\s+/i.test(line) || /^\u2611\s*/.test(line);
    const unchecked = /^\[\s?\]\s+/.test(line) || /^\u2610\s*/.test(line);
    let textBody = line;
    if (checked) textBody = line.replace(/^\[x\]\s+/i, '').replace(/^\u2611\s*/, '');
    else if (unchecked) textBody = line.replace(/^\[\s?\]\s+/, '').replace(/^\u2610\s*/, '');
    return {
      id: newItemId(),
      text: textBody.trim(),
      done: opts?.preserveDone === false ? false : checked,
    };
  }).filter((item) => item.text.length > 0);
}

export function acceptanceChecklistToLines(items: AcceptanceCriterionItem[]): string {
  return items
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n');
}

export function acceptanceChecklistSummary(items: AcceptanceCriterionItem[]): string {
  const texts = items.map((i) => i.text.trim()).filter(Boolean);
  if (texts.length === 0) return '';
  if (texts.length <= 2) return texts.join(' / ');
  return `${texts.slice(0, 2).join(' / ')} 等 ${texts.length} 项`;
}

export function countAcceptanceProgress(items: AcceptanceCriterionItem[]): {
  done: number;
  total: number;
} {
  const total = items.filter((i) => i.text.trim()).length;
  const done = items.filter((i) => i.text.trim() && i.done).length;
  return { done, total };
}

function parseChecklistFromUnknown(raw: unknown): AcceptanceCriterionItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: AcceptanceCriterionItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!text) continue;
    items.push({
      id: typeof rec.id === 'string' && rec.id.trim() ? rec.id : newItemId(),
      text,
      done: rec.done === true,
    });
  }
  return items;
}

/**
 * 读取验收 checklist：优先 extra_data.acceptanceChecklist；
 * 空则用 description（或过渡期 note）按行拆成未勾选项。
 */
export function parseAcceptanceChecklist(
  extraData: string | null | undefined,
  description?: string | null | undefined,
  legacyNote?: string | null | undefined,
): AcceptanceCriterionItem[] {
  const fromExtra = parseChecklistFromUnknown(parseExtraRecord(extraData)[CHECKLIST_KEY]);
  if (fromExtra && fromExtra.length > 0) return fromExtra;
  const fallback = resolveAcceptanceCriteria(description, legacyNote);
  return linesToAcceptanceChecklist(fallback, { preserveDone: true });
}

/** 合并 checklist 进 extra_data；空列表时移除字段 */
export function mergeAcceptanceChecklistIntoExtraData(
  extraData: string | null | undefined,
  items: AcceptanceCriterionItem[],
): string | null {
  const parsed = parseExtraRecord(extraData);
  const cleaned = items
    .map((item) => ({
      id: item.id?.trim() || newItemId(),
      text: item.text.trim(),
      done: item.done === true,
    }))
    .filter((item) => item.text.length > 0);
  if (cleaned.length === 0) {
    if (!(CHECKLIST_KEY in parsed)) {
      return extraData == null || extraData === '' ? null : extraData;
    }
    const { [CHECKLIST_KEY]: _removed, ...rest } = parsed;
    return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  }
  return JSON.stringify({ ...parsed, [CHECKLIST_KEY]: cleaned });
}

export function createEmptyAcceptanceItem(): AcceptanceCriterionItem {
  return { id: newItemId(), text: '', done: false };
}

/** 验收标准：优先 description，空则回退旧 note（过渡兼容） */
export function resolveAcceptanceCriteria(
  description: string | null | undefined,
  note?: string | null | undefined,
): string {
  const d = (description ?? '').trim();
  if (d) return d;
  return (note ?? '').trim();
}

/** 保存前：并入旧备注，写入时 note 应置 null（长期任务路径） */
export function mergeNoteIntoAcceptanceCriteria(
  acceptanceCriteria: string,
  legacyNote: string | null | undefined,
): string {
  const a = acceptanceCriteria.trim();
  const n = (legacyNote ?? '').trim();
  if (a) return a;
  return n;
}

/** 长期任务/项目才展示与持久化验收标准；否则用备注 */
export function shouldShowAcceptanceCriteria(isLongTerm: boolean): boolean {
  return isLongTerm === true;
}
