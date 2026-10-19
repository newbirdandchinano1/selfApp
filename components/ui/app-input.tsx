import React from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

export type AppInputProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputWrapStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

export function AppInput({
  label,
  hint,
  error,
  containerStyle,
  inputWrapStyle,
  inputStyle,
  placeholderTextColor,
  style,
  multiline,
  ...inputProps
}: AppInputProps) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.wrap,
          {
            backgroundColor: colors.input,
            borderColor: error ? colors.danger : colors.outline,
          },
          inputWrapStyle,
        ]}>
        <TextInput
          multiline={multiline}
          placeholderTextColor={placeholderTextColor ?? colors.textMuted}
          style={[
            styles.input,
            { color: colors.text },
            Platform.OS === 'android'
              ? {
                  textAlignVertical: multiline ? 'top' : 'center',
                  includeFontPadding: false,
                }
              : null,
            inputStyle,
            style,
          ]}
          {...inputProps}
        />
      </View>
      {error ? (
        <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0,
  },
  wrap: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  input: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
    padding: 0,
    margin: 0,
  },
  hint: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
});
