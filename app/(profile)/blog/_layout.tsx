import { ZlogProviders } from '@/features/zlog';
import { Stack } from 'expo-router';
import React from 'react';

/** 博客子栈：共享 zlog store / 主题 / Toast */
export default function BlogLayout() {
  return (
    <ZlogProviders>
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="detail" />
        <Stack.Screen
          name="compose-moment"
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="compose-blog"
          options={{ animation: 'slide_from_bottom' }}
        />
      </Stack>
    </ZlogProviders>
  );
}
