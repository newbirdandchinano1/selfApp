import { useReducedMotion } from '@/hooks/use-reduced-motion';
import React from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

/** 静止可读时间（不含翻页） */
const DWELL_MS = 2600;
const OUT_MS = 200;
const IN_MS = 280;
const SLIDE_PX = 10;
const EASE = Easing.bezier(0.4, 0.0, 0.2, 1);

type Props = {
  titles: string[];
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
};

function readFontSize(style: StyleProp<TextStyle>, fallback = 12): number {
  const flat = StyleSheet.flatten(style);
  const n = flat?.fontSize;
  return typeof n === 'number' && n > 0 ? n : fallback;
}

/**
 * 同一格多只未完成青蛙时：标题上下翻页轮换（每次 1 条）。
 * 用「滑出淡出 → 换字 → 滑入淡入」，换字发生在 opacity=0，避免条带回零闪一下。
 */
export function ScheduleCellTitleRotator({
  titles,
  numberOfLines = 1,
  style,
}: Props) {
  const reduceMotion = useReducedMotion();
  const safeTitles = React.useMemo(() => {
    const cleaned = titles.map((t) => t.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : ['青蛙'];
  }, [titles]);

  const fontSize = readFontSize(style, 12);
  const lineHeight = Math.round(fontSize * 1.35);
  const pageH = Math.max(1, lineHeight * Math.max(1, numberOfLines));

  const [index, setIndex] = React.useState(0);
  const opacity = React.useRef(new Animated.Value(1)).current;
  const translateY = React.useRef(new Animated.Value(0)).current;
  const indexRef = React.useRef(0);
  const animatingRef = React.useRef(false);
  const reduceMotionRef = React.useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const titlesKey = safeTitles.join('\u0001');
  React.useEffect(() => {
    indexRef.current = 0;
    setIndex(0);
    opacity.stopAnimation();
    translateY.stopAnimation();
    opacity.setValue(1);
    translateY.setValue(0);
    animatingRef.current = false;
  }, [titlesKey, opacity, translateY]);

  React.useEffect(() => {
    if (index >= safeTitles.length) {
      indexRef.current = 0;
      setIndex(0);
    }
  }, [safeTitles.length, index]);

  React.useEffect(() => {
    if (safeTitles.length <= 1) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        if (cancelled || animatingRef.current) {
          scheduleNext();
          return;
        }
        const from = indexRef.current;
        const next = (from + 1) % safeTitles.length;
        if (next === from) {
          scheduleNext();
          return;
        }

        if (reduceMotionRef.current) {
          indexRef.current = next;
          setIndex(next);
          scheduleNext();
          return;
        }

        animatingRef.current = true;
        // 1) 当前标题上滑淡出
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: OUT_MS,
            easing: EASE,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: -SLIDE_PX,
            duration: OUT_MS,
            easing: EASE,
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (!finished || cancelled) {
            animatingRef.current = false;
            return;
          }
          // 2) 透明时换字，再从下方滑入淡入（用户看不见换字瞬间）
          indexRef.current = next;
          setIndex(next);
          translateY.setValue(SLIDE_PX);
          Animated.parallel([
            Animated.timing(opacity, {
              toValue: 1,
              duration: IN_MS,
              easing: EASE,
              useNativeDriver: true,
            }),
            Animated.timing(translateY, {
              toValue: 0,
              duration: IN_MS,
              easing: EASE,
              useNativeDriver: true,
            }),
          ]).start(({ finished: inOk }) => {
            if (!inOk || cancelled) {
              opacity.setValue(1);
              translateY.setValue(0);
            }
            animatingRef.current = false;
            if (!cancelled) scheduleNext();
          });
        });
      }, DWELL_MS);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      opacity.stopAnimation();
      translateY.stopAnimation();
      animatingRef.current = false;
    };
  }, [safeTitles.length, opacity, translateY]);

  const current = safeTitles[index] ?? safeTitles[0]!;

  const textStyle: StyleProp<TextStyle> = [
    style,
    { lineHeight, height: pageH },
  ];

  if (safeTitles.length <= 1) {
    return (
      <Text numberOfLines={numberOfLines} style={textStyle}>
        {current}
      </Text>
    );
  }

  return (
    <View style={[styles.clip, { height: pageH }]}>
      <Animated.View
        style={{
          opacity,
          transform: [{ translateY }],
        }}>
        <Text numberOfLines={numberOfLines} style={textStyle}>
          {current}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    width: '100%',
  },
});
