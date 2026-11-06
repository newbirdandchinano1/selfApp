/**
 * 列表行计数轨：进度条 + 加减，紧凑展示。
 */
import { FoldProgressBar } from '@/components/tasks/fold-progress-bar';
import {
  evaluateProgressCounters,
  type ProgressCountersEvaluation,
} from '@/lib/repositories/progress/progress-counters';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function formatProgressCounterListCaption(
  evaluation: ProgressCountersEvaluation,
): string {
  if (evaluation.checks.length === 0) return '';
  return evaluation.checks
    .map((c) => `${c.title} ${c.current}/${c.target}${c.unit}`)
    .join(' · ');
}

type ProgressCounterListHintProps = {
  extraData: string | null | undefined;
  logicalTodayYmd: string;
  muted: string;
  primary: string;
  surfaceLow: string;
  ink?: string;
  trackAccentFrom?: string;
  trackAccentTo?: string;
  disabled?: boolean;
  /** 对指定计数轨加减 */
  onBump?: (counterId: string, delta: number) => void;
};

export function ProgressCounterListHint({
  extraData,
  logicalTodayYmd,
  muted,
  primary,
  surfaceLow,
  ink,
  trackAccentFrom = '#7BA3C9',
  trackAccentTo,
  disabled = false,
  onBump,
}: ProgressCounterListHintProps) {
  const evaluation = useMemo(
    () => evaluateProgressCounters(extraData, { logicalTodayYmd }),
    [extraData, logicalTodayYmd],
  );
  if (evaluation.ratio == null || evaluation.checks.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {evaluation.checks.map((check) => (
        <View key={check.id} style={styles.row}>
          <View style={styles.top}>
            <Text style={[styles.title, { color: ink ?? muted }]} numberOfLines={1}>
              {check.title}
            </Text>
            <Text style={[styles.caption, { color: muted }]} numberOfLines={1}>
              {check.progressCaption}
            </Text>
            {onBump && !disabled ? (
              <View style={styles.stepper}>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onBump(check.id, -1);
                  }}
                  disabled={check.current <= 0}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={`${check.title} 减一`}
                  style={({ pressed }) => [
                    styles.stepBtn,
                    {
                      backgroundColor: surfaceLow,
                      opacity: check.current <= 0 ? 0.35 : pressed ? 0.7 : 1,
                    },
                  ]}>
                  <Text style={[styles.stepText, { color: muted }]}>−</Text>
                </Pressable>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onBump(check.id, 1);
                  }}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={`${check.title} 加一`}
                  style={({ pressed }) => [
                    styles.stepBtn,
                    {
                      backgroundColor: primary,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}>
                  <Text style={[styles.stepText, { color: '#FFF' }]}>+</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <FoldProgressBar
            ratio={check.ratio}
            height={3}
            colorFrom={trackAccentFrom}
            colorTo={trackAccentTo}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 3,
    gap: 5,
    minWidth: 0,
  },
  row: {
    gap: 3,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  title: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '700',
    maxWidth: '40%',
  },
  caption: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  stepBtn: {
    width: 22,
    height: 18,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
  },
});
