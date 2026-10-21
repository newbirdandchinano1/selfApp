import { FoldCard } from '@/components/review/fold-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { getMinTouchTarget, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

export function ReviewAiAnalysisPanel({
  text,
  busy,
  canRun,
  onAnalyze,
  disabledReason,
}: {
  text: string | null | undefined;
  busy: boolean;
  canRun: boolean;
  onAnalyze: () => void;
  disabledReason?: string;
}) {
  const { fold } = useFoldTheme();
  const body = (text ?? '').trim();
  const touchMin = useMemo(() => getMinTouchTarget(Platform.OS), []);
  const actionLabel = body ? '重新分析' : 'AI 分析';

  return (
    <FoldCard tone="muted" style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <MaterialIcons name="auto-awesome" size={18} color={fold.pine} />
          <Text style={[Typography.title, { color: fold.ink }]} maxFontSizeMultiplier={1.35}>
            AI 分析
          </Text>
        </View>
        <Pressable
          onPress={onAnalyze}
          disabled={!canRun || busy}
          style={({ pressed }) => [
            styles.btn,
            {
              backgroundColor: fold.pineButton,
              minHeight: touchMin,
              opacity: !canRun || busy ? 0.45 : pressed ? 0.88 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ disabled: !canRun || busy, busy }}>
          {busy ? (
            <ActivityIndicator color={fold.onPineButton} size="small" />
          ) : (
            <Text style={[Typography.caption, { color: fold.onPineButton, fontWeight: '800' }]} maxFontSizeMultiplier={1.35}>
              {actionLabel}
            </Text>
          )}
        </Pressable>
      </View>
      {!canRun && disabledReason ? (
        <Text style={[Typography.caption, { color: fold.muted, lineHeight: 18 }]} maxFontSizeMultiplier={1.35}>
          {disabledReason}
        </Text>
      ) : null}
      {busy && !body ? (
        <View style={styles.busySkeleton}>
          <Skeleton width="100%" height={12} borderRadius={5} />
          <Skeleton width="92%" height={12} borderRadius={5} />
          <Skeleton width="78%" height={12} borderRadius={5} />
        </View>
      ) : body ? (
        <Text style={[Typography.body, { color: fold.ink2, lineHeight: 22 }]} maxFontSizeMultiplier={1.35}>
          {body}
        </Text>
      ) : (
        <View style={styles.emptyRow}>
          <View style={[styles.emptyIcon, { backgroundColor: fold.sage2 }]}>
            <MaterialIcons name="auto-awesome" size={18} color={fold.pine} />
          </View>
          <Text style={[Typography.body, { color: fold.muted, lineHeight: 21, flex: 1 }]} maxFontSizeMultiplier={1.35}>
            填写一定内容后，可生成「目前的问题 / 潜在问题 / 建议」诊断分析。
          </Text>
        </View>
      )}
    </FoldCard>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  headLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  btn: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busySkeleton: {
    gap: Spacing.sm,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  emptyIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
