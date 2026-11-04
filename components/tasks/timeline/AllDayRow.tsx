/**
 * 阶段 F：全天区独立顶栏（色点 + 图标 + 标题的胶囊，自动换行）。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { TimelineEvent } from '@/lib/schedule/timeline/types';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { resolveTimelineTone } from '@/components/tasks/timeline/timeline-tone';

type Props = {
  events: TimelineEvent[];
  onPress: (event: TimelineEvent) => void;
};

export function AllDayRow({ events, onPress }: Props) {
  const { isDark } = useAppTheme();
  const { tf } = useTaskFoldTheme();

  return (
    <View style={[styles.wrap, { borderColor: isDark ? tf.line : 'rgba(230,221,206,0.7)' }]}>
      <Text style={[styles.label, { color: tf.faint }]}>全天</Text>
      <View style={styles.chips}>
        {events.length === 0 ? (
          <Text style={[styles.empty, { color: tf.faint }]}>—</Text>
        ) : (
          events.map((event) => {
            const tone = resolveTimelineTone(event.kind, {
              done: event.done,
              isDark,
              tf,
              overdue: event.overdue,
            });
            return (
              <Pressable
                key={event.id}
                onPress={() => onPress(event)}
                accessibilityRole="button"
                accessibilityLabel={`全天 ${event.title}${event.done ? '，已完成' : ''}`}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: tone.cardBg,
                    borderColor: tone.cardBorder,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <View style={[styles.dot, { backgroundColor: tone.dotColor }]} />
                {event.icon ? <Text style={styles.chipIcon}>{event.icon}</Text> : null}
                <Text
                  numberOfLines={1}
                  style={[
                    styles.chipTitle,
                    {
                      color: tone.titleColor,
                      textDecorationLine: event.done ? 'line-through' : 'none',
                      opacity: event.done ? 0.72 : 1,
                    },
                  ]}>
                  {event.title}
                </Text>
                {event.done ? (
                  <MaterialIcons name="check" size={11} color={tone.barColor} />
                ) : null}
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginTop: 4,
    width: 22,
  },
  chips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  empty: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  chipIcon: {
    fontSize: 11,
  },
  chipTitle: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
});
