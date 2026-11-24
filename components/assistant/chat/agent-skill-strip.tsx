import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  AGENT_SKILL_PROMPTS,
  type AgentSkillPrompt,
} from '@/lib/assistant/agent-space-prompts';

type Props = {
  onSelect: (skill: AgentSkillPrompt) => void;
  disabled?: boolean;
};

export function AgentSkillStrip({ onSelect, disabled = false }: Props) {
  const { colors } = useAppTheme();

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {AGENT_SKILL_PROMPTS.map(skill => (
          <Pressable
            key={skill.id}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={skill.title}
            onPress={() => onSelect(skill)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: colors.surface,
                borderColor: colors.outline,
                opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
                transform: [{ translateY: pressed && !disabled ? -2 : 0 }],
              },
            ]}>
            <Text style={[styles.icon, { color: skill.accent }]}>{skill.icon}</Text>
            <Text style={[styles.label, { color: colors.textMuted }]}>{skill.title}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing['5xl'],
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  icon: {
    fontSize: 12,
    marginRight: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
