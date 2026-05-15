import AsyncStorage from '@react-native-async-storage/async-storage';
import { markGithubKvSliceDirty } from '@/lib/github-sqlite-dirty-track';

const WEAKNESS_LIST_KEY = 'user_weaknesses_v1';

export const WEAKNESS_TITLE_MAX = 120;
export const WEAKNESS_DETAIL_MAX = 8000;

export type UserWeaknessItem = {
  id: string;
  /** 缺点名称（短标题） */
  title: string;
  /** 具体表现、场景、想改变的点等 */
  detail: string;
  created_at: string;
  updated_at: string;
  ai_evaluation?: string;
  ai_suggestions?: string;
  ai_review_at?: string;
};

function newId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function clampTitle(t: string): string {
  return t.length > WEAKNESS_TITLE_MAX ? t.slice(0, WEAKNESS_TITLE_MAX) : t;
}

function clampDetail(t: string): string {
  return t.length > WEAKNESS_DETAIL_MAX ? t.slice(0, WEAKNESS_DETAIL_MAX) : t;
}

function parseList(raw: string | null): UserWeaknessItem[] {
  if (raw == null || raw === '') return [];
  try {
    const x = JSON.parse(raw) as unknown;
    if (!Array.isArray(x)) return [];
    const out: UserWeaknessItem[] = [];
    for (const row of x) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : '';
      const title = typeof r.title === 'string' ? r.title : '';
      const detail =
        typeof r.detail === 'string'
          ? r.detail
          : typeof r.body === 'string'
            ? r.body
            : '';
      const created_at = typeof r.created_at === 'string' ? r.created_at : '';
      const updated_at = typeof r.updated_at === 'string' ? r.updated_at : '';
      const ai_evaluation = typeof r.ai_evaluation === 'string' ? r.ai_evaluation : undefined;
      const ai_suggestions = typeof r.ai_suggestions === 'string' ? r.ai_suggestions : undefined;
      const ai_review_at = typeof r.ai_review_at === 'string' ? r.ai_review_at : undefined;
      if (!id || !created_at || !updated_at) continue;
      out.push({
        id,
        title,
        detail,
        created_at,
        updated_at,
        ...(ai_evaluation != null && ai_evaluation !== '' ? { ai_evaluation } : {}),
        ...(ai_suggestions != null && ai_suggestions !== '' ? { ai_suggestions } : {}),
        ...(ai_review_at != null && ai_review_at !== '' ? { ai_review_at } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function readList(): Promise<UserWeaknessItem[]> {
  const raw = await AsyncStorage.getItem(WEAKNESS_LIST_KEY);
  return parseList(raw);
}

/** 从云备份 kv payload 解析缺点列表。 */
export function userWeaknessItemsFromBackupPayload(payload: unknown): UserWeaknessItem[] {
  if (!Array.isArray(payload)) return [];
  return parseList(JSON.stringify(payload));
}

async function writeList(items: UserWeaknessItem[]): Promise<void> {
  await AsyncStorage.setItem(WEAKNESS_LIST_KEY, JSON.stringify(items));
  markGithubKvSliceDirty('user_weaknesses');
}

/** 云恢复：用备份中的缺点列表整表覆盖本地。 */
export async function replaceUserWeaknessesFromCloudRestore(items: UserWeaknessItem[]): Promise<void> {
  await writeList(items);
}

export async function listUserWeaknesses(): Promise<UserWeaknessItem[]> {
  const arr = await readList();
  return [...arr].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getUserWeakness(id: string): Promise<UserWeaknessItem | null> {
  const arr = await readList();
  return arr.find(m => m.id === id) ?? null;
}

export async function createUserWeakness(input: { title: string; detail: string }): Promise<UserWeaknessItem> {
  const now = new Date().toISOString();
  const item: UserWeaknessItem = {
    id: newId(),
    title: clampTitle(input.title),
    detail: clampDetail(input.detail),
    created_at: now,
    updated_at: now,
  };
  const arr = await readList();
  arr.push(item);
  await writeList(arr);
  return item;
}

export async function updateUserWeakness(
  id: string,
  patch: { title?: string; detail?: string },
): Promise<UserWeaknessItem | null> {
  const arr = await readList();
  const idx = arr.findIndex(m => m.id === id);
  if (idx < 0) return null;
  const prev = arr[idx]!;
  const nextTitle = patch.title !== undefined ? clampTitle(patch.title) : prev.title;
  const nextDetail = patch.detail !== undefined ? clampDetail(patch.detail) : prev.detail;
  const contentChanged =
    (patch.title !== undefined && nextTitle !== prev.title) ||
    (patch.detail !== undefined && nextDetail !== prev.detail);

  const next: UserWeaknessItem = {
    ...prev,
    title: nextTitle,
    detail: nextDetail,
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

export async function setUserWeaknessAiReview(
  id: string,
  payload: { evaluation: string; suggestions: string },
): Promise<UserWeaknessItem | null> {
  const arr = await readList();
  const idx = arr.findIndex(m => m.id === id);
  if (idx < 0) return null;
  const prev = arr[idx]!;
  const now = new Date().toISOString();
  const next: UserWeaknessItem = {
    ...prev,
    ai_evaluation: payload.evaluation.trim(),
    ai_suggestions: payload.suggestions.trim(),
    ai_review_at: now,
  };
  arr[idx] = next;
  await writeList(arr);
  return next;
}

export async function deleteUserWeakness(id: string): Promise<boolean> {
  const arr = await readList();
  const next = arr.filter(m => m.id !== id);
  if (next.length === arr.length) return false;
  await writeList(next);
  return true;
}

export function weaknessListPreviewTitle(row: UserWeaknessItem): string {
  const t = row.title.trim();
  if (t) return t;
  const first = row.detail.trim().split(/\n/)[0]?.trim() ?? '';
  if (first) return first.length > 48 ? `${first.slice(0, 48)}…` : first;
  return '未命名缺点';
}

export function weaknessListPreviewDetail(row: UserWeaknessItem): string {
  const b = row.detail.trim();
  if (!b) return '（无详情）';
  const one = b.split(/\n/)[0]!.trim();
  return one.length > 80 ? `${one.slice(0, 80)}…` : one;
}

export function weaknessContextForAiReview(row: UserWeaknessItem): string {
  const title = row.title.trim();
  const detail = row.detail.trim();
  if (!title && !detail) return '';
  const parts: string[] = [];
  if (title) parts.push(`【缺点名称】\n${title}`);
  if (detail) parts.push(`【详情说明】\n${detail}`);
  return parts.join('\n\n');
}
