/**
 * 任务族表单入口（历史兼容）。
 * 子任务已改为页内 AddSubtaskSheet，不再走独立路由页。
 */
export type TaskFormMode = 'create' | 'standalone' | 'standalone-edit' | 'subtask';

type TaskFormScreenProps = {
  mode: TaskFormMode;
};

export function TaskFormScreen({ mode }: TaskFormScreenProps) {
  throw new Error(
    mode === 'subtask'
      ? '子任务请使用页内 <AddSubtaskSheet />，勿再打开 /add-subtask 路由。'
      : `TaskFormScreen: mode "${mode}" 尚未迁入；请使用 add-task 路由（standalone / create）。`,
  );
}
