import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { getMinTouchTarget, Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

import { AppIcon } from './app-icon';
import { AppText } from './app-text';

/** 分组列表容器：一张表面、发丝边，内部用分隔线而不是再套卡片。 */
export function InsetGroup({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.group,
        { backgroundColor: colors.surface, borderColor: colors.outline },
        style,
      ]}>
      {children}
    </View>
  );
}

/** 分组标题，放在 InsetGroup 外侧。 */
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionRow}>
      <AppText variant="caption" chrome style={[styles.section, { color: colors.textSecondary }]}>
        {title}
      </AppText>
      {action}
    </View>
  );
}

export type ListRowProps = {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: PressableProps['onPress'];
  showChevron?: boolean;
  separator?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  showChevron = false,
  separator = false,
  accessibilityLabel,
  style,
}: ListRowProps) {
  const { colors } = useAppTheme();
  const minHeight = Math.max(getMinTouchTarget(Platform.OS), 52);

  const row = (
    <View
      style={[
        styles.row,
        {
          minHeight,
          borderBottomWidth: separator ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: colors.outline,
        },
        style,
      ]}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.copy}>
        <AppText variant="title" style={{ color: colors.text }} numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" chrome style={{ color: colors.textSecondary }} numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
      {showChevron ? <AppIcon name="chevron-right" size={16} color={colors.textMuted} /> : null}
    </View>
  );

  if (!onPress) return row;

  // 列表行反馈：仅背景高亮（colors.surfaceMuted），不加 scale / haptic
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}，${subtitle}` : title)}
      onPress={onPress}
      style={({ pressed }) => [
        { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
      ]}>
      {row}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.xs,
    gap: Spacing.md,
  },
  section: {
    flex: 1,
  },
  row: {
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
  },
  leading: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
});
