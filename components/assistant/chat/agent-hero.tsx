/**
 * Agent Space Hero — face + 问候文案 + 在线状态（对齐设计稿 hero）。
 */
import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AgentFace } from '@/components/assistant/chat/agent-face';
import { Spacing, Typography } from '@/constants/design-tokens';
import { appFonts } from '@/constants/app-fonts';
import { useAppTheme } from '@/hooks/use-app-theme';
import { AGENT_BRAND } from '@/lib/assistant/agent-space-prompts';

type Props = {
  compact?: boolean;
};

export function AgentHero({ compact = false }: Props) {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  // 手机上控制体积，避免挤占右侧文案：约 78–88
  const faceSize = compact ? 72 : width < 360 ? 76 : 86;

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <View style={styles.faceSlot}>
        <AgentFace size={faceSize} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: colors.secondary }]}>{AGENT_BRAND.eyebrow}</Text>
        <Text style={[styles.title, { color: colors.text }, compact && styles.titleCompact]}>
          {AGENT_BRAND.greetingLine1}
          {'\n'}
          {AGENT_BRAND.greetingLine2}
        </Text>
        {!compact ? (
          <Text style={[styles.blurb, { color: colors.textMuted }]}>{AGENT_BRAND.blurb}</Text>
        ) : (
          <Text style={[styles.blurbCompact, { color: colors.textMuted }]} numberOfLines={2}>
            从一条模糊的念头开始，就够了。
          </Text>
        )}
        <View style={[styles.status, { backgroundColor: colors.primaryMuted }]}>
          <View style={styles.dotWrap}>
            <View style={[styles.dot, { backgroundColor: colors.secondary }]} />
            <View style={[styles.dotRing, { borderColor: 'rgba(95,138,110,0.2)' }]} />
          </View>
          <Text style={[styles.statusText, { color: colors.secondary }]}>
            {AGENT_BRAND.statusOnline}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingTop: Spacing['4xl'],
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing['5xl'],
  },
  rowCompact: {
    gap: 12,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  faceSlot: {
    // 给外虚线轨道留出溢出空间，但不占布局宽度
    padding: 8,
    margin: -8,
    marginTop: 4,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  eyebrow: {
    fontFamily: appFonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    ...Typography.h2,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.9,
    fontWeight: '800',
    marginBottom: 8,
  },
  titleCompact: {
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.6,
  },
  blurb: {
    ...Typography.body,
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 12,
  },
  blurbCompact: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  status: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 99,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  dotWrap: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotRing: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3.5,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
