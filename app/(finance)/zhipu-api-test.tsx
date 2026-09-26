import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';

/**
 * 正式包不注册调试实现：仅 `__DEV__` 才 require 屏幕本体，便于 Metro 剥离体积。
 * 生产若深链到此路由则回退到财务页。
 */
let DevScreen: ComponentType | null = null;
if (__DEV__) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DevScreen = require('@/screens/debug/zhipu-api-test-screen').default as ComponentType;
}

export default function ZhipuApiTestRoute() {
  if (!__DEV__ || !DevScreen) {
    return <Redirect href="/(tabs)/finance" />;
  }
  return <DevScreen />;
}
