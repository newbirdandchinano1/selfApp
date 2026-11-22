/**
 * 场景 / 时段切换：Reanimated 共享值插值天空色，光斑与粒子透明度交叠，避免闪切。
 */
import {
  getSkyPalette,
  type AtmospherePeriod,
  type SkyPalette,
  type SoftGlowSpotConfig,
} from '@/features/weather-atmosphere/config/sky-palette';
import {
  WEATHER_TRANSITION_MS,
  sceneTransitionKey,
} from '@/features/weather-atmosphere/core/WeatherTransition';
import { lerpColorList } from '@/features/weather-atmosphere/utils/color';
import type { WeatherSceneKey } from '@/lib/weather-scene';
import { useEffect, useRef, useState } from 'react';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export type AnimatedSkyTransition = {
  skyColors: SharedValue<string[]>;
  progress: SharedValue<number>;
  fromSpots: SoftGlowSpotConfig[];
  toSpots: SoftGlowSpotConfig[];
  fromSpotOpacity: SharedValue<number>;
  toSpotOpacity: SharedValue<number>;
  /** 粒子层总透明度（切换时先淡出再淡入） */
  particleOpacity: SharedValue<number>;
  /** 粒子实际应使用的场景（淡出完成后再切换） */
  particleScene: WeatherSceneKey;
};

function normalizeSky(palette: SkyPalette): string[] {
  const sky = [...palette.sky];
  while (sky.length < 3) sky.push(sky[sky.length - 1] ?? '#88AACC');
  return sky.slice(0, 3);
}

export function useAnimatedSkyTransition(
  scene: WeatherSceneKey,
  period: AtmospherePeriod,
  reduceMotion: boolean,
): AnimatedSkyTransition {
  const key = sceneTransitionKey(scene, period);
  const initial = getSkyPalette(scene, period);

  const [fromSpots, setFromSpots] = useState(() => [...initial.spots]);
  const [toSpots, setToSpots] = useState(() => [...initial.spots]);
  const [particleScene, setParticleScene] = useState(scene);

  const fromSky = useSharedValue<string[]>(normalizeSky(initial));
  const toSky = useSharedValue<string[]>(normalizeSky(initial));
  const progress = useSharedValue(1);
  const fromSpotOpacity = useSharedValue(0);
  const toSpotOpacity = useSharedValue(1);
  const particleOpacity = useSharedValue(1);

  const prevKeyRef = useRef(key);
  const toSpotsRef = useRef(toSpots);
  const bootRef = useRef(true);
  toSpotsRef.current = toSpots;

  const skyColors = useDerivedValue(() => {
    return lerpColorList(fromSky.value, toSky.value, progress.value);
  });

  useEffect(() => {
    if (bootRef.current) {
      bootRef.current = false;
      prevKeyRef.current = key;
      return;
    }
    if (prevKeyRef.current === key) return;

    const nextPalette = getSkyPalette(scene, period);
    const nextSky = normalizeSky(nextPalette);
    const [prevScene, prevPeriod] = prevKeyRef.current.split('::');
    const prevWasThemeOnly = prevScene === scene && prevPeriod !== period;

    const current = lerpColorList(fromSky.value, toSky.value, progress.value);
    fromSky.value = current;
    toSky.value = nextSky;
    setFromSpots(toSpotsRef.current.length ? [...toSpotsRef.current] : [...nextPalette.spots]);
    setToSpots([...nextPalette.spots]);

    const skyMs = reduceMotion
      ? 0
      : prevWasThemeOnly
        ? WEATHER_TRANSITION_MS.theme
        : WEATHER_TRANSITION_MS.sky;

    progress.value = 0;
    fromSpotOpacity.value = 1;
    toSpotOpacity.value = 0;

    if (skyMs <= 0) {
      progress.value = 1;
      fromSpotOpacity.value = 0;
      toSpotOpacity.value = 1;
      particleOpacity.value = 1;
      setParticleScene(scene);
    } else {
      progress.value = withTiming(1, {
        duration: skyMs,
        easing: Easing.inOut(Easing.cubic),
      });
      fromSpotOpacity.value = withTiming(0, {
        duration: WEATHER_TRANSITION_MS.spots,
        easing: Easing.out(Easing.cubic),
      });
      toSpotOpacity.value = withTiming(1, {
        duration: WEATHER_TRANSITION_MS.spots,
        easing: Easing.in(Easing.cubic),
      });

      const outMs = WEATHER_TRANSITION_MS.particlesOut;
      const inMs = WEATHER_TRANSITION_MS.particlesIn;
      particleOpacity.value = withTiming(0, { duration: outMs }, (finished) => {
        if (!finished) return;
        runOnJS(setParticleScene)(scene);
        particleOpacity.value = withTiming(1, {
          duration: inMs,
          easing: Easing.out(Easing.quad),
        });
      });
    }

    prevKeyRef.current = key;
  }, [
    key,
    scene,
    period,
    reduceMotion,
    fromSky,
    toSky,
    progress,
    fromSpotOpacity,
    toSpotOpacity,
    particleOpacity,
  ]);

  return {
    skyColors,
    progress,
    fromSpots,
    toSpots,
    fromSpotOpacity,
    toSpotOpacity,
    particleOpacity,
    particleScene,
  };
}
