import { addDaysToYmd, parseYmd } from '@/lib/date';
import { isHabitScheduledOnLogicalYmd } from '@/lib/habit-schedule';
import { isHabitDayGoalMet } from '@/lib/repositories/habits/habit-goal';
import type { HabitKind } from '@/lib/repositories/habits/habit-kind';
import { isHabitSkippedOn } from '@/lib/repositories/habits/habit-skip';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const WEEKDAY_CHAR = ['日', '一', '二', '三', '四', '五', '六'] as const;

export type HabitRecentSevenDay = {
  ymd: string;
  /** 无障碍用：日一二三四五六 */
  label: string;
  done: boolean;
  isToday: boolean;
  /** 非循环打卡日 / 跳过 → 显示 × */
  idle: boolean;
};

export function buildHabitRecentSevenDays(params: {
  logicalTodayYmd: string;
  kind: HabitKind;
  dailyGoal: number | null;
  extraData: string | null;
  checkIns: Record<string, number>;
}): HabitRecentSevenDay[] {
  const { logicalTodayYmd, kind, dailyGoal, extraData, checkIns } = params;
  const out: HabitRecentSevenDay[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const ymd = addDaysToYmd(logicalTodayYmd, -i);
    const d = parseYmd(ymd);
    const label = WEEKDAY_CHAR[d?.getDay() ?? 0] ?? '·';
    const isToday = ymd === logicalTodayYmd;
    const scheduled = isHabitScheduledOnLogicalYmd(extraData, ymd);
    const skipped = isHabitSkippedOn(extraData, ymd);
    if (!scheduled || skipped) {
      out.push({ ymd, label, done: false, isToday, idle: true });
      continue;
    }
    const hasDayRecord = Object.prototype.hasOwnProperty.call(checkIns, ymd);
    const count = checkIns[ymd] ?? 0;
    const done = isHabitDayGoalMet({
      kind,
      todayCount: count,
      dailyGoal,
      hasDayRecord: kind === 'break' ? hasDayRecord : undefined,
      ymd,
      logicalTodayYmd,
    });
    out.push({ ymd, label, done, isToday, idle: false });
  }
  return out;
}

/** 打卡乐观更新后，只改今天这一格 */
export function patchHabitRecentSevenToday(
  days: HabitRecentSevenDay[] | undefined,
  opts: { done: boolean; idle?: boolean },
): HabitRecentSevenDay[] | undefined {
  if (!days?.length) return days;
  return days.map((d) =>
    d.isToday ? { ...d, done: opts.done, idle: opts.idle ?? d.idle } : d,
  );
}

type Props = {
  days: HabitRecentSevenDay[];
  /** 已完成：小黄点 */
  activeColor: string;
  /** 应打未打：浅灰空心点 */
  missColor: string;
  /** 无打卡日：× */
  offColor: string;
};

/**
 * 近七天完成进度：左旧右新（today-6 … today）。
 * 完成 → 小黄点；未完成 → 浅灰点；非打卡日 → ×。
 */
export function HabitRecentSevenStrip({ days, activeColor, missColor, offColor }: Props) {
  if (!days.length) return null;
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel="近七天完成进度">
      {days.map((d) => {
        if (d.idle) {
          return (
            <View
              key={d.ymd}
              style={styles.slot}
              accessibilityLabel={`${d.label}无打卡`}>
              <Text style={[styles.offMark, { color: offColor }]} allowFontScaling={false}>
                ×
              </Text>
            </View>
          );
        }
        const on = d.done;
        return (
          <View
            key={d.ymd}
            style={styles.slot}
            accessibilityLabel={`${d.label}${on ? '已完成' : '未完成'}`}>
            <View
              style={[
                styles.dot,
                on
                  ? { backgroundColor: activeColor }
                  : { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: missColor },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  slot: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  offMark: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 12,
    includeFontPadding: false,
  },
});
