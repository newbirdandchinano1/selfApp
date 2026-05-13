import AsyncStorage from '@react-native-async-storage/async-storage';

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

export type UserSkillDimension = {
  id: string;
  title: string;
  skills: UserSkillItem[];
};

export type UserSkillsSnapshot = {
  dimensions: UserSkillDimension[];
  last_ai_at: string | null;
  last_overall_suggestions: string | null;
  last_profile_analysis: string | null;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createEmptyUserSkillsSnapshot(): UserSkillsSnapshot {
  return {
    dimensions: [],
    last_ai_at: null,
    last_overall_suggestions: null,
    last_profile_analysis: null,
  };
}

export function createSkillDimension(title = '新维度'): UserSkillDimension {
  return { id: newId(), title, skills: [] };
}

export function createSkillItem(): UserSkillItem {
  return { id: newId(), name: '', description: '' };
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

function normalizeDimension(raw: unknown): UserSkillDimension | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : newId();
  const title = typeof o.title === 'string' ? o.title : '未命名维度';
  const skillsRaw = o.skills;
  const skills: UserSkillItem[] = Array.isArray(skillsRaw)
    ? skillsRaw.map(normalizeItem).filter((x): x is UserSkillItem => x != null)
    : [];
  return { id, title, skills };
}

function normalizeSnapshot(parsed: unknown): UserSkillsSnapshot {
  if (typeof parsed !== 'object' || parsed === null) return createEmptyUserSkillsSnapshot();
  const o = parsed as Record<string, unknown>;
  const dimsRaw = o.dimensions;
  const dimensions: UserSkillDimension[] = Array.isArray(dimsRaw)
    ? dimsRaw.map(normalizeDimension).filter((x): x is UserSkillDimension => x != null)
    : [];
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
  return {
    dimensions,
    last_ai_at,
    last_overall_suggestions,
    last_profile_analysis,
  };
}

export async function loadUserSkills(): Promise<UserSkillsSnapshot> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw?.trim()) return createEmptyUserSkillsSnapshot();
    const parsed = JSON.parse(raw) as unknown;
    return normalizeSnapshot(parsed);
  } catch {
    return createEmptyUserSkillsSnapshot();
  }
}

export async function saveUserSkills(snapshot: UserSkillsSnapshot): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function countSkillsInSnapshot(s: UserSkillsSnapshot): number {
  return s.dimensions.reduce((n, d) => n + d.skills.length, 0);
}

export function skillsProfilePreviewSubtitle(s: UserSkillsSnapshot): string {
  const dim = s.dimensions.length;
  const n = countSkillsInSnapshot(s);
  if (dim === 0) return '自定义维度，记录技能与自评，一键生成 AI 分析与建议';
  if (n === 0) return `${dim} 个维度 · 尚未添加技能`;
  if (s.last_ai_at) return `${dim} 维 · ${n} 项技能 · 已生成 AI 评估`;
  return `${dim} 维 · ${n} 项技能 · 填写描述后可请求 AI 评估`;
}
