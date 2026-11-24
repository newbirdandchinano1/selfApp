import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  AGENT_SUGGESTION_CHIPS,
  type AgentSuggestionChip,
} from '@/lib/assistant/agent-space-prompts';

type Props = {
  onSelect: (chip: AgentSuggestionChip) => void;
  disabled?: boolean;
};

function SuggestionChip({
  chip,
  disabled,
  onSelect,
}: {
  chip: AgentSuggestionChip;
  disabled: boolean;
  onSelect: (chip: AgentSuggestionChip) => void;
}) {
  const { colors } = useAppTheme();
  const [pressed, setPressed] = React.useState(false);

  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={chip.label}
      onPress={() => onSelect(chip)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.chip,
        {
          borderColor: colors.outline,
          backgroundColor: pressed ? colors.primaryMuted : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
      ]}>
      <Text
        style={[
          styles.label,
          { color: pressed ? colors.primary : colors.textMuted },
        ]}>
        {chip.label}
      </Text>
    </Pressable>
  );
}

export function AgentSuggestionChips({ onSelect, disabled = false }: Props) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.wrap, { borderTopColor: colors.outline }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {AGENT_SUGGESTION_CHIPS.map(chip => (
          <SuggestionChip
            key={chip.id}
            chip={chip}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    paddingHorizontal: Spacing['5xl'],
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
