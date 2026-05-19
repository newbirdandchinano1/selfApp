import AsyncStorage from '@react-native-async-storage/async-storage';
import { markGithubKvSliceDirty } from '@/lib/github-sqlite-dirty-track';

/** 旧版个人页单条备忘，首次读取时迁移为一条列表项 */
const LEGACY_SINGLE_MEMO_KEY = 'profile_screen_memo_v1';
const MEMO_LIST_KEY = 'memo_list_v2';

export const MEMO_TITLE_MAX = 120;
export const MEMO_BODY_MAX = 8000;

export type MemoItem = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  /** 智谱 AI 对备忘内容的简要评价 */
  ai_evaluation?: string;
  /** 智谱 AI 给出的可执行建议 */
  ai_suggestions?: string;
  /** 最近一次生成 AI 评价的时间 ISO */
  ai_review_at?: string;
  /** 由该备忘左滑「转待办」生成的独立待办 id（可重复再转，仅记录最近一次） */
  linked_task_id?: string;
};

function newId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function clampTitle(t: string): string {
  const s = t.length > MEMO_TITLE_MAX ? t.slice(0, MEMO_TITLE_MAX) : t;
  return s;
}

function clampBody(t: string): string {
  const s = t.length > MEMO_BODY_MAX ? t.slice(0, MEMO_BODY_MAX) : t;
  return s;
}

function parseList(raw: string | null): MemoItem[] {
  if (raw == null || raw === '') return [];
  try {
    const x = JSON.parse(raw) as unknown;
    if (!Array.isArray(x)) return [];
    const out: MemoItem[] = [];
    for (const row of x) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : '';
      const title = typeof r.title === 'string' ? r.title : '';
      const body = typeof r.body === 'string' ? r.body : '';
      const created_at = typeof r.created_at === 'string' ? r.created_at : '';
      const updated_at = typeof r.updated_at === 'string' ? r.updated_at : '';
      const ai_evaluation = typeof r.ai_evaluation === 'string' ? r.ai_evaluation : undefined;
      const ai_suggestions = typeof r.ai_suggestions === 'string' ? r.ai_suggestions : undefined;
      const ai_review_at = typeof r.ai_review_at === 'string' ? r.ai_review_at : undefined;
      const linked_task_id = typeof r.linked_task_id === 'string' ? r.linked_task_id : undefined;
      if (!id || !created_at || !updated_at) continue;
      out.push({
        id,
        title,
        body,
        created_at,
        updated_at,
        ...(ai_evaluation != null && ai_evaluation !== '' ? { ai_evaluation } : {}),
        ...(ai_suggestions != null && ai_suggestions !== '' ? { ai_suggestions } : {}),
        ...(ai_review_at != null && ai_review_at !== '' ? { ai_review_at } : {}),
        ...(linked_task_id != null && linked_task_id !== '' ? { linked_task_id } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function readListAfterMigration(): Promise<MemoItem[]> {
  const raw = await AsyncStorage.getItem(MEMO_LIST_KEY);
  if (raw != null && raw !== '') {
    return parseList(raw);
  }
  const legacy = await AsyncStorage.getItem(LEGACY_SINGLE_MEMO_KEY);
  if (legacy?.trim()) {
    const now = new Date().toISOString();
    const one: MemoItem = {
      id: newId(),
      title: '备忘录',
      body: legacy.trim(),
      created_at: now,
      updated_at: now,
    };
    await AsyncStorage.setItem(MEMO_LIST_KEY, JSON.stringify([one]));
    markGithubKvSliceDirty('memos');
    await AsyncStorage.removeItem(LEGACY_SINGLE_MEMO_KEY);
    return [one];
  }
  return [];
}

/** 从云备份 kv payload 解析备忘列表（与 `listMemos` 存盘格式一致）。 */
export function memoItemsFromBackupPayload(payload: unknown): MemoItem[] {
  if (!Array.isArray(payload)) return [];
  return parseList(JSON.stringify(payload));
}

async function writeList(items: MemoItem[]): Promise<void> {
  await AsyncStorage.setItem(MEMO_LIST_KEY, JSON.stringify(items));
  markGithubKvSliceDirty('memos');
}

/** 云恢复：用备份中的备忘列表整表覆盖本地（不经由单条编辑 API）。 */
export async function replaceMemosFromCloudRestore(items: MemoItem[]): Promise<void> {
  await writeList(items);
}

export async function listMemos(): Promise<MemoItem[]> {
  const arr = await readListAfterMigration();
  return [...arr].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getMemo(id: string): Promise<MemoItem | null> {
  const arr = await readListAfterMigration();
  return arr.find(m => m.id === id) ?? null;
}

export async function createMemo(input: { title: string; body: string }): Promise<MemoItem> {
  const now = new Date().toISOString();
  const item: MemoItem = {
    id: newId(),
    title: clampTitle(input.title),
    body: clampBody(input.body),
    created_at: now,
    updated_at: now,
  };
  const arr = await readListAfterMigration();
  arr.push(item);
  await writeList(arr);
  return item;
}

export async function updateMemo(
  id: string,
  patch: { title?: string; body?: string },
): Promise<MemoItem | null> {
  const arr = await readListAfterMigration();
  const idx = arr.findIndex(m => m.id === id);
  if (idx < 0) return null;
  const prev = arr[idx]!;
  const nextTitle = patch.title !== undefined ? clampTitle(patch.title) : prev.title;
  const nextBody = patch.body !== undefined ? clampBody(patch.body) : prev.body;
  const contentChanged =
    (patch.title !== undefined && nextTitle !== prev.title) ||
    (patch.body !== undefined && nextBody !== prev.body);

  const next: MemoItem = {
    ...prev,
    title: nextTitle,
    body: nextBody,
    updated_at: new Date().toISOString(),
  };
  if (contentChanged) {
    next.ai_evaluation = undefined;
    next.ai_suggestions = undefined;
    next.ai_review_at = undefined;
  }
  arr[idx] = next;
  await writeList(arr);
  return next;
}

export async function setMemoAiReview(
  id: string,
  payload: { evaluation: string; suggestions: string },
): Promise<MemoItem | null> {
  const arr = await readListAfterMigration();
  const idx = arr.findIndex(m => m.id === id);
  if (idx < 0) return null;
  const prev = arr[idx]!;
  const now = new Date().toISOString();
  const next: MemoItem = {
    ...prev,
    ai_evaluation: payload.evaluation.trim(),
    ai_suggestions: payload.suggestions.trim(),
    ai_review_at: now,
  };
  arr[idx] = next;
  await writeList(arr);
  return next;
}

export async function deleteMemo(id: string): Promise<boolean> {
  const arr = await readListAfterMigration();
  const next = arr.filter(m => m.id !== id);
  if (next.length === arr.length) return false;
  await writeList(next);
  return true;
}

/** 列表预览用：无标题时取正文首行 */
export function memoListPreviewTitle(row: MemoItem): string {
  const t = row.title.trim();
  if (t) return t;
  const first = row.body.trim().split(/\n/)[0]?.trim() ?? '';
  if (first) return first.length > 48 ? `${first.slice(0, 48)}…` : first;
  return '无标题';
}

export function memoListPreviewBody(row: MemoItem): string {
  const b = row.body.trim();
  if (!b) return '（无正文）';
  const one = b.split(/\n/)[0]!.trim();
  return one.length > 80 ? `${one.slice(0, 80)}…` : one;
}

/** 供智谱 AI 使用的备忘全文（标题 + 正文 + 元信息） */
export function memoContextForAiReview(row: MemoItem): string {
  const title = row.title.trim();
  const body = row.body.trim();
  if (!title && !body) return '';
  const parts: string[] = [];
  const bodyLines = body ? body.split(/\n/).filter(l => l.trim().length > 0).length : 0;
  const updatedLabel = row.updated_at
    ? new Date(row.updated_at).toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '未知';
  parts.push(
    `【元信息】标题 ${title.length} 字；正文 ${body.length} 字${bodyLines > 0 ? `（约 ${bodyLines} 段/行）` : ''}；最近更新 ${updatedLabel}`,
  );
  if (title) parts.push(`【标题】\n${title}`);
  if (body) parts.push(`【正文】\n${body}`);
  return parts.join('\n\n');
}
