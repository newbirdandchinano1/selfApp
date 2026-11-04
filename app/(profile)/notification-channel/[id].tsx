/**
 * 提醒设置 · 页面频道详情路由（health / finance / tasks / review；旧类别 id 兼容）。
 */
import { NotificationChannelDetailScreen } from '@/screens/profile/NotificationChannelDetailScreen';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';

function firstParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? '';
  return raw ?? '';
}

export default function NotificationChannelRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  return <NotificationChannelDetailScreen categoryId={firstParam(params.id)} />;
}
