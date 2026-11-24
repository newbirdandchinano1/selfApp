/**
 * Agent 桌宠主组件：手势 + 渲染 + 快捷菜单。
 * 点击直接进入完整聊天页。
 */
import { PetBubble } from '@/components/agent-pet/components/PetBubble';
import { PetGesture } from '@/components/agent-pet/components/PetGesture';
import { PetQuickMenu } from '@/components/agent-pet/components/PetQuickMenu';
import { PetRenderer } from '@/components/agent-pet/components/PetRenderer';
import { useAgentPet } from '@/components/agent-pet/hooks/useAgentPet';
import { useAgentPetAnimation } from '@/components/agent-pet/hooks/useAgentPetAnimation';
import { useAgentPetPosition } from '@/components/agent-pet/hooks/useAgentPetPosition';
import type {
  AgentPetQuickAction,
  AgentPetRenderEngine,
} from '@/components/agent-pet/types/agentPet.types';
import { glassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import { subscribeAgentPetEvents } from '@/lib/assistant/agent-pet-events';
import { createThinkingState } from '@/lib/assistant/agent-thinking-status';
import { subscribeGlobalAssistant } from '@/lib/assistant/host-controller';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { type ImageSourcePropType, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  engine?: AgentPetRenderEngine;
  /**
   * 自定义桌宠图：传入后替代默认液态精灵。
   * 例：require('../assets/my-pet.png')
   */
  imageSource?: ImageSourcePropType;
};

function isAssistantRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/assistant' || pathname.startsWith('/assistant/');
}

/** 隐藏后的边缘休眠态：轻触恢复，保留 Agent 入口 */
function DormantEdgeNub({
  side,
  bottom,
  onRestore,
}: {
  side: 'left' | 'right';
  bottom: number;
  onRestore: () => void;
}) {
  const { isDark } = useAppTheme();
  const pulse = useSharedValue(0);

  React.useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * 0.35,
    transform: [{ scaleY: 0.92 + pulse.value * 0.12 }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="恢复 Agent 桌宠"
      onPress={onRestore}
      style={[
        styles.nubHit,
        side === 'right' ? { right: 0 } : { left: 0 },
        { bottom },
      ]}>
      <Animated.View
        style={[
          styles.nub,
          {
            backgroundColor: isDark ? '#4A7A68' : '#2F5A4C',
            borderColor: isDark ? 'rgba(224,176,114,0.45)' : 'rgba(224,179,90,0.5)',
            ...(side === 'right'
              ? { borderTopLeftRadius: 10, borderBottomLeftRadius: 10 }
              : { borderTopRightRadius: 10, borderBottomRightRadius: 10 }),
          },
          style,
        ]}
      />
    </Pressable>
  );
}

export function AgentPet({ engine = 'native', imageSource }: Props) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const pet = useAgentPet();
  const anim = useAgentPetAnimation(pet.visualState);
  const bottomReserve = glassTabBarContentInset(insets.bottom) + 24;
  const position = useAgentPetPosition({
    enabled: pet.visible && !pet.menuOpen,
    bottomReserve,
  });
  const [menuAnchorY, setMenuAnchorY] = React.useState(120);
  const onAssistantPage = isAssistantRoute(pathname);
  const navigatingRef = React.useRef(false);

  const pushChat = React.useCallback(() => {
    if (isAssistantRoute(pathname)) return;
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    try {
      router.push('/assistant/chat' as never);
    } finally {
      setTimeout(() => {
        navigatingRef.current = false;
      }, 500);
    }
  }, [pathname, router]);

  const handleQuickAction = React.useCallback(
    (action: AgentPetQuickAction) => {
      switch (action.id) {
        case 'chat':
        case 'settings':
          pushChat();
          break;
        case 'tasks':
          router.push('/(tabs)/tasks' as never);
          break;
        case 'hide':
          pet.hidePet();
          break;
        default:
          break;
      }
    },
    [pet, pushChat, router],
  );

  const petRef = React.useRef(pet);
  petRef.current = pet;

  // 外部 openGlobalAssistant：launchPayload 已写入，这里只负责跳转完整聊天页
  React.useEffect(() => {
    return subscribeGlobalAssistant(() => {
      if (isAssistantRoute(pathname)) return;
      const p = petRef.current;
      if (!p.visible) p.showPet();
      pushChat();
    });
  }, [pathname, pushChat]);

  React.useEffect(() => {
    return subscribeAgentPetEvents(event => {
      const p = petRef.current;
      switch (event.type) {
        case 'bubble':
          p.showBubble(event.text, event.force);
          break;
        case 'visual':
          if (event.state == null) {
            p.setThinking(null);
          } else if (event.state === 'thinking' || event.state === 'working') {
            p.setThinking(
              createThinkingState(event.state === 'working' ? 'tool' : 'thinking'),
            );
          } else if (event.state === 'error') {
            p.flashError();
          } else if (event.state === 'success') {
            p.flashSuccess();
          }
          break;
        case 'task':
          p.setTaskProgress(event.progress);
          break;
        case 'success':
          p.flashSuccess();
          break;
        case 'error':
          p.flashError();
          if (event.label) p.showBubble(event.label, true);
          break;
        default:
          break;
      }
    });
  }, []);

  if (onAssistantPage) return null;

  if (!pet.visible) {
    return (
      <DormantEdgeNub
        side={position.side}
        bottom={bottomReserve + 40}
        onRestore={pet.showPet}
      />
    );
  }

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <PetGesture
        position={position}
        dragEnabled={!pet.menuOpen}
        onPress={() => {
          pet.dismissBubble();
          pushChat();
        }}
        onLongPress={() => {
          setMenuAnchorY(position.y.value);
          pet.openMenu();
        }}>
        <View style={styles.petStack}>
          <PetBubble
            bubble={pet.bubble}
            side={position.side}
            onPress={() => {
              pet.dismissBubble();
              pushChat();
            }}
            onDismiss={pet.dismissBubble}
          />
          <PetRenderer
            state={pet.visualState}
            anim={anim}
            engine={engine}
            imageSource={imageSource}
          />
        </View>
      </PetGesture>

      <PetQuickMenu
        open={pet.menuOpen}
        side={position.side}
        anchorY={menuAnchorY}
        onClose={pet.closeMenu}
        onAction={handleQuickAction}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  petStack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nubHit: {
    position: 'absolute',
    zIndex: 45,
    width: 22,
    height: 48,
    justifyContent: 'center',
  },
  nub: {
    width: 10,
    height: 36,
    borderWidth: 1,
    alignSelf: 'center',
  },
});
