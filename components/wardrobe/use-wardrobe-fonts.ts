import { useAppFonts } from '@/hooks/use-app-fonts';

/**
 * @deprecated 请直接用 `useAppFonts`；根布局已全局加载字体。
 * 保留作兼容薄封装。
 */
export function useWardrobeFonts(): { ready: boolean; error: Error | null } {
  return useAppFonts();
}
