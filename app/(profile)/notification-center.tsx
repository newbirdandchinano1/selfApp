import { Redirect } from 'expo-router';

/** 旧「提醒总览」入口 → 消息模块提醒设置区 */
export default function NotificationCenterRedirect() {
  return <Redirect href="/messages?tab=settings" />;
}
