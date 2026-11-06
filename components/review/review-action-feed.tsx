/**
 * 复盘「缺陷 / 新想法」反哺执行：快捷新建 + AI 智能拆分。
 */
import { FoldCard } from '@/components/review/fold-ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { formatYmd } from '@/lib/date';
import type { ReviewAiScope } from '@/lib/review-ai-analysis';
import {
  hrefForReviewAiSuggestion,
  REVIEW_AI_ACTION_META,
} from '@/lib/review-ai-quick-create';
import type { ReviewAiSuggestion, ReviewAiSuggestionAction } from '@/lib/review-ai-sections';
import {
  BUILTIN_REVIEW_DIMENSION_IDS,
} from '@/lib/repositories/insights/review-template-defaults';
import { convertReviewActions } from '@/lib/zhipu-image-parse';
import type { ReviewConvertActionItem } from '@/lib/ai-api-client';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function buildReviewFeedTodoDefaultSchedule(): string {
  const today = formatYmd(new Date());
  return JSON.stringify({
    mode: 'date',
    date: today,
    allDay: true,
    reminderOption: '自动临期',
    reminderHour: 9,
    reminderMinute: 0,
  });
}

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

function toSuggestion(item: ReviewConvertActionItem): ReviewAiSuggestion {
  const action = (item.action || 'todo') as ReviewAiSuggestionAction;
  return {
    text: (item.text || item.draft_title || '').trim(),
    action,
    draftTitle: (item.draft_title || item.text || '').trim(),
    draftBody: (item.draft_body || '').trim(),
  };
}

export function ReviewActionFeedStrip({
  dimensionId,
  hint,
  bodyText,
  scope = 'daily',
  periodLabel,
  openItems,
}: {
  dimensionId: string;
  /** 可选：当前栏正文前几字，仅作文案提示 / 待办预填 */
  hint?: string;
  /** 智能拆分用的完整栏正文 */
  bodyText?: string;
  scope?: ReviewAiScope;
  periodLabel?: string;
  openItems?: { id: string; title: string }[];
}) {
  const router = useRouter();
  const { palette } = useFoldTheme();
  const insets = useSafeAreaInsets();
  const [splitBusy, setSplitBusy] = useState(false);
  const [actions, setActions] = useState<ReviewConvertActionItem[] | null>(null);

  const quickActions = useMemo((): FeedAction[] => {
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
        onPress: () =>
          router.push({
            pathname: '/add-task',
            params: {
              standalone: '1',
              ...(hint?.trim() ? { title: hint.trim().slice(0, 80) } : {}),
              defaultSchedule: buildReviewFeedTodoDefaultSchedule(),
            },
          }),
      },
    ];
  }, [hint, router]);

  const runSmartSplit = useCallback(async () => {
    const text = (bodyText || hint || '').trim();
    if (!text) {
      toast.error('请先写下缺陷或想法，再智能拆分');
      return;
    }
    setSplitBusy(true);
    try {
      const isDefect = dimensionId.endsWith('_defects');
      const r = await convertReviewActions({
        scope,
        periodLabel: periodLabel || '',
        dimensionTitle: isDefect ? '缺陷' : '新想法',
        text,
        openItems,
      });
      if (!r.ok) {
        toast.error(r.error || '智能拆分失败');
        return;
      }
      setActions(r.data.actions);
    } catch (e) {
      console.warn('review convert-actions', e);
      toast.error(toUserMessage(e, '智能拆分失败，请稍后重试'));
    } finally {
      setSplitBusy(false);
    }
  }, [bodyText, dimensionId, hint, openItems, periodLabel, scope]);

  const openAction = useCallback(
    (item: ReviewConvertActionItem) => {
      const suggestion = toSuggestion(item);
      router.push(hrefForReviewAiSuggestion(suggestion, suggestion.action));
      setActions(null);
    },
    [router],
  );

  if (!isReviewActionFeedDimension(dimensionId)) return null;

  const isDefect = dimensionId.endsWith('_defects');
  const title = isDefect ? '把缺陷落到执行' : '把想法落到执行';
  const sub =
    hint && hint.trim()
      ? '可智能拆分，或直接建备忘 / 项目 / 习惯 / 待办。'
      : '复盘不是终点：先写几句，再用智能拆分推进执行。';

  return (
    <>
      <FoldCard tone="muted" style={styles.card}>
        <Text style={[styles.title, { color: palette.ink }]} maxFontSizeMultiplier={1.3}>
          {title}
        </Text>
        <Text style={[styles.sub, { color: palette.muted }]} maxFontSizeMultiplier={1.3}>
          {sub}
        </Text>
        <View style={styles.row}>
          <Pressable
            onPress={() => void runSmartSplit()}
            disabled={splitBusy}
            accessibilityRole="button"
            accessibilityLabel="智能拆分"
            style={({ pressed }) => [
              styles.chip,
              styles.chipPrimary,
              {
                borderColor: palette.pine,
                backgroundColor: palette.pine,
                opacity: splitBusy ? 0.55 : pressed ? 0.82 : 1,
              },
            ]}>
            {splitBusy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="auto-awesome" size={15} color="#fff" />
            )}
            <Text style={[styles.chipText, { color: '#fff' }]} numberOfLines={1} maxFontSizeMultiplier={1.25}>
              智能拆分
            </Text>
          </Pressable>
          {quickActions.map(action => (
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

      <Modal visible={actions != null} transparent animationType="fade" onRequestClose={() => setActions(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setActions(null)}>
          <Pressable
            style={[
              styles.modalCard,
              {
                backgroundColor: palette.card,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
            onPress={e => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: palette.ink }]} maxFontSizeMultiplier={1.3}>
              选择要创建的行动
            </Text>
            <Text style={[styles.modalSub, { color: palette.muted }]} maxFontSizeMultiplier={1.3}>
              逐条确认，不会自动写入
            </Text>
            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {(actions ?? []).map((item, index) => {
                const meta = REVIEW_AI_ACTION_META[item.action] ?? REVIEW_AI_ACTION_META.todo;
                return (
                  <Pressable
                    key={`${item.draft_title}-${index}`}
                    onPress={() => openAction(item)}
                    style={({ pressed }) => [
                      styles.actionRow,
                      {
                        borderColor: palette.line,
                        backgroundColor: pressed ? palette.paper : palette.card,
                      },
                    ]}>
                    <View style={[styles.actionIcon, { backgroundColor: palette.paper }]}>
                      <MaterialIcons name={meta.icon} size={18} color={palette.pine} />
                    </View>
                    <View style={styles.actionBody}>
                      <Text style={[styles.actionTitle, { color: palette.ink }]} numberOfLines={2}>
                        {item.draft_title}
                      </Text>
                      {item.draft_body ? (
                        <Text style={[styles.actionBodyText, { color: palette.muted }]} numberOfLines={2}>
                          {item.draft_body}
                        </Text>
                      ) : null}
                      <Text style={[styles.actionMeta, { color: palette.faint }]}>{meta.createLabel}</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color={palette.faint} />
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={() => setActions(null)}
              style={[styles.modalClose, { borderColor: palette.line }]}
              accessibilityRole="button"
              accessibilityLabel="关闭">
              <Text style={{ color: palette.inkSoft, fontWeight: '600' }}>关闭</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  chipPrimary: {
    borderWidth: 0,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    borderRadius: 16,
    paddingTop: 18,
    paddingHorizontal: 16,
    maxHeight: '72%',
    gap: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 12,
    marginBottom: 4,
  },
  modalList: {
    maxHeight: 360,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBody: {
    flex: 1,
    gap: 2,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionBodyText: {
    fontSize: 12,
    lineHeight: 17,
  },
  actionMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  modalClose: {
    marginTop: 4,
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
