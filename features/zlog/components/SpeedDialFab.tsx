import React, { useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  bottom: number;
  onMoment: () => void;
  onBlog: () => void;
}

/** 悬浮发布按钮 + 展开式快捷菜单（发说说 / 写博客） */
export function SpeedDialFab({ bottom, onMoment, onBlog }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const prog = useRef(new Animated.Value(0)).current;

  const animateTo = (to: number) => {
    Animated.spring(prog, {
      toValue: to,
      useNativeDriver: true,
      speed: 14,
      bounciness: 7,
    }).start();
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    animateTo(next ? 1 : 0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const run = (fn: () => void) => {
    setOpen(false);
    animateTo(0);
    setTimeout(fn, 120);
  };

  const rotate = prog.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '135deg'],
  });

  const momentAnim = {
    opacity: prog,
    transform: [
      {
        translateY: prog.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
      {
        scale: prog.interpolate({
          inputRange: [0, 1],
          outputRange: [0.4, 1],
        }),
      },
    ],
  };

  const blogAnim = {
    opacity: prog,
    transform: [
      {
        translateY: prog.interpolate({
          inputRange: [0, 1],
          outputRange: [36, 0],
        }),
      },
      {
        scale: prog.interpolate({
          inputRange: [0, 1],
          outputRange: [0.4, 1],
        }),
      },
    ],
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        right: 20,
        bottom,
        width: 150,
        height: 214,
        justifyContent: 'flex-end',
        alignItems: 'flex-end',
      }}
    >
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[{ position: 'absolute', bottom: 74, right: 0 }, momentAnim]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 999,
              marginRight: 8,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.inkSoft }}>
              发说说
            </Text>
          </View>
          <Pressable onPress={() => run(onMoment)}>
            <LinearGradient
              colors={['#E0B35A', '#C77E3A'] as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: colors.shadow,
                shadowOpacity: 0.2,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
              }}
            >
              <Ionicons name="chatbubble-ellipses" size={22} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        </View>
      </Animated.View>

      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[{ position: 'absolute', bottom: 138, right: 0 }, blogAnim]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 999,
              marginRight: 8,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.inkSoft }}>
              写博客
            </Text>
          </View>
          <Pressable onPress={() => run(onBlog)}>
            <LinearGradient
              colors={[colors.brand, colors.sage] as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: colors.shadow,
                shadowOpacity: 0.2,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
              }}
            >
              <Ionicons name="document-text" size={22} color={colors.onBrand} />
            </LinearGradient>
          </Pressable>
        </View>
      </Animated.View>

      <Pressable onPress={toggle} hitSlop={8}>
        <LinearGradient
          colors={[colors.brand, colors.sage] as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 60,
            height: 60,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: colors.shadow,
            shadowOpacity: 0.3,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 10 },
          }}
        >
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons name="add" size={30} color={colors.onBrand} />
          </Animated.View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}
