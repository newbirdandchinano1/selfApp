type Listener = () => void;

let listeners: Listener[] = [];
let expectShortcutImageHandoff = false;
/** 财务 Tab 尚未挂载时先记下 handoff，避免冷启动/后台唤起时 notify 丢失 */
let pendingHandoffConsume = false;

export function markShortcutImageHandoffExpected(): void {
  expectShortcutImageHandoff = true;
}

export function consumeShortcutImageHandoffExpected(): boolean {
  const v = expectShortcutImageHandoff;
  expectShortcutImageHandoff = false;
  return v;
}

function flushPendingHandoffConsume(): void {
  if (!pendingHandoffConsume || listeners.length === 0) {
    return;
  }
  pendingHandoffConsume = false;
  for (const listener of listeners) {
    listener();
  }
}

/** 财务 Tab 注册：快捷指令 handoff 到达且导航已切到财务时触发消费 */
export function subscribeShortcutHandoffConsume(listener: Listener): () => void {
  listeners.push(listener);
  flushPendingHandoffConsume();
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function notifyShortcutHandoffConsume(): void {
  if (listeners.length === 0) {
    pendingHandoffConsume = true;
    return;
  }
  pendingHandoffConsume = false;
  for (const listener of listeners) {
    listener();
  }
}
