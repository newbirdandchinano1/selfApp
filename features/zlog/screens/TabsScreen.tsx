import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { TabBar, TabKey } from '../components/TabBar';
import { SpeedDialFab } from '../components/SpeedDialFab';
import { PressableScale } from '../components/PressableScale';
import FeedScreen from './FeedScreen';
import MomentsScreen from './MomentsScreen';

export default function TabsScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>('feed');
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    fade.setValue(0.55);
    Animated.timing(fade, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [tab, fade]);

  const barBottom = Math.max(insets.bottom, 14);
  const fabBottom = barBottom + 62 + 16;

  const exitBlog = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/profile');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Animated.View style={{ flex: 1, opacity: fade }}>
        <View style={{ flex: 1, display: tab === 'feed' ? 'flex' : 'none' }}>
          <FeedScreen />
        </View>
        <View style={{ flex: 1, display: tab === 'moments' ? 'flex' : 'none' }}>
          <MomentsScreen />
        </View>
      </Animated.View>

      <BlurView
        intensity={isDark ? 40 : 70}
        tint={isDark ? 'dark' : 'light'}
        style={{
          position: 'absolute',
          top: insets.top + 6,
          left: 16,
          width: 42,
          height: 42,
          borderRadius: 14,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20,
        }}
      >
        <PressableScale
          onPress={exitBlog}
          style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
          hitSlop={10}
          accessibilityLabel="返回我的"
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </PressableScale>
      </BlurView>

      <TabBar tab={tab} onChange={setTab} bottom={barBottom} />

      <SpeedDialFab
        bottom={fabBottom}
        onMoment={() => router.push('/blog/compose-moment')}
        onBlog={() => router.push('/blog/compose-blog')}
      />
    </View>
  );
}
