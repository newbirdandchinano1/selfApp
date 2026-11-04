/**
 * 阶段 F：单日时间线日视图（只读）。
 * 左：竖线 + 彩点 + 语义时段标签；右：浅底圆角事件卡，同刻横向多栏。
 * 全天独立顶栏；break 禁排区仅弱提示，不画旧课表厚休息行。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { AxisLike } from '@/lib/schedule/axis';
import {
  eventHeightPx,
  layoutOverlappingEvents,
  splitAllDayEvents,
  timelineBodyHeightPx,
  TIMELINE_MINUTE_PX,
} from '@/lib/schedule/timeline/layout';
import { semanticBucketsForAxis } from '@/lib/schedule/timeline/labels';
import type { TimelineEvent } from '@/lib/schedule/timeline/types';
import type { ScheduleBreak } from '@/lib/schedule/types';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { AllDayRow } from '@/components/tasks/timeline/AllDayRow';
import { TimelineEventCard } from '@/components/tasks/timeline/TimelineEventCard';
import { TimelineRail } from '@/components/tasks/timeline/TimelineRail';
import { resolveTimelineTone } from '@/components/tasks/timeline/timeline-tone';

const COLUMN_GAP = 4;

type Props = {
  dayYmd: string;
  axis: AxisLike & { breaks?: ScheduleBreak[] };
  events: TimelineEvent[];
  /** 今日才传当前分钟，其余 null */
  nowMinutes: number | null;
  /** 可视高度上限（超出内部纵向滚动） */
  maxHeight: number;
  width: number;
  onPressEvent: (event: TimelineEvent) => void;
  onRequestAdd?: (ymd: string) => void;
};

export function DayTimelineSchedule({
  dayYmd,
  axis,
  events,
  nowMinutes,
  maxHeight,
  width,
  onPressEvent,
  onRequestAdd,
}: Props) {
  const { isDark } = useAppTheme();
  const { tf } = useTaskFoldTheme();
  const [areaWidth, setAreaWidth] = React.useState(0);

  const { allDay, timed } = React.useMemo(() => splitAllDayEvents(events), [events]);
  const laidOut = React.useMemo(() => layoutOverlappingEvents(timed), [timed]);
  const buckets = React.useMemo(() => semanticBucketsForAxis(axis), [axis]);
  const bodyHeight = React.useMemo(() => timelineBodyHeightPx(axis), [axis]);

  const axisStart = axis.startMinutes;
  const offsetOf = (minutes: number) => (minutes - axisStart) * TIMELINE_MINUTE_PX;

  const onAreaLayout = React.useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0) setAreaWidth((prev) => (prev === w ? prev : w));
  }, []);

  const dots = React.useMemo(
    () =>
      timed.map((event) => {
        const tone = resolveTimelineTone(event.kind, {
          done: event.done,
          isDark,
          tf,
          overdue: event.overdue,
        });
        return { top: offsetOf(event.startMinutes), color: tone.dotColor };
      }),
    // offsetOf depends on axisStart via closure; include axisStart
    [timed, isDark, tf, axisStart],
  );

  const breaks = (axis.breaks ?? []).filter(
    (b) => b.endMinutes > axis.startMinutes && b.startMinutes < axis.endMinutes,
  );

  const nowTop =
    nowMinutes != null &&
    nowMinutes >= axis.startMinutes &&
    nowMinutes <= axis.endMinutes
      ? offsetOf(nowMinutes)
      : null;

  return (
    <View style={{ width }}>
      <AllDayRow events={allDay} onPress={onPressEvent} />
      <ScrollView
        style={{ height: maxHeight }}
        contentContainerStyle={{ minHeight: Math.max(bodyHeight, maxHeight) }}
        nestedScrollEnabled
        showsVerticalScrollIndicator={bodyHeight > maxHeight}
        bounces={false}>
        <View style={{ flexDirection: 'row', height: bodyHeight }}>
          <TimelineRail
            bodyHeight={bodyHeight}
            buckets={buckets}
            axisStartMinutes={axisStart}
            minutePx={TIMELINE_MINUTE_PX}
            nowMinutes={nowTop != null ? nowMinutes : null}
            dots={dots}
          />
          <View
            style={{ flex: 1, position: 'relative' }}
            onLayout={onAreaLayout}>
            {breaks.map((b, i) => (
              <View
                key={`break-${i}`}
                pointerEvents="none"
                style={[
                  styles.breakBand,
                  {
                    top: offsetOf(Math.max(b.startMinutes, axis.startMinutes)),
                    height: Math.max(
                      0,
                      (Math.min(b.endMinutes, axis.endMinutes) -
                        Math.max(b.startMinutes, axis.startMinutes)) *
                        TIMELINE_MINUTE_PX,
                    ),
                    backgroundColor: isDark
                      ? 'rgba(180,170,150,0.08)'
                      : 'rgba(214,205,190,0.18)',
                    borderColor: isDark ? 'rgba(180,170,150,0.25)' : 'rgba(200,190,170,0.5)',
                  },
                ]}>
                <Text style={[styles.breakLabel, { color: tf.faint }]} numberOfLines={1}>
                  {b.label?.trim() || '休息'}
                </Text>
              </View>
            ))}

            {areaWidth > 0
              ? laidOut.map((item) => {
                  const { event, column, columns } = item;
                  const colW = (areaWidth - COLUMN_GAP * (columns - 1)) / columns;
                  const height = eventHeightPx(event);
                  return (
                    <View
                      key={event.id}
                      style={{
                        position: 'absolute',
                        top: offsetOf(event.startMinutes),
                        left: column * (colW + COLUMN_GAP),
                        width: colW,
                        height,
                      }}>
                      <TimelineEventCard
                        event={event}
                        height={height}
                        columns={columns}
                        onPress={onPressEvent}
                      />
                    </View>
                  );
                })
              : null}

            {nowTop != null ? (
              <View
                pointerEvents="none"
                style={[styles.nowLine, { top: nowTop, backgroundColor: tf.sun }]}
              />
            ) : null}
          </View>
        </View>
      </ScrollView>
      {onRequestAdd ? (
        <Pressable
          onPress={() => onRequestAdd(dayYmd)}
          accessibilityRole="button"
          accessibilityLabel="添加安排"
          style={({ pressed }) => [
            styles.addBtn,
            {
              borderColor: isDark ? tf.line2 : 'rgba(216,205,187,0.7)',
              backgroundColor: isDark ? tf.paper3 : '#F6F0E3',
              opacity: pressed ? 0.82 : 1,
            },
          ]}>
          <Text style={[styles.addBtnText, { color: tf.pond }]}>＋ 添加安排</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  breakBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  breakLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    opacity: 0.85,
  },
  addBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    marginHorizontal: 10,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addBtnText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
