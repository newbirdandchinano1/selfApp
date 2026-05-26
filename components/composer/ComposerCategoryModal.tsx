import { Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, Text } from 'react-native';

import { composerStyles as s } from './composer-styles';

export type ComposerCategoryOption = {
  id: string | null;
  name: string;
};

export function ComposerCategoryModal({
  visible,
  title,
  options,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: ComposerCategoryOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={[s.modalOverlay, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable onPress={() => {}} style={[s.modalCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
          <Text style={[Typography.title, s.modalTitle, { color: colors.text }]}>{title}</Text>
          {options.map((item) => {
            const active = selectedId === item.id;
            return (
              <Pressable
                key={item.id ?? '__none__'}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
                style={({ pressed }) => [s.modalItem, pressed && { opacity: 0.85 }]}>
                <Text style={[Typography.bodyStrong, { color: colors.text }]}>{item.name}</Text>
                {active ? <MaterialIcons name="check" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
