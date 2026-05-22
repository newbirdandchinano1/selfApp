import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type HealthKitQuantityRow = {
  identifier: string;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  source: string;
  aggregation: string;
};

export type HealthKitCategoryRow = {
  identifier: string;
  value: string;
  startDate: string;
  endDate: string;
  source: string;
};

export type HealthKitSnapshot = {
  available: boolean;
  authorized: boolean;
  fetchedAt: string;
  characteristics: Record<string, string>;
  quantities: HealthKitQuantityRow[];
  categories: HealthKitCategoryRow[];
  errors: string[];
};

/** 无法使用 HealthKit 时的具体原因（用于界面提示） */
export type HealthKitBlockReason =
  | 'not_ios'
  | 'expo_go'
  | 'native_module_missing'
  | 'ipad_unsupported'
  | 'healthkit_unavailable';

type ZhengHealthKitNative = {
  isAvailable: () => Promise<boolean>;
  requestAuthorization: () => Promise<boolean>;
  fetchAllHealthData: () => Promise<HealthKitSnapshot>;
};

const native = requireOptionalNativeModule<ZhengHealthKitNative>('ZhengHealthKit');

const EMPTY_SNAPSHOT: HealthKitSnapshot = {
  available: false,
  authorized: false,
  fetchedAt: new Date().toISOString(),
  characteristics: {},
  quantities: [],
  categories: [],
  errors: [],
};

export function isAppleHealthKitSupported(): boolean {
  return Platform.OS === 'ios';
}

export function isHealthKitNativeModuleLinked(): boolean {
  return native != null;
}

function isRunningInExpoGo(): boolean {
  return Constants.executionEnvironment === 'storeClient';
}

/** 诊断当前环境为何无法使用 HealthKit；返回 null 表示可以尝试读取 */
export async function getHealthKitBlockReason(): Promise<HealthKitBlockReason | null> {
  if (Platform.OS !== 'ios') return 'not_ios';
  if (Platform.isPad === true) return 'ipad_unsupported';
  if (isRunningInExpoGo()) return 'expo_go';
  if (!native) return 'native_module_missing';
  try {
    const available = await native.isAvailable();
    if (!available) return 'healthkit_unavailable';
  } catch {
    return 'native_module_missing';
  }
  return null;
}

export function healthKitBlockReasonMessage(reason: HealthKitBlockReason): string {
  switch (reason) {
    case 'not_ios':
      return 'Apple 健康仅支持 iOS 设备。';
    case 'expo_go':
      return '当前为 Expo Go，无法加载自定义原生模块。请使用本项目的开发版安装包（在 Mac 上执行 npx expo run:ios 或 EAS 构建后安装）。';
    case 'native_module_missing':
      return '未检测到 HealthKit 原生模块。请重新打 iOS 开发包并安装（EAS：eas build -p ios --profile development；本地 Mac：npx expo prebuild --platform ios && npx expo run:ios）。添加 zheng-healthkit 后旧安装包不会自动包含该模块。';
    case 'ipad_unsupported':
      return 'HealthKit 仅支持 iPhone，iPad 无法读取 Apple 健康数据，请改用 iPhone 真机。';
    case 'healthkit_unavailable':
      return '系统报告 HealthKit 不可用，请使用 iPhone 真机（模拟器部分版本亦不支持）。';
    default:
      return '无法使用 HealthKit。';
  }
}

export async function isHealthKitAvailable(): Promise<boolean> {
  return (await getHealthKitBlockReason()) === null;
}

export async function requestHealthKitAuthorization(): Promise<boolean> {
  if (!isAppleHealthKitSupported() || !native) return false;
  try {
    return (await native.requestAuthorization()) ?? false;
  } catch {
    return false;
  }
}

export async function fetchAppleHealthKitSnapshot(): Promise<HealthKitSnapshot> {
  if (!isAppleHealthKitSupported()) return { ...EMPTY_SNAPSHOT };
  const block = await getHealthKitBlockReason();
  if (block) {
    return { ...EMPTY_SNAPSHOT, errors: [healthKitBlockReasonMessage(block)] };
  }
  try {
    const raw = await native?.fetchAllHealthData?.();
    if (!raw) {
      return {
        ...EMPTY_SNAPSHOT,
        errors: [healthKitBlockReasonMessage('native_module_missing')],
      };
    }
    return {
      available: Boolean(raw.available),
      authorized: Boolean(raw.authorized),
      fetchedAt: String(raw.fetchedAt ?? new Date().toISOString()),
      characteristics: (raw.characteristics as Record<string, string>) ?? {},
      quantities: Array.isArray(raw.quantities) ? (raw.quantities as HealthKitQuantityRow[]) : [],
      categories: Array.isArray(raw.categories) ? (raw.categories as HealthKitCategoryRow[]) : [],
      errors: Array.isArray(raw.errors) ? raw.errors.map(String) : [],
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : '读取健康数据失败';
    return { ...EMPTY_SNAPSHOT, errors: [message] };
  }
}
