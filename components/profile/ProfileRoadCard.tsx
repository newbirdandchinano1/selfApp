/**
 * 我的页「我的道路」摘要卡：只读，整卡进子页；空态诚实，派生失败显示 —。
 */
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import {
  getMinTouchTarget,
  getTaskUiColors,
  Radius,
  Spacing,
} from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatLifeBetDerivedCaption } from '@/lib/life-road/life-road-labels';
import type { ProfileRoadBetSummary, ProfileRoadHub } from '@/lib/profile-hub-stats';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

const MIN_TOUCH = getMinTouchTarget(Platform.OS);

export type ProfileRoadCardProps = {
  road: ProfileRoadHub | null | undefined;
  onOpen: () => void;
  onRetry?: () => void;
  /** 空态主 CTA：写下总方向 */
  onWriteDirection?: () => void;
};

function BetRow({
  bet,
  preferStatus,
  textColor,
  mutedColor,
  accent,
  emptyWindow,
}: {
  bet: ProfileRoadBetSummary;
  preferStatus?: boolean;
  textColor: string;
  mutedColor: string;
  accent: string;
  emptyWindow: boolean;
}) {
  const caption = formatLifeBetDerivedCaption(bet, {
    preferStatusLabel: preferStatus ? bet.status : undefined,
  });
  return (
    <View style={styles.betRow}>
      <View style={[styles.betDot, { backgroundColor: emptyWindow ? mutedColor : accent }]} />
      <View style={styles.betCopy}>
        <AppText variant="bodyStrong" style={{ color: textColor }} numberOfLines={1}>
          {bet.title}
        </AppText>
        <AppText variant="caption" chrome style={{ color: mutedColor }} numberOfLines={1}>
          {caption}
        </AppText>
      </View>
    </View>
  );
}

function CardChrome({
  children,
  onPress,
  pressable,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  pressable?: boolean;
}) {
  const { colors } = useAppTheme();
  const shell = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.outline,
        },
      ]}>
      {children}
    </View>
  );
  if (!pressable || !onPress) return shell;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="我的道路，打开编辑"
      style={({ pressed }) => [
        { opacity: pressed ? 0.94 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] },
      ]}>
      {shell}
    </Pressable>
  );
}

function RoadHeader({
  actionLabel,
  actionColor,
}: {
  actionLabel?: string;
  actionColor: string;
}) {
  const { colors, isDark } = useAppTheme();
  const taskUi = getTaskUiColors(isDark);
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: taskUi.primaryWash,
              borderColor: taskUi.primaryWashBorder,
            },
          ]}>
          <AppIcon name="explore" size={20} color={colors.primary} />
        </View>
        <AppText variant="title" style={{ color: colors.text, fontWeight: '700' }}>
          我的道路
        </AppText>
      </View>
      {actionLabel ? (
        <View style={styles.headerAction}>
          <AppText variant="caption" chrome style={{ color: actionColor }}>
            {actionLabel}
          </AppText>
          <AppIcon name="chevron-right" size={18} color={actionColor} />
        </View>
      ) : null}
    </View>
  );
}

export function ProfileRoadCard({
  road,
  onOpen,
  onRetry,
  onWriteDirection,
}: ProfileRoadCardProps) {
  const { colors, isDark } = useAppTheme();
  const taskUi = getTaskUiColors(isDark);

  if (road == null) {
    return null;
  }

  if (road.error) {
    return (
      <CardChrome>
        <RoadHeader actionColor={colors.primary} />
        <AppText variant="body" style={{ color: colors.danger }}>
          {road.error}
        </AppText>
        {onRetry ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="重试加载道路"
            style={({ pressed }) => [
              styles.inlineCta,
              {
                backgroundColor: taskUi.primaryWash,
                borderColor: taskUi.primaryWashBorder,
                opacity: pressed ? 0.88 : 1,
                minHeight: MIN_TOUCH,
              },
            ]}>
            <AppText variant="bodyStrong" chrome style={{ color: colors.primary }}>
              重试
            </AppText>
          </Pressable>
        ) : null}
      </CardChrome>
    );
  }

  const direction = road.direction;
  const yearTheme = road.yearTheme;
  const yearBets = road.yearBets;
  const fartherBets = road.fartherBets;
  const isEmpty = !direction && yearBets.length === 0 && fartherBets.length === 0;

  if (isEmpty) {
    return (
      <CardChrome>
        <RoadHeader actionColor={colors.primary} />
        <View
          style={[
            styles.emptyPanel,
            { backgroundColor: taskUi.primaryWash, borderColor: taskUi.primaryWashBorder },
          ]}>
          <AppText variant="body" style={{ color: colors.textSecondary, lineHeight: 22 }}>
            还没有写下方向。用来看清未来几年押什么，不是用来排任务。
          </AppText>
        </View>
        <Pressable
          onPress={onWriteDirection ?? onOpen}
          accessibilityRole="button"
          accessibilityLabel="写下总方向"
          style={({ pressed }) => [
            styles.primaryCta,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.9 : 1,
              minHeight: MIN_TOUCH,
            },
          ]}>
          <AppText variant="bodyStrong" chrome style={{ color: colors.onPrimary }}>
            写下总方向
          </AppText>
        </Pressable>
      </CardChrome>
    );
  }

  return (
    <CardChrome pressable onPress={onOpen}>
      <RoadHeader actionLabel="编辑" actionColor={colors.primary} />

      {direction ? (
        <AppText
          variant="body"
          style={[styles.direction, { color: colors.text }]}
          numberOfLines={2}>
          {direction}
        </AppText>
      ) : null}
      {yearTheme ? (
        <View
          style={[
            styles.themeChip,
            { backgroundColor: taskUi.primaryWash, borderColor: taskUi.primaryWashBorder },
          ]}>
          <AppText variant="caption" chrome style={{ color: colors.primary }} numberOfLines={1}>
            {yearTheme}
          </AppText>
        </View>
      ) : null}

      <View style={[styles.section, { borderTopColor: colors.outline }]}>
        <AppText variant="label" chrome style={{ color: colors.textSecondary, letterSpacing: 0.4 }}>
          今年
        </AppText>
        {yearBets.length === 0 ? (
          <AppText variant="body" style={{ color: colors.textSecondary }}>
            今年还没有下注
          </AppText>
        ) : (
          <View style={styles.betList}>
            {yearBets.map((bet) => (
              <BetRow
                key={bet.id}
                bet={bet}
                textColor={colors.text}
                mutedColor={colors.textSecondary}
                accent={colors.secondary}
                emptyWindow={bet.isEmptyWindow}
              />
            ))}
          </View>
        )}
      </View>

      {fartherBets.length > 0 ? (
        <View style={[styles.section, { borderTopColor: colors.outline }]}>
          <AppText variant="label" chrome style={{ color: colors.textSecondary, letterSpacing: 0.4 }}>
            更远
          </AppText>
          <View style={styles.betList}>
            {fartherBets.map((bet) => (
              <BetRow
                key={bet.id}
                bet={bet}
                preferStatus
                textColor={colors.text}
                mutedColor={colors.textSecondary}
                accent={colors.primary}
                emptyWindow={false}
              />
            ))}
          </View>
        </View>
      ) : null}
    </CardChrome>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing['3xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    flex: 1,
    minWidth: 0,
  },
  headerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  direction: {
    lineHeight: 24,
    fontWeight: '600',
  },
  themeChip: {
    alignSelf: 'flex-start',
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  section: {
    gap: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing['3xl'],
  },
  betList: {
    gap: Spacing.xl,
  },
  betRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.lg,
  },
  betDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 7,
  },
  betCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  emptyPanel: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['3xl'],
  },
  primaryCta: {
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['3xl'],
  },
  inlineCta: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['3xl'],
  },
});
