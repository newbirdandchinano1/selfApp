import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** 便利贴上的墨水色。纸始终是浅色，深色模式也不改成白字。 */
export const MEMO_INK = '#3A2A1A';
export const MEMO_INK_SOFT = '#5C4636';
export const MEMO_RULE = 'rgba(58,42,26,0.12)';
export const MEMO_WASH = 'rgba(58,42,26,0.08)';

/** 同一条备忘在本次打开里保持同一张纸色，列表和详情共用。 */
const paperByMemoId = new Map<string, string>();

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lig - c / 2;
  const channel = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function memoPaperColor(id: string): string {
  const cached = paperByMemoId.get(id);
  if (cached) return cached;
  const hue = Math.floor(Math.random() * 360);
  const saturation = 48 + Math.floor(Math.random() * 22);
  const lightness = 74 + Math.floor(Math.random() * 10);
  const paper = hslToHex(hue, saturation, lightness);
  paperByMemoId.set(id, paper);
  return paper;
}

export function shiftPaper(hex: string, amount: number): string {
  const raw = hex.replace('#', '');
  const n = parseInt(raw, 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, shift + amount)).toString(16).padStart(2, '0');
  return `#${channel((n >> 16) & 255)}${channel((n >> 8) & 255)}${channel(n & 255)}`;
}

/** 整页阅读纸。列表便利贴可以很鲜，铺开后只留一点原色，其余靠近暖白。 */
const PAGE_CREAM = '#F4EFE6';

function mixToward(hex: string, target: string, amount: number): string {
  const parse = (value: string) => {
    const n = parseInt(value.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  const from = parse(hex);
  const to = parse(target);
  const channel = (index: number) =>
    Math.round(from[index] + (to[index] - from[index]) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

export function memoPagePaper(sticky: string): string {
  return mixToward(sticky, PAGE_CREAM, 0.82);
}

/** 从正面看的图钉：钉头压在纸上，下面留一个钉孔阴影。 */
export function Thumbtack({ large }: { large: boolean }) {
  const head = large ? 22 : 18;
  return (
    <View pointerEvents="none" style={[styles.tack, large ? styles.tackWide : null]}>
      <View style={[styles.tackHole, large ? styles.tackHoleWide : null]} />
      <View style={[styles.tackHead, { width: head, height: head, borderRadius: head / 2 }]}>
        <View style={styles.tackShine} />
        <View style={styles.tackCore} />
      </View>
    </View>
  );
}

export function MemoTape({ wide = false, page = false }: { wide?: boolean; page?: boolean }) {
  return (
    <View pointerEvents="none" style={[styles.tape, wide ? styles.tapeWide : null, page ? styles.tapePage : null]}>
      <View style={styles.tapeShine} />
    </View>
  );
}

/** 右下角卷起：折页、折痕高光，以及揭开后露出的暗影。 */
export function PaperCurl({ size, paper }: { size: number; paper: string }) {
  const flap = shiftPaper(paper, -36);
  const lip = shiftPaper(paper, 22);
  return (
    <Svg width={size} height={size} style={styles.curl} pointerEvents="none">
      <Path
        d={`M${size} ${size * 0.42} C ${size * 0.78} ${size * 0.58}, ${size * 0.58} ${size * 0.78}, ${size * 0.34} ${size} L ${size} ${size} Z`}
        fill="rgba(48,32,18,0.34)"
      />
      <Path
        d={`M${size} ${size * 0.16} C ${size * 0.66} ${size * 0.34}, ${size * 0.4} ${size * 0.62}, ${size * 0.08} ${size} L ${size} ${size} Z`}
        fill={flap}
      />
      <Path
        d={`M${size} ${size * 0.34} C ${size * 0.74} ${size * 0.48}, ${size * 0.52} ${size * 0.7}, ${size * 0.22} ${size} L ${size} ${size} Z`}
        fill={lip}
      />
      <Path
        d={`M${size * 0.96} ${size * 0.14} C ${size * 0.68} ${size * 0.34}, ${size * 0.42} ${size * 0.58}, ${size * 0.12} ${size * 0.9}`}
        stroke="rgba(255,255,255,0.72)"
        strokeWidth={1.4}
        fill="none"
      />
    </Svg>
  );
}

const RULE_START = 22;
const RULE_GAP = 24;

/**
 * 详情里的一整页纸。纸色、横线、胶带、图钉和卷角与列表便利贴同一套。
 */
export function MemoPaperPage({
  memoId,
  pinned,
  minHeight,
  children,
  /** 编辑页里有 WebView，裁切会让输入区画不出来。 */
  clip = true,
  /** 铺满父级剩余高度，正文才能在键盘上方收缩。 */
  stretch = false,
  paddingBottom = 64,
}: {
  memoId: string;
  pinned: boolean;
  minHeight: number;
  children: React.ReactNode;
  clip?: boolean;
  stretch?: boolean;
  paddingBottom?: number;
}) {
  const paper = memoPagePaper(memoPaperColor(memoId));
  const edge = shiftPaper(paper, -14);
  const [height, setHeight] = useState(0);
  const lineCount = Math.min(640, Math.max(12, Math.ceil(Math.max(0, height - RULE_START) / RULE_GAP)));

  return (
    <View style={[styles.pageWrap, stretch && styles.stretch, { minHeight }]}>
      <View pointerEvents="none" style={styles.castShadow} />
      {pinned ? null : <MemoTape page />}
      <View
        onLayout={event => {
          const next = Math.ceil(event.nativeEvent.layout.height);
          setHeight(prev => (prev === next ? prev : next));
        }}
        style={[
          styles.page,
          clip ? styles.pageClip : null,
          stretch && styles.stretch,
          { backgroundColor: paper, borderBottomColor: edge, minHeight, paddingBottom, elevation: clip ? 2 : 0 },
        ]}>
        <View pointerEvents="none" style={styles.sheen} />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {Array.from({ length: lineCount }).map((_, index) => (
            <View key={index} style={[styles.rule, { top: RULE_START + index * RULE_GAP }]} />
          ))}
        </View>
        {children}
        <PaperCurl size={72} paper={paper} />
      </View>
      {pinned ? <Thumbtack large /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pageWrap: {
    flexGrow: 1,
    marginTop: 16,
  },
  stretch: {
    flex: 1,
    minHeight: 0,
  },
  castShadow: {
    position: 'absolute',
    left: 10,
    right: 8,
    top: 22,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: 'rgba(62, 40, 18, 0.12)',
    transform: [{ translateX: 3 }, { translateY: 8 }],
  },
  page: {
    flexGrow: 1,
    borderRadius: 2,
    borderBottomWidth: 2,
    paddingTop: 28,
    paddingHorizontal: 22,
    paddingBottom: 64,
    shadowColor: '#3E2814',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  pageClip: {
    overflow: 'hidden',
  },
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  rule: {
    position: 'absolute',
    left: 18,
    right: 28,
    height: StyleSheet.hairlineWidth,
    backgroundColor: MEMO_RULE,
  },
  curl: {
    position: 'absolute',
    right: 0,
    bottom: 0,
  },
  tack: {
    position: 'absolute',
    top: -10,
    left: '50%',
    marginLeft: -14,
    width: 28,
    height: 32,
    zIndex: 4,
    elevation: 10,
    alignItems: 'center',
  },
  tackWide: {
    top: -12,
    marginLeft: -16,
    width: 32,
    height: 36,
  },
  tackHole: {
    position: 'absolute',
    top: 16,
    width: 12,
    height: 7,
    borderRadius: 6,
    backgroundColor: 'rgba(42,24,12,0.38)',
  },
  tackHoleWide: {
    top: 18,
    width: 14,
    height: 8,
  },
  tackHead: {
    marginTop: 2,
    backgroundColor: '#C4453A',
    borderWidth: 1,
    borderColor: '#8C261E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3E2814',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 8,
  },
  tackShine: {
    position: 'absolute',
    top: 3,
    left: 4,
    width: 7,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  tackCore: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#6E1C16',
    borderWidth: 1,
    borderColor: 'rgba(255,220,200,0.35)',
  },
  tape: {
    position: 'absolute',
    top: -8,
    left: '50%',
    marginLeft: -26,
    width: 52,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.38)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.72)',
    transform: [{ rotate: '-3deg' }],
    zIndex: 3,
  },
  tapeWide: {
    width: 72,
    height: 18,
    marginLeft: -36,
    top: -9,
  },
  tapePage: {
    width: 92,
    height: 20,
    marginLeft: -46,
    top: -10,
  },
  tapeShine: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 6,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
});
