import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';

import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';

type Props = {
  visible: boolean;
  /** 退出动画结束后才调用，页面在这里把 visible 置 false */
  onClose: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

const OVERLAY_IN_MS = 180;
const PANEL_IN_MS = 220;
const OUT_MS = 160;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const SheetCloseContext = React.createContext<() => boolean>(() => false);

/**
 * 第一次返回 true，并开始关闭。
 * 关闭过程中再次调用返回 false，调用方不要再改排序或重复关闭。
 */
export function useMemoCenterSheetClose(): () => boolean {
  return useContext(SheetCloseContext);
}

/**
 * 居中弹层：遮罩 180ms 淡入，面板 220ms 透明度 + 16pt 上移。
 * 只服务备忘录的排序与 AI，不做成全局 Bottom Sheet。
 * `animationType="none"`，反向播完 160ms 再通知页面卸载。
 */
export function MemoCenterSheet({ visible, onClose, children, style }: Props) {
  const { colors } = useAppTheme();
  const focused = useIsFocused();
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const motionOff = reduceMotion || !motionReady;

  const [mounted, setMounted] = useState(visible);
  const [closing, setClosing] = useState(false);
  const overlay = useRef(new Animated.Value(0)).current;
  const panel = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const aliveRef = useRef(true);
  const exitAnim = useRef<Animated.CompositeAnimation | null>(null);
  const exitRafRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stopAnims = useCallback(() => {
    if (exitRafRef.current) {
      cancelAnimationFrame(exitRafRef.current);
      exitRafRef.current = 0;
    }
    exitAnim.current?.stop();
    exitAnim.current = null;
    overlay.stopAnimation();
    panel.stopAnimation();
  }, [overlay, panel]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopAnims();
      overlay.setValue(0);
      panel.setValue(0);
    };
  }, [overlay, panel, stopAnims]);

  useEffect(() => {
    if (!visible) {
      closingRef.current = false;
      setClosing(false);
      stopAnims();
      overlay.setValue(0);
      panel.setValue(0);
      setMounted(false);
      return;
    }
    if (closingRef.current) return;
    setMounted(true);
    setClosing(false);
    if (motionOff) {
      overlay.setValue(1);
      panel.setValue(1);
      return;
    }
    overlay.setValue(0);
    panel.setValue(0);
    const raf = requestAnimationFrame(() => {
      if (closingRef.current) return;
      Animated.parallel([
        Animated.timing(overlay, {
          toValue: 1,
          duration: OVERLAY_IN_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(panel, {
          toValue: 1,
          duration: PANEL_IN_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => cancelAnimationFrame(raf);
  }, [motionOff, overlay, panel, stopAnims, visible]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return false;
    closingRef.current = true;
    setClosing(true);
    if (motionOff || !focused) {
      stopAnims();
      overlay.setValue(0);
      panel.setValue(0);
      onCloseRef.current();
      return true;
    }
    // 下一帧再播退出，调用方可以在本次点击里先写入排序。
    exitRafRef.current = requestAnimationFrame(() => {
      exitRafRef.current = 0;
      if (!aliveRef.current || !closingRef.current) return;
      if (motionOff || !focused) {
        stopAnims();
        overlay.setValue(0);
        panel.setValue(0);
        onCloseRef.current();
        return;
      }
      stopAnims();
      const anim = Animated.parallel([
        Animated.timing(overlay, {
          toValue: 0,
          duration: OUT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(panel, {
          toValue: 0,
          duration: OUT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      exitAnim.current = anim;
      anim.start(({ finished }) => {
        if (!finished || !aliveRef.current) return;
        exitAnim.current = null;
        onCloseRef.current();
      });
    });
    return true;
  }, [focused, motionOff, overlay, panel, stopAnims]);

  useEffect(() => {
    if (focused || !visible) return;
    stopAnims();
    overlay.setValue(0);
    panel.setValue(0);
    closingRef.current = false;
    setClosing(false);
    onCloseRef.current();
  }, [focused, overlay, panel, stopAnims, visible]);

  if (!mounted || !visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={() => {
        requestClose();
      }}
      statusBarTranslucent>
      <SheetCloseContext.Provider value={requestClose}>
        <View style={styles.overlay} pointerEvents={closing ? 'none' : 'auto'}>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: overlay }]}
          />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              requestClose();
            }}
            accessibilityLabel="关闭弹层"
          />
          <AnimatedPressable
            accessible={false}
            onPress={() => {}}
            style={[
              styles.panel,
              {
                opacity: panel,
                transform: [
                  {
                    translateY: panel.interpolate({
                      inputRange: [0, 1],
                      outputRange: [16, 0],
                    }),
                  },
                ],
              },
              style,
            ]}>
            {children}
          </AnimatedPressable>
        </View>
      </SheetCloseContext.Provider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  panel: {
    borderRadius: 16,
    padding: 18,
    gap: 4,
  },
});
