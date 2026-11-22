/**
 * 雷暴闪电：间歇全屏闪光 + 单层折线电弧（去掉外发光描边减负）。
 */
import { Group, Path, Rect, usePathValue } from '@shopify/react-native-skia';
import React, { memo, useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export type LightningLayerProps = {
  width: number;
  height: number;
  enabled: boolean;
  opacity?: SharedValue<number>;
};

function LightningLayerInner({
  width,
  height,
  enabled,
  opacity,
}: LightningLayerProps) {
  const flash = useSharedValue(0);
  const bolt = useSharedValue(0);
  const seed = useSharedValue(Math.random());

  useEffect(() => {
    if (!enabled) {
      cancelAnimation(flash);
      cancelAnimation(bolt);
      flash.value = 0;
      bolt.value = 0;
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fire = () => {
      if (cancelled) return;
      // 间隔略拉长，减少频繁全屏闪
      const wait = 3200 + Math.random() * 5200;
      timer = setTimeout(() => {
        if (cancelled) return;
        seed.value = Math.random();
        flash.value = withSequence(
          withTiming(0.72, { duration: 40, easing: Easing.linear }),
          withTiming(0.1, { duration: 60 }),
          withTiming(0.42, { duration: 40 }),
          withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) }),
        );
        bolt.value = withSequence(
          withTiming(1, { duration: 30 }),
          withTiming(0.4, { duration: 70 }),
          withTiming(0, { duration: 160 }),
        );
        timer = setTimeout(fire, 1200 + Math.random() * 2200);
      }, wait);
    };

    fire();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cancelAnimation(flash);
      cancelAnimation(bolt);
    };
  }, [enabled, flash, bolt, seed]);

  const boltPath = usePathValue(builder => {
    'worklet';
    if (bolt.value < 0.05) return;
    const s = seed.value;
    const startX = width * (0.28 + s * 0.44);
    let x = startX;
    let y = height * 0.02;
    builder.moveTo(x, y);

    const segments = 5;
    for (let i = 0; i < segments; i++) {
      const t = (i + 1) / segments;
      const jag =
        (Math.sin(s * 40 + i * 2.7) * 0.5 + Math.cos(s * 18 + i) * 0.5) *
        width *
        0.055;
      x = startX + jag + (i % 2 === 0 ? -1 : 1) * width * 0.016;
      y = height * (0.02 + t * 0.4);
      builder.lineTo(x, y);
    }
  });

  const flashOpacity = useDerivedValue(
    () => flash.value * 0.48 * (opacity?.value ?? 1),
  );
  const boltOpacity = useDerivedValue(
    () => bolt.value * (opacity?.value ?? 1),
  );

  if (!enabled) return null;

  return (
    <Group>
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        color="#E8F0FF"
        opacity={flashOpacity}
      />
      <Path
        path={boltPath}
        style="stroke"
        strokeWidth={2.6}
        strokeCap="round"
        strokeJoin="round"
        color="#F5F8FF"
        opacity={boltOpacity}
      />
    </Group>
  );
}

export const LightningLayer = memo(LightningLayerInner);
