import { normalizeRewardPoints } from '@/lib/reward-points';
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

const STEP_MIN = -999;
const STEP_MAX = 999;

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  monoFontFamily?: string;
  accessibilityLabel?: string;
};

/** 奖励积分步进器：加减按钮 + 中间可手动输入 */
export function RewardPointsStepper({
  value,
  onChange,
  disabled = false,
  monoFontFamily,
  accessibilityLabel = '奖励积分',
}: Props) {
  const bump = React.useCallback(
    (delta: number) => {
      const cur = Number(value);
      const base = Number.isFinite(cur) ? cur : 0;
      onChange(String(Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round(base + delta)))));
    },
    [onChange, value],
  );

  const commit = React.useCallback(() => {
    onChange(String(normalizeRewardPoints(value)));
  }, [onChange, value]);

  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => bump(-1)}
        disabled={disabled}
        style={[styles.stepperBtn, disabled && styles.dim]}
        accessibilityRole="button"
        accessibilityLabel="减少积分">
        <Text style={styles.btnText}>−</Text>
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChange}
        onBlur={commit}
        onSubmitEditing={commit}
        editable={!disabled}
        keyboardType="numbers-and-punctuation"
        returnKeyType="done"
        selectTextOnFocus
        style={[styles.input, monoFontFamily ? { fontFamily: monoFontFamily } : null]}
        accessibilityLabel={accessibilityLabel}
      />
      <Pressable
        onPress={() => bump(1)}
        disabled={disabled}
        style={[styles.stepperBtn, disabled && styles.dim]}
        accessibilityRole="button"
        accessibilityLabel="增加积分">
        <Text style={styles.btnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#F0EBDE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.55 },
  btnText: { color: '#6F7D72', fontWeight: '700' },
  input: {
    minWidth: 36,
    maxWidth: 72,
    paddingHorizontal: 2,
    paddingVertical: 0,
    fontSize: 13,
    fontWeight: '600',
    color: '#5C6D60',
    textAlign: 'center',
  },
});
