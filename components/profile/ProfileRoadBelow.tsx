/**
 * 摘要卡下方：12 月节律条（对齐 HTML 奶油松墨 `renderProfile` rhythm strip）。
 */
import { MotionPressable } from '@/components/ui/motion-pressable';
import { Motion } from '@/constants/design-tokens';
import { lifeRoadType } from '@/constants/life-road-theme';
import { useWeatherAwareLifeRoadTheme } from '@/hooks/use-weather-aware-fold-theme';
import { currentCalendarYear } from '@/lib/life-road/life-road-limits';
import type { LifeRoadNodeStatus } from '@/lib/life-road/life-road-node-model';
import type { ProfileRoadHub } from '@/lib/profile-hub-stats';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type ProfileRoadBelowProps = {
  road: ProfileRoadHub | null | undefined;
  /** 保留兼容；节律条无数字动画 */
  animate?: boolean;
  /** 点击整条 → 道路全景（对齐原型 nav('panorama')） */
  onOpen?: () => void;
};

function barColors(
  status: LifeRoadNodeStatus | undefined,
  isNow: boolean,
  paper2: string,
  muted: string,
  ink: string,
): { bg: string; fg: string; weight: '400' | '700' } {
  if (!status) {
    return { bg: paper2, fg: muted, weight: '400' };
  }
  if (status === 'arrived') {
    return { bg: '#1E3932', fg: '#A9C7B9', weight: '400' };
  }
  if (status === 'paused') {
    return { bg: 'rgba(224,179,90,0.35)', fg: ink, weight: '400' };
  }
  if (status === 'on_track') {
    if (isNow) {
      return { bg: '#E0B35A', fg: '#121A16', weight: '700' };
    }
    return { bg: '#5F8A6E', fg: '#FAF8F0', weight: '400' };
  }
  // dropped / other：弱化
  return { bg: paper2, fg: muted, weight: '400' };
}

export function ProfileRoadBelow({ road, onOpen }: ProfileRoadBelowProps) {
  const { lr } = useWeatherAwareLifeRoadTheme();
  const year = currentCalendarYear();
  const nowMonth = new Date().getMonth() + 1;
  const statuses = road?.monthStatuses ?? {};
  const monthsWithContent = new Set(road?.monthsWithContent ?? []);

  const body = (
    <>
      <View style={styles.head}>
        <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
          {year} · 月轨节律
        </Text>
        <Text style={{ fontSize: 11, fontWeight: '500', color: lr.ink }}>全景 →</Text>
      </View>

      <View style={styles.bars}>
        {Array.from({ length: 12 }, (_, idx) => {
          const month = idx + 1;
          const isNow = month === nowMonth;
          const status = statuses[month];
          // 有内容但无 status（仅挂项目）按 on_track 弱亮
          const effective: LifeRoadNodeStatus | undefined =
            status ?? (monthsWithContent.has(month) ? 'on_track' : undefined);
          const { bg, fg, weight } = barColors(
            effective,
            isNow,
            lr.paper2,
            lr.muted,
            lr.ink,
          );
          return (
            <View key={month} style={[styles.bar, { backgroundColor: bg }]}>
              <Text style={{ fontSize: 10, color: fg, fontWeight: weight }}>{month}</Text>
            </View>
          );
        })}
      </View>
    </>
  );

  const shellStyle = [
    styles.strip,
    { borderColor: lr.line, backgroundColor: lr.card },
  ];

  if (onOpen) {
    return (
      <MotionPressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${year} 月轨节律，打开道路全景`}
        pressScale={Motion.pressScaleCard}
        pressOpacity={1}
        style={shellStyle}>
        {body}
      </MotionPressable>
    );
  }

  return <View style={shellStyle}>{body}</View>;
}

const styles = StyleSheet.create({
  strip: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  bars: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bar: {
    flex: 1,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
