import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as SQLite from 'expo-sqlite';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '@/lib/database';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
  markCloudSqliteTableDirty,
} from '@/lib/cloud-sql-dirty-track';

const STORAGE_KEY = 'user_skills_portfolio_v1';
const USER_SKILLS_ASYNC_MIGRATED_KEY = 'user_skills_async_migrated_v1';
const SKILLS_META_ID = 'default';

export type UserSkillItem = {
  id: string;
  name: string;
  description: string;
  last_evaluation?: string;
  last_suggestions?: string;
};

export type DesiredSkillItem = {
  id: string;
  name: string;
  target_level: string;
};

export type UserSkillsSnapshot = {
  skills: UserSkillItem[];
  desired_skills: DesiredSkillItem[];
  last_ai_at: string | null;
  last_overall_suggestions: string | null;
  last_profile_analysis: string | null;
};

type SkillRow = {
  id: string;
  name: string;
  description: string;
  last_evaluation: string | null;
  last_suggestions: string | null;
  sort_order: number | null;
};

type DesiredRow = {
  id: string;
  name: string;
  target_level: string;
  sort_order: number | null;
};

type MetaRow = {
  last_ai_at: string | null;
  last_overall_suggestions: string | null;
  last_profile_analysis: string | null;
};

function newId(): string {
  return makeTimestampEntityId('', 9).replace('_', '-');
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

function rowToSkill(row: SkillRow): UserSkillItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ...(row.last_evaluation?.trim() ? { last_evaluation: row.last_evaluation.trim() } : {}),
    ...(row.last_suggestions?.trim() ? { last_suggestions: row.last_suggestions.trim() } : {}),
  };
}

function rowToDesired(row: DesiredRow): DesiredSkillItem {
  return {
    id: row.id,
    name: row.name,
    target_level: row.target_level,
  };
}

function markUserSkillsDirty(): void {
  markCloudSqliteTableDirty('user_skill_items');
  markCloudSqliteTableDirty('user_desired_skills');
  markCloudSqliteTableDirty('user_skills_meta');
}

async function loadSnapshotFromDb(db: SQLite.SQLiteDatabase): Promise<UserSkillsSnapshot> {
  const skillRows = await db.getAllAsync<SkillRow>(
    `SELECT id, name, description, last_evaluation, last_suggestions, sort_order
     FROM user_skill_items WHERE deleted_at IS NULL
     ORDER BY COALESCE(sort_order, 999999), datetime(updated_at) DESC`,
  );
  const desiredRows = await db.getAllAsync<DesiredRow>(
    `SELECT id, name, target_level, sort_order
     FROM user_desired_skills WHERE deleted_at IS NULL
     ORDER BY COALESCE(sort_order, 999999), datetime(updated_at) DESC`,
  );
  const meta = await db.getFirstAsync<MetaRow>(
    `SELECT last_ai_at, last_overall_suggestions, last_profile_analysis
     FROM user_skills_meta WHERE id = ? LIMIT 1`,
    [SKILLS_META_ID],
  );
  return {
    skills: skillRows.map(rowToSkill),
    desired_skills: desiredRows.map(rowToDesired),
    last_ai_at: meta?.last_ai_at?.trim() || null,
    last_overall_suggestions: meta?.last_overall_suggestions?.trim() || null,
    last_profile_analysis: meta?.last_profile_analysis?.trim() || null,
  };
}

async function importSnapshotToDb(db: SQLite.SQLiteDatabase, snapshot: UserSkillsSnapshot): Promise<void> {
  const normalized = ensureUserSkillsSnapshot(snapshot);
  const now = new Date().toISOString();
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.execAsync('BEGIN IMMEDIATE');
    await db.runAsync('DELETE FROM user_skill_items');
    await db.runAsync('DELETE FROM user_desired_skills');
    let sort = 0;
    for (const skill of normalized.skills) {
      await db.runAsync(
        `INSERT INTO user_skill_items (
          id, name, description, last_evaluation, last_suggestions, sort_order,
          created_at, updated_at, deleted_at, sync_status, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 1)`,
        [
          skill.id,
          skill.name,
          skill.description,
          skill.last_evaluation?.trim() || null,
          skill.last_suggestions?.trim() || null,
          sort,
          now,
          now,
        ],
      );
      sort += 1;
    }
    sort = 0;
    for (const desired of normalized.desired_skills) {
      await db.runAsync(
        `INSERT INTO user_desired_skills (
          id, name, target_level, sort_order,
          created_at, updated_at, deleted_at, sync_status, version
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'synced', 1)`,
        [desired.id, desired.name, desired.target_level, sort, now, now],
      );
      sort += 1;
    }
    await db.runAsync(
      `INSERT OR REPLACE INTO user_skills_meta (
        id, last_ai_at, last_overall_suggestions, last_profile_analysis, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        SKILLS_META_ID,
        normalized.last_ai_at,
        normalized.last_overall_suggestions,
        normalized.last_profile_analysis,
        now,
      ],
    );
    await db.execAsync('COMMIT');
  } catch (e) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
  markUserSkillsDirty();
}

/** 启动时：将 AsyncStorage 中的技能组合一次性迁入 SQLite */
export async function migrateUserSkillsStorageToSqliteIfNeeded(db?: SQLite.SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());
  const flag = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    [USER_SKILLS_ASYNC_MIGRATED_KEY],
  );
  if (flag?.value === '1') return;

  const skillCount = await database.getFirstAsync<{ c: number }>(
    'SELECT COUNT(1) AS c FROM user_skill_items WHERE deleted_at IS NULL',
  );
  const desiredCount = await database.getFirstAsync<{ c: number }>(
    'SELECT COUNT(1) AS c FROM user_desired_skills WHERE deleted_at IS NULL',
  );
  const hasSqliteData = Number(skillCount?.c ?? 0) > 0 || Number(desiredCount?.c ?? 0) > 0;

  if (!hasSqliteData) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw?.trim()) {
        const parsed = JSON.parse(raw) as unknown;
        const snapshot = normalizeUserSkillsSnapshot(parsed);
        const hasContent =
          snapshot.skills.length > 0 ||
          snapshot.desired_skills.length > 0 ||
          snapshot.last_ai_at != null ||
          snapshot.last_overall_suggestions != null ||
          snapshot.last_profile_analysis != null;
        if (hasContent) {
          await importSnapshotToDb(database, snapshot);
        }
      }
    } catch {
      /* ignore corrupt legacy */
    }
  }

  await AsyncStorage.removeItem(STORAGE_KEY);
  await database.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
    USER_SKILLS_ASYNC_MIGRATED_KEY,
    '1',
  ]);
}

export async function loadUserSkills(): Promise<UserSkillsSnapshot> {
  const db = await getDatabase();
  await migrateUserSkillsStorageToSqliteIfNeeded(db);
  return loadSnapshotFromDb(db);
}

export async function saveUserSkills(snapshot: UserSkillsSnapshot): Promise<void> {
  const db = await getDatabase();
  await migrateUserSkillsStorageToSqliteIfNeeded(db);
  await importSnapshotToDb(db, snapshot);
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
