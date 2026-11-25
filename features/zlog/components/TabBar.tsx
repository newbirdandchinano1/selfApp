import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export type TabKey = 'feed' | 'moments';

interface Props {
  tab: TabKey;
  onChange: (tab: TabKey) => void;
  bottom: number;
}

const ITEMS: Array<{
  key: TabKey;
  label: string;
  icon: any;
  activeIcon: any;
}> = [
  { key: 'feed', label: '博客', icon: 'document-text-outline', activeIcon: 'document-text' },
  {
    key: 'moments',
    label: '说说',
    icon: 'chatbubble-ellipses-outline',
    activeIcon: 'chatbubble-ellipses',
  },
];

export function TabBar({ tab, onChange, bottom }: Props) {
  const { colors, isDark } = useTheme();

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 16, right: 16, bottom }}
    >
      <BlurView
        intensity={isDark ? 40 : 60}
        tint={isDark ? 'dark' : 'light'}
        style={{
          flexDirection: 'row',
          borderRadius: 26,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
          padding: 6,
          backgroundColor: isDark ? 'rgba(20,30,25,0.55)' : 'rgba(255,254,250,0.55)',
          shadowColor: colors.shadow,
          shadowOpacity: 0.12,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        {ITEMS.map((item) => (
          <TabItem
            key={item.key}
            item={item}
            active={tab === item.key}
            onPress={() => onChange(item.key)}
          />
        ))}
      </BlurView>
    </View>
  );
}

function TabItem({
  item,
  active,
  onPress,
}: {
  item: (typeof ITEMS)[number];
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: active ? 1 : 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [active, anim]);

  const pillOpacity = anim;
  const pillScale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });
  const iconTranslate = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -2],
  });
  const iconScale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 7,
        gap: 3,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          margin: 2,
          borderRadius: 20,
          backgroundColor: colors.sageSoft,
          opacity: pillOpacity,
          transform: [{ scale: pillScale }],
        }}
      />
      <Animated.View style={{ transform: [{ translateY: iconTranslate }, { scale: iconScale }] }}>
        <Ionicons
          name={active ? item.activeIcon : item.icon}
          size={21}
          color={active ? colors.brand : colors.inkFaint}
        />
      </Animated.View>
      <Text
        style={{
          fontSize: 10.5,
          fontWeight: '600',
          color: active ? colors.brand : colors.inkFaint,
        }}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}
