/**
 * 通用底部弹层：scrim 淡入 + 面板上滑（对齐 QuickPrioritySheet）。
 * visible 控制开关；关闭时先播动画，结束后再回调 onClose。
 */
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import React from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DEFAULT_SLIDE_PX = 520;

const FoldBottomSheetCloseContext = React.createContext<() => void>(() => {});

/** 弹层内容内点关闭 / 确定时调用，会先播退场动画再触发 onClose */
export function useFoldBottomSheetRequestClose() {
  return React.useContext(FoldBottomSheetCloseContext);
}

export function FoldBottomSheet({
  visible,
  onClose,
  children,
  accessibilityLabel = '关闭弹层',
  maxHeightRatio = 0.82,
  sheetStyle,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  accessibilityLabel?: string;
  maxHeightRatio?: number;
  sheetStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { tf, isDark } = useTaskFoldTheme();
  const { animate } = useFoldMotionGate();

  const [presented, setPresented] = React.useState(false);
  // Modal 独立窗口，Android 的 adjustResize / softwareKeyboardLayoutMode 管不到，
  // 用键盘高度把整块面板顶上去，避免「添加计数目标」等表单被挡住。
  const [keyboardInset, setKeyboardInset] = React.useState(0);
  const closingRef = React.useRef(false);
  const scrim = React.useRef(new Animated.Value(0)).current;
  const sheetY = React.useRef(new Animated.Value(1)).current;

  const runOpen = React.useCallback(() => {
    closingRef.current = false;
    setPresented(true);
    if (!animate) {
      scrim.setValue(1);
      sheetY.setValue(0);
      return;
    }
    scrim.setValue(0);
    sheetY.setValue(1);
    Animated.parallel([
      Animated.timing(scrim, {
        toValue: 1,
        duration: TaskFoldMotion.scrim,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(sheetY, {
        toValue: 0,
        duration: TaskFoldMotion.sheet,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [animate, scrim, sheetY]);

  const runClose = React.useCallback(
    (after?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      // Modal 关掉后焦点可能悬空，不主动收键盘会把输入法留在底层页面上
      Keyboard.dismiss();
      setKeyboardInset(0);
      const finish = () => {
        setPresented(false);
        scrim.setValue(0);
        sheetY.setValue(1);
        after?.();
        onClose();
        closingRef.current = false;
      };
      if (!animate) {
        finish();
        return;
      }
      Animated.parallel([
        Animated.timing(scrim, {
          toValue: 0,
          duration: Math.round(TaskFoldMotion.scrim * 0.85),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(sheetY, {
          toValue: 1,
          duration: Math.round(TaskFoldMotion.sheet * 0.75),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) finish();
        else closingRef.current = false;
      });
    },
    [animate, onClose, scrim, sheetY],
  );

  React.useEffect(() => {
    if (visible) {
      runOpen();
      return;
    }
    // 父级强制关掉：跳过动画直接收起（正常关闭走 runClose → onClose）
    Keyboard.dismiss();
    setKeyboardInset(0);
    if (!closingRef.current) {
      setPresented(false);
      scrim.setValue(0);
      sheetY.setValue(1);
    }
  }, [visible, runOpen, scrim, sheetY]);

  React.useEffect(() => {
    if (!presented) {
      setKeyboardInset(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvent, (e) => {
      setKeyboardInset(Math.max(0, e.endCoordinates.height));
    });
    const onHide = Keyboard.addListener(hideEvent, () => setKeyboardInset(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [presented]);

  const footPad = Math.max(insets.bottom, 12);
  const slidePx = Math.min(DEFAULT_SLIDE_PX, Math.round(winH * 0.55));
  const translateY = sheetY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, slidePx],
  });
  const sheetBg = isDark ? tf.paper2 : tf.card;
  const maxH = Math.round(winH * maxHeightRatio);
  // 键盘升起时安全区已被键盘盖住，用键盘高度替代底部安全 padding
  const bottomPad = keyboardInset > 0 ? keyboardInset : footPad;

  if (!presented && !visible) return null;

  return (
    <Modal
      transparent
      visible={presented}
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => runClose()}>
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tf.dim, opacity: scrim }]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => runClose()}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: sheetBg,
              borderTopColor: tf.line,
              paddingBottom: bottomPad,
              maxHeight: maxH,
              transform: [{ translateY }],
              shadowColor: tf.shadow,
            },
            sheetStyle,
          ]}>
          <View style={[styles.handle, { backgroundColor: tf.line2 }]} />
          <FoldBottomSheetCloseContext.Provider value={() => runClose()}>
            {children}
          </FoldBottomSheetCloseContext.Provider>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 6,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
});
