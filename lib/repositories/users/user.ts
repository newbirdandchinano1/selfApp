import { readApiRecord, readApiTable } from '@/lib/api-read';
import { sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { deriveRestDaysFromWorkoutDays, parseUserWeekDaysJson } from '@/lib/user-workout-schedule';

import { getDatabase } from '../../database.native';
import type { UpdateDefaultUserInput, UserRow } from './user.types';

export { deriveRestDaysFromWorkoutDays } from '@/lib/user-workout-schedule';

function serializeWeekDays(days: string[]): string {
  return JSON.stringify(days);
}

/** ISO `YYYY-MM-DD`（按本地日历）；已满周岁岁数，无有效生日时为 0 */
export function computeAgeFromBirthdayIso(iso: string | null | undefined): number {
  if (iso == null || iso === '') return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return 0;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  const birth = new Date(y, mo - 1, d);
  if (Number.isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return Math.max(0, age);
}

const userUpdateListeners = new Set<() => void>();

export function subscribeDefaultUserUpdates(listener: () => void) {
  userUpdateListeners.add(listener);
  return () => {
    userUpdateListeners.delete(listener);
  };
}

function notifyDefaultUserUpdated() {
  for (const listener of userUpdateListeners) {
    listener();
  }
}

async function readLocalDefaultUser(): Promise<UserRow | null> {
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<UserRow>(
    `SELECT * FROM users WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
    ['default'],
  );
  return row ?? null;
}

/** 本地尚无 default 用户时写入种子行（与 database 迁移一致） */
async function ensureLocalDefaultUserSeed(): Promise<UserRow> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR IGNORE INTO users (id, height, weight, age, created_at, updated_at) VALUES (?, 0, 0, 0, datetime("now"), datetime("now"))',
    ['default'],
  );
  await db.runAsync(
    `UPDATE users
     SET gender = COALESCE(NULLIF(gender, ''), '男'),
         lifestyle = COALESCE(NULLIF(lifestyle, ''), '长期静坐不运动'),
         goal = COALESCE(NULLIF(goal, ''), '无')
     WHERE id = ?`,
    ['default'],
  );
  const row = await readLocalDefaultUser();
  if (!row) throw new Error('无法初始化默认用户');
  return row;
}

export async function getDefaultUser() {
  let row: UserRow | null = null;
  try {
    row = await readApiRecord<UserRow>('users', 'default', { offlineFallback: true });
  } catch (e) {
    if (__DEV__) console.warn('[user] REST 读取 default 用户失败，回退本地', e);
  }
  if (!row) {
    row = await readLocalDefaultUser();
  }
  if (!row) {
    try {
      const rows = await readApiTable<UserRow>('users', { offlineFallback: true });
      row = rows.find((u) => u.id === 'default') ?? null;
    } catch {
      // ignore
    }
  }
  if (!row) {
    row = await ensureLocalDefaultUserSeed();
  }
  if (!row) return row;

  const withPortrait: UserRow = {
    ...row,
    persona_portrait:
      row.persona_portrait == null || row.persona_portrait === undefined
        ? null
        : String(row.persona_portrait),
  };

  if (!Object.prototype.hasOwnProperty.call(withPortrait, 'birthday')) {
    return withPortrait;
  }

  const computed = computeAgeFromBirthdayIso(withPortrait.birthday);
  if (withPortrait.age !== computed) {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE users SET age = ?, updated_at = datetime('now'),
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [computed, 'default'],
    );
    notifyDefaultUserUpdated();
    return { ...withPortrait, age: computed };
  }
  return withPortrait;
}

export async function updateDefaultUser(input: UpdateDefaultUserInput) {
  const db = await getDatabase();
  let columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
  let columnSet = new Set(columns.map((c) => c.name));
  const ensureUserColumn = async (
    column: 'gender' | 'lifestyle' | 'goal' | 'birthday' | 'workout_days' | 'rest_days' | 'persona_portrait',
    defaultValue?: string
  ) => {
    if (columnSet.has(column)) return;
    await db.execAsync(`ALTER TABLE users ADD COLUMN ${column} TEXT`);
    if (defaultValue !== undefined) {
      await db.runAsync(
        `UPDATE users
         SET ${column} = COALESCE(NULLIF(${column}, ''), ?)
         WHERE id = ?`,
        [defaultValue, 'default']
      );
    }
    columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
    columnSet = new Set(columns.map((c) => c.name));
  };
  await ensureUserColumn('gender', '男');
  await ensureUserColumn('lifestyle', '长期静坐不运动');
  await ensureUserColumn('goal', '无');
  await ensureUserColumn('workout_days', '[]');
  await ensureUserColumn('rest_days', '[]');
  await ensureUserColumn('birthday');
  await ensureUserColumn('persona_portrait');

  const computedAge = computeAgeFromBirthdayIso(input.birthday);
  const personaPortrait =
    input.persona_portrait == null ? null : String(input.persona_portrait).trim().slice(0, 500);

  const updatable: Array<{ sql: string; value: string | number | null }> = [
    { sql: 'name = ?', value: input.name },
    { sql: 'height = ?', value: input.height },
    { sql: 'weight = ?', value: input.weight },
    { sql: 'age = ?', value: computedAge },
  ];
  if (input.avatar_uri !== undefined) {
    updatable.push({ sql: 'avatar_uri = ?', value: input.avatar_uri ?? null });
  }
  if (columnSet.has('persona_portrait')) {
    updatable.push({ sql: 'persona_portrait = ?', value: personaPortrait });
  }
  if (columnSet.has('gender')) updatable.push({ sql: 'gender = ?', value: input.gender });
  if (columnSet.has('lifestyle')) updatable.push({ sql: 'lifestyle = ?', value: input.lifestyle });
  if (columnSet.has('goal')) updatable.push({ sql: 'goal = ?', value: input.goal });
  if (columnSet.has('workout_days')) {
    const workoutJson = input.workout_days ?? '[]';
    updatable.push({ sql: 'workout_days = ?', value: workoutJson });
    if (columnSet.has('rest_days')) {
      const rest = deriveRestDaysFromWorkoutDays(parseUserWeekDaysJson(workoutJson));
      updatable.push({ sql: 'rest_days = ?', value: serializeWeekDays(rest) });
    }
  }
  if (columnSet.has('birthday')) updatable.push({ sql: 'birthday = ?', value: input.birthday ?? null });

  const assignments = [
    ...updatable.map((f) => f.sql),
    "updated_at = datetime('now')",
    "sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END",
  ].join(', ');
  const values = [...updatable.map((f) => f.value), 'default'];
  await db.runAsync(
    `UPDATE users
     SET ${assignments}
     WHERE id = ?`,
    values
  );
  notifyDefaultUserUpdated();
}
