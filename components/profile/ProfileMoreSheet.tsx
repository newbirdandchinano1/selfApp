/**
 * 「我的 · 更多」底部菜单：对齐设计稿 Sheet 弹簧上滑 + 行级联。
 */
import { FoldRiseIn, FOLD_MOTION_EASE, FOLD_MOTION_SPRING, useFoldMotionGate } from '@/components/review/fold-motion';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { getMinTouchTarget } from '@/constants/design-tokens';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

const MIN_TOUCH = getMinTouchTarget(Platform.OS);

export type ProfileMoreMenuItem = {
  key: string;
  title: string;
  subtitle: string;
  meta: string;
  icon: AppIconName;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  items: ProfileMoreMenuItem[];
  onClose: () => void;
};

export function ProfileMoreSheet({ visible, items, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate } = useFoldMotionGate();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = React.useState(visible);

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
      duration: animate ? 220 : 1,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [animate, mounted, progress, visible]);

  const versionLabel = useMemo(() => {
    const v =
      Constants.expoConfig?.version ??
      Constants.nativeAppVersion ??
      '2.4';
    return `折页 v${v} · 数据仅存本机与私有云`;
  }, []);

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [48, 0],
  });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(24,32,28,0.4)', opacity: progress },
          ]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="关闭更多菜单"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: fold.card,
              borderColor: fold.line2,
              paddingBottom: Math.max(insets.bottom, 16) + 8,
              opacity: progress,
              transform: [{ translateY }],
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: fold.line2 }]} />
          <View style={styles.head}>
            <Text style={[styles.headTitle, { color: fold.pine, fontFamily: foldFonts.serif }]}>
              更多
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="关闭"
              hitSlop={10}
              style={({ pressed }) => [
                styles.closeBtn,
                {
                  borderColor: fold.line,
                  backgroundColor: pressed ? fold.paper2 : 'rgba(255,252,245,0.65)',
                  minWidth: MIN_TOUCH,
                  minHeight: MIN_TOUCH,
                },
              ]}>
              <AppIcon name="close" size={16} color={fold.ink2} />
            </Pressable>
          </View>

          {items.map((item, index) => (
            <FoldRiseIn
              key={item.key}
              animate={animate && visible}
              index={index}
              staggerMs={40}
              delayMs={60}
              fromY={10}
              duration={320}>
              <Pressable
                onPress={() => {
                  onClose();
                  // 等收起一拍再跳，避免 Modal 与路由叠闪
                  requestAnimationFrame(() => item.onPress());
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}，${item.subtitle}`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderTopColor: index === 0 ? 'transparent' : 'rgba(230,221,206,0.62)',
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    backgroundColor: pressed ? fold.paper2 : 'transparent',
                    minHeight: Math.max(MIN_TOUCH, 52),
                  },
                ]}>
                <View style={[styles.iconWrap, { backgroundColor: fold.paper2 }]}>
                  <AppIcon name={item.icon} size={15} color={fold.ink2} />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.title, { color: fold.ink2 }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[styles.sub, { color: fold.faint }]} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                </View>
                <Text style={[styles.meta, { color: fold.faint }]} numberOfLines={1}>
                  {item.meta}
                </Text>
              </Pressable>
            </FoldRiseIn>
          ))}

          <View style={styles.foot}>
            <Text style={[styles.footText, { color: fold.faint }]} numberOfLines={1}>
              {versionLabel}
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
    shadowColor: '#181F1C',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  handle: {
    width: 34,
    height: 4,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 11,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  headTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
    paddingHorizontal: 5,
    borderRadius: 11,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
  },
  sub: {
    fontSize: 11,
  },
  meta: {
    fontSize: 11,
    marginLeft: 4,
  },
  foot: {
    marginTop: 8,
    paddingHorizontal: 5,
    paddingBottom: 2,
  },
  footText: {
    fontSize: 10,
  },
});
