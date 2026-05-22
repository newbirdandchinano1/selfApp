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

export type HealthKitAppIdentity = {
  displayName: string;
  bundleIdentifier: string;
  bundleName: string;
};

export type HealthKitSnapshot = {
  available: boolean;
  /** 是否已向系统登记（不等于每项数据都已允许读取） */
  authorized: boolean;
  fetchedAt: string;
  characteristics: Record<string, string>;
  quantities: HealthKitQuantityRow[];
  categories: HealthKitCategoryRow[];
  errors: string[];
  requestStatus?: HealthKitAuthorizationRequestStatus;
  appDisplayName?: string;
  bundleIdentifier?: string;
  /** 用户在健康 App 里未授权读取的指标数量 */
  skippedUnauthorized?: number;
  /** 已授权但暂无记录的指标数量 */
  skippedNoData?: number;
};

/** 无法使用 HealthKit 时的具体原因（用于界面提示） */
export type HealthKitBlockReason =
  | 'not_ios'
  | 'expo_go'
  | 'native_module_missing'
  | 'ipad_unsupported'
  | 'healthkit_unavailable';

export type HealthKitAuthorizationRequestStatus =
  | 'shouldRequest'
  | 'unnecessary'
  | 'unknown'
  | 'unavailable';

type ZhengHealthKitNative = {
  isAvailable: () => Promise<boolean>;
  requestAuthorization: () => Promise<boolean>;
  fetchAllHealthData: () => Promise<HealthKitSnapshot>;
  getAppDisplayName: () => Promise<string>;
  getAppIdentity: () => Promise<HealthKitAppIdentity>;
  getAuthorizationRequestStatus: () => Promise<HealthKitAuthorizationRequestStatus>;
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

/** iPhone 主屏幕与健康 App 列表里显示的应用名 */
export async function getHealthKitAppDisplayName(): Promise<string> {
  const identity = await getHealthKitAppIdentity();
  return identity.displayName;
}

export async function getHealthKitAppIdentity(): Promise<HealthKitAppIdentity> {
  const fallbackName =
    (typeof Constants.expoConfig?.name === 'string' && Constants.expoConfig.name.trim()) ||
    '小郑的自我修养';
  if (!isAppleHealthKitSupported() || !native) {
    return { displayName: fallbackName, bundleIdentifier: '', bundleName: '' };
  }
  try {
    if (native.getAppIdentity) {
      const raw = await native.getAppIdentity();
      const displayName =
        (typeof raw?.displayName === 'string' && raw.displayName.trim()) || fallbackName;
      return {
        displayName,
        bundleIdentifier:
          typeof raw?.bundleIdentifier === 'string' ? raw.bundleIdentifier.trim() : '',
        bundleName: typeof raw?.bundleName === 'string' ? raw.bundleName.trim() : '',
      };
    }
    const name = await native.getAppDisplayName();
    return {
      displayName: typeof name === 'string' && name.trim() ? name.trim() : fallbackName,
      bundleIdentifier: '',
      bundleName: '',
    };
  } catch {
    return { displayName: fallbackName, bundleIdentifier: '', bundleName: '' };
  }
}

export async function getHealthKitAuthorizationRequestStatus(): Promise<HealthKitAuthorizationRequestStatus> {
  if (!isAppleHealthKitSupported() || !native) return 'unavailable';
  try {
    const status = await native.getAuthorizationRequestStatus();
    if (
      status === 'shouldRequest' ||
      status === 'unnecessary' ||
      status === 'unknown' ||
      status === 'unavailable'
    ) {
      return status;
    }
    return 'unknown';
  } catch {
    return 'unknown';
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
    const requestStatus = raw.requestStatus;
    return {
      available: Boolean(raw.available),
      authorized: Boolean(raw.authorized),
      fetchedAt: String(raw.fetchedAt ?? new Date().toISOString()),
      characteristics: (raw.characteristics as Record<string, string>) ?? {},
      quantities: Array.isArray(raw.quantities) ? (raw.quantities as HealthKitQuantityRow[]) : [],
      categories: Array.isArray(raw.categories) ? (raw.categories as HealthKitCategoryRow[]) : [],
      errors: Array.isArray(raw.errors) ? raw.errors.map(String) : [],
      requestStatus:
        requestStatus === 'shouldRequest' ||
        requestStatus === 'unnecessary' ||
        requestStatus === 'unknown' ||
        requestStatus === 'unavailable'
          ? requestStatus
          : undefined,
      appDisplayName:
        typeof raw.appDisplayName === 'string' && raw.appDisplayName.trim()
          ? raw.appDisplayName.trim()
          : undefined,
      bundleIdentifier:
        typeof raw.bundleIdentifier === 'string' && raw.bundleIdentifier.trim()
          ? raw.bundleIdentifier.trim()
          : undefined,
      skippedUnauthorized: Number(raw.skippedUnauthorized ?? 0) || 0,
      skippedNoData: Number(raw.skippedNoData ?? 0) || 0,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : '读取健康数据失败';
    return { ...EMPTY_SNAPSHOT, errors: [message] };
  }
}
