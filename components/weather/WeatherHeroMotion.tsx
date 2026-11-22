/**
 * 天气卡左侧动态主视觉：Meteocons Lottie（按场景切换）。
 * 加载失败时回退彩色静态图标。
 */
import { WeatherConditionIcon } from '@/components/weather/WeatherConditionIcon';
import type { WeatherDayPart, WeatherSceneKey } from '@/lib/weather-scene';
import { meteoconLottieUrl } from '@/lib/weather-meteocon';
import LottieView from 'lottie-react-native';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  scene: WeatherSceneKey;
  dayPart?: WeatherDayPart;
  /** 回退静态图标用 */
  icon?: string | null;
  text?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

function WeatherHeroMotionInner({
  scene,
  dayPart = 'day',
  icon,
  text,
  size = 96,
  style,
}: Props) {
  const url = useMemo(() => meteoconLottieUrl(scene, dayPart), [scene, dayPart]);
  const [failed, setFailed] = useState(false);
  const lottieRef = useRef<LottieView>(null);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  useEffect(() => {
    if (failed) return;
    // 场景切换后确保继续播
    const t = setTimeout(() => {
      try {
        lottieRef.current?.play();
      } catch {
        /* ignore */
      }
    }, 80);
    return () => clearTimeout(t);
  }, [failed, url]);

  if (failed) {
    return (
      <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
        <WeatherConditionIcon icon={icon} text={text} size={size * 0.72} />
      </View>
    );
  }

  return (
    <View style={[{ width: size, height: size }, style]}>
      <LottieView
        ref={lottieRef}
        source={{ uri: url }}
        autoPlay
        loop
        resizeMode="contain"
        style={styles.lottie}
        onAnimationFailure={() => setFailed(true)}
      />
    </View>
  );
}

export const WeatherHeroMotion = memo(WeatherHeroMotionInner);

const styles = StyleSheet.create({
  lottie: { width: '100%', height: '100%' },
});
