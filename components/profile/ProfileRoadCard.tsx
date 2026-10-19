/**
 * 我的页「我的道路」摘要卡：只读，整卡进子页；空态诚实，派生失败显示 —。
 */
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { MotionPressable } from '@/components/ui/motion-pressable';
import {
  getMinTouchTarget,
  getTaskUiColors,
  Motion,
  Radius,
  Spacing,
} from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatLifeBetDerivedCaption } from '@/lib/life-road/life-road-labels';
import type { ProfileRoadBetSummary, ProfileRoadHub } from '@/lib/profile-hub-stats';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

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
    <MotionPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="我的道路，打开编辑"
      pressScale={Motion.pressScaleCard}
      pressOpacity={1}>
      {shell}
    </MotionPressable>
  );
}

function RoadHeader({
  actionLabel,
  actionColor,
}: {
  actionLabel?: string;
  actionColor: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <AppIcon name="explore" size={18} color={colors.primary} />
        <AppText variant="title" style={{ color: colors.text }}>
          我的道路
        </AppText>
      </View>
      {actionLabel ? (
        <View style={styles.headerAction}>
          <AppText variant="caption" chrome style={{ color: actionColor }}>
            {actionLabel}
          </AppText>
          <AppIcon name="chevron-right" size={16} color={actionColor} />
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
          <MotionPressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="重试加载道路"
            pressScale={1}
            pressOpacity={Motion.pressOpacityButton}
            style={[
              styles.inlineCta,
              {
                backgroundColor: taskUi.primaryWash,
                borderColor: taskUi.primaryWashBorder,
                minHeight: MIN_TOUCH,
              },
            ]}>
            <AppText variant="bodyStrong" chrome style={{ color: colors.primary }}>
              重试
            </AppText>
          </MotionPressable>
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
        <AppText variant="body" style={{ color: colors.textSecondary, lineHeight: 22 }}>
          还没有写下方向。用来看清未来几年押什么，不是用来排任务。
        </AppText>
        <MotionPressable
          onPress={onWriteDirection ?? onOpen}
          accessibilityRole="button"
          accessibilityLabel="写下总方向"
          pressScale={Motion.pressScaleButton}
          pressOpacity={Motion.pressOpacityButton}
          style={[
            styles.primaryCta,
            {
              backgroundColor: colors.primary,
              minHeight: MIN_TOUCH,
            },
          ]}>
          <AppText variant="bodyStrong" chrome style={{ color: colors.onPrimary }}>
            写下总方向
          </AppText>
        </MotionPressable>
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
        <AppText variant="caption" chrome style={{ color: colors.primary }} numberOfLines={1}>
          {yearTheme}
        </AppText>
      ) : null}

      <View style={[styles.section, { borderTopColor: colors.outline }]}>
        <AppText variant="label" chrome style={{ color: colors.textSecondary }}>
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
          <AppText variant="label" chrome style={{ color: colors.textSecondary }}>
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
    borderRadius: Radius.xl,
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
    gap: Spacing.md,
    flex: 1,
    minWidth: 0,
  },
  headerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  direction: {
    lineHeight: 22,
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
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  betCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
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
