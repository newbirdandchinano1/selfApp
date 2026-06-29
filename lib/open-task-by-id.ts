import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { isStandaloneTodoTask, standaloneTodoEditorHref } from '@/lib/standalone-todo-task';
import type { Router } from 'expo-router';
import { Alert } from 'react-native';

/** 确保任务已同步到本地后，按独立待办 / 项目任务打开对应编辑页 */
export async function openTaskById(router: Router, taskId: string): Promise<boolean> {
  const id = taskId?.trim();
  if (!id) return false;

  try {
    const task = await ensureLocalRowForWrite<TaskRow>('tasks', id);
    if (!task) {
      Alert.alert('待办不存在', '未找到对应待办，可能已被删除。');
      return false;
    }
    if (isStandaloneTodoTask(task)) {
      router.push(standaloneTodoEditorHref(id));
    } else {
      router.push({ pathname: '/task/[id]', params: { id } });
    }
    return true;
  } catch (error) {
    console.warn('打开待办失败', error);
    Alert.alert('打开失败', '无法加载待办，请稍后重试。');
    return false;
  }
}
