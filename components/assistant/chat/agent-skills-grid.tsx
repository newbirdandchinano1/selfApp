/**
 * 「我可以替你做什么」— 2×2 技能卡（对齐设计稿 skills 区）。
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AgentSectionHead } from '@/components/assistant/chat/agent-section-head';
import { Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  AGENT_SKILL_PROMPTS,
  type AgentSkillPrompt,
} from '@/lib/assistant/agent-space-prompts';

type Props = {
  onSelect: (skill: AgentSkillPrompt) => void;
  disabled?: boolean;
};

export function AgentSkillsGrid({ onSelect, disabled = false }: Props) {
  const { colors, isDark } = useAppTheme();
  const { width } = useWindowDimensions();
  const pad = Spacing['5xl'] * 2;
  const gap = 11;
  const cardW = Math.max(140, (width - pad - gap) / 2);
  const cardBg = isDark ? colors.surface : 'rgba(255,254,248,0.7)';

  return (
    <View>
      <AgentSectionHead title="我可以替你做什么" meta="8 DOMAINS · READY" />
      <View style={[styles.grid, { gap }]}>
        {AGENT_SKILL_PROMPTS.map(skill => (
          <Pressable
            key={skill.id}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${skill.title}：${skill.subtitle}`}
            onPress={() => onSelect(skill)}
            style={({ pressed }) => [
              styles.card,
              {
                width: cardW,
                backgroundColor: pressed ? colors.surface : cardBg,
                borderColor: pressed ? colors.outlineStrong : colors.outline,
                opacity: disabled ? 0.45 : 1,
                transform: [{ translateY: pressed && !disabled ? -4 : 0 }],
                shadowOpacity: pressed ? 0.1 : 0,
              },
            ]}>
            <View
              pointerEvents="none"
              style={[styles.blob, { backgroundColor: skill.accent }]}
            />
            <Text style={styles.icon}>{skill.icon}</Text>
            <Text style={[styles.title, { color: colors.text }]}>{skill.title}</Text>
            <Text style={[styles.sub, { color: colors.textMuted }]}>{skill.subtitle}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing['5xl'],
  },
  card: {
    minHeight: 112,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingTop: 14,
    paddingBottom: 13,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: 'rgba(35,53,43,1)',
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 0,
  },
  blob: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    right: -28,
    bottom: -28,
    opacity: 0.12,
  },
  icon: {
    fontSize: 23,
    marginBottom: 14,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 5,
  },
  sub: {
    fontSize: 11,
    lineHeight: 15,
  },
});
