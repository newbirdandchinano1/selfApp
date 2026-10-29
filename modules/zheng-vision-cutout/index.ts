import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type VisionCutoutQuality = 'accurate' | 'balanced' | 'fast';

export type CutOutPersonResult = {
  /** file:// 本地透明 PNG */
  uri: string;
};

type ZhengVisionCutoutNative = {
  isAvailable: () => Promise<boolean>;
  cutOutPerson: (imageUri: string, quality?: string | null) => Promise<{ uri: string }>;
};

const native = requireOptionalNativeModule<ZhengVisionCutoutNative>('ZhengVisionCutout');

/** 原生模块是否已链入（development build 重编后才有）。 */
export function isVisionCutoutModuleLinked(): boolean {
  return native != null;
}

/**
 * 当前环境是否可用 Vision 人像抠图。
 * iOS 实机 + 已链入模块为 true；模拟器 / Android / Expo Go 为 false。
 */
export async function isVisionCutoutAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' || !native?.isAvailable) {
    return false;
  }
  try {
    return await native.isAvailable();
  } catch {
    return false;
  }
}

/**
 * 人像去背景，输出透明 PNG 的本地 URI。
 * @param imageUri 本地 file:// 或绝对路径（相册选图结果即可）
 */
export async function cutOutPerson(
  imageUri: string,
  options?: { quality?: VisionCutoutQuality },
): Promise<CutOutPersonResult> {
  const uri = imageUri.trim();
  if (!uri) {
    throw new Error('图片路径为空');
  }
  if (!native?.cutOutPerson) {
    throw new Error(
      '未找到 ZhengVisionCutout 原生模块。请使用 development build 并执行 npx expo run:ios 重新编译。',
    );
  }
  if (Platform.OS !== 'ios') {
    throw new Error('Vision 人像抠图仅支持 iOS 实机');
  }

  const quality = options?.quality ?? 'accurate';
  const result = await native.cutOutPerson(uri, quality);
  if (!result?.uri?.trim()) {
    throw new Error('原生模块未返回结果 URI');
  }
  return { uri: result.uri.trim() };
}
