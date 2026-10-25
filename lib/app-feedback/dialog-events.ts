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

export type AppDialogActionButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
};

export type AppDialogActionsOptions = {
  title: string;
  message?: string;
  kind?: AppDialogKind;
  buttons: AppDialogActionButton[];
};

export type AppDialogPayload = {
  id: number;
  title: string;
  message: string;
  kind: AppDialogKind;
  /** null = 单按钮 / 动作列表模式不使用左右双键 */
  cancelText: string | null;
  confirmText: string;
  confirmDanger: boolean;
  /** 非 null 时为多选项列表（替代左右双键） */
  actions: AppDialogActionButton[] | null;
  /** confirm/alert：boolean；actions：选中下标，取消/遮罩为 null */
  resolve: (result: boolean | number | null) => void;
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

function dismissCurrent(result: boolean | number | null): void {
  const prev = current;
  if (!prev) return;
  emit(null);
  prev.resolve(result);
}

function open(
  partial: Omit<AppDialogPayload, 'id' | 'resolve'>,
): Promise<boolean | number | null> {
  return new Promise(resolve => {
    if (current) {
      const prev = current;
      emit(null);
      prev.resolve(prev.actions ? null : false);
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
      actions: null,
    }).then(r => r === true);
  },

  /** 单按钮提示；点确认 true，点遮罩/返回 false */
  alert(opts: AppDialogAlertOptions): Promise<boolean> {
    return open({
      title: opts.title.trim() || '提示',
      message: (opts.message ?? '').trim(),
      kind: opts.kind ?? 'success',
      cancelText: null,
      confirmText: (opts.okText ?? '好的').trim() || '好的',
      confirmDanger: false,
      actions: null,
    }).then(r => r === true);
  },

  /**
   * 多选项列表；resolve 选中下标，遮罩/无选为 null。
   * 用于替代 RN Alert 的多按钮动作菜单。
   */
  actions(opts: AppDialogActionsOptions): Promise<number | null> {
    const buttons = opts.buttons
      .map(b => ({
        text: (b.text ?? '').trim() || '选项',
        style: b.style ?? ('default' as const),
      }))
      .filter(b => b.text);
    if (buttons.length === 0) {
      return Promise.resolve(null);
    }
    return open({
      title: opts.title.trim() || '请选择',
      message: (opts.message ?? '').trim(),
      kind: opts.kind ?? 'success',
      cancelText: null,
      confirmText: '',
      confirmDanger: false,
      actions: buttons,
    }).then(r => (typeof r === 'number' ? r : null));
  },

  /** 强制关闭（视为取消） */
  dismiss(): void {
    dismissCurrent(current?.actions ? null : false);
  },
};

/** Host 内调用：用户点确认 / 取消 / 遮罩（双键模式） */
export function resolveAppDialog(confirmed: boolean): void {
  dismissCurrent(confirmed);
}

/** Host 内调用：动作列表选中 / 取消 */
export function resolveAppDialogAction(index: number | null): void {
  dismissCurrent(index);
}

export function subscribeAppDialog(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
