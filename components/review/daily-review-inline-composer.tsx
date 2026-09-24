import { ReviewSectionCard } from '@/components/review/review-shared-ui';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

/** 全部维度 / 栏目均为内联输入，不再使用宫格 */
export function DailyReviewInlineComposer({
  dimensions,
  fields,
  canEdit,
  onChangeField,
  onOpenDimension,
}: {
  dimensions: ReviewDimensionTemplate[];
  fields: Record<string, string>;
  canEdit: boolean;
  onChangeField: (columnId: string, plain: string) => void;
  /** 可选：打开富文本详情编辑 */
  onOpenDimension?: (dimensionId: string) => void;
}) {
  const { colors } = useAppTheme();

  if (dimensions.length === 0) return null;

  return (
    <View style={styles.stack}>
      {dimensions.map(dim => (
        <ReviewSectionCard key={dim.id} style={styles.card}>
          <View style={styles.head}>
            <Text style={[Typography.title, { color: colors.text, flex: 1 }]} maxFontSizeMultiplier={1.35}>
              {dim.title}
            </Text>
            {onOpenDimension ? (
              <Pressable
                onPress={() => onOpenDimension(dim.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${dim.title}，展开详细编辑`}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                <MaterialIcons name="open-in-full" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {dim.columns.map(col => {
            const plain = reviewContentToPlainDisplay(fields[col.id] ?? '');
            return (
              <View key={col.id} style={styles.fieldBlock}>
                {dim.columns.length > 1 ? (
                  <Text style={[Typography.caption, { color: colors.primary }]} maxFontSizeMultiplier={1.35}>
                    {col.title}
                  </Text>
                ) : null}
                <TextInput
                  value={plain}
                  onChangeText={text => onChangeField(col.id, text)}
                  editable={canEdit}
                  multiline
                  placeholder={col.placeholder || '写点什么…'}
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.input,
                    {
                      color: colors.text,
                      backgroundColor: colors.input,
                      borderColor: colors.outline,
                    },
                  ]}
                  textAlignVertical="top"
                  maxFontSizeMultiplier={1.35}
                />
              </View>
            );
          })}
        </ReviewSectionCard>
      ))}
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
  input: {
    minHeight: 108,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    fontSize: 16,
    lineHeight: 24,
  },
});
