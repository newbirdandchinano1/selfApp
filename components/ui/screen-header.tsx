import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

import { AppIconButton } from './app-icon-button';

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  left?: React.ReactNode;
  sticky?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  left,
  sticky = true,
  style,
}: ScreenHeaderProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  const leftSlot =
    left ??
    (onBack ? (
      <AppIconButton
        icon="arrow-back"
        onPress={onBack}
        accessibilityLabel="返回"
      />
    ) : (
      <View style={styles.sideSpacer} />
    ));

  return (
    <View
      style={[
        styles.wrap,
        sticky && styles.sticky,
        {
          paddingTop: insets.top,
          backgroundColor: colors.headerScrim,
          borderBottomColor: colors.outline,
        },
        style,
      ]}>
      <View style={styles.inner}>
        <View style={styles.side}>{leftSlot}</View>
        <View style={styles.center}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={[styles.side, styles.sideRight]}>{right ?? <View style={styles.sideSpacer} />}</View>
      </View>
    </View>
  );
}

/** 仅图标、无背景描边的顶栏操作（财务页 headerIconBtn） */
export function ScreenHeaderIconAction({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return <AppIconButton icon={icon} onPress={onPress} accessibilityLabel={accessibilityLabel} />;
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 60,
  },
  sticky: {},
  inner: {
    height: Layout.headerHeight,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: {
    minWidth: Layout.iconButtonSize,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  sideSpacer: {
    width: Layout.iconButtonSize,
    height: Layout.iconButtonSize,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
});
