import { WardrobeScreen } from '@/components/wardrobe';
import { useWardrobeTheme } from '@/constants/wardrobe-theme';
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

/** 我的衣柜：对齐 `衣橱-UI重构.html` 的 ATELIER 衣橱 UI */
export default function MyWardrobeScreen() {
  const router = useRouter();
  const { w } = useWardrobeTheme();

  return (
    <View style={{ flex: 1, backgroundColor: w.screenMid }}>
      <WardrobeScreen onBack={() => router.back()} />
    </View>
  );
}
