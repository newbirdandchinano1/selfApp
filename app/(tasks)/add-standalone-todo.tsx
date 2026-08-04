import { Redirect } from 'expo-router';

/** 任务 Tab「详细新建」与旧深链统一跳转到带矩阵 UI 的 add-task */
export default function AddStandaloneTodoScreen() {
  return <Redirect href="/add-task?standalone=1" />;
}
