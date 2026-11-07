import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  busy?: boolean;
  placeholder?: string;
  /** S5：有待发送附图时，无文字也可发送 */
  hasPendingImage?: boolean;
};

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onCancel,
  busy = false,
  placeholder = '随便问点什么…',
  hasPendingImage = false,
}: Props) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const canSend = (Boolean(value.trim()) || hasPendingImage) && !busy;
  const canCancel = busy && Boolean(onCancel);

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingBottom: Math.max(insets.bottom, 12),
          backgroundColor: colors.headerScrim,
          borderTopColor: colors.outline,
        },
      ]}>
      <View
        style={[
          styles.row,
          {
            backgroundColor: colors.surface,
            borderColor: colors.outlineStrong,
          },
        ]}>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={4000}
          editable={!busy}
          onSubmitEditing={() => {
            if (canSend) onSend();
          }}
          blurOnSubmit={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={canCancel ? '停止生成' : '发送'}
          disabled={!canSend && !canCancel}
          onPress={() => {
            if (canCancel) onCancel?.();
            else if (canSend) onSend();
          }}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: canCancel
                ? colors.danger
                : canSend
                  ? colors.primary
                  : colors.surfaceMuted,
              opacity: pressed && (canSend || canCancel) ? 0.88 : 1,
            },
          ]}>
          {busy && !canCancel ? (
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : (
            <MaterialIcons
              name={canCancel ? 'stop' : 'arrow-upward'}
              size={20}
              color={canSend || canCancel ? colors.onPrimary : colors.textMuted}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['3xl'],
    paddingTop: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.composer,
    paddingLeft: Spacing.xl,
    paddingRight: Spacing.sm,
    paddingVertical: Spacing.sm,
    minHeight: 48,
  },
  input: {
    flex: 1,
    ...Typography.body,
    fontSize: 15,
    lineHeight: 21,
    maxHeight: 120,
    paddingTop: 10,
    paddingBottom: 10,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
