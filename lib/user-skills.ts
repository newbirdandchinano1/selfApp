import AsyncStorage from '@react-native-async-storage/async-storage';
import { markGithubKvSliceDirty } from '@/lib/github-sqlite-dirty-track';

const STORAGE_KEY = 'user_skills_portfolio_v1';

export type UserSkillItem = {
  id: string;
  name: string;
  description: string;
  /** 最近一次 AI 评估摘要 */
  last_evaluation?: string;
  /** 最近一次 AI 对该技能的建议 */
  last_suggestions?: string;
};

export type DesiredSkillItem = {
  id: string;
  name: string;
  /** 期望达到的水平 */
  target_level: string;
};

export type UserSkillsSnapshot = {
  skills: UserSkillItem[];
  desired_skills: DesiredSkillItem[];
  last_ai_at: string | null;
  last_overall_suggestions: string | null;
  last_profile_analysis: string | null;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createEmptyUserSkillsSnapshot(): UserSkillsSnapshot {
  return {
    skills: [],
    desired_skills: [],
    last_ai_at: null,
    last_overall_suggestions: null,
    last_profile_analysis: null,
  };
}

export function createSkillItem(): UserSkillItem {
  return { id: newId(), name: '', description: '' };
}

export function createDesiredSkillItem(): DesiredSkillItem {
  return { id: newId(), name: '', target_level: '' };
}

function normalizeItem(raw: unknown): UserSkillItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : newId();
  const name = typeof o.name === 'string' ? o.name : '';
  const description = typeof o.description === 'string' ? o.description : '';
  const last_evaluation = typeof o.last_evaluation === 'string' ? o.last_evaluation : undefined;
  const last_suggestions = typeof o.last_suggestions === 'string' ? o.last_suggestions : undefined;
  return { id, name, description, last_evaluation, last_suggestions };
}

function normalizeDesiredSkill(raw: unknown): DesiredSkillItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : newId();
  const name = typeof o.name === 'string' ? o.name : '';
  const target_level = typeof o.target_level === 'string' ? o.target_level : '';
  return { id, name, target_level };
}

function flattenLegacyDimensions(raw: unknown): UserSkillItem[] {
  if (!Array.isArray(raw)) return [];
  const out: UserSkillItem[] = [];
  for (const dim of raw) {
    if (typeof dim !== 'object' || dim === null) continue;
    const skillsRaw = (dim as Record<string, unknown>).skills;
    if (!Array.isArray(skillsRaw)) continue;
    for (const item of skillsRaw) {
      const normalized = normalizeItem(item);
      if (normalized) out.push(normalized);
    }
  }
  return out;
}

export function normalizeUserSkillsSnapshot(parsed: unknown): UserSkillsSnapshot {
  if (typeof parsed !== 'object' || parsed === null) return createEmptyUserSkillsSnapshot();
  const o = parsed as Record<string, unknown>;

  const skillsRaw = o.skills;
  let skills: UserSkillItem[] = Array.isArray(skillsRaw)
    ? skillsRaw.map(normalizeItem).filter((x): x is UserSkillItem => x != null)
    : [];
  if (skills.length === 0 && Array.isArray(o.dimensions)) {
    skills = flattenLegacyDimensions(o.dimensions);
  }

  const last_ai_at =
    typeof o.last_ai_at === 'string' && o.last_ai_at.trim() ? o.last_ai_at.trim() : null;
  const last_overall_suggestions =
    typeof o.last_overall_suggestions === 'string' && o.last_overall_suggestions.trim()
      ? o.last_overall_suggestions.trim()
      : null;
  const last_profile_analysis =
    typeof o.last_profile_analysis === 'string' && o.last_profile_analysis.trim()
      ? o.last_profile_analysis.trim()
      : null;
  const desiredRaw = o.desired_skills;
  const desired_skills: DesiredSkillItem[] = Array.isArray(desiredRaw)
    ? desiredRaw.map(normalizeDesiredSkill).filter((x): x is DesiredSkillItem => x != null)
    : [];
  return {
    skills,
    desired_skills,
    last_ai_at,
    last_overall_suggestions,
    last_profile_analysis,
  };
}

/** 确保快照字段完整（兼容旧版 dimensions 结构与热更新残留 state） */
export function ensureUserSkillsSnapshot(input: unknown): UserSkillsSnapshot {
  if (
    typeof input === 'object' &&
    input !== null &&
    Array.isArray((input as UserSkillsSnapshot).skills) &&
    Array.isArray((input as UserSkillsSnapshot).desired_skills)
  ) {
    return input as UserSkillsSnapshot;
  }
  return normalizeUserSkillsSnapshot(input);
}

export async function loadUserSkills(): Promise<UserSkillsSnapshot> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw?.trim()) return createEmptyUserSkillsSnapshot();
    const parsed = JSON.parse(raw) as unknown;
    return normalizeUserSkillsSnapshot(parsed);
  } catch {
    return createEmptyUserSkillsSnapshot();
  }
}

export async function saveUserSkills(snapshot: UserSkillsSnapshot): Promise<void> {
  const normalized = ensureUserSkillsSnapshot(snapshot);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  markGithubKvSliceDirty('user_skills');
}

export function countSkillsInSnapshot(s: UserSkillsSnapshot): number {
  return ensureUserSkillsSnapshot(s).skills.length;
}

export function countDesiredSkillsInSnapshot(s: UserSkillsSnapshot): number {
  return ensureUserSkillsSnapshot(s).desired_skills.length;
}

export function skillsProfilePreviewSubtitle(s: UserSkillsSnapshot): string {
  const n = countSkillsInSnapshot(s);
  const desired = countDesiredSkillsInSnapshot(s);
  const desiredHint = desired > 0 ? ` · ${desired} 项想学的技能` : '';
  if (n === 0 && desired === 0) return '记录现有技能与自评，一键生成 AI 分析与建议';
  if (n === 0) return `${desired} 项想学的技能 · 还可添加现有技能`;
  if (s.last_ai_at) return `${n} 项技能 · 已生成 AI 评估${desiredHint}`;
  return `${n} 项技能 · 填写描述后可请求 AI 评估${desiredHint}`;
}
