import type { CompletionReward } from '@/lib/completion-reward/completion-reward.types';
import { formatCompletionRewardLabel, parseCompletionRewardFromExtraData } from '@/lib/completion-reward/completion-reward-extra';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  extraData: string | null;
  wishNameById?: ReadonlyMap<string, string> | null;
  outline: string;
  accent: string;
  isDark: boolean;
};

export function CompletionRewardBadge({ extraData, wishNameById, outline, accent, isDark }: Props) {
  const reward = parseCompletionRewardFromExtraData(extraData);
  const label = formatCompletionRewardLabel(reward, wishNameById);
  if (!label) return null;

  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(130,81,0,0.1)',
          borderColor: isDark ? 'rgba(251,191,36,0.35)' : 'rgba(130,81,0,0.28)',
        },
      ]}>
      <MaterialIcons name="emoji-events" size={11} color={accent} />
      <Text style={[styles.chipText, { color: accent }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function getCompletionRewardFromExtra(extraData: string | null): CompletionReward {
  return parseCompletionRewardFromExtraData(extraData);
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  chipText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
});
