/**
 * 复盘建议 → 快捷新建备忘 / 项目 / 习惯 / 待办（带预填）。
 * 分析页每条建议只显示一个「+」图标，点开后再选落地点。
 * 待办优先复用 task/parse-one-liner，带齐 priority/due/schedule。
 */
import type { TaskAiScheduleDraft, TaskParseOneLinerJson } from '@/lib/ai-api-client';
import type { ReviewAiSuggestion, ReviewAiSuggestionAction } from '@/lib/review-ai-sections';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { parseTaskOneLiner } from '@/lib/zhipu-image-parse';
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

export type ReviewTodoPrefill = {
  title?: string;
  note?: string | null;
  priority?: number | null;
  due_ymd?: string | null;
  schedule?: TaskAiScheduleDraft | null;
};

export function hrefForReviewAiSuggestion(
  suggestion: ReviewAiSuggestion,
  action: ReviewAiSuggestionAction = suggestion.action,
  todoPrefill?: ReviewTodoPrefill | null,
): Href {
  const title = (todoPrefill?.title || suggestion.draftTitle || suggestion.text).trim();
  const body = (todoPrefill?.note || suggestion.draftBody || suggestion.text).trim();
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
    default: {
      const params: Record<string, string> = {
        standalone: '1',
        title,
        note: body,
      };
      if (todoPrefill?.priority != null && todoPrefill.priority > 0) {
        params.priority = String(todoPrefill.priority);
      }
      if (todoPrefill?.due_ymd) {
        params.due_ymd = todoPrefill.due_ymd;
      }
      if (todoPrefill?.schedule && typeof todoPrefill.schedule === 'object') {
        try {
          params.schedule = JSON.stringify(todoPrefill.schedule);
        } catch {
          // ignore
        }
      }
      return {
        pathname: '/add-task',
        params,
      };
    }
  }
}

/** 复盘「+ 待办」：先调 parse-one-liner 增强预填；失败则回退 title/note。 */
export async function enrichReviewTodoPrefill(
  suggestion: ReviewAiSuggestion,
): Promise<ReviewTodoPrefill> {
  const title = (suggestion.draftTitle || suggestion.text).trim();
  const body = (suggestion.draftBody || suggestion.text).trim();
  const fallback: ReviewTodoPrefill = { title, note: body };
  const text = [title, body !== title ? body : ''].filter(Boolean).join('，').trim();
  if (!text) return fallback;
  try {
    const r = await parseTaskOneLiner({
      text,
      todayYmd: getLogicalLocalYmd(new Date(), getDayBoundarySync()),
    });
    if (!r.ok) return fallback;
    const d: TaskParseOneLinerJson = r.data;
    return {
      title: d.title?.trim() || title,
      note: d.note?.trim() || body,
      priority: typeof d.priority === 'number' ? d.priority : null,
      due_ymd: d.due_ymd ?? null,
      schedule: d.schedule ?? null,
    };
  } catch {
    return fallback;
  }
}
