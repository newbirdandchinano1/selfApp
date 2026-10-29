/**
 * 复盘「缺陷 / 新想法」反哺执行：快捷新建备忘、项目、小习惯、待办。
 */
import { FoldCard } from '@/components/review/fold-ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import {
  BUILTIN_REVIEW_DIMENSION_IDS,
} from '@/lib/repositories/insights/review-template-defaults';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const ACTION_FEED_DIMENSION_IDS = new Set<string>([
  BUILTIN_REVIEW_DIMENSION_IDS.daily.defects,
  BUILTIN_REVIEW_DIMENSION_IDS.daily.ideas,
  BUILTIN_REVIEW_DIMENSION_IDS.weekly.defects,
  BUILTIN_REVIEW_DIMENSION_IDS.weekly.ideas,
  BUILTIN_REVIEW_DIMENSION_IDS.monthly.defects,
  BUILTIN_REVIEW_DIMENSION_IDS.monthly.ideas,
]);

export function isReviewActionFeedDimension(dimensionId: string | null | undefined): boolean {
  return !!dimensionId && ACTION_FEED_DIMENSION_IDS.has(dimensionId);
}

type FeedAction = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  onPress: () => void;
};

export function ReviewActionFeedStrip({
  dimensionId,
  hint,
}: {
  dimensionId: string;
  /** 可选：当前栏正文前几字，仅作文案提示 */
  hint?: string;
}) {
  const router = useRouter();
  const { palette } = useFoldTheme();

  const actions = useMemo((): FeedAction[] => {
    return [
      {
        key: 'memo',
        label: '新建备忘',
        icon: 'sticky-note-2',
        onPress: () => router.push({ pathname: '/memo-edit/[id]', params: { id: 'new' } }),
      },
      {
        key: 'project',
        label: '新建项目',
        icon: 'folder-open',
        onPress: () => router.push('/add-project'),
      },
      {
        key: 'habit',
        label: '新建习惯',
        icon: 'replay',
        onPress: () => router.push('/add-habit'),
      },
      {
        key: 'todo',
        label: '新建待办',
        icon: 'check-box-outline-blank',
        onPress: () => router.push({ pathname: '/add-task', params: { standalone: '1' } }),
      },
    ];
  }, [router]);

  if (!isReviewActionFeedDimension(dimensionId)) return null;

  const isDefect = dimensionId.endsWith('_defects');
  const title = isDefect ? '把缺陷落到执行' : '把想法落到执行';
  const sub =
    hint && hint.trim()
      ? '写完可直接建备忘 / 项目 / 习惯 / 待办，别停在纸面上。'
      : '复盘不是终点：用下面入口把改进项推进任务与备忘。';

  return (
    <FoldCard tone="muted" style={styles.card}>
      <Text style={[styles.title, { color: palette.ink }]} maxFontSizeMultiplier={1.3}>
        {title}
      </Text>
      <Text style={[styles.sub, { color: palette.muted }]} maxFontSizeMultiplier={1.3}>
        {sub}
      </Text>
      <View style={styles.row}>
        {actions.map(action => (
          <Pressable
            key={action.key}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => [
              styles.chip,
              {
                borderColor: palette.line,
                backgroundColor: palette.card,
                opacity: pressed ? 0.82 : 1,
              },
            ]}>
            <MaterialIcons name={action.icon} size={15} color={palette.pine} />
            <Text style={[styles.chipText, { color: palette.inkSoft }]} numberOfLines={1} maxFontSizeMultiplier={1.25}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </FoldCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sub: {
    fontSize: 12,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
