import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type ZhengBackgroundNative = {
  moveToBackground: () => Promise<void>;
  beginBackgroundExecution: () => Promise<void>;
  endBackgroundExecution: () => Promise<void>;
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

/** 申请原生后台执行时间（iOS UIBackgroundTask / Android 前台服务）。 */
export async function beginBackgroundExecution(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    await native?.beginBackgroundExecution?.();
  } catch (e) {
    console.warn('beginBackgroundExecution failed:', e);
  }
}

/** 释放 beginBackgroundExecution 申请的资源。 */
export async function endBackgroundExecution(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    await native?.endBackgroundExecution?.();
  } catch (e) {
    console.warn('endBackgroundExecution failed:', e);
  }
}
