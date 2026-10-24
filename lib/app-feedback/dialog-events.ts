export type AppDialogKind = 'success' | 'warning' | 'danger';

export type AppDialogConfirmOptions = {
  title: string;
  message?: string;
  kind?: AppDialogKind;
  cancelText?: string;
  confirmText?: string;
  /** true → 确认键用 clay 危险色（删除等） */
  destructive?: boolean;
};

export type AppDialogAlertOptions = {
  title: string;
  message?: string;
  kind?: AppDialogKind;
  okText?: string;
};

export type AppDialogPayload = {
  id: number;
  title: string;
  message: string;
  kind: AppDialogKind;
  cancelText: string | null;
  confirmText: string;
  confirmDanger: boolean;
  resolve: (confirmed: boolean) => void;
};

type Listener = (payload: AppDialogPayload | null) => void;

const listeners = new Set<Listener>();

let current: AppDialogPayload | null = null;
let dialogSeq = 0;

function emit(payload: AppDialogPayload | null): void {
  current = payload;
  for (const listener of listeners) {
    listener(payload);
  }
}

function dismissCurrent(confirmed: boolean): void {
  const prev = current;
  if (!prev) return;
  emit(null);
  prev.resolve(confirmed);
}

function open(partial: Omit<AppDialogPayload, 'id' | 'resolve'>): Promise<boolean> {
  return new Promise(resolve => {
    if (current) {
      const prev = current;
      emit(null);
      prev.resolve(false);
    }

    const payload: AppDialogPayload = {
      id: ++dialogSeq,
      ...partial,
      resolve,
    };
    emit(payload);
  });
}

/** 命令式全局提示框（需根布局挂载 AppDialogHost） */
export const dialog = {
  /** 双按钮确认；resolve true = 点确认 */
  confirm(opts: AppDialogConfirmOptions): Promise<boolean> {
    const destructive = Boolean(opts.destructive);
    const kind: AppDialogKind =
      opts.kind ?? (destructive ? 'danger' : 'success');
    return open({
      title: opts.title.trim() || '确认',
      message: (opts.message ?? '').trim(),
      kind,
      cancelText: (opts.cancelText ?? '取消').trim() || '取消',
      confirmText:
        (opts.confirmText ?? (destructive ? '删除' : '确定')).trim() ||
        (destructive ? '删除' : '确定'),
      confirmDanger: destructive,
    });
  },

  /** 单按钮提示；关闭后 resolve */
  async alert(opts: AppDialogAlertOptions): Promise<void> {
    await open({
      title: opts.title.trim() || '提示',
      message: (opts.message ?? '').trim(),
      kind: opts.kind ?? 'success',
      cancelText: null,
      confirmText: (opts.okText ?? '好的').trim() || '好的',
      confirmDanger: false,
    });
  },

  /** 强制关闭（视为取消） */
  dismiss(): void {
    dismissCurrent(false);
  },
};

/** Host 内调用：用户点确认 / 取消 / 遮罩 */
export function resolveAppDialog(confirmed: boolean): void {
  dismissCurrent(confirmed);
}

export function subscribeAppDialog(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
