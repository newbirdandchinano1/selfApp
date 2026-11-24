/**
 * 长按快捷菜单：对话 / 任务 / 设置 / 隐藏。
 */
import {
  AGENT_PET_QUICK_ACTIONS,
  type AgentPetQuickAction,
  type AgentPetSide,
} from '@/components/agent-pet/types/agentPet.types';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

type Props = {
  open: boolean;
  side: AgentPetSide;
  anchorY: number;
  onClose: () => void;
  onAction: (action: AgentPetQuickAction) => void;
};

export function PetQuickMenu({ open, side, anchorY, onClose, onAction }: Props) {
  const { colors, isDark, typography } = useAppTheme();

  if (!open) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={styles.root} pointerEvents="box-none">
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Animated.View
            entering={FadeIn.duration(120)}
            exiting={FadeOut.duration(100)}
            style={StyleSheet.absoluteFill}
          />
        </Pressable>
        <Animated.View
          entering={ZoomIn.duration(180)}
          style={[
            styles.menuWrap,
            {
              top: Math.max(72, anchorY - 12),
              ...(side === 'right' ? { right: 16 } : { left: 16 }),
            },
          ]}>
          <View
            style={[
              styles.menu,
              {
                backgroundColor: isDark ? 'rgba(27,36,32,0.96)' : 'rgba(255,252,247,0.98)',
                borderColor: isDark ? 'rgba(169,199,185,0.22)' : 'rgba(30,57,50,0.1)',
              },
            ]}>
            {AGENT_PET_QUICK_ACTIONS.map(action => (
              <Pressable
                key={action.id}
                onPress={() => {
                  onAction(action);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.item,
                  pressed && {
                    backgroundColor: isDark
                      ? 'rgba(169,199,185,0.12)'
                      : 'rgba(30,57,50,0.06)',
                  },
                ]}>
                <MaterialIcons
                  name={(action.icon as keyof typeof MaterialIcons.glyphMap) || 'circle'}
                  size={18}
                  color={action.id === 'hide' ? colors.textMuted : colors.primary}
                />
                <Text
                  style={[
                    typography.bodyStrong,
                    {
                      color: action.id === 'hide' ? colors.textMuted : colors.text,
                    },
                  ]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill },
  menuWrap: {
    position: 'absolute',
    zIndex: 60,
  },
  menu: {
    minWidth: 148,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
