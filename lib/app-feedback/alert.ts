/**
 * 与 React Native `Alert.alert` 同签名的主题弹框兼容层。
 * 单按钮 → dialog.alert；双按钮确认 → dialog.confirm；多选项 → dialog.actions。
 */
import { dialog, type AppDialogKind } from './dialog-events';

export type AppAlertButtonStyle = 'default' | 'cancel' | 'destructive';

export type AppAlertButton = {
  text?: string;
  onPress?: (value?: string) => void;
  style?: AppAlertButtonStyle;
};

export type AppAlertOptions = {
  cancelable?: boolean;
  userInterfaceStyle?: 'unspecified' | 'light' | 'dark';
  onDismiss?: () => void;
};

function inferKind(title: string, destructive: boolean): AppDialogKind {
  if (destructive) return 'danger';
  if (/失败|无法|错误|无效|不可|未找到|缺失/.test(title)) return 'warning';
  if (/删除|清除|清空|移除/.test(title)) return 'danger';
  return 'success';
}

function normalizeButtons(buttons?: AppAlertButton[]): Array<{
  text: string;
  style: AppAlertButtonStyle;
  onPress?: (value?: string) => void;
}> {
  if (!buttons || buttons.length === 0) {
    return [{ text: '好的', style: 'default' }];
  }
  return buttons.map(b => ({
    text: (b.text ?? '确定').trim() || '确定',
    style: b.style ?? 'default',
    onPress: b.onPress,
  }));
}

async function present(
  title: string,
  message: string | undefined,
  buttons: ReturnType<typeof normalizeButtons>,
  options?: AppAlertOptions,
): Promise<void> {
  const kind = inferKind(title, buttons.some(b => b.style === 'destructive'));
  const cancelIdx = buttons.findIndex(b => b.style === 'cancel');
  const nonCancel = buttons
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.style !== 'cancel');

  // 单按钮（含仅取消）
  if (buttons.length === 1) {
    const ok = await dialog.alert({
      title,
      message,
      kind,
      okText: buttons[0].text,
    });
    if (ok) buttons[0].onPress?.();
    else options?.onDismiss?.();
    return;
  }

  // 标准双按钮：取消 + 确认
  if (buttons.length === 2 && cancelIdx >= 0 && nonCancel.length === 1) {
    const conf = nonCancel[0];
    const cancel = buttons[cancelIdx];
    const confirmed = await dialog.confirm({
      title,
      message,
      kind: conf.b.style === 'destructive' ? 'danger' : kind,
      cancelText: cancel.text,
      confirmText: conf.b.text,
      destructive: conf.b.style === 'destructive',
    });
    if (confirmed) conf.b.onPress?.();
    else {
      cancel.onPress?.();
      options?.onDismiss?.();
    }
    return;
  }

  // 双按钮无 cancel 标记：第一为次要、第二为主确认
  if (buttons.length === 2 && cancelIdx < 0) {
    const confirmed = await dialog.confirm({
      title,
      message,
      kind: buttons[1].style === 'destructive' ? 'danger' : kind,
      cancelText: buttons[0].text,
      confirmText: buttons[1].text,
      destructive: buttons[1].style === 'destructive',
    });
    if (confirmed) buttons[1].onPress?.();
    else {
      buttons[0].onPress?.();
      options?.onDismiss?.();
    }
    return;
  }

  // 多选项 / 动作列表
  const picked = await dialog.actions({
    title,
    message,
    kind,
    buttons: buttons.map(b => ({
      text: b.text,
      style: b.style,
    })),
  });
  if (picked == null) {
    options?.onDismiss?.();
    const cancel = cancelIdx >= 0 ? buttons[cancelIdx] : null;
    cancel?.onPress?.();
    return;
  }
  buttons[picked]?.onPress?.();
}

/** 命令式 API，行为对齐 RN Alert.alert（fire-and-forget） */
export const Alert = {
  alert(
    title: string,
    message?: string,
    buttons?: AppAlertButton[],
    options?: AppAlertOptions,
  ): void {
    void present(title, message, normalizeButtons(buttons), options).catch(() => {
      /* 避免未处理 rejection */
    });
  },
};
