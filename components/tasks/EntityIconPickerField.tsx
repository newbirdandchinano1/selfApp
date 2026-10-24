/**
 * 习惯 / 待办 / 项目共用图标选择：预览钮 + 网格弹层（对齐小习惯选图标交互）。
 */
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  ENTITY_ICON_CHOICES,
  normalizeEntityIcon,
} from '@/lib/constants/entity-icon-choices';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type Props = {
  value: string;
  onChange: (icon: string) => void;
  fallback?: string;
  disabled?: boolean;
  /** 仅图标钮（标题旁）；默认带「图标」文案行 */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function EntityIconPickerField({
  value,
  onChange,
  fallback = '📝',
  disabled = false,
  compact = false,
  style,
  accessibilityLabel = '选择图标',
}: Props) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  const icon = normalizeEntityIcon(value, fallback);

  const trigger = (
    <Pressable
      onPress={() => {
        if (!disabled) setOpen(true);
      }}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        compact ? styles.emojiWrap : styles.rowTrigger,
        compact
          ? {
              backgroundColor: colors.primaryMuted,
              borderColor: colors.outline,
              opacity: disabled ? 0.55 : pressed ? 0.88 : 1,
            }
          : {
              backgroundColor: colors.input,
              borderColor: colors.outline,
              opacity: disabled ? 0.55 : pressed ? 0.88 : 1,
            },
        style,
      ]}>
      {compact ? (
        <>
          <Text style={styles.emoji}>{icon}</Text>
          <View style={[styles.emojiEdit, { backgroundColor: colors.accentCard }]}>
            <MaterialIcons name="edit" size={10} color={colors.onAccent} />
          </View>
        </>
      ) : (
        <>
          <View style={[styles.rowIconWrap, { backgroundColor: colors.primaryMuted }]}>
            <Text style={styles.rowEmoji}>{icon}</Text>
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>图标</Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>点击更换</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
        </>
      )}
    </Pressable>
  );

  return (
    <>
      {trigger}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
            onPress={() => setOpen(false)}
          />
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.outline },
            ]}>
            <Text style={[Typography.title, styles.modalTitle, { color: colors.text }]}>
              选择图标
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}>
              <View style={styles.grid}>
                {ENTITY_ICON_CHOICES.map((ico) => {
                  const selected = icon === ico;
                  return (
                    <Pressable
                      key={ico}
                      onPress={() => {
                        onChange(ico);
                        setOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.cell,
                        {
                          backgroundColor: selected ? colors.primaryMuted : colors.surfaceMuted,
                          borderColor: selected ? colors.primary : 'transparent',
                        },
                        pressed && { opacity: 0.85 },
                      ]}>
                      <Text style={styles.cellEmoji}>{ico}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <Pressable
              onPress={() => setOpen(false)}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.8 }]}>
              <Text style={[Typography.bodyStrong, styles.closeText, { color: colors.textSecondary }]}>
                取消
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  emojiWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.icon,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  emoji: { fontSize: 24 },
  emojiEdit: {
    position: 'absolute',
    right: -Spacing.xs,
    bottom: -Spacing.xs,
    width: 16,
    height: 16,
    borderRadius: Radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEmoji: { fontSize: 20 },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 11, fontWeight: '600' },
  rowValue: { fontSize: 14, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing['4xl'] },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['2xl'],
    paddingTop: Spacing['2xl'],
    paddingBottom: Spacing.lg,
    maxHeight: '78%',
  },
  modalTitle: { marginBottom: Spacing.lg, textAlign: 'center' },
  modalScroll: { maxHeight: 360 },
  modalScrollContent: { paddingBottom: Spacing.sm },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.lg,
    justifyContent: 'center',
  },
  cell: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellEmoji: { fontSize: 26 },
  closeBtn: {
    alignSelf: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing['3xl'],
    marginTop: Spacing.xs,
  },
  closeText: { fontSize: 14 },
});
