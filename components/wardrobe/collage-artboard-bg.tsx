/**
 * 拼图画布背景：对齐设计稿 data-bg 图案（RN 无 CSS background-image）。
 */
import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect, Circle, Line } from 'react-native-svg';

type Props = {
  bg: string;
  width: number;
  height: number;
};

function solidColor(bg: string): string | null {
  return bg.startsWith('#') ? bg : null;
}

function patternBase(bg: string): string {
  switch (bg) {
    case 'gridPink':
      return '#F4DDE4';
    case 'wideBlue':
      return '#D3E3EF';
    case 'sage':
      return '#DDE9D2';
    case 'checkPurple':
      return '#DAD8ED';
    case 'checkOrange':
      return '#F2D4AE';
    case 'paper':
      return '#F4EEDD';
    case 'stripeBlue':
    default:
      return '#DBEEF1';
  }
}

export const CollageArtboardBg = memo(function CollageArtboardBg({ bg, width, height }: Props) {
  const solid = solidColor(bg);
  const base = solid ?? patternBase(bg);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} pointerEvents="none">
      {!solid ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            {bg === 'stripeBlue' ? (
              <Pattern id="p" patternUnits="userSpaceOnUse" width={9} height={9}>
                <Rect width={9} height={9} fill="#DBEEF1" />
                <Line x1={0} y1={0} x2={0} y2={9} stroke="rgba(255,255,255,0.62)" strokeWidth={1} />
              </Pattern>
            ) : null}
            {bg === 'gridPink' ? (
              <Pattern id="p" patternUnits="userSpaceOnUse" width={15} height={15}>
                <Rect width={15} height={15} fill="#F4DDE4" />
                <Line x1={0} y1={0} x2={15} y2={0} stroke="rgba(255,255,255,0.68)" strokeWidth={1} />
                <Line x1={0} y1={0} x2={0} y2={15} stroke="rgba(255,255,255,0.68)" strokeWidth={1} />
              </Pattern>
            ) : null}
            {bg === 'wideBlue' ? (
              <Pattern id="p" patternUnits="userSpaceOnUse" width={21} height={21}>
                <Rect width={21} height={10} fill="#F8FBFD" />
                <Rect y={10} width={21} height={11} fill="#BDD7EA" />
              </Pattern>
            ) : null}
            {bg === 'sage' ? (
              <Pattern id="p" patternUnits="userSpaceOnUse" width={12} height={12}>
                <Rect width={12} height={12} fill="#DDE9D2" />
                <Rect width={3} height={12} fill="rgba(255,255,255,0.62)" />
                <Rect width={12} height={2} fill="rgba(255,255,255,0.2)" />
              </Pattern>
            ) : null}
            {bg === 'checkPurple' || bg === 'checkOrange' ? (
              <Pattern id="p" patternUnits="userSpaceOnUse" width={18} height={18}>
                <Rect width={18} height={18} fill={bg === 'checkOrange' ? '#F2D4AE' : '#DAD8ED'} />
                <Rect width={9} height={9} fill="rgba(255,255,255,0.42)" />
                <Rect x={9} y={9} width={9} height={9} fill="rgba(255,255,255,0.42)" />
              </Pattern>
            ) : null}
            {bg === 'paper' ? (
              <Pattern id="p" patternUnits="userSpaceOnUse" width={6} height={6}>
                <Rect width={6} height={6} fill="#F4EEDD" />
                <Circle cx={1} cy={1} r={0.55} fill="rgba(101,88,64,0.11)" />
              </Pattern>
            ) : null}
          </Defs>
          {bg !== 'solid' && !solid ? (
            <Rect width={width} height={height} fill="url(#p)" />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
});
