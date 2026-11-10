/**
 * 全局助手外部入口（对齐 finance sheet launch intent）。
 * 系统分享 / 剪贴板 / 深链 → openGlobalAssistant → Host 导航到独立聊天页。
 */

export type OpenGlobalAssistantOpts = {
  /** 预填文案 */
  text?: string;
  /** data URI 附图（S5：随 /agent/chat 转发识图 Capability） */
  imageDataUri?: string | null;
  /** 打开后自动发送 */
  autoSubmit?: boolean;
  /** 仅打开聊天页，不改预填 */
  openOnly?: boolean;
};

type Listener = (opts: OpenGlobalAssistantOpts) => void;

let pending: OpenGlobalAssistantOpts | null = null;
/** 聊天页启动载荷（可含大图 data URI，不走路由 params） */
let launchPayload: OpenGlobalAssistantOpts | null = null;
const listeners = new Set<Listener>();

function normalizeOpts(opts: OpenGlobalAssistantOpts = {}): OpenGlobalAssistantOpts {
  return {
    ...opts,
    text: opts.text?.trim() || undefined,
    imageDataUri: opts.imageDataUri ?? undefined,
  };
}

export function openGlobalAssistant(opts: OpenGlobalAssistantOpts = {}): void {
  const next = normalizeOpts(opts);
  launchPayload = next;
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
    launchPayload = p;
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

/** 聊天页挂载时取走启动参数（含附图） */
export function takeAssistantLaunchPayload(): OpenGlobalAssistantOpts | null {
  const p = launchPayload;
  launchPayload = null;
  return p;
}

export function peekAssistantLaunchPayload(): OpenGlobalAssistantOpts | null {
  return launchPayload;
}
