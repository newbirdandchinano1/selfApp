import { NotoSansSC_400Regular } from '@expo-google-fonts/noto-sans-sc/400Regular';
import { NotoSansSC_500Medium } from '@expo-google-fonts/noto-sans-sc/500Medium';
import { NotoSansSC_600SemiBold } from '@expo-google-fonts/noto-sans-sc/600SemiBold';
import { NotoSansSC_700Bold } from '@expo-google-fonts/noto-sans-sc/700Bold';
import { NotoSerifSC_600SemiBold } from '@expo-google-fonts/noto-serif-sc/600SemiBold';
import { NotoSerifSC_700Bold } from '@expo-google-fonts/noto-serif-sc/700Bold';
import { RobotoMono_400Regular } from '@expo-google-fonts/roboto-mono/400Regular';
import { RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono/500Medium';
import { RobotoMono_600SemiBold } from '@expo-google-fonts/roboto-mono/600SemiBold';
import { RobotoMono_700Bold } from '@expo-google-fonts/roboto-mono/700Bold';
import { useFonts } from 'expo-font';
import { Platform } from 'react-native';

/**
 * 加载设计稿首选项字族（Noto Serif SC / Noto Sans SC / Roboto Mono）。
 * Web 走系统 CSS 栈，无需打包加载。
 */
export function useWardrobeFonts(): { ready: boolean; error: Error | null } {
  const [loaded, error] = useFonts({
    NotoSerifSC_600SemiBold,
    NotoSerifSC_700Bold,
    NotoSansSC_400Regular,
    NotoSansSC_500Medium,
    NotoSansSC_600SemiBold,
    NotoSansSC_700Bold,
    RobotoMono_400Regular,
    RobotoMono_500Medium,
    RobotoMono_600SemiBold,
    RobotoMono_700Bold,
  });

  if (Platform.OS === 'web') {
    return { ready: true, error: null };
  }

  // 加载失败也放行，避免衣橱页卡死；未注册字族时系统会回退
  return { ready: loaded || error != null, error };
}
