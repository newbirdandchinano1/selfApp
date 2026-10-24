/**
 * 任务主屏顶周条 — 对齐设计稿 `.weekwrap` / `.wday`
 * 周一～日 · 今日松墨绿高亮 · 圆点：青蛙 / 习惯 / 待办
 */
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { fetchTasksCalendarMonth } from '@/lib/tasks-calendar-api';
import type { TasksCalendarGridDay } from '@/lib/tasks-calendar-data';
import { getWeekStartMondayYmd, WEEKDAY_SHORT_LABELS } from '@/lib/schedule/week';
import {
  addDaysToLogicalYmd,
  logicalYmdToLocalDate,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type WeekStripMarks = {
  frog?: boolean;
  habit?: boolean;
  todo?: boolean;
  gray?: boolean;
};

type Props = {
  logicalTodayYmd: string;
  dayBoundary: TasksDayBoundary;
  /** 选中日（非今日时用浅色底） */
  selectedYmd?: string | null;
  onSelectDay?: (ymd: string) => void;
  /** 父页 reloadToken，变更时重拉圆点 */
  reloadToken?: number;
  /** 右侧同步文案，如 `21:08 已同步` */
  syncLabel?: string | null;
  /** 今日青蛙摘要，如 `今日 6 只青蛙` */
  todayFrogLabel?: string | null;
  todayMeta?: string | null;
  animate?: boolean;
};

function dayNumFromYmd(ymd: string): string {
  const d = logicalYmdToLocalDate(ymd);
  return String(d.getDate());
}

function marksFromGridDay(day: TasksCalendarGridDay | undefined): WeekStripMarks {
  if (!day) return {};
  return {
    frog: day.frogs > 0,
    habit: day.habits > 0,
    todo: day.openTodos > 0,
    gray: day.frogs === 0 && day.habits === 0 && day.openTodos === 0 && day.dueCount > 0,
  };
}

export function TasksWeekStrip({
  logicalTodayYmd,
  dayBoundary,
  selectedYmd,
  onSelectDay,
  reloadToken = 0,
  syncLabel,
  todayFrogLabel,
  todayMeta,
  animate: animateProp,
}: Props) {
  const { tf, fonts } = useTaskFoldTheme();
  const { animate: gateAnimate } = useFoldMotionGate();
  const animate = animateProp ?? gateAnimate;

  const weekStart = React.useMemo(
    () => getWeekStartMondayYmd(logicalTodayYmd),
    [logicalTodayYmd],
  );
  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToLogicalYmd(weekStart, i)),
    [weekStart],
  );

  const [marksByYmd, setMarksByYmd] = React.useState<Map<string, WeekStripMarks>>(
    () => new Map(),
  );

  React.useEffect(() => {
    let cancelled = false;
    const endYmd = addDaysToLogicalYmd(weekStart, 6);
    void fetchTasksCalendarMonth({
      startYmd: weekStart,
      endYmd,
      dayBoundary,
      serverFallback: true,
    })
      .then((payload) => {
        if (cancelled) return;
        const next = new Map<string, WeekStripMarks>();
        for (const ymd of days) {
          next.set(ymd, marksFromGridDay(payload.grid.get(ymd)));
        }
        setMarksByYmd(next);
      })
      .catch(() => {
        if (!cancelled) setMarksByYmd(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, dayBoundary, days, reloadToken]);

  const showMeta = !!(todayFrogLabel || todayMeta || syncLabel);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {days.map((ymd, i) => {
          const isToday = ymd === logicalTodayYmd;
          const isSel = !isToday && selectedYmd === ymd;
          const marks = marksByYmd.get(ymd) ?? {};
          const dots: { key: string; color: string }[] = [];
          if (marks.frog) dots.push({ key: 'f', color: isToday ? tf.lily : '#C7D6B9' });
          if (marks.habit) dots.push({ key: 'h', color: isToday ? tf.lily : '#9DB7A4' });
          if (marks.todo) dots.push({ key: 't', color: isToday ? tf.lily : '#E0B77D' });
          if (marks.gray && dots.length === 0) {
            dots.push({ key: 'g', color: isToday ? 'rgba(255,255,255,0.3)' : '#DAD5C8' });
          }
          const label = isToday ? '今天' : WEEKDAY_SHORT_LABELS[i];

          return (
            <FoldRiseIn
              key={ymd}
              animate={animate}
              index={i}
              staggerMs={42}
              fromY={8}
              duration={360}
              style={styles.daySlot}>
              <Pressable
                onPress={() => onSelectDay?.(ymd)}
                accessibilityRole="button"
                accessibilityState={{ selected: isToday || isSel }}
                accessibilityLabel={`${label} ${dayNumFromYmd(ymd)}`}
                style={({ pressed }) => [
                  styles.day,
                  isToday && {
                    backgroundColor: tf.pond,
                    shadowColor: tf.shadow,
                    shadowOpacity: 0.2,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 6 },
                    elevation: 4,
                  },
                  isSel && { backgroundColor: 'rgba(200,217,164,0.32)' },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}>
                <Text
                  style={[
                    styles.wd,
                    { color: isToday ? 'rgba(247,244,233,0.78)' : tf.muted },
                  ]}>
                  {label}
                </Text>
                <Text
                  style={[
                    styles.dd,
                    {
                      color: isToday ? tf.onPond : tf.ink2,
                      fontFamily: fonts.mono,
                      fontWeight: '700',
                    },
                  ]}>
                  {dayNumFromYmd(ymd)}
                </Text>
                <View style={styles.dots}>
                  {dots.slice(0, 3).map((d) => (
                    <View key={d.key} style={[styles.dot, { backgroundColor: d.color }]} />
                  ))}
                </View>
                {isToday ? <View style={[styles.todayBar, { backgroundColor: 'rgba(201,217,163,0.55)' }]} /> : null}
              </Pressable>
            </FoldRiseIn>
          );
        })}
      </View>

      {showMeta ? (
        <FoldRiseIn animate={animate} index={7} staggerMs={42} fromY={6} duration={320}>
          <View style={styles.metaLine}>
            {todayFrogLabel ? (
              <View style={[styles.frogTag, { backgroundColor: tf.sage2 }]}>
                <Text style={[styles.frogTagText, { color: '#36594D' }]}>{todayFrogLabel}</Text>
              </View>
            ) : null}
            {todayMeta ? (
              <Text style={[styles.metaText, { color: '#879487' }]} numberOfLines={1}>
                {todayMeta}
              </Text>
            ) : null}
            {syncLabel ? (
              <Text style={[styles.syncText, { color: '#97A096' }]} numberOfLines={1}>
                {syncLabel}
              </Text>
            ) : null}
          </View>
        </FoldRiseIn>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 3,
  },
  daySlot: {
    flex: 1,
    minWidth: 0,
  },
  day: {
    height: 46,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    position: 'relative',
  },
  wd: {
    fontSize: 10,
    letterSpacing: 0.4,
    fontWeight: '600',
  },
  dd: {
    fontSize: 13,
    lineHeight: 16,
  },
  dots: {
    flexDirection: 'row',
    gap: 1.5,
    height: 3,
    marginTop: 2,
    alignItems: 'center',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  todayBar: {
    position: 'absolute',
    bottom: 4,
    width: 12,
    height: 2,
    borderRadius: 2,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 7,
    paddingHorizontal: 4,
  },
  frogTag: {
    height: 17,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frogTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  metaText: {
    fontSize: 10,
    flexShrink: 1,
  },
  syncText: {
    marginLeft: 'auto',
    fontSize: 10,
  },
});
