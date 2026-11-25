import React, { type ReactNode } from 'react';
import { ThemeProvider } from './theme/ThemeContext';
import { ToastProvider } from './components/Toast';
import { AppStoreProvider } from './store/AppStore';

/** 博客模块独立主题 / Toast / 数据 store，挂在 blog 路由布局上 */
export function ZlogProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppStoreProvider>{children}</AppStoreProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
