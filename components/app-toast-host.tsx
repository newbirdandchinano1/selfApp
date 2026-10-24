/**
 * 全局 Toast Host — 对齐《Toast与提示框》设计稿：
 * 底部居中、圆角胶囊、圆形图标槽；toastIn 0.3s ease（上浮 10px + 淡入）。
 */
import React from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FeedbackIconSlot,
  FeedbackToastGlyph,
  type FeedbackTone,
} from '@/components/feedback/feedback-icons';
import { FOLD_MOTION_EASE } from '@/components/review/fold-motion';
import {
  subscribeAppToast,
  type AppToastKind,
  type AppToastPayload,
} from '@/lib/app-feedback/toast-events';

const FADE_IN_MS = 300;
const FADE_OUT_MS = 220;
/** 设计稿 toastIn：from translateY(10px) */
const SLIDE_FROM = 10;

type ToneStyle = {
  toastBg: string;
  iconBg: string;
  iconColor: string;
};

const TONE: Record<AppToastKind, ToneStyle> = {
  success: {
    toastBg: 'rgba(32,48,40,0.94)',
    iconBg: 'rgba(127,166,149,0.22)',
    iconColor: '#C9D9A3',
  },
  info: {
    toastBg: 'rgba(32,48,40,0.94)',
    iconBg: 'rgba(217,154,78,0.22)',
    iconColor: '#F4D9A8',
  },
  loading: {
    toastBg: 'rgba(32,48,40,0.94)',
    iconBg: 'rgba(217,154,78,0.22)',
    iconColor: '#F4D9A8',
  },
  warn: {
    toastBg: 'rgba(180,90,60,0.95)',
    iconBg: 'rgba(201,106,75,0.22)',
    iconColor: '#F5C6B8',
  },
  error: {
    toastBg: 'rgba(160,60,45,0.95)',
    iconBg: 'rgba(255,255,255,0.18)',
    iconColor: '#FFD6CF',
  },
};

function kindToTone(kind: AppToastKind): FeedbackTone {
  return kind;
}

/** 根级挂载：通用操作反馈 Toast（success / error / info / warn / loading） */
export function AppToastHost() {
  const insets = useSafeAreaInsets();
  const [payload, setPayload] = React.useState<AppToastPayload | null>(null);
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(SLIDE_FROM)).current;
  const animRef = React.useRef<Animated.CompositeAnimation | null>(null);

  React.useEffect(() => {
    return subscribeAppToast(next => {
      animRef.current?.stop();

      if (next == null) {
        const hide = Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: FADE_OUT_MS,
            easing: FOLD_MOTION_EASE,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: SLIDE_FROM,
            duration: FADE_OUT_MS,
            easing: FOLD_MOTION_EASE,
            useNativeDriver: true,
          }),
        ]);
        animRef.current = hide;
        hide.start(({ finished }) => {
          if (!finished) return;
          animRef.current = null;
          setPayload(null);
        });
        return;
      }

      setPayload(next);
      opacity.setValue(0);
      translateY.setValue(SLIDE_FROM);

      const show = Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_IN_MS,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: FADE_IN_MS,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]);
      animRef.current = show;
      show.start(({ finished }) => {
        if (finished) animRef.current = null;
      });
    });
  }, [opacity, translateY]);

  if (payload == null) return null;

  const tone = TONE[payload.kind];

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        {
          // 设计稿 bottom: 86（含 Tab / Home Indicator 余量）
          bottom: Math.max(insets.bottom, 12) + 72,
          opacity,
          transform: [{ translateY }],
        },
      ]}>
      <View style={[styles.toast, { backgroundColor: tone.toastBg }]}>
        <FeedbackIconSlot size={20} radius={10} backgroundColor={tone.iconBg}>
          <FeedbackToastGlyph
            tone={kindToTone(payload.kind)}
            color={tone.iconColor}
            size={11}
          />
        </FeedbackIconSlot>
        <Text style={styles.text} numberOfLines={2}>
          {payload.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 210,
    elevation: 210,
    paddingHorizontal: 20,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 18,
    paddingLeft: 9,
    paddingRight: 13,
    paddingVertical: 8,
    maxWidth: '92%',
    shadowColor: 'rgba(20,30,24,1)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },
  text: {
    color: '#F8F3E8',
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
    flexShrink: 1,
  },
});
