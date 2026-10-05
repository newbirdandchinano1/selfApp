import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { InitialSyncProgress } from '@/lib/api-initial-sync';

const MIN_SPLASH_MS = 1400;
const FADE_OUT_MS = 420;

void SplashScreen.preventAutoHideAsync().catch(() => {});

export type AppSplashScreenProps = {
  /** 数据库等业务初始化完成且无错误时可退出开屏 */
  exitReady: boolean;
  onFinish: () => void;
  dbError?: string | null;
  /** 首启全量同步进度（可选） */
  syncProgress?: InitialSyncProgress | null;
  /** 覆盖 syncProgress 的状态文案（如 pending 冲刷） */
  statusText?: string | null;
  /** 冲刷/初始化重试进行中 */
  retrying?: boolean;
  onRetry?: () => void;
};

function formatSyncProgress(progress: InitialSyncProgress | null | undefined): string | null {
  if (!progress) return null;
  if (progress.phase === 'preparing') return '正在准备…';
  if (progress.phase === 'warming') return '正在加载数据…';
  if (progress.phase === 'clearing') return '正在初始化本地数据…';
  return null;
}

/**
 * 全屏开屏：原生 Splash 与 JS 层同一张图。
 * 打包后原生层会盖住 JS，必须在 JS 开屏 layout 后立刻 hideAsync，
 * 否则标题、同步文案和重试按钮都看不见。
 */
export function AppSplashScreen({
  exitReady,
  onFinish,
  dbError,
  syncProgress,
  statusText,
  retrying,
  onRetry,
}: AppSplashScreenProps) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(true);
  const mountTimeRef = useRef(Date.now());
  const hasFinishedRef = useRef(false);

  const nativeHiddenRef = useRef(false);
  const shellOpacity = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(10)).current;

  const hideNativeSplash = () => {
    if (nativeHiddenRef.current) return;
    nativeHiddenRef.current = true;
    void SplashScreen.hideAsync().catch(() => {});
  };

  useEffect(() => {
    Animated.sequence([
      Animated.delay(260),
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslateY, {
          toValue: 0,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [titleOpacity, titleTranslateY]);

  useEffect(() => {
    if (!exitReady || hasFinishedRef.current) return;

    const elapsed = Date.now() - mountTimeRef.current;
    const wait = Math.max(0, MIN_SPLASH_MS - elapsed);

    const timer = setTimeout(() => {
      hasFinishedRef.current = true;
      Animated.timing(shellOpacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        hideNativeSplash();
        setVisible(false);
        onFinish();
      });
    }, wait);

    return () => clearTimeout(timer);
  }, [exitReady, onFinish, shellOpacity]);

  if (!visible) return null;

  const syncStatusText = statusText?.trim() || formatSyncProgress(syncProgress);

  return (
    <Animated.View
      style={[styles.root, { opacity: shellOpacity }]}
      onLayout={hideNativeSplash}
    >
      <View style={styles.imageWrap}>
        <Image
          source={require('../assets/images/start.png')}
          style={styles.image}
          contentFit="cover"
          transition={0}
        />
      </View>

      <Animated.View
        style={[
          styles.footer,
          {
            paddingBottom: Math.max(insets.bottom, 28),
            opacity: titleOpacity,
            transform: [{ translateY: titleTranslateY }],
          },
        ]}
      >
        <Text style={styles.appName}>小郑的自我修养</Text>
        {syncStatusText ? <Text style={styles.syncStatus}>{syncStatusText}</Text> : null}
      </Animated.View>

      {dbError ? (
        <View
          style={[
            styles.errorOverlay,
            {
              paddingTop: Math.max(insets.top, 24),
              paddingBottom: Math.max(insets.bottom, 24),
            },
          ]}
        >
          <Text style={styles.errorText}>{dbError}</Text>
          {statusText ? <Text style={styles.retryHint}>{statusText}</Text> : null}
          <View style={styles.errorActions}>
            <Pressable
              disabled={retrying}
              onPress={onRetry}
              style={({ pressed }) => [
                styles.errorButton,
                { opacity: retrying ? 0.5 : pressed ? 0.82 : 1 },
              ]}
            >
              <Text style={styles.errorButtonText}>{retrying ? '正在重试…' : '重试'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#ffffff',
    zIndex: 9999,
  },
  imageWrap: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  appName: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.4,
    color: '#131b2e',
  },
  syncStatus: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#131b2e',
    opacity: 0.55,
    textAlign: 'center',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#131b2e',
    textAlign: 'center',
    opacity: 0.85,
  },
  retryHint: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#131b2e',
    textAlign: 'center',
    opacity: 0.55,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  errorButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(19,27,46,0.18)',
    backgroundColor: '#ffffff',
  },
  errorButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#131b2e',
  },
});
