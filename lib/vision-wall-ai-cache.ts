import AsyncStorage from '@react-native-async-storage/async-storage';

import type { VisionWallAiAssessmentPayload } from '@/lib/zhipu-image-parse';

const STORAGE_KEY = '@vision_wall_ai_assessment_v1';

export type VisionWallAiCacheEntry = {
  fingerprint: string;
  generated_at: string;
  data: VisionWallAiAssessmentPayload;
};

export async function loadVisionWallAiCache(): Promise<VisionWallAiCacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VisionWallAiCacheEntry;
    if (!parsed?.data?.sections?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveVisionWallAiCache(entry: VisionWallAiCacheEntry): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
}

export async function clearVisionWallAiCache(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
