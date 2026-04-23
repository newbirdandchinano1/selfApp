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
  await db.runAsync(
    `UPDATE users
     SET name = ?, avatar_uri = ?, height = ?, weight = ?, age = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [input.name, input.avatar_uri ?? null, input.height, input.weight, input.age, 'default']
  );
  notifyDefaultUserUpdated();
}
