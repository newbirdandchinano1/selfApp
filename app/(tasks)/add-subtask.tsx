import { Redirect } from 'expo-router';

/** 子任务已改为页内 Sheet；保留路由以免旧链接白屏，直接返回上一页。 */
export default function AddSubtaskScreen() {
  return <Redirect href=".." />;
}
