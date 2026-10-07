import * as SplashScreen from 'expo-splash-screen';
import { Platform } from 'react-native';

let inflight: Promise<void> | null = null;
let confirmedHidden = false;

/**
 * iOS 生产包上 hideAsync 偶发首次无效（返回 undefined），多见于真机 RELEASE；
 * iPad 上复现更明显。短间隔重试直到返回 true 或耗尽次数。
 * @see https://github.com/expo/expo/discussions/28175
 */
export async function hideNativeSplashWithRetry(opts?: {
  attempts?: number;
  intervalMs?: number;
}): Promise<void> {
  if (Platform.OS === 'web') return;
  if (confirmedHidden) return;
  if (inflight) return inflight;

  const attempts = opts?.attempts ?? 30;
  const intervalMs = opts?.intervalMs ?? 100;

  inflight = (async () => {
    for (let i = 0; i < attempts; i += 1) {
      if (confirmedHidden) return;
      try {
        const result = await SplashScreen.hideAsync();
        if (result === true) {
          confirmedHidden = true;
          return;
        }
      } catch {
        /* 继续重试 */
      }
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
