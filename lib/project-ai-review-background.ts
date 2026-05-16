import {
  buildProjectTasksAiSummaryText,
  countProjectTasks,
  getAllTasksFlatByProjectId,
  patchProjectAiReview,
} from '@/lib/repositories/projects/project-ai-review';
import { getProjectById } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { analyzeProjectTasksReviewFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

const projectAiInFlight = new Set<string>();
const projectAiPendingAnalysisIds = new Set<string>();
const projectAiPendingListeners = new Set<(ids: ReadonlySet<string>) => void>();
const projectAiReviewSavedListeners = new Set<(project: ProjectRow) => void>();

function emitProjectAiPendingSnapshot(): void {
  const snap = new Set(projectAiPendingAnalysisIds);
  for (const cb of projectAiPendingListeners) {
    try {
      cb(snap);
    } catch {
      // ignore
    }
  }
}

export function addProjectAiPendingAnalysisListener(cb: (ids: ReadonlySet<string>) => void): () => void {
  projectAiPendingListeners.add(cb);
  cb(new Set(projectAiPendingAnalysisIds));
  return () => projectAiPendingListeners.delete(cb);
}

export function addProjectAiReviewSavedListener(cb: (project: ProjectRow) => void): () => void {
  projectAiReviewSavedListeners.add(cb);
  return () => projectAiReviewSavedListeners.delete(cb);
}

function markProjectAiAnalysisPending(id: string): void {
  projectAiPendingAnalysisIds.add(id);
  emitProjectAiPendingSnapshot();
}

function clearProjectAiAnalysisPending(id: string): void {
  if (!projectAiPendingAnalysisIds.delete(id)) return;
  emitProjectAiPendingSnapshot();
}

function notifyProjectAiReviewSaved(project: ProjectRow): void {
  for (const cb of projectAiReviewSavedListeners) {
    try {
      cb(project);
    } catch {
      // ignore
    }
  }
}

export type RunProjectAiReviewResult =
  | { ok: true; project: ProjectRow; skipped: boolean }
  | { ok: false; error: string };

/**
 * 汇总项目下全部任务并请求 AI 点评，结果写入 `projects.extra_data.ai_review`。
 * `force` 为 true 时即使已有历史结果也会重新生成（项目编辑页手动触发）。
 */
export async function runProjectAiReview(
  projectId: string,
  opts?: { force?: boolean },
): Promise<RunProjectAiReviewResult> {
  const id = projectId.trim();
  if (!id) return { ok: false, error: '项目 ID 无效' };
  if (projectAiInFlight.has(id)) {
    return { ok: false, error: '正在请求 AI，请稍候' };
  }

  const taskCount = await countProjectTasks(id);
  if (taskCount === 0) {
    clearProjectAiAnalysisPending(id);
    return { ok: false, error: '项目下暂无任务' };
  }

  const project = await getProjectById(id);
  if (!project) {
    clearProjectAiAnalysisPending(id);
    return { ok: false, error: '项目不存在' };
  }

  if (!opts?.force) {
    try {
      const extra = project.extra_data ? (JSON.parse(project.extra_data) as { ai_review?: { review_at?: string } }) : {};
      if (extra.ai_review?.review_at?.trim()) {
        return { ok: true, project, skipped: true };
      }
    } catch {
      // 继续生成
    }
  }

  const key = getActiveAiLlmApiKey().trim();
  if (!key) {
    clearProjectAiAnalysisPending(id);
    return { ok: false, error: '未配置智谱 API 密钥' };
  }

  projectAiInFlight.add(id);
  markProjectAiAnalysisPending(id);
  try {
    const tasks = await getAllTasksFlatByProjectId(id);
    if (tasks.length === 0) {
      return { ok: false, error: '项目下暂无任务' };
    }
    const summaryText = buildProjectTasksAiSummaryText(project, tasks);
    const r = await analyzeProjectTasksReviewFromText({ apiKey: key, projectContextText: summaryText });
    if (!r.ok) {
      return { ok: false, error: r.error };
    }
    const saved = await patchProjectAiReview(id, {
      evaluation: r.evaluation,
      suggestions: r.suggestions,
      task_count: tasks.length,
    });
    if (!saved) {
      return { ok: false, error: '保存失败' };
    }
    notifyProjectAiReviewSaved(saved);
    return { ok: true, project: saved, skipped: false };
  } finally {
    projectAiInFlight.delete(id);
    clearProjectAiAnalysisPending(id);
  }
}

/** 项目新增任务后调用：后台自动生成并持久化（空项目、无密钥时静默跳过）。 */
export function startProjectAiReviewInBackground(projectId: string | null | undefined): void {
  const id = projectId?.trim();
  if (!id) return;
  void (async () => {
    try {
      const count = await countProjectTasks(id);
      if (count === 0) return;
      await runProjectAiReview(id, { force: true });
    } catch {
      // 静默失败
    }
  })();
}
