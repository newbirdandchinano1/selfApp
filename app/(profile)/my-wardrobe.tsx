import { WardrobeScreen } from '@/components/wardrobe';
import type { WardrobeTab } from '@/components/wardrobe/data';
import { useWardrobeTheme } from '@/constants/wardrobe-theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { View } from 'react-native';

const WARDROBE_TABS = new Set<WardrobeTab>(['closet', 'outfits', 'mine']);

function parseTab(raw: string | string[] | undefined): WardrobeTab | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const t = (v ?? '').trim().toLowerCase();
  if (t === 'outfit') return 'outfits';
  return WARDROBE_TABS.has(t as WardrobeTab) ? (t as WardrobeTab) : undefined;
}

/** 我的衣柜：对齐 `衣橱-UI重构.html` 的 ATELIER 衣橱 UI */
export default function MyWardrobeScreen() {
  const router = useRouter();
  const { w } = useWardrobeTheme();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const initialTab = useMemo(() => parseTab(params.tab), [params.tab]);

  return (
    <View style={{ flex: 1, backgroundColor: w.screenMid }}>
      <WardrobeScreen onBack={() => router.back()} initialTab={initialTab} />
    </View>
  );
}
