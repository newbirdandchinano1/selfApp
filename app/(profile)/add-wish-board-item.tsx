import { Redirect } from 'expo-router';

/** 添加心愿已改为心愿板页内弹层；保留路由以免旧入口 404 */
export default function AddWishBoardItemScreen() {
  return <Redirect href="/wish-board" />;
}
