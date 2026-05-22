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

export async function isHealthKitAvailable(): Promise<boolean> {
  if (!isAppleHealthKitSupported()) return false;
  try {
    return (await native?.isAvailable?.()) ?? false;
  } catch {
    return false;
  }
}

export async function requestHealthKitAuthorization(): Promise<boolean> {
  if (!isAppleHealthKitSupported()) return false;
  try {
    return (await native?.requestAuthorization?.()) ?? false;
  } catch {
    return false;
  }
}

export async function fetchAppleHealthKitSnapshot(): Promise<HealthKitSnapshot> {
  if (!isAppleHealthKitSupported()) return { ...EMPTY_SNAPSHOT };
  try {
    const raw = await native?.fetchAllHealthData?.();
    if (!raw) return { ...EMPTY_SNAPSHOT };
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
