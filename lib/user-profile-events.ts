import { EventEmitter } from 'events';

const emitter = new EventEmitter();
const USER_PROFILE_UPDATED = 'user-profile-updated';

export function emitUserProfileUpdated() {
  emitter.emit(USER_PROFILE_UPDATED);
}

export function onUserProfileUpdated(listener: () => void) {
  emitter.addListener(USER_PROFILE_UPDATED, listener);
  return () => {
    emitter.removeListener(USER_PROFILE_UPDATED, listener);
  };
}
