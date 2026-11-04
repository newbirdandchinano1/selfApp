/**
 * 我的页「我的道路」摘要卡：对齐 `我的道路-UI重构.html` 深色 content / 浅色 empty·error。
 */
import { useWardrobeFonts } from '@/components/wardrobe/use-wardrobe-fonts';
import { MotionPressable } from '@/components/ui/motion-pressable';
import { getMinTouchTarget, Motion } from '@/constants/design-tokens';
import {
  lifeRoadType,
  useLifeRoadTheme,
} from '@/constants/life-road-theme';
import type { ProfileRoadHub } from '@/lib/profile-hub-stats';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const MIN_TOUCH = getMinTouchTarget(Platform.OS);

export type ProfileRoadCardProps = {
  road: ProfileRoadHub | null | undefined;
  /** hub 仍在首屏加载时显示骨架 */
  loading?: boolean;
  onOpen: () => void;
  onRetry?: () => void;
  onWriteDirection?: () => void;
};

function TreeIcon({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3v18M12 7c-2.8 0-5 1.7-5 4.2 0 2.3 2 4 5 4s5-1.7 5-4C17 8.7 14.8 7 12 7zM12 15c-2.1 0-3.8 1.3-3.8 3.2 0 1.8 1.6 2.8 3.8 2.8s3.8-1 3.8-2.8C15.8 16.3 14.1 15 12 15z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ArrowIcon({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12h14M14 7l5 5-5 5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function RefreshIcon({ color }: { color: string }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 11a8 8 0 1 0-2.3 5.6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M20 5v6h-6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function EmptyPathVisual({ line, amber }: { line: string; amber: string }) {
  return (
    <View style={styles.emptyVisual} pointerEvents="none">
      <Svg width="100%" height={52} viewBox="0 0 180 52">
        <Path
          d="M4 38C34 38 36 14 66 14S106 40 132 40 160 22 178 22"
          fill="none"
          stroke={line}
          strokeWidth={1.2}
          strokeDasharray="4 5"
          strokeLinecap="round"
        />
        <Circle cx={66} cy={14} r={2.6} fill={amber} />
      </Svg>
    </View>
  );
}

function RoadPathDecor({ stroke }: { stroke: string }) {
  return (
    <View style={styles.pathDecor} pointerEvents="none">
      <Svg width={180} height={112} viewBox="0 0 180 112">
        <Path
          d="M4 104C48 100 34 62 72 54S118 44 138 16 162 4 176 4"
          fill="none"
          stroke={stroke}
          strokeWidth={1}
          strokeDasharray="3 6"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

function ProgressBar({
  ratio,
  track,
  fillFrom,
  fillTo,
}: {
  ratio: number;
  track: string;
  fillFrom: string;
  fillTo: string;
}) {
  const widthAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: Math.max(0, Math.min(1, ratio)),
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [ratio, widthAnim]);

  const w = widthAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.progressTrack, { backgroundColor: track }]}>
      <Animated.View
        style={[
          styles.progressFill,
          {
            width: w,
            backgroundColor: fillTo,
            // 近似 sage→amber：用琥珀主色，左侧叠一点 sage 感靠 track 衬托
            borderColor: fillFrom,
          },
        ]}
      />
    </View>
  );
}

export function ProfileRoadCard({
  road,
  loading = false,
  onOpen,
  onRetry,
  onWriteDirection,
}: ProfileRoadCardProps) {
  useWardrobeFonts();
  const { lr } = useLifeRoadTheme();

  if (loading || road == null) {
    return (
      <View
        style={[
          styles.lightCard,
          { backgroundColor: lr.card2, borderColor: lr.line },
        ]}
        accessibilityState={{ busy: true }}>
        <View style={styles.rcTop}>
          <Text style={[lifeRoadType.kickerTiny, { color: lr.muted }]}>
            MY ROAD · 我的道路
          </Text>
          <View
            style={[
              styles.glance,
              { borderColor: lr.line, backgroundColor: 'rgba(255,255,255,0.4)' },
            ]}>
            <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>正在同步</Text>
          </View>
        </View>
        <View style={styles.skeleton}>
          <View style={[styles.skTall, { backgroundColor: lr.line3 }]} />
          <View style={[styles.skMid, { backgroundColor: lr.line3 }]} />
          <View style={[styles.skShort, { backgroundColor: lr.line3 }]} />
        </View>
      </View>
    );
  }

  if (road.error) {
    return (
      <View
        style={[
          styles.lightCard,
          { backgroundColor: lr.card2, borderColor: lr.line },
        ]}>
        <View style={styles.rcTop}>
          <Text style={[lifeRoadType.kickerTiny, { color: lr.muted }]}>
            MY ROAD · 我的道路
          </Text>
          <View
            style={[
              styles.glance,
              { borderColor: lr.line, backgroundColor: 'rgba(255,255,255,0.4)' },
            ]}>
            <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>本地缓存</Text>
          </View>
        </View>
        <View
          style={[
            styles.errIco,
            { backgroundColor: lr.clay2, borderColor: 'rgba(191,111,82,0.2)' },
          ]}>
          <Text style={{ color: lr.clay, fontSize: 18, fontWeight: '700' }}>!</Text>
        </View>
        <Text style={[lifeRoadType.serifEmpty, { color: lr.ink }]}>
          道路暂时没有加载出来
        </Text>
        <Text style={[styles.lightCopy, { color: lr.muted }]}>
          {road.error || '网络抖动，或云端还没准备好。可先重试，或稍后再看。'}
        </Text>
        <View style={styles.errActions}>
          {onRetry ? (
            <MotionPressable
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="重试加载道路"
              pressScale={Motion.pressScaleButton}
              pressOpacity={Motion.pressOpacityButton}
              style={[
                styles.retryBtn,
                {
                  borderColor: 'rgba(33,69,58,0.18)',
                  backgroundColor: 'rgba(255,255,255,0.55)',
                  minHeight: MIN_TOUCH,
                },
              ]}>
              <RefreshIcon color={lr.pine} />
              <Text style={[lifeRoadType.cta, { color: lr.pine }]}>重试</Text>
            </MotionPressable>
          ) : null}
          <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>ERROR · E_RETRY</Text>
        </View>
      </View>
    );
  }

  const isEmpty = !road.direction && !road.yearFocus;

  if (isEmpty) {
    return (
      <View
        style={[
          styles.lightCard,
          { backgroundColor: lr.card2, borderColor: lr.line },
        ]}>
        <View style={styles.rcTop}>
          <Text style={[lifeRoadType.kickerTiny, { color: lr.muted }]}>
            MY ROAD · 我的道路
          </Text>
          <View
            style={[
              styles.glance,
              { borderColor: lr.line, backgroundColor: 'rgba(255,255,255,0.4)' },
            ]}>
            <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>尚未写下</Text>
          </View>
        </View>
        <EmptyPathVisual line={lr.line2} amber={lr.amber} />
        <Text style={[lifeRoadType.serifEmpty, { color: lr.ink, marginTop: 2 }]}>
          先写下你想去的方向
        </Text>
        <Text style={[styles.lightCopy, { color: lr.muted }]}>
          总方向是一句长期主义；年、季、月会把它拆成可走的步子。全空时，这里会安静地等你。
        </Text>
        <MotionPressable
          onPress={onWriteDirection ?? onOpen}
          accessibilityRole="button"
          accessibilityLabel="写下总方向"
          pressScale={Motion.pressScaleButton}
          pressOpacity={Motion.pressOpacityButton}
          style={[
            styles.cta,
            { backgroundColor: lr.pine, minHeight: MIN_TOUCH },
          ]}>
          <Text style={[lifeRoadType.cta, { color: lr.onRoad }]}>写下总方向</Text>
          <ArrowIcon color={lr.onRoad} />
        </MotionPressable>
      </View>
    );
  }

  const percent =
    road.focusTotal > 0
      ? Math.round((road.focusDone / Math.max(1, road.focusTotal)) * 100)
      : 0;

  return (
    <MotionPressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel="我的道路，打开导图"
      pressScale={Motion.pressScaleCard}
      pressOpacity={1}
      style={[styles.contentCard, { backgroundColor: lr.roadDeep }]}>
      <View style={styles.orbit} pointerEvents="none" />
      <RoadPathDecor stroke="rgba(230,184,120,0.32)" />

      <View style={styles.rcTop}>
        <View style={styles.kickerRow}>
          <TreeIcon color={lr.onRoadSoft} />
          <Text style={[lifeRoadType.kickerTiny, { color: lr.onRoadSoft }]}>
            MY ROAD · 我的道路
          </Text>
        </View>
        <View
          style={[
            styles.glance,
            {
              borderColor: 'rgba(245,240,227,0.12)',
              backgroundColor: 'rgba(245,240,227,0.06)',
            },
          ]}>
          <Text style={[lifeRoadType.monoTiny, { color: lr.onRoadSoft }]}>
            {road.glance ?? '打开导图'}
          </Text>
        </View>
      </View>

      {road.direction ? (
        <Text style={[lifeRoadType.serifDir, styles.rcDir, { color: lr.onRoadDir }]} numberOfLines={2}>
          {road.direction}
        </Text>
      ) : (
        <Text style={[lifeRoadType.serifDir, styles.rcDir, { color: lr.onRoadSoft }]} numberOfLines={2}>
          总方向未写
        </Text>
      )}

      <View
        style={[
          styles.focusBox,
          {
            borderColor: 'rgba(245,240,227,0.09)',
            backgroundColor: 'rgba(245,240,227,0.065)',
          },
        ]}>
        <View style={styles.focusHead}>
          <Text style={[lifeRoadType.monoTiny, { color: 'rgba(245,240,227,0.42)' }]}>
            今年焦点{' '}
            <Text style={{ color: lr.amber3, fontWeight: '700' }}>
              {road.focusTag ?? '—'}
            </Text>
          </Text>
          <View
            style={[
              styles.focusPill,
              {
                borderColor: 'rgba(230,184,120,0.18)',
                backgroundColor: 'rgba(230,184,120,0.07)',
              },
            ]}>
            <Text style={{ fontSize: 9, color: 'rgba(230,184,120,0.8)', letterSpacing: 0.3 }}>
              月 → 季 → 年
            </Text>
          </View>
        </View>
        <Text
          style={[styles.focusTitle, { color: lr.onRoadFocus }]}
          numberOfLines={1}>
          {road.yearFocus ?? '今年还没有拆到月'}
        </Text>
        {road.focusTotal > 0 ? (
          <ProgressBar
            ratio={percent / 100}
            track="rgba(245,240,227,0.1)"
            fillFrom={lr.sage3}
            fillTo={lr.amber3}
          />
        ) : (
          <View style={[styles.progressTrack, { backgroundColor: 'rgba(245,240,227,0.1)' }]}>
            <View style={[styles.progressFill, { width: '28%', backgroundColor: lr.amber3 }]} />
          </View>
        )}
      </View>

      <View style={[styles.rcFoot, { borderTopColor: 'rgba(245,240,227,0.1)' }]}>
        <Text style={{ fontSize: 11, color: lr.onRoadMute }}>
          {road.aboveYearCount > 0
            ? `更远层 · ${road.aboveYearCount} 条`
            : '更远层 · 暂无'}
        </Text>
        <View style={styles.openRow}>
          <Text style={{ fontSize: 11, color: lr.openAccent, letterSpacing: 0.3 }}>
            打开导图
          </Text>
          <ArrowIcon color={lr.openAccent} />
        </View>
      </View>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  lightCard: {
    marginTop: 2,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 17,
    paddingBottom: 15,
    overflow: 'hidden',
  },
  contentCard: {
    marginTop: 2,
    borderRadius: 26,
    paddingHorizontal: 17,
    paddingTop: 16,
    paddingBottom: 14,
    overflow: 'hidden',
  },
  orbit: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    right: -70,
    top: -98,
    borderWidth: 1,
    borderColor: 'rgba(245,240,227,0.09)',
  },
  pathDecor: {
    position: 'absolute',
    right: -16,
    bottom: -4,
    width: 180,
    height: 112,
    opacity: 0.5,
  },
  rcTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    zIndex: 2,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  glance: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rcDir: {
    marginTop: 12,
    maxWidth: 285,
    zIndex: 2,
  },
  focusBox: {
    marginTop: 13,
    paddingHorizontal: 11,
    paddingTop: 10,
    paddingBottom: 9,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  focusHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  focusPill: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  focusTitle: {
    marginTop: 5,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  progressTrack: {
    marginTop: 7,
    height: 2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  rcFoot: {
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    zIndex: 2,
  },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  emptyVisual: {
    height: 52,
    marginTop: 7,
    marginBottom: 4,
  },
  lightCopy: {
    fontSize: 12,
    lineHeight: 20,
    marginTop: 5,
    marginBottom: 13,
    maxWidth: 280,
  },
  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  errIco: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 4,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  skeleton: {
    marginTop: 12,
    gap: 6,
  },
  skTall: {
    height: 24,
    borderRadius: 12,
    width: '100%',
  },
  skMid: {
    height: 8,
    borderRadius: 999,
    width: '76%',
  },
  skShort: {
    height: 8,
    borderRadius: 999,
    width: '54%',
  },
});
