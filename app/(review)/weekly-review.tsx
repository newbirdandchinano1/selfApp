import { Redirect } from 'expo-router';

/** 兼容旧链接与通知跳转，统一进入底部「复盘」Tab */
export default function WeeklyReviewRedirect() {
  return <Redirect href="/(tabs)/review" />;
}
