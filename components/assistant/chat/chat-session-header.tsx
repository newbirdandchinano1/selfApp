import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/design-tokens';
import { appFonts } from '@/constants/app-fonts';
import { useAppTheme } from '@/hooks/use-app-theme';
import { AGENT_BRAND } from '@/lib/assistant/agent-space-prompts';

type Props = {
  title: string;
  onBack: () => void;
  onNewChat: () => void;
  onOpenHistory: () => void;
  onOpenPrefs?: () => void;
  online?: boolean;
};

export function ChatSessionHeader({
  title,
  onBack,
  onNewChat,
  onOpenHistory,
  onOpenPrefs,
  online = true,
}: Props) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const showSessionTitle = Boolean(title?.trim()) && title !== '助手' && title !== '新对话';

  return (
    <View
      style={[
        styles.wrap,
        {
          paddingTop: insets.top,
          backgroundColor: colors.headerScrim,
          borderBottomColor: colors.outline,
        },
      ]}>
      <View style={styles.bar}>
        <Pressable
          onPress={onBack}
          accessibilityLabel="返回"
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconBtn,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={[styles.backGlyph, { color: colors.primary }]}>‹</Text>
        </Pressable>

        <View style={styles.brand}>
          <View style={[styles.mark, { backgroundColor: colors.primary }]}>
            <Text style={[styles.markGlyph, { color: colors.onPrimary }]}>✦</Text>
          </View>
          <View style={styles.brandCopy}>
            <Text style={[styles.brandTitle, { color: colors.text }]} numberOfLines={1}>
              {showSessionTitle ? title : AGENT_BRAND.name}
            </Text>
            <View style={styles.metaRow}>
              {online ? (
                <View style={[styles.liveDot, { backgroundColor: colors.secondary }]} />
              ) : null}
              <Text style={[styles.brandSub, { color: colors.textMuted }]} numberOfLines={1}>
                {online ? 'LIVE · ' : ''}
                {AGENT_BRAND.crumb}
              </Text>
            </View>
          </View>
        </View>

        {onOpenPrefs ? (
          <Pressable
            onPress={onOpenPrefs}
            accessibilityLabel="偏好管理"
            hitSlop={8}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: colors.surface,
                borderColor: colors.outline,
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <Text style={[styles.sideGlyph, { color: colors.primary }]}>◎</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={onOpenHistory}
          accessibilityLabel="历史对话"
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconBtn,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={[styles.sideGlyph, { color: colors.primary }]}>☰</Text>
        </Pressable>

        <Pressable
          onPress={onNewChat}
          accessibilityLabel="新建对话"
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconBtn,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={[styles.sideGlyph, { color: colors.primary }]}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
    position: 'relative',
  },
  bar: {
    minHeight: 54,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: {
    fontSize: 28,
    lineHeight: 30,
    marginTop: -2,
    fontWeight: '400',
  },
  sideGlyph: {
    fontSize: 18,
    fontWeight: '600',
  },
  brand: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  mark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlyph: {
    fontSize: 15,
    fontWeight: '700',
  },
  brandCopy: {
    flex: 1,
    minWidth: 0,
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  brandSub: {
    fontFamily: appFonts.mono,
    fontSize: 10,
    letterSpacing: 0.4,
  },
});
