import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type ZhengBackgroundNative = {
  moveToBackground: () => Promise<void>;
};

const native = requireOptionalNativeModule<ZhengBackgroundNative>('ZhengBackground');

/** 将本应用切到后台，便于快捷指令记账后回到用户之前的应用。 */
export async function moveAppToBackground(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    await native?.moveToBackground?.();
  } catch (e) {
    console.warn('moveAppToBackground failed:', e);
  }
}
