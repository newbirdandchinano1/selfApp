import { ReviewSectionCard } from '@/components/review/review-shared-ui';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** 总览只读预览；须进入维度详情页才能编辑 */
export function DailyReviewInlineComposer({
  dimensions,
  fields,
  canEdit,
  onOpenDimension,
}: {
  dimensions: ReviewDimensionTemplate[];
  fields: Record<string, string>;
  canEdit: boolean;
  onOpenDimension: (dimensionId: string) => void;
}) {
  const { colors } = useAppTheme();

  if (dimensions.length === 0) return null;

  return (
    <View style={styles.stack}>
      {dimensions.map(dim => {
        const plainParts = dim.columns.map(col => ({
          id: col.id,
          title: col.title,
          placeholder: col.placeholder || '写点什么…',
          plain: reviewContentToPlainDisplay(fields[col.id] ?? '').trim(),
        }));
        const hasAny = plainParts.some(p => p.plain.length > 0);
        const actionHint = canEdit ? '点击进入详情编辑' : '点击查看详情';

        return (
          <Pressable
            key={dim.id}
            onPress={() => onOpenDimension(dim.id)}
            accessibilityRole="button"
            accessibilityLabel={`${dim.title}，${actionHint}`}
            style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
            <ReviewSectionCard style={styles.card}>
              <View style={styles.head}>
                <Text style={[Typography.title, { color: colors.text, flex: 1 }]} maxFontSizeMultiplier={1.35}>
                  {dim.title}
                </Text>
                <MaterialIcons
                  name={canEdit ? (hasAny ? 'open-in-full' : 'edit-note') : 'lock-outline'}
                  size={20}
                  color={colors.textMuted}
                />
              </View>

              {plainParts.map(col => (
                <View key={col.id} style={styles.fieldBlock}>
                  {dim.columns.length > 1 ? (
                    <Text style={[Typography.caption, { color: colors.primary }]} maxFontSizeMultiplier={1.35}>
                      {col.title}
                    </Text>
                  ) : null}
                  <View
                    style={[
                      styles.preview,
                      {
                        backgroundColor: colors.input,
                        borderColor: colors.outline,
                      },
                    ]}>
                    {col.plain ? (
                      <Text
                        style={[styles.previewText, { color: colors.text }]}
                        numberOfLines={6}
                        maxFontSizeMultiplier={1.35}>
                        {col.plain}
                      </Text>
                    ) : (
                      <Text
                        style={[styles.previewText, { color: colors.textMuted }]}
                        maxFontSizeMultiplier={1.35}>
                        {col.placeholder}
                      </Text>
                    )}
                  </View>
                </View>
              ))}

              <Text style={[Typography.caption, { color: colors.textMuted }]} maxFontSizeMultiplier={1.35}>
                {actionHint}
              </Text>
            </ReviewSectionCard>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.xl,
  },
  card: {
    gap: Spacing.md,
    paddingVertical: Spacing['3xl'],
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  fieldBlock: {
    gap: Spacing.sm,
  },
  preview: {
    minHeight: 108,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  previewText: {
    fontSize: 16,
    lineHeight: 24,
  },
});
