import { WardrobeScreen } from '@/components/wardrobe';
import { useRouter } from 'expo-router';
import React from 'react';

/** 我的衣柜：对齐 `衣橱-UI重构.html` 的 ATELIER 衣橱 UI */
export default function MyWardrobeScreen() {
  const router = useRouter();

  return <WardrobeScreen onBack={() => router.back()} />;
}
