import { getPalette } from '@/constants/design-tokens';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export type MemoWallTone = {
  base: string;
  chip: string;
  search: string;
  line: string;
  ink: string;
  muted: string;
};

/** 粉刷墙的底色和贴在墙上的控件色。浅色是暖灰泥，深色是夜里的同一堵墙。 */
export function memoWallTone(isDark: boolean): MemoWallTone {
  if (isDark) {
    const palette = getPalette('dark');
    return {
      base: palette.background,
      chip: palette.surfaceMuted,
      search: palette.surfaceSubtle,
      line: palette.outlineStrong,
      ink: palette.text,
      muted: palette.textSecondary,
    };
  }
  return {
    base: '#E6DDD0',
    chip: 'rgba(255,252,246,0.78)',
    search: 'rgba(255,252,246,0.92)',
    line: 'rgba(90,70,40,0.18)',
    ink: '#3A2E22',
    muted: '#6E5F4E',
  };
}

/**
 * 备忘录首页的墙面。只用普通 View，避免 SVG 在 Android 上画到内容上面。
 */
export function MemoWall() {
  const { isDark } = useAppTheme();
  const palette = getPalette(isDark ? 'dark' : 'light');
  const patch = isDark ? 'rgba(148,163,184,0.06)' : 'rgba(255,252,246,0.55)';
  const shade = isDark ? 'rgba(0,0,0,0.16)' : 'rgba(90,70,40,0.08)';
  const seam = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(120,98,70,0.16)';

  return (
    <View pointerEvents="none" style={styles.fill} accessibilityElementsHidden>
      <View style={[styles.patch, styles.patchTop, { backgroundColor: patch }]} />
      <View style={[styles.patch, styles.patchRight, { backgroundColor: shade }]} />
      <View style={[styles.patch, styles.patchBottom, { backgroundColor: shade }]} />
      <View style={[styles.seam, { left: '12%', backgroundColor: seam }]} />
      <View style={[styles.seam, { left: '37%', backgroundColor: seam }]} />
      <View style={[styles.seam, { left: '61%', backgroundColor: seam }]} />
      <View style={[styles.seam, { left: '84%', backgroundColor: seam }]} />
      <View style={[styles.baseboard, { backgroundColor: isDark ? palette.background : '#CABBAA' }]} />
      <View style={[styles.baseboardLip, { backgroundColor: isDark ? palette.outline : 'rgba(255,252,246,0.75)' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  patch: {
    position: 'absolute',
    borderRadius: 999,
  },
  patchTop: {
    width: '78%',
    height: '28%',
    top: '-6%',
    left: '-18%',
  },
  patchRight: {
    width: '70%',
    height: '34%',
    top: '18%',
    right: '-24%',
  },
  patchBottom: {
    width: '90%',
    height: '30%',
    bottom: '4%',
    left: '-10%',
  },
  seam: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  baseboard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 18,
  },
  baseboardLip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    height: StyleSheet.hairlineWidth,
  },
});
