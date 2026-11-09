import { NotoSansSC_400Regular } from '@expo-google-fonts/noto-sans-sc/400Regular';
import { NotoSansSC_700Bold } from '@expo-google-fonts/noto-sans-sc/700Bold';
import { NotoSerifSC_600SemiBold } from '@expo-google-fonts/noto-serif-sc/600SemiBold';
import { NotoSerifSC_700Bold } from '@expo-google-fonts/noto-serif-sc/700Bold';
import { RobotoMono_400Regular } from '@expo-google-fonts/roboto-mono/400Regular';
import { RobotoMono_700Bold } from '@expo-google-fonts/roboto-mono/700Bold';
import { useFonts } from 'expo-font';
import { Platform } from 'react-native';

/**
 * 全局加载设计字族（Noto Serif SC / Noto Sans SC / Roboto Mono）。
 * 仅打包 400/700 Sans、600/700 Serif、400/700 Mono。
 * 实际套用由 `rn-font-text` + babel 插件完成（defaultProps 在新 RN 无效）。
 * Web 走 CSS 栈，无需打包加载。
 */
export function useAppFonts(): { ready: boolean; error: Error | null } {
  const [loaded, error] = useFonts({
    NotoSerifSC_600SemiBold,
    NotoSerifSC_700Bold,
    NotoSansSC_400Regular,
    NotoSansSC_700Bold,
    RobotoMono_400Regular,
    RobotoMono_700Bold,
  });

  if (Platform.OS === 'web') {
    return { ready: true, error: null };
  }

  // 加载失败也放行，避免启动卡死；未注册字族时系统会回退
  return { ready: loaded || error != null, error: error ?? null };
}
