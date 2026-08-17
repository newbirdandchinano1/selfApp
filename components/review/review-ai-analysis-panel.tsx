import { ReviewSectionCard } from '@/components/review/review-shared-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

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
  const { colors } = useAppTheme();
  const body = (text ?? '').trim();

  return (
    <ReviewSectionCard variant="muted" style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <MaterialIcons name="auto-awesome" size={18} color={colors.primary} />
          <Text style={[Typography.title, { color: colors.text, fontSize: 15 }]}>AI 分析</Text>
        </View>
        <Pressable
          onPress={onAnalyze}
          disabled={!canRun || busy}
          style={({ pressed }) => [
            styles.btn,
            {
              backgroundColor: colors.primary,
              opacity: !canRun || busy ? 0.45 : pressed ? 0.88 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="AI 分析">
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : (
            <Text style={[styles.btnText, { color: colors.onPrimary }]}>
              {body ? '重新分析' : 'AI 分析'}
            </Text>
          )}
        </Pressable>
      </View>
      {!canRun && disabledReason ? (
        <Text style={[Typography.caption, { color: colors.textMuted, lineHeight: 18 }]}>
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
        <Text style={[Typography.body, { color: colors.text, lineHeight: 22 }]}>{body}</Text>
      ) : (
        <View style={styles.emptyRow}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primaryMuted }]}>
            <MaterialIcons name="auto-awesome" size={18} color={colors.primary} />
          </View>
          <Text style={[Typography.body, { color: colors.textMuted, lineHeight: 21, flex: 1 }]}>
            填写一定内容后，可生成「目前的问题 / 潜在问题 / 建议」诊断分析。
          </Text>
        </View>
      )}
    </ReviewSectionCard>
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
    minHeight: 34,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: 13,
    fontWeight: '800',
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
