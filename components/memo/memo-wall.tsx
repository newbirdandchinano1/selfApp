import { HEALTH_HOME_DARK, HEALTH_HOME_LIGHT } from '@/constants/health-home-theme';
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
  /** 筛选抽屉面板 */
  drawerPaper: string;
  drawerCavity: string;
  searchBg: string;
  chipBg: string;
};

/**
 * 备忘录墙面色 — 对齐健康页奶油纸 / 松墨绿（不再用牛皮纸棕）。
 * 浅色：略深一档的奶油墙，贴便利贴；深色：同一套松墨夜色。
 */
export function memoWallTone(isDark: boolean): MemoWallTone {
  const h = isDark ? HEALTH_HOME_DARK : HEALTH_HOME_LIGHT;
  if (isDark) {
    return {
      base: h.paper,
      chip: h.cardMuted,
      search: h.card,
      line: h.lineStrong,
      ink: h.ink,
      muted: h.muted,
      drawerPaper: h.card,
      drawerCavity: h.paperAlt,
      searchBg: 'rgba(242,238,228,0.1)',
      chipBg: 'rgba(169,199,185,0.14)',
    };
  }
  return {
    base: h.paperAlt,
    chip: 'rgba(255,254,248,0.82)',
    search: 'rgba(255,254,248,0.94)',
    line: h.lineStrong,
    ink: h.ink,
    muted: h.muted,
    drawerPaper: h.paper,
    drawerCavity: h.cardMuted,
    searchBg: h.sageSoft,
    chipBg: h.track,
  };
}

/**
 * 备忘录首页的墙面。只用普通 View，避免 SVG 在 Android 上画到内容上面。
 */
export function MemoWall() {
  const { isDark } = useAppTheme();
  const h = isDark ? HEALTH_HOME_DARK : HEALTH_HOME_LIGHT;
  const patch = isDark ? 'rgba(169,199,185,0.06)' : 'rgba(255,254,248,0.55)';
  const shade = isDark ? 'rgba(0,0,0,0.16)' : 'rgba(30,57,50,0.06)';
  const seam = isDark ? 'rgba(230,221,206,0.12)' : 'rgba(30,57,50,0.1)';
  const baseboard = isDark ? h.paperAlt : '#D8D6C4';
  const lip = isDark ? h.lineStrong : 'rgba(255,254,248,0.78)';

  return (
    <View pointerEvents="none" style={styles.fill} accessibilityElementsHidden>
      <View style={[styles.patch, styles.patchTop, { backgroundColor: patch }]} />
      <View style={[styles.patch, styles.patchRight, { backgroundColor: shade }]} />
      <View style={[styles.patch, styles.patchBottom, { backgroundColor: shade }]} />
      <View style={[styles.seam, { left: '12%', backgroundColor: seam }]} />
      <View style={[styles.seam, { left: '37%', backgroundColor: seam }]} />
      <View style={[styles.seam, { left: '61%', backgroundColor: seam }]} />
      <View style={[styles.seam, { left: '84%', backgroundColor: seam }]} />
      <View style={[styles.baseboard, { backgroundColor: baseboard }]} />
      <View style={[styles.baseboardLip, { backgroundColor: lip }]} />
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
