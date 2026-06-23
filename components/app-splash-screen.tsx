import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { InitialSyncProgress } from '@/lib/api-initial-sync';

const MIN_SPLASH_MS = 1400;
const FADE_IN_MS = 720;
const FADE_OUT_MS = 420;

void SplashScreen.preventAutoHideAsync().catch(() => {});

export type AppSplashScreenProps = {
  /** 数据库等业务初始化完成且无错误时可退出开屏 */
  exitReady: boolean;
  onFinish: () => void;
  dbError?: string | null;
  dbRepairBusy?: boolean;
  /** 首启全量同步进度（可选） */
  syncProgress?: InitialSyncProgress | null;
  onRetry?: () => void;
  onRepair?: () => void;
};

function formatSyncProgress(progress: InitialSyncProgress | null | undefined): string | null {
  if (!progress) return null;
  if (progress.phase === 'preparing') return '正在准备同步…';
  if (progress.phase === 'syncing') {
    const label = progress.tableLabel ? ` · ${progress.tableLabel}` : '';
    return `正在同步数据 ${progress.tableIndex}/${progress.tableCount}${label}`;
  }
  return null;
}

/**
 * 全屏开屏：原生 Splash 与 JS 层使用同一张图，淡入缩放后等待初始化完成再淡出。
 */
export function AppSplashScreen({
  exitReady,
  onFinish,
  dbError,
  dbRepairBusy = false,
  syncProgress,
  onRetry,
  onRepair,
}: AppSplashScreenProps) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(true);
  const mountTimeRef = useRef(Date.now());
  const hasFinishedRef = useRef(false);

  const imageOpacity = useRef(new Animated.Value(0)).current;
  const imageScale = useRef(new Animated.Value(0.93)).current;
  const shellOpacity = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(imageOpacity, {
        toValue: 1,
        duration: FADE_IN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(imageScale, {
        toValue: 1,
        friction: 8,
        tension: 70,
        useNativeDriver: true,
      }),
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
      ]),
    ]).start();
  }, [imageOpacity, imageScale, titleOpacity, titleTranslateY]);

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
        void SplashScreen.hideAsync().catch(() => {});
        setVisible(false);
        onFinish();
      });
    }, wait);

    return () => clearTimeout(timer);
  }, [exitReady, onFinish, shellOpacity]);

  if (!visible) return null;

  const syncStatusText = formatSyncProgress(syncProgress);

  return (
    <Animated.View style={[styles.root, { opacity: shellOpacity }]}>
      <Animated.View
        style={[
          styles.imageWrap,
          {
            opacity: imageOpacity,
            transform: [{ scale: imageScale }],
          },
        ]}
      >
        <Image
          source={require('../assets/images/start.png')}
          style={styles.image}
          contentFit="cover"
          transition={0}
        />
      </Animated.View>

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
        <View style={[styles.errorOverlay, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <Text style={styles.errorText}>{dbError}</Text>
          <View style={styles.errorActions}>
            <Pressable
              onPress={onRetry}
              disabled={dbRepairBusy}
              style={({ pressed }) => [
                styles.errorButton,
                { opacity: dbRepairBusy ? 0.5 : pressed ? 0.82 : 1 },
              ]}
            >
              <Text style={styles.errorButtonText}>重试</Text>
            </Pressable>
            {Platform.OS !== 'web' ? (
              <Pressable
                onPress={onRepair}
                disabled={dbRepairBusy}
                style={({ pressed }) => [
                  styles.errorButton,
                  { opacity: dbRepairBusy ? 0.5 : pressed ? 0.82 : 1 },
                ]}
              >
                <Text style={styles.errorButtonText}>
                  {dbRepairBusy ? '修复中…' : '修复数据库'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
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
    ...StyleSheet.absoluteFillObject,
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
