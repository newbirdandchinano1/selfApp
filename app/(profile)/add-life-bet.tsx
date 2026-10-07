import { Redirect } from 'expo-router';

/** 添加赌注统一走 edit-life-bet/new；保留路由以免旧入口 404 */
export default function AddLifeBetScreen() {
  return <Redirect href="/edit-life-bet/new" />;
}
