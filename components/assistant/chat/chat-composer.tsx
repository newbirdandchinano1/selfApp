import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
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
  /** 待发送附图预览 URI（file:// 或 data URI） */
  pendingImageUri?: string | null;
  /** 选图 / 拍照入口 */
  onPickImage?: () => void;
  /** 清除待发送附图 */
  onClearPendingImage?: () => void;
  /** 是否显示底部 footnote */
  showFootnote?: boolean;
};

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onCancel,
  busy = false,
  placeholder = '随便问点什么…',
  hasPendingImage = false,
  pendingImageUri = null,
  onPickImage,
  onClearPendingImage,
  showFootnote = true,
}: Props) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const canSend = (Boolean(value.trim()) || hasPendingImage) && !busy;
  const canCancel = busy && Boolean(onCancel);
  const canPick = Boolean(onPickImage) && !busy;

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingBottom: Math.max(insets.bottom, 10),
          backgroundColor: colors.headerScrim,
        },
      ]}>
      {pendingImageUri ? (
        <View style={styles.previewRow}>
          <View
            style={[
              styles.previewFrame,
              { borderColor: colors.outlineStrong, backgroundColor: colors.surface },
            ]}>
            <Image source={{ uri: pendingImageUri }} style={styles.previewImage} />
            {onClearPendingImage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="移除图片"
                onPress={onClearPendingImage}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.clearBadge,
                  {
                    backgroundColor: colors.danger,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <MaterialIcons name="close" size={14} color={colors.onPrimary} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      <View
        style={[
          styles.row,
          {
            backgroundColor: colors.surface,
            borderColor: colors.outline,
            shadowColor: colors.primary,
          },
        ]}>
        {onPickImage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加图片"
            disabled={!canPick}
            onPress={onPickImage}
            style={({ pressed }) => [
              styles.attach,
              {
                backgroundColor: colors.primaryMuted,
                opacity: !canPick ? 0.4 : pressed ? 0.72 : 1,
              },
            ]}>
            <MaterialIcons name="image" size={20} color={colors.primary} />
          </Pressable>
        ) : null}
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
              transform: [{ scale: pressed && (canSend || canCancel) ? 1.05 : 1 }],
            },
          ]}>
          {busy && !canCancel ? (
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : canCancel ? (
            <MaterialIcons name="stop" size={18} color={colors.onPrimary} />
          ) : (
            <Text
              style={[
                styles.sendGlyph,
                { color: canSend ? colors.onPrimary : colors.textMuted },
              ]}>
              ↗
            </Text>
          )}
        </Pressable>
      </View>
      {showFootnote ? (
        <View style={styles.footnote}>
          <Text style={[styles.footnoteText, { color: colors.textMuted }]}>
            支持文字 · 图片 · 操作确认
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing.sm,
  },
  previewRow: {
    marginBottom: Spacing.md,
  },
  previewFrame: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  clearBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingLeft: 9,
    paddingRight: 6,
    paddingVertical: 5,
    minHeight: 51,
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  attach: {
    width: 35,
    height: 35,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  input: {
    flex: 1,
    ...Typography.body,
    fontSize: 13,
    lineHeight: 19,
    maxHeight: 120,
    paddingTop: 9,
    paddingBottom: 9,
  },
  send: {
    width: 37,
    height: 37,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendGlyph: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: -1,
  },
  footnote: {
    marginTop: 8,
    marginHorizontal: 4,
  },
  footnoteText: {
    fontSize: 9,
  },
});
