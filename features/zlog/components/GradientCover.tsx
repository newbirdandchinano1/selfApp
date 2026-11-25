import React from 'react';
import { DimensionValue, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { coverPalettes, fonts } from '../theme/colors';

interface Props {
  seed: number;
  glyph: string;
  height?: number;
  width?: DimensionValue;
  radius?: number;
  fontSize?: number;
  style?: ViewStyle;
}

export function coverPalette(seed: number): [string, string] {
  const i = Math.abs(Math.round(seed)) % coverPalettes.length;
  return coverPalettes[i];
}

/** 用渐变 + 大字做封面，无需网络图片即可稳定呈现 */
export function GradientCover({
  seed,
  glyph,
  height = 160,
  width = '100%',
  radius = 16,
  fontSize,
  style,
}: Props) {
  const [c1, c2] = coverPalette(seed);
  return (
    <View
      style={[
        { height, width, borderRadius: radius, overflow: 'hidden' },
        style,
      ]}
    >
      <LinearGradient
        colors={[c1, c2] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={{
          position: 'absolute',
          width: '75%',
          height: '75%',
          borderRadius: 999,
          backgroundColor: 'rgba(255,255,255,0.13)',
          top: '-25%',
          right: '-20%',
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: '45%',
          height: '45%',
          borderRadius: 999,
          backgroundColor: 'rgba(224,179,90,0.26)',
          bottom: '-18%',
          left: '-12%',
        }}
      />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text
          style={{
            fontFamily: fonts.serif,
            fontWeight: '700',
            fontSize: fontSize ?? Math.round(height * 0.4),
            color: 'rgba(255,255,255,0.92)',
            textShadowColor: 'rgba(0,0,0,0.18)',
            textShadowOffset: { width: 0, height: 3 },
            textShadowRadius: 8,
          }}
        >
          {glyph}
        </Text>
      </View>
    </View>
  );
}
