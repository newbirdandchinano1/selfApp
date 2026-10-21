import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type Props = {
  colors: readonly string[];
  /** 渐变方向，按设计稿默认 135°（左上 → 右下） */
  diagonal?: boolean;
  radius?: number;
};

/** 心愿匣通用渐变底：铺满父容器（父级需 overflow hidden + borderRadius） */
export function WishBoxGradientFill({ colors, diagonal = true, radius = 0 }: Props) {
  const rawId = React.useId();
  const gradientId = `wbg${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const offsets =
    colors.length <= 1 ? [0] : colors.map((_, i) => i / (colors.length - 1));
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2={diagonal ? '1' : '0'}
          y2="1">
          {colors.map((color, i) => (
            <Stop key={i} offset={offsets[i]} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={radius} fill={`url(#${gradientId})`} />
    </Svg>
  );
}
