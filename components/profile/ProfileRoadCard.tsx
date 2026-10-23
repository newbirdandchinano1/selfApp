/**
 * 我的页「我的道路」摘要卡：对齐设计稿 MY ROAD · 今年名额 · 赌注行。
 */
import { AppText } from '@/components/ui/app-text';
import { MotionPressable } from '@/components/ui/motion-pressable';
import {
  getMinTouchTarget,
  Motion,
  Radius,
  Spacing,
} from '@/constants/design-tokens';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { formatLifeBetDerivedCaption } from '@/lib/life-road/life-road-labels';
import {
  isActiveLifeBetStatus,
  LIFE_BET_YEAR_ACTIVE_LIMIT,
} from '@/lib/life-road/life-road-limits';
import type { ProfileRoadBetSummary, ProfileRoadHub } from '@/lib/profile-hub-stats';
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

const MIN_TOUCH = getMinTouchTarget(Platform.OS);

export type ProfileRoadCardProps = {
  road: ProfileRoadHub | null | undefined;
  onOpen: () => void;
  onRetry?: () => void;
  onWriteDirection?: () => void;
};

function statusDotColor(status: ProfileRoadBetSummary['status'], fold: ReturnType<typeof useFoldTheme>['fold']) {
  if (status === 'paused') return fold.amber;
  if (status === 'arrived') return fold.sage;
  return fold.sage;
}

function BetRow({
  bet,
  preferStatus,
}: {
  bet: ProfileRoadBetSummary;
  preferStatus?: boolean;
}) {
  const { fold } = useFoldTheme();
  const caption = formatLifeBetDerivedCaption(bet, {
    preferStatusLabel: preferStatus ? bet.status : undefined,
  });
  return (
    <View style={[styles.bet, { backgroundColor: fold.paper2, borderColor: fold.line }]}>
      <View style={[styles.betDot, { backgroundColor: statusDotColor(bet.status, fold) }]} />
      <Text style={[styles.betTitle, { color: fold.ink2 }]} numberOfLines={1}>
        {bet.title}
      </Text>
      <Text style={[styles.betMeta, { color: fold.faint }]} numberOfLines={1}>
        {caption}
      </Text>
    </View>
  );
}

export function ProfileRoadCard({
  road,
  onOpen,
  onRetry,
  onWriteDirection,
}: ProfileRoadCardProps) {
  const { fold } = useFoldTheme();

  if (road == null) return null;

  if (road.error) {
    return (
      <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
        <Text style={[styles.kicker, { color: fold.muted }]}>MY ROAD · 我的道路</Text>
        <AppText variant="body" style={{ color: fold.clay, marginTop: 6 }}>
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
              styles.retryBtn,
              {
                backgroundColor: fold.sage2,
                borderColor: fold.line,
                minHeight: MIN_TOUCH,
              },
            ]}>
            <Text style={{ color: fold.pine, fontWeight: '700', fontSize: 13 }}>重试</Text>
          </MotionPressable>
        ) : null}
      </View>
    );
  }

  const direction = road.direction;
  const yearTheme = road.yearTheme;
  const yearBets = road.yearBets;
  const fartherBets = road.fartherBets;
  const isEmpty = !direction && yearBets.length === 0 && fartherBets.length === 0;
  const yearUsed = yearBets.filter((b) => isActiveLifeBetStatus(b.status)).length;

  if (isEmpty) {
    return (
      <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
        <View style={styles.header}>
          <Text style={[styles.kicker, { color: fold.muted }]}>MY ROAD · 我的道路</Text>
          <View style={[styles.tag, { backgroundColor: fold.sage2 }]}>
            <Text style={[styles.tagText, { color: fold.pine2 }]}>
              今年 0 / {LIFE_BET_YEAR_ACTIVE_LIMIT}
            </Text>
          </View>
        </View>
        <Text style={[styles.emptyCopy, { color: fold.muted }]}>
          还没有写下方向。用来看清未来几年押什么，不是用来排任务。
        </Text>
        <MotionPressable
          onPress={onWriteDirection ?? onOpen}
          accessibilityRole="button"
          accessibilityLabel="写下总方向"
          pressScale={Motion.pressScaleButton}
          pressOpacity={Motion.pressOpacityButton}
          style={[
            styles.primaryCta,
            { backgroundColor: fold.pineButton, minHeight: MIN_TOUCH },
          ]}>
          <Text style={{ color: fold.onPineButton, fontWeight: '700', fontSize: 13 }}>写下总方向</Text>
        </MotionPressable>
      </View>
    );
  }

  const previewYear = yearBets.slice(0, 2);
  const fartherHint =
    fartherBets.length > 0
      ? `还有 ${Math.max(0, yearBets.length - previewYear.length + fartherBets.length)} 条 ›`
      : yearBets.length > previewYear.length
        ? `还有 ${yearBets.length - previewYear.length} 条 ›`
        : '查看全部 ›';

  return (
    <MotionPressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel="我的道路，打开编辑"
      pressScale={Motion.pressScaleCard}
      pressOpacity={1}
      style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
      <View style={styles.header}>
        <Text style={[styles.kicker, { color: fold.muted }]}>MY ROAD · 我的道路</Text>
        <View style={[styles.tag, { backgroundColor: fold.sage2 }]}>
          <Text style={[styles.tagText, { color: fold.pine2 }]}>
            今年 {yearUsed} / {LIFE_BET_YEAR_ACTIVE_LIMIT}
          </Text>
        </View>
      </View>

      {direction ? (
        <Text
          style={[styles.direction, { color: fold.pine, fontFamily: foldFonts.serif }]}
          numberOfLines={2}>
          {direction}
        </Text>
      ) : null}
      {yearTheme ? (
        <Text style={[styles.yearTheme, { color: fold.sage }]} numberOfLines={1}>
          {yearTheme}
        </Text>
      ) : null}

      {previewYear.length > 0 ? (
        <View style={styles.betList}>
          {previewYear.map((bet) => (
            <BetRow key={bet.id} bet={bet} />
          ))}
        </View>
      ) : (
        <Text style={[styles.emptyCopy, { color: fold.muted, marginTop: 6 }]}>今年还没有下注</Text>
      )}

      <View style={styles.footer}>
        <Text style={[styles.footerLeft, { color: fold.faint }]}>
          {fartherBets.length > 0 ? `更远 · ${fartherBets.length} 条` : '更远 · 暂无'}
        </Text>
        <Text style={[styles.footerRight, { color: fold.amber }]}>{fartherHint}</Text>
      </View>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    gap: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  tag: {
    height: 19,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  direction: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
    marginBottom: 2,
    fontWeight: '600',
  },
  yearTheme: {
    fontSize: 11,
    marginBottom: 4,
  },
  betList: {
    marginTop: 6,
    gap: 5,
  },
  bet: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  betDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  betTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '700',
  },
  betMeta: {
    fontSize: 10,
    maxWidth: '36%',
  },
  footer: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLeft: {
    fontSize: 11,
  },
  footerRight: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyCopy: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  primaryCta: {
    marginTop: 10,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['3xl'],
  },
  retryBtn: {
    marginTop: 10,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['3xl'],
  },
});
