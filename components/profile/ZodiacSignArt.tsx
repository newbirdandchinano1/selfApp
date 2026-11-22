/**
 * 星座徽章插画：符号 + 星点环 + 场景色洗底。
 * 符号用几何 Path（非 Unicode Text），避免 Android 上文字突破圆形裁切。
 */
import { resolveZodiacVisual, type ZodiacCode, type ZodiacVisual } from '@/lib/zodiac-visuals';
import React, { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';

type Props = {
  zodiacLabel: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** 覆盖解析结果（详情页可直接传） */
  visual?: ZodiacVisual;
};

/** viewBox 0 0 24 24；描边符号，居中绘制 */
const ZODIAC_PATHS: Record<ZodiacCode, string> = {
  baiyang: 'M6 18c0-4 2.5-7 6-9 3.5 2 6 5 6 9 M8 9c-1.5-2-1.5-4 0-5 M16 9c1.5-2 1.5-4 0-5',
  jinniu: 'M8 15a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M8 11c-1.2-2.5-1-4.5.5-5.5 M16 11c1.2-2.5 1-4.5-.5-5.5',
  shuangzi: 'M8 6v12 M16 6v12 M7 6h10 M7 18h10',
  juxie:
    'M6 10c0-2 1.6-3.6 3.6-3.6S13.2 8 13.2 10 M10.8 14c0 2-1.6 3.6-3.6 3.6S3.6 16 3.6 14 M18 10c0-2-1.6-3.6-3.6-3.6S10.8 8 10.8 10 M13.2 14c0 2 1.6 3.6 3.6 3.6S20.4 16 20.4 14',

  shizi: 'M9 14c0-2.2 1.8-4 4-4s3 1.3 3 3-1.2 2.5-2.8 2.5C10.5 15.5 9 17 9 19 M7 9.5c1.2-2 3-3 5-3',
  chunv: 'M7 6v10.5c0 1.8 1.2 3 2.8 3S13 18.3 13 16.5V6 M13 6v10.5c0 1.8 1.2 3 2.8 3S19 18.3 19 16.5 M7 12h6',
  tiancheng: 'M5 14h14 M8 14V9.5a4 4 0 0 1 8 0V14 M7 18h10',
  tianxie: 'M6 6v9.5c0 1.6 1.1 2.8 2.6 2.8S11 17.1 11 15.5V6 M11 6v9.5c0 1.6 1.1 2.8 2.6 2.8S16 17.1 16 15.5V10 M16 15.5l3 3 M16 18.5h3.2',
  sheshou: 'M7 17L17 7 M12 7h5v5 M9 11l4 4',
  mojie: 'M6 7c2 0 3.5 1.2 4.2 3.2L12 16c.6 1.8 2 3 3.8 3 2 0 3.2-1.4 3.2-3.2S17.6 12 15.8 12c-1 0-1.8.4-2.3 1',
  shuiping: 'M4 9.5c2-1.5 3.5-1.5 5.5 0s3.5 1.5 5.5 0 3.5-1.5 5.5 0 M4 14.5c2-1.5 3.5-1.5 5.5 0s3.5 1.5 5.5 0 3.5-1.5 5.5 0',
  shuangyu: 'M7 5c-2.5 2.2-2.5 11.8 0 14 M17 5c2.5 2.2 2.5 11.8 0 14 M6 12h12',
};

function ZodiacSignArtInner({ zodiacLabel, size = 72, style, visual }: Props) {
  const z = visual ?? resolveZodiacVisual(zodiacLabel);
  const r = size / 2;
  const ring = r - 3;
  const stroke = Math.max(1.4, size * 0.028);
  // 符号画在 24 坐标系；缩放到头像内径（避开星点环）
  const iconBox = size * 0.42;
  const iconOrigin = (size - iconBox) / 2;
  const scale = iconBox / 24;
  const gradId = `zg-${z.code}-${Math.round(size)}`;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: r,
          overflow: 'hidden',
        },
        style,
      ]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={z.wash} />
            <Stop offset="1" stopColor="#FFFCF5" />
          </LinearGradient>
        </Defs>
        <Circle cx={r} cy={r} r={r} fill={`url(#${gradId})`} />
        <Circle
          cx={r}
          cy={r}
          r={ring}
          stroke={z.accent}
          strokeWidth={1.5}
          strokeOpacity={0.45}
          fill="none"
        />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
          const cx = r + Math.cos(a) * (ring - 5);
          const cy = r + Math.sin(a) * (ring - 5);
          return (
            <Circle
              key={i}
              cx={cx}
              cy={cy}
              r={i % 3 === 0 ? 1.8 : 1.1}
              fill={z.accent}
              opacity={i % 3 === 0 ? 0.85 : 0.4}
            />
          );
        })}
        <G transform={`translate(${iconOrigin}, ${iconOrigin}) scale(${scale})`}>
          <Path
            d={ZODIAC_PATHS[z.code]}
            stroke={z.accent}
            strokeWidth={stroke / scale}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </G>
      </Svg>
    </View>
  );
}

export const ZodiacSignArt = memo(ZodiacSignArtInner);
