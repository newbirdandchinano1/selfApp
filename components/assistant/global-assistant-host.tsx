/**
 * 全局助手入口：悬浮钮 + 订阅 openGlobalAssistant。
 * 阶段二：主交互改为独立聊天页（不再用业务 Modal）。
 */
import { glassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import {
  openGlobalAssistant,
  subscribeGlobalAssistant,
} from '@/lib/assistant/host-controller';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CHAT_HREF = '/assistant/chat';

function isAssistantRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/assistant' || pathname.startsWith('/assistant/');
}

export function GlobalAssistantHost() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useAppTheme();
  const navigatingRef = React.useRef(false);
  const onAssistantPage = isAssistantRoute(pathname);

  const openChat = React.useCallback(() => {
    // 已在助手页时不再 push，避免叠出第二个聊天页
    if (isAssistantRoute(pathname)) return;
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    try {
      router.push(CHAT_HREF as never);
    } finally {
      // 短防抖，避免连点叠多个聊天页
      setTimeout(() => {
        navigatingRef.current = false;
      }, 500);
    }
  }, [pathname, router]);

  React.useEffect(() => {
    return subscribeGlobalAssistant(() => {
      openChat();
    });
  }, [openChat]);

  // 助手页自身不再显示入口 FAB
  if (onAssistantPage) return null;

  const fabBottom = glassTabBarContentInset(insets.bottom) + 72;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="打开全局助手"
      onPress={() => openGlobalAssistant({ openOnly: true })}
      style={({ pressed }) => [
        styles.fab,
        {
          bottom: fabBottom,
          backgroundColor: colors.primary,
          opacity: pressed ? 0.88 : 1,
        },
      ]}>
      <MaterialIcons name="auto-awesome" size={22} color={colors.onPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    zIndex: 40,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#1A2A1E',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
});
