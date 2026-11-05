/**
 * 阶段 F：单日时间线日视图（只读）。
 * 左：竖线 + 彩点 + 语义时段标签；右：浅底圆角事件卡，同刻横向多栏。
 * 全天独立顶栏；break 禁排区仅弱提示，不画旧课表厚休息行。
 */
import { FOLD_MOTION_EASE } from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { formatMinutesAsHm, type AxisLike } from '@/lib/schedule/axis';
import {
  eventFrameInAxis,
  layoutCardsHorizontally,
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
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { AllDayRow } from '@/components/tasks/timeline/AllDayRow';
import { TimelineEventCard } from '@/components/tasks/timeline/TimelineEventCard';
import { TimelineRail, TIMELINE_RAIL_W } from '@/components/tasks/timeline/TimelineRail';
import { resolveTimelineTone } from '@/components/tasks/timeline/timeline-tone';

const COLUMN_GAP = 4;
/** 单卡最大宽至少盖住可视区，长标题可铺满 */
const TIMELINE_MIN_FALLBACK_MAX = 160;

function areaWidthFromTotal(totalWidth: number): number {
  return Math.max(0, Math.floor(totalWidth) - TIMELINE_RAIL_W);
}

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
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  // 先用总宽估算，避免等 onLayout 之前事件层空白（长时段尤其像「消失了」）
  const [areaWidth, setAreaWidth] = React.useState(() => areaWidthFromTotal(width));
  /** 视口高度动画（半高 ↔ 完整）；height 不能走 native driver */
  const viewportHeightAnim = React.useRef(new Animated.Value(maxHeight)).current;
  const viewportHeightAnimRef = React.useRef(maxHeight);
  /** ScrollView 内容高：展开先撑满，收起等裁切动画结束再缩小 */
  const [scrollMaxH, setScrollMaxH] = React.useState(maxHeight);

  React.useEffect(() => {
    const next = areaWidthFromTotal(width);
    setAreaWidth((prev) => (prev === next ? prev : next));
  }, [width]);

  React.useEffect(() => {
    const from = viewportHeightAnimRef.current;
    const to = maxHeight;
    if (Math.abs(from - to) < 0.5) {
      viewportHeightAnimRef.current = to;
      setScrollMaxH(to);
      return;
    }
    if (!motionReady || reduceMotion) {
      viewportHeightAnim.stopAnimation();
      viewportHeightAnim.setValue(to);
      viewportHeightAnimRef.current = to;
      setScrollMaxH(to);
      return;
    }
    const expanding = to > from;
    if (expanding) setScrollMaxH(to);
    viewportHeightAnim.stopAnimation();
    viewportHeightAnim.setValue(from);
    Animated.timing(viewportHeightAnim, {
      toValue: to,
      duration: TaskFoldMotion.zoomMorph,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      viewportHeightAnimRef.current = to;
      if (!expanding) setScrollMaxH(to);
    });
  }, [maxHeight, motionReady, reduceMotion, viewportHeightAnim]);

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

  const framed = React.useMemo(() => {
    const out: {
      event: TimelineEvent;
      column: number;
      columns: number;
      clusterId: number;
      top: number;
      height: number;
    }[] = [];
    for (const item of laidOut) {
      const frame = eventFrameInAxis(item.event, axis);
      if (!frame) continue;
      out.push({
        event: item.event,
        column: item.column,
        columns: item.columns,
        clusterId: item.clusterId,
        top: frame.top,
        height: frame.height,
      });
    }
    return out;
  }, [laidOut, axis]);

  /** 卡片宽随标题长度自适应；同簇列占位取列内最大宽，超出可视区可横滑 */
  const clusterLayout = React.useMemo(() => {
    const horiz = layoutCardsHorizontally(framed, {
      gap: COLUMN_GAP,
      maxW: Math.max(TIMELINE_MIN_FALLBACK_MAX, areaWidth),
    });
    return {
      frames: horiz.frames,
      contentWidth: Math.max(areaWidth, horiz.contentWidth),
    };
  }, [framed, areaWidth]);

  const dots = React.useMemo(
    () =>
      framed.map((item) => {
        const tone = resolveTimelineTone(item.event.id, {
          done: item.event.done,
          isDark,
          tf,
          overdue: item.event.overdue,
        });
        return { top: item.top, color: tone.dotColor };
      }),
    [framed, isDark, tf],
  );

  /** 时间轴上标出每条指派的结束时刻（半开区间底边） */
  const endMarks = React.useMemo(
    () =>
      framed.map((item) => {
        const tone = resolveTimelineTone(item.event.id, {
          done: item.event.done,
          isDark,
          tf,
          overdue: item.event.overdue,
        });
        return {
          top: item.top + item.height,
          label: formatMinutesAsHm(item.event.endMinutes),
          color: tone.dotColor,
        };
      }),
    [framed, isDark, tf],
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

  const areaScrollable =
    areaWidth > 0 && clusterLayout.contentWidth > areaWidth + 0.5;

  const eventsLayer =
    areaWidth > 0
      ? framed.map((item) => {
          const horiz = clusterLayout.frames.get(item.event.id) ?? {
            left: 0,
            width: Math.min(areaWidth, 160),
          };
          return (
            <View
              key={item.event.id}
              style={{
                position: 'absolute',
                top: item.top,
                left: horiz.left,
                width: horiz.width,
                height: item.height,
              }}>
              <TimelineEventCard
                event={item.event}
                height={item.height}
                onPress={onPressEvent}
              />
            </View>
          );
        })
      : null;

  return (
    <View style={{ width }}>
      <AllDayRow events={allDay} onPress={onPressEvent} />
      <Animated.View style={{ height: viewportHeightAnim, overflow: 'hidden' }}>
        <ScrollView
          style={{ height: scrollMaxH }}
          contentContainerStyle={{ minHeight: Math.max(bodyHeight, scrollMaxH) }}
          nestedScrollEnabled
          showsVerticalScrollIndicator={bodyHeight > scrollMaxH}
          bounces={false}>
          <View style={{ flexDirection: 'row', height: bodyHeight }}>
            <TimelineRail
              bodyHeight={bodyHeight}
              buckets={buckets}
              axisStartMinutes={axisStart}
              minutePx={TIMELINE_MINUTE_PX}
              nowMinutes={nowTop != null ? nowMinutes : null}
              dots={dots}
              endMarks={endMarks}
            />
            <View style={{ flex: 1 }} onLayout={onAreaLayout}>
              {areaScrollable ? (
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  bounces={false}
                  showsHorizontalScrollIndicator
                  style={{ flex: 1 }}
                  contentContainerStyle={{
                    width: clusterLayout.contentWidth,
                    height: bodyHeight,
                  }}>
                  <View style={{ width: clusterLayout.contentWidth, height: bodyHeight }}>
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
                            borderColor: isDark
                              ? 'rgba(180,170,150,0.25)'
                              : 'rgba(200,190,170,0.5)',
                          },
                        ]}>
                        <Text style={[styles.breakLabel, { color: tf.faint }]} numberOfLines={1}>
                          {b.label?.trim() || '休息'}
                        </Text>
                      </View>
                    ))}
                    {eventsLayer}
                    {nowTop != null ? (
                      <View
                        pointerEvents="none"
                        style={[styles.nowLine, { top: nowTop, backgroundColor: tf.sun }]}
                      />
                    ) : null}
                  </View>
                </ScrollView>
              ) : (
                <View style={{ flex: 1, position: 'relative', height: bodyHeight }}>
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
                          borderColor: isDark
                            ? 'rgba(180,170,150,0.25)'
                            : 'rgba(200,190,170,0.5)',
                        },
                      ]}>
                      <Text style={[styles.breakLabel, { color: tf.faint }]} numberOfLines={1}>
                        {b.label?.trim() || '休息'}
                      </Text>
                    </View>
                  ))}
                  {eventsLayer}
                  {nowTop != null ? (
                    <View
                      pointerEvents="none"
                      style={[styles.nowLine, { top: nowTop, backgroundColor: tf.sun }]}
                    />
                  ) : null}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </Animated.View>
      {onRequestAdd ? (
        <Pressable
          onPress={() => onRequestAdd(dayYmd)}
          accessibilityRole="button"
          accessibilityLabel="添加安排或入格"
          style={({ pressed }) => [
            styles.addBtn,
            {
              borderColor: isDark ? tf.line2 : 'rgba(216,205,187,0.7)',
              backgroundColor: isDark ? tf.paper3 : '#F6F0E3',
              opacity: pressed ? 0.82 : 1,
            },
          ]}>
          <Text style={[styles.addBtnText, { color: tf.pond }]}>＋ 添加安排 / 入格</Text>
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
