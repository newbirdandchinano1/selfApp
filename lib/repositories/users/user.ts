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

export async function getDefaultUser() {
  const db = await getDatabase();
  const row = await db.getFirstAsync<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', ['default']);
  if (!row) return row;

  if (!Object.prototype.hasOwnProperty.call(row, 'birthday')) {
    return row;
  }

  const computed = computeAgeFromBirthdayIso(row.birthday);
  if (row.age !== computed) {
    await db.runAsync(`UPDATE users SET age = ?, updated_at = datetime('now') WHERE id = ?`, [computed, 'default']);
    notifyDefaultUserUpdated();
    return { ...row, age: computed };
  }
  return row;
}

export async function updateDefaultUser(input: UpdateDefaultUserInput) {
  const db = await getDatabase();
  let columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
  let columnSet = new Set(columns.map((c) => c.name));
  const ensureUserColumn = async (
    column: 'gender' | 'lifestyle' | 'goal' | 'birthday' | 'workout_days' | 'rest_days',
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

  const computedAge = computeAgeFromBirthdayIso(input.birthday);

  const updatable: Array<{ sql: string; value: string | number | null }> = [
    { sql: 'name = ?', value: input.name },
    { sql: 'avatar_uri = ?', value: input.avatar_uri ?? null },
    { sql: 'height = ?', value: input.height },
    { sql: 'weight = ?', value: input.weight },
    { sql: 'age = ?', value: computedAge },
  ];
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

  const assignments = [...updatable.map((f) => f.sql), "updated_at = datetime('now')"].join(', ');
  const values = [...updatable.map((f) => f.value), 'default'];
  await db.runAsync(
    `UPDATE users
     SET ${assignments}
     WHERE id = ?`,
    values
  );
  notifyDefaultUserUpdated();
}
