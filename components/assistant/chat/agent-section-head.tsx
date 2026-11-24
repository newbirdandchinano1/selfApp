import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/design-tokens';
import { appFonts } from '@/constants/app-fonts';
import { useAppTheme } from '@/hooks/use-app-theme';

type Props = {
  title: string;
  meta: string;
};

export function AgentSectionHead({ title, meta }: Props) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.meta, { color: colors.textMuted }]}>{meta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: Spacing['6xl'],
    marginBottom: Spacing['2xl'],
    paddingHorizontal: Spacing['5xl'],
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  meta: {
    fontFamily: appFonts.mono,
    fontSize: 11,
    letterSpacing: 0.4,
  },
});
