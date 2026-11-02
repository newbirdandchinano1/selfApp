/**
 * 复盘建议 → 快捷新建备忘 / 项目 / 习惯 / 待办（带预填）。
 * 分析页每条建议只显示一个「+」图标，点开后再选落地点。
 */
import type { ReviewAiSuggestion, ReviewAiSuggestionAction } from '@/lib/review-ai-sections';
import type { Href } from 'expo-router';

export const REVIEW_AI_ACTION_ORDER: ReviewAiSuggestionAction[] = [
  'memo',
  'project',
  'habit',
  'todo',
];

export const REVIEW_AI_ACTION_META: Record<
  ReviewAiSuggestionAction,
  { label: string; createLabel: string; icon: 'sticky-note-2' | 'folder-open' | 'replay' | 'check-box-outline-blank' }
> = {
  memo: { label: '备忘', createLabel: '新建备忘', icon: 'sticky-note-2' },
  project: { label: '项目', createLabel: '新建项目', icon: 'folder-open' },
  habit: { label: '习惯', createLabel: '新建习惯', icon: 'replay' },
  todo: { label: '待办', createLabel: '新建待办', icon: 'check-box-outline-blank' },
};

export function hrefForReviewAiSuggestion(
  suggestion: ReviewAiSuggestion,
  action: ReviewAiSuggestionAction = suggestion.action,
): Href {
  const title = (suggestion.draftTitle || suggestion.text).trim();
  const body = (suggestion.draftBody || suggestion.text).trim();
  switch (action) {
    case 'memo':
      return {
        pathname: '/memo-edit/[id]',
        params: { id: 'new', title, body },
      };
    case 'project':
      return {
        pathname: '/add-project',
        params: { title },
      };
    case 'habit':
      return {
        pathname: '/add-habit',
        params: { name: title },
      };
    case 'todo':
    default:
      return {
        pathname: '/add-task',
        params: { standalone: '1', title, note: body },
      };
  }
}
