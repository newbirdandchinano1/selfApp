/**
 * 全局助手外部入口（对齐 finance sheet launch intent）。
 * 系统分享 / 剪贴板 / 深链 → openGlobalAssistant → Host 订阅执行。
 */

export type OpenGlobalAssistantOpts = {
  /** 预填文案 */
  text?: string;
  /** data URI 附图 */
  imageDataUri?: string | null;
  /** 打开后自动提交 route/compose */
  autoSubmit?: boolean;
  /** 仅打开 Sheet，不改预填 */
  openOnly?: boolean;
  /** 打开并触发今日简报（Host 可提示用户看首页，或切到简报模式） */
  focusBrief?: boolean;
};

type Listener = (opts: OpenGlobalAssistantOpts) => void;

let pending: OpenGlobalAssistantOpts | null = null;
const listeners = new Set<Listener>();

export function openGlobalAssistant(opts: OpenGlobalAssistantOpts = {}): void {
  const next: OpenGlobalAssistantOpts = {
    ...opts,
    text: opts.text?.trim() || undefined,
    imageDataUri: opts.imageDataUri ?? undefined,
  };
  if (listeners.size === 0) {
    pending = next;
    return;
  }
  pending = null;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function subscribeGlobalAssistant(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    const p = pending;
    pending = null;
    try {
      listener(p);
    } catch {
      /* ignore */
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

export function peekGlobalAssistantPending(): OpenGlobalAssistantOpts | null {
  return pending;
}

export function consumeGlobalAssistantPending(): OpenGlobalAssistantOpts | null {
  const p = pending;
  pending = null;
  return p;
}
