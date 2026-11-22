/**
 * 夜间星空：定点闪烁的细小星点（十字芒），绝不下落、不漂移。
 */
import { Circle, Group, Line, vec } from '@shopify/react-native-skia';
import React, { memo, useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

type Star = {
  nx: number;
  ny: number;
  /** 核心半径，控制在很小 */
  core: number;
  /** 是否画十字芒（亮星） */
  spike: boolean;
  spikeLen: number;
  phase: number;
  twinkle: number;
  baseOpacity: number;
};

export type StarFieldLayerProps = {
  width: number;
  height: number;
  clock: SharedValue<number>;
  opacity?: SharedValue<number>;
  density?: 'clear' | 'cloudy';
};

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function buildStars(density: 'clear' | 'cloudy'): Star[] {
  const count = density === 'clear' ? 56 : 32;
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const a = hash01(i * 3.1 + 0.7);
    const b = hash01(i * 5.7 + 1.3);
    const c = hash01(i * 9.2 + 2.1);
    const bright = c > 0.72;
    stars.push({
      nx: 0.03 + a * 0.94,
      ny: density === 'cloudy' ? 0.03 + b * 0.4 : 0.03 + b * 0.58,
      core: bright ? 1.05 + c * 0.35 : 0.45 + c * 0.45,
      spike: bright,
      spikeLen: 3.2 + c * 2.4,
      phase: a * Math.PI * 2,
      twinkle: 0.55 + b * 0.9,
      baseOpacity: density === 'clear'
        ? bright
          ? 0.7 + c * 0.25
          : 0.28 + c * 0.4
        : bright
          ? 0.5 + c * 0.25
          : 0.18 + c * 0.3,
    });
  }
  return stars;
}

function StarNode({
  star,
  width,
  height,
  clock,
  opacityMul,
}: {
  star: Star;
  width: number;
  height: number;
  clock: SharedValue<number>;
  opacityMul: SharedValue<number>;
}) {
  const cx = star.nx * width;
  const cy = star.ny * height;

  const opacity = useDerivedValue(() => {
    // 闪烁：亮度变化，位置绝对不动
    const tw = 0.62 + 0.38 * Math.sin(clock.value * star.twinkle + star.phase);
    return star.baseOpacity * tw * opacityMul.value;
  });

  const spikeOpacity = useDerivedValue(() => opacity.value * 0.55);

  return (
    <Group>
      {star.spike ? (
        <Group opacity={spikeOpacity}>
          <Line
            p1={vec(cx - star.spikeLen, cy)}
            p2={vec(cx + star.spikeLen, cy)}
            color="#DDE6F8"
            style="stroke"
            strokeWidth={0.7}
            strokeCap="round"
          />
          <Line
            p1={vec(cx, cy - star.spikeLen)}
            p2={vec(cx, cy + star.spikeLen)}
            color="#DDE6F8"
            style="stroke"
            strokeWidth={0.7}
            strokeCap="round"
          />
        </Group>
      ) : null}
      <Circle cx={cx} cy={cy} r={star.core} color="#F2F6FF" opacity={opacity} />
    </Group>
  );
}

function StarFieldLayerInner({
  width,
  height,
  clock,
  opacity,
  density = 'clear',
}: StarFieldLayerProps) {
  const stars = useMemo(() => buildStars(density), [density]);
  const opacityMul = useDerivedValue(() => opacity?.value ?? 1);

  return (
    <Group>
      {stars.map((star, i) => (
        <StarNode
          key={`star-${density}-${i}`}
          star={star}
          width={width}
          height={height}
          clock={clock}
          opacityMul={opacityMul}
        />
      ))}
    </Group>
  );
}

export const StarFieldLayer = memo(StarFieldLayerInner);
