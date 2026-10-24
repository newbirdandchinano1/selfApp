/**
 * 全局提示框 Host — 对齐《Toast与提示框》设计稿：
 * 遮罩 blur 感 + 纸色卡片；sheetUp 0.34s spring（translateY 12 + scale .98）。
 */
import {
  FeedbackDialogGlyph,
  FeedbackIconSlot,
} from '@/components/feedback/feedback-icons';
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import {
  resolveAppDialog,
  subscribeAppDialog,
  type AppDialogKind,
  type AppDialogPayload,
} from '@/lib/app-feedback/dialog-events';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

const ENTER_MS = 340;
const EXIT_MS = 200;

type DicTone = { bg: string; color: string };

function dicTone(kind: AppDialogKind, isDark: boolean): DicTone {
  if (kind === 'success') {
    return {
      bg: isDark ? 'rgba(127,166,149,0.22)' : '#DDE8E0',
      color: isDark ? '#A9C7B9' : '#36594D',
    };
  }
  if (kind === 'danger') {
    return {
      bg: isDark ? 'rgba(224,139,109,0.2)' : '#F5DED6',
      color: isDark ? '#EDAE99' : '#8F422B',
    };
  }
  return {
    bg: isDark ? 'rgba(224,176,114,0.18)' : '#F4E5CC',
    color: isDark ? '#EFC894' : '#8B5A1E',
  };
}

function DialogPaperFill({ isDark }: { isDark: boolean }) {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const top = isDark ? '#24302A' : '#FBF7ED';
  const bottom = isDark ? '#1B2420' : '#F4F0E6';
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={`dlg${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={top} />
          <Stop offset="1" stopColor={bottom} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={20} fill={`url(#dlg${id})`} />
    </Svg>
  );
}

/** 根级挂载：命令式 dialog.confirm / dialog.alert */
export function AppDialogHost() {
  const { fold, isDark } = useFoldTheme();
  const { animate } = useFoldMotionGate();
  const [payload, setPayload] = useState<AppDialogPayload | null>(null);
  const [mounted, setMounted] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const pendingRef = useRef<AppDialogPayload | null>(null);

  useEffect(() => {
    return subscribeAppDialog(next => {
      pendingRef.current = next;
      if (next) {
        setPayload(next);
        setMounted(true);
        progress.setValue(0);
        Animated.timing(progress, {
          toValue: 1,
          duration: animate ? ENTER_MS : 1,
          easing: FOLD_MOTION_SPRING,
          useNativeDriver: true,
        }).start();
        return;
      }
      Animated.timing(progress, {
        toValue: 0,
        duration: animate ? EXIT_MS : 1,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        if (pendingRef.current == null) {
          setMounted(false);
          setPayload(null);
        }
      });
    });
  }, [animate, progress]);

  if (!mounted || payload == null) return null;

  const dic = dicTone(payload.kind, isDark);
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1],
  });

  const onCancel = () => resolveAppDialog(false);
  const onConfirm = () => resolveAppDialog(true);

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(25,34,28,0.44)', opacity: progress },
          ]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.dialog,
            {
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.65)',
              opacity: progress,
              transform: [{ translateY }, { scale }],
              shadowColor: 'rgba(20,30,24,1)',
            },
          ]}>
          <DialogPaperFill isDark={isDark} />

          <FeedbackIconSlot size={38} radius={13} backgroundColor={dic.bg} style={styles.dic}>
            <FeedbackDialogGlyph kind={payload.kind} color={dic.color} size={18} />
          </FeedbackIconSlot>

          <Text
            style={[
              styles.title,
              { color: fold.pine, fontFamily: foldFonts.serif },
            ]}>
            {payload.title}
          </Text>
          {payload.message ? (
            <Text style={[styles.message, { color: fold.ink2 }]}>{payload.message}</Text>
          ) : (
            <View style={styles.messageSpacer} />
          )}

          <View style={styles.btns}>
            {payload.cancelText ? (
              <Pressable
                onPress={onCancel}
                accessibilityRole="button"
                accessibilityLabel={payload.cancelText}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnGhost,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#EDE7D9' },
                  pressed && { opacity: 0.88 },
                ]}>
                <Text
                  style={[
                    styles.btnLabel,
                    { color: isDark ? fold.muted : '#7C887D' },
                  ]}>
                  {payload.cancelText}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={payload.confirmText}
              style={({ pressed }) => [
                styles.btn,
                payload.confirmDanger
                  ? { backgroundColor: fold.clay }
                  : { backgroundColor: fold.pineButton },
                pressed && { opacity: 0.9 },
              ]}>
              <Text
                style={[
                  styles.btnLabel,
                  {
                    color: payload.confirmDanger
                      ? '#FFFFFF'
                      : fold.onPineButton,
                  },
                ]}>
                {payload.confirmText}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  dialog: {
    width: 270,
    maxWidth: '100%',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 13,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.3,
    shadowRadius: 60,
    elevation: 20,
  },
  dic: {
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  message: {
    marginTop: 4,
    marginBottom: 10,
    fontSize: 12.5,
    lineHeight: 20,
    fontWeight: '500',
  },
  messageSpacer: {
    height: 10,
  },
  btns: {
    flexDirection: 'row',
    gap: 6,
  },
  btn: {
    flex: 1,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {},
  btnLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
});
