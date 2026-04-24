import { getDatabase } from '../../database.native';
import type { UpdateDefaultUserInput, UserRow } from './user.types';

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
  return db.getFirstAsync<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', ['default']);
}

export async function updateDefaultUser(input: UpdateDefaultUserInput) {
  const db = await getDatabase();
  let columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
  let columnSet = new Set(columns.map((c) => c.name));
  const ensureUserColumn = async (column: 'gender' | 'lifestyle' | 'goal', defaultValue: string) => {
    if (columnSet.has(column)) return;
    await db.execAsync(`ALTER TABLE users ADD COLUMN ${column} TEXT`);
    await db.runAsync(
      `UPDATE users
       SET ${column} = COALESCE(NULLIF(${column}, ''), ?)
       WHERE id = ?`,
      [defaultValue, 'default']
    );
    columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
    columnSet = new Set(columns.map((c) => c.name));
  };
  await ensureUserColumn('gender', '男');
  await ensureUserColumn('lifestyle', '长期静坐不运动');
  await ensureUserColumn('goal', '无');

  const updatable: Array<{ sql: string; value: string | number | null }> = [
    { sql: 'name = ?', value: input.name },
    { sql: 'avatar_uri = ?', value: input.avatar_uri ?? null },
    { sql: 'height = ?', value: input.height },
    { sql: 'weight = ?', value: input.weight },
    { sql: 'age = ?', value: input.age },
  ];
  if (columnSet.has('gender')) updatable.push({ sql: 'gender = ?', value: input.gender });
  if (columnSet.has('lifestyle')) updatable.push({ sql: 'lifestyle = ?', value: input.lifestyle });
  if (columnSet.has('goal')) updatable.push({ sql: 'goal = ?', value: input.goal });

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
