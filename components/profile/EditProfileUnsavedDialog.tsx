/**
 * 编辑资料 · 未保存拦截（设计稿 06）：遮罩淡入 + 弹窗 spring 上浮。
 */
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { getMinTouchTarget } from '@/constants/design-tokens';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const MIN_TOUCH = getMinTouchTarget(Platform.OS);

type Props = {
  visible: boolean;
  summary: string;
  saving?: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSaveAndLeave: () => void;
};

export function EditProfileUnsavedDialog({
  visible,
  summary,
  saving = false,
  onCancel,
  onDiscard,
  onSaveAndLeave,
}: Props) {
  const { fold } = useFoldTheme();
  const { animate } = useFoldMotionGate();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: animate ? 340 : 1,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }).start();
      return;
    }
    if (!mounted) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: animate ? 200 : 1,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [animate, mounted, progress, visible]);

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 0],
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1],
  });

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
            { backgroundColor: 'rgba(24,32,28,0.42)', opacity: progress },
          ]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="取消离开"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.dialog,
            {
              backgroundColor: fold.card,
              borderColor: fold.line2,
              opacity: progress,
              transform: [{ translateY }, { scale }],
            },
          ]}>
          <Text style={[styles.title, { color: fold.pine, fontFamily: foldFonts.serif }]}>
            有未保存的修改
          </Text>
          <Text style={[styles.body, { color: fold.muted }]}>
            离开后这些改动会丢失，饮食建议与训练日不会更新。
          </Text>
          <View style={[styles.unsavedBar, { backgroundColor: fold.amber2, borderColor: '#E7CFA6' }]}>
            <View style={[styles.dot, { backgroundColor: fold.amber }]} />
            <Text style={[styles.unsavedText, { color: '#8B5A1E' }]} numberOfLines={2}>
              {summary}
            </Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="取消"
              style={({ pressed }) => [
                styles.btnGhost,
                { borderColor: fold.line },
                pressed && { opacity: 0.88 },
              ]}>
              <Text style={[styles.btnGhostLabel, { color: fold.ink2 }]}>取消</Text>
            </Pressable>
            <Pressable
              onPress={onDiscard}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="不保存"
              style={({ pressed }) => [
                styles.btnDanger,
                { backgroundColor: fold.clay2, borderColor: fold.clay },
                pressed && { opacity: 0.88 },
                saving && { opacity: 0.5 },
              ]}>
              <Text style={[styles.btnDangerLabel, { color: fold.clay }]}>不保存</Text>
            </Pressable>
            <Pressable
              onPress={onSaveAndLeave}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="保存并离开"
              style={({ pressed }) => [
                styles.btnPrimary,
                { backgroundColor: fold.pineButton },
                pressed && { opacity: 0.9 },
                saving && { opacity: 0.55 },
              ]}>
              <Text style={[styles.btnPrimaryLabel, { color: fold.onPineButton }]}>
                {saving ? '保存中' : '保存并离开'}
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 34,
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  body: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
  },
  unsavedBar: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  unsavedText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  btnGhost: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  btnDanger: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDangerLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  btnPrimary: {
    flex: 1.15,
    minHeight: MIN_TOUCH,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
});
