type Listener = () => void;

let listeners: Listener[] = [];
let expectShortcutImageHandoff = false;

export function markShortcutImageHandoffExpected(): void {
  expectShortcutImageHandoff = true;
}

export function consumeShortcutImageHandoffExpected(): boolean {
  const v = expectShortcutImageHandoff;
  expectShortcutImageHandoff = false;
  return v;
}

/** 财务 Tab 注册：快捷指令 handoff 到达且导航已切到财务时触发消费 */
export function subscribeShortcutHandoffConsume(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function notifyShortcutHandoffConsume(): void {
  for (const listener of listeners) {
    listener();
  }
}
