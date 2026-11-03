/**
 * 我的页「我的道路」摘要卡：总方向 + 今年焦点；完整导图在子页。
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
import type { ProfileRoadHub } from '@/lib/profile-hub-stats';
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

const MIN_TOUCH = getMinTouchTarget(Platform.OS);

export type ProfileRoadCardProps = {
  road: ProfileRoadHub | null | undefined;
  onOpen: () => void;
  onRetry?: () => void;
  onWriteDirection?: () => void;
};

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

  const isEmpty = !road.direction && !road.yearFocus;

  if (isEmpty) {
    return (
      <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
        <View style={styles.header}>
          <Text style={[styles.kicker, { color: fold.muted }]}>MY ROAD · 我的道路</Text>
          <View style={[styles.tag, { backgroundColor: fold.sage2 }]}>
            <Text style={[styles.tagText, { color: fold.pine2 }]}>年 · 季 · 月</Text>
          </View>
        </View>
        <Text style={[styles.emptyCopy, { color: fold.muted }]}>
          还没有写下方向。用来拆清年季月目标，不是用来排任务。
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
          <Text style={{ color: fold.onPineButton, fontWeight: '700', fontSize: 13 }}>
            写下总方向
          </Text>
        </MotionPressable>
      </View>
    );
  }

  return (
    <MotionPressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel="我的道路，打开导图"
      pressScale={Motion.pressScaleCard}
      pressOpacity={1}
      style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
      <View style={styles.header}>
        <Text style={[styles.kicker, { color: fold.muted }]}>MY ROAD · 我的道路</Text>
        <View style={[styles.tag, { backgroundColor: fold.sage2 }]}>
          <Text style={[styles.tagText, { color: fold.pine2 }]}>导图 ›</Text>
        </View>
      </View>

      {road.direction ? (
        <Text
          style={[styles.direction, { color: fold.pine, fontFamily: foldFonts.serif }]}
          numberOfLines={2}>
          {road.direction}
        </Text>
      ) : (
        <Text style={[styles.emptyCopy, { color: fold.muted, marginTop: 6 }]}>总方向未写</Text>
      )}

      {road.yearFocus ? (
        <View style={[styles.focusRow, { backgroundColor: fold.paper2, borderColor: fold.line }]}>
          <Text style={[styles.focusLab, { color: fold.faint }]}>今年焦点</Text>
          <Text style={[styles.focusTxt, { color: fold.ink2 }]} numberOfLines={1}>
            {road.yearFocus}
          </Text>
        </View>
      ) : (
        <Text style={[styles.emptyCopy, { color: fold.muted, marginTop: 6 }]}>
          今年还没有拆到月
        </Text>
      )}

      <View style={styles.footer}>
        <Text style={[styles.footerLeft, { color: fold.faint }]}>
          {road.aboveYearCount > 0
            ? `更远层 · ${road.aboveYearCount} 条`
            : '更远层 · 暂无'}
        </Text>
        <Text style={[styles.footerRight, { color: fold.amber }]}>打开导图 ›</Text>
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
  focusRow: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 7,
    paddingHorizontal: 8,
    gap: 2,
  },
  focusLab: {
    fontSize: 10,
    fontWeight: '700',
  },
  focusTxt: {
    fontSize: 13,
    fontWeight: '600',
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
