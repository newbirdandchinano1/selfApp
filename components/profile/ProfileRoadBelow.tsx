/**
 * 摘要卡下方：三项统计 + 「今年的节奏」月轨。
 * 对齐 `我的道路-UI重构.html` .stat-strip / .yearline。
 */
import { FoldCountUpText } from '@/components/review/fold-motion';
import {
  lifeRoadFonts,
  lifeRoadType,
  useLifeRoadTheme,
  type LifeRoadPalette,
} from '@/constants/life-road-theme';
import { currentCalendarYear } from '@/lib/life-road/life-road-limits';
import type { ProfileRoadHub } from '@/lib/profile-hub-stats';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function NowDot({ lr }: { lr: LifeRoadPalette }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.35],
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.08],
  });

  return (
    <View style={styles.nowDotWrap}>
      <Animated.View
        style={[
          styles.nowRing,
          {
            backgroundColor: 'rgba(211,154,85,0.14)',
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      <View style={[styles.nowDot, { backgroundColor: lr.amber, borderColor: lr.amber }]} />
    </View>
  );
}

export type ProfileRoadBelowProps = {
  road: ProfileRoadHub | null | undefined;
  animate?: boolean;
};

export function ProfileRoadBelow({ road, animate = true }: ProfileRoadBelowProps) {
  const { lr } = useLifeRoadTheme();
  const year = currentCalendarYear();
  const nowMonth = new Date().getMonth() + 1;
  const monthsWithContent = new Set(road?.monthsWithContent ?? []);

  const yearNodeCount = road?.error ? 0 : (road?.yearNodeCount ?? 0);
  const arrivedCount = road?.error ? 0 : (road?.arrivedCount ?? 0);
  const farCount = road?.error ? 0 : (road?.aboveYearCount ?? 0);

  const pastCount = Math.max(0, nowMonth - 1);
  const remainCount = Math.max(0, 12 - nowMonth);

  const stats = [
    { label: '今年节点', value: yearNodeCount, delay: 40 },
    { label: '已抵达', value: arrivedCount, delay: 90 },
    { label: '更远层', value: farCount, delay: 140 },
  ] as const;

  return (
    <View>
      <View style={[styles.statStrip, { borderTopColor: lr.line3, borderBottomColor: lr.line3 }]}>
        {stats.map((s, i) => (
          <View key={s.label} style={styles.stat}>
            {i > 0 ? (
              <View style={[styles.statDivider, { backgroundColor: lr.line3 }]} />
            ) : null}
            <FoldCountUpText
              value={s.value}
              animate={animate && !road?.error}
              duration={700}
              delayMs={s.delay}
              textStyle={[
                styles.statNum,
                { color: lr.pine, fontFamily: lifeRoadFonts.monoBold },
              ]}
            />
            <Text style={[styles.statLabel, { color: lr.muted }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      <View
        style={[
          styles.yearline,
          {
            borderColor: lr.line,
            backgroundColor: 'rgba(252,249,241,0.62)',
          },
        ]}>
        <View style={styles.ylHead}>
          <Text style={[styles.ylHeadTitle, { color: lr.ink2 }]}>今年的节奏</Text>
          <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>
            {year} · 12 MONTHS
          </Text>
        </View>

        <View style={styles.ylTrack}>
          <View style={[styles.ylRail, { backgroundColor: lr.line2 }]} />
          {Array.from({ length: 12 }, (_, idx) => {
            const month = idx + 1;
            const isNow = month === nowMonth;
            const isPast = month < nowMonth;
            const hasContent = monthsWithContent.has(month);
            return (
              <View key={month} style={styles.ylMonth}>
                {isNow ? (
                  <NowDot lr={lr} />
                ) : (
                  <View
                    style={[
                      styles.ylDot,
                      isPast || hasContent
                        ? { backgroundColor: lr.sage3, borderColor: lr.sage3 }
                        : { backgroundColor: lr.card, borderColor: lr.line2 },
                    ]}
                  />
                )}
                <Text
                  style={[
                    lifeRoadType.monoTiny,
                    {
                      color: isNow ? lr.clay : lr.muted2,
                      fontWeight: isNow ? '700' : '400',
                      marginTop: 4,
                    },
                  ]}>
                  {pad2(month)}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.ylFoot}>
          <Text style={[styles.ylFootTxt, { color: lr.muted }]}>
            已走过 <Text style={{ color: lr.ink2, fontWeight: '600' }}>{pastCount}</Text> 个月
            · 还有 {remainCount} 个月
          </Text>
          <Text style={[styles.ylFootTxt, { color: lr.muted }]}>{nowMonth} 月 · 当前</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statStrip: {
    marginTop: 13,
    paddingVertical: 11,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
    position: 'relative',
  },
  statDivider: {
    position: 'absolute',
    left: 0,
    top: '14%',
    height: '72%',
    width: StyleSheet.hairlineWidth,
  },
  statNum: {
    fontSize: 20,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  statLabel: {
    marginTop: 5,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  yearline: {
    marginTop: 13,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  ylHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  ylHeadTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  ylTrack: {
    marginTop: 13,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
  },
  ylRail: {
    position: 'absolute',
    left: 3,
    right: 3,
    top: 4,
    height: StyleSheet.hairlineWidth,
  },
  ylMonth: {
    zIndex: 1,
    alignItems: 'center',
    minWidth: 18,
  },
  ylDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nowDotWrap: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nowRing: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  ylFoot: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  ylFootTxt: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
