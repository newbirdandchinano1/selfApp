import { AppCard } from '@/components/ui/app-card';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export function ReviewSectionCard({
  children,
  variant = 'default',
  style,
  padded = true,
  onPress,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'muted' | 'accent';
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
}) {
  const { shadows } = useAppTheme();
  return (
    <AppCard
      variant={variant}
      padded={padded}
      onPress={onPress}
      style={[shadows.card, styles.sectionCard, style]}>
      {children}
    </AppCard>
  );
}

export function ReviewNoticeBanner({
  icon,
  message,
  tone = 'info',
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  message: string;
  tone?: 'info' | 'muted';
}) {
  const { colors } = useAppTheme();
  const iconColor = tone === 'info' ? colors.primary : colors.textMuted;
  const textColor = tone === 'info' ? colors.text : colors.textMuted;

  return (
    <ReviewSectionCard variant="muted" style={styles.noticeCard}>
      <View style={styles.noticeRow}>
        <MaterialIcons name={icon} size={22} color={iconColor} />
        <Text style={[Typography.body, { color: textColor, flex: 1, lineHeight: 21 }]}>{message}</Text>
      </View>
    </ReviewSectionCard>
  );
}

export function ReviewEmptyState({
  icon = 'dashboard-customize',
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <ReviewSectionCard variant="muted" style={styles.emptyCard}>
      <View style={[styles.emptyIconWrap, { backgroundColor: colors.primaryMuted }]}>
        <MaterialIcons name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={[Typography.title, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {subtitle ? (
        <Text style={[Typography.body, { color: colors.textMuted, textAlign: 'center', lineHeight: 21 }]}>
          {subtitle}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <ReviewPrimaryButton label={actionLabel} onPress={onAction} style={styles.emptyAction} />
      ) : null}
    </ReviewSectionCard>
  );
}

export function ReviewPrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.primaryBtn,
        {
          backgroundColor: colors.primary,
          opacity: disabled || loading ? 0.45 : pressed ? 0.88 : 1,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.onPrimary} size="small" />
      ) : (
        <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function ReviewPageContent({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.pageContent, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  sectionCard: {
    marginHorizontal: Layout.pagePaddingX,
  },
  noticeCard: {
    paddingVertical: Spacing['3xl'],
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.lg,
  },
  emptyCard: {
    alignItems: 'center',
    gap: Spacing.lg,
    paddingVertical: Spacing['5xl'],
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  emptyAction: {
    marginTop: Spacing.md,
    alignSelf: 'stretch',
  },
  primaryBtn: {
    borderRadius: Radius.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Layout.pagePaddingX,
    paddingHorizontal: Spacing['3xl'],
    ...Shadows.card,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  pageContent: {
    width: '100%',
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
  },
});
