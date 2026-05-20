import { ensureDailyAiIntakeTargetsForToday } from '@/lib/daily-intake-ai-targets';
import type { DailyAiIntakeTargetsRow } from '@/lib/daily-intake-ai-targets';
import { getDatabase } from '@/lib/database';
import { getHealthRecordsLast7Days } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import { fetchWeeklyReviewMetrics, type WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import {
  getPersonaPortraitCache,
  PERSONA_PORTRAIT_SLUGS,
  savePersonaPortraitCache,
  type PersonaPortraitCacheSlug,
} from '@/lib/repositories/insights/persona-portrait-cache';
import { getDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import {
  appendPersonaHealthContextLines,
  getIntakeTargetsSnapshot,
  ymdAddDays,
} from '@/lib/persona-health-context';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { generatePersonaPortraitFromContext, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

export type PersonaHealthContextInput = {
  prevWeekHealthRows?: HealthRecordRow[];
  dailyAiTargets?: DailyAiIntakeTargetsRow | null;
  todayYmd?: string;
};

export function localCalendarYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 应用日界下的逻辑「今天」YMD */
export function localLogicalTodayYmd(d = new Date()): string {
  return getLogicalLocalYmd(d, getDayBoundarySync());
}

function appendTaskMetricsLines(lines: string[], metrics: WeeklyReviewMetrics): void {
  lines.push(
    `完成任务：${metrics.tasksCompleted} 项；新建任务：${metrics.tasksCreated} 项；习惯打卡合计：${metrics.habitCheckInTotal} 次。`,
  );
  if (metrics.tasksCreated > 0) {
    const rate = Math.round((metrics.tasksCompleted / metrics.tasksCreated) * 100);
    lines.push(`任务完成率（完成/新建）：约 ${rate}%（${metrics.tasksCompleted}/${metrics.tasksCreated}）。`);
  }
}

function appendFinanceMetricsLines(lines: string[], metrics: WeeklyReviewMetrics): void {
  lines.push(`存钱计划入账合计：¥${metrics.savingsWeekTotal.toLocaleString('zh-CN')}。`);
  const financeNet = metrics.financeIncome - metrics.financeExpense;
  lines.push(
    `记账：收入 ¥${metrics.financeIncome.toLocaleString('zh-CN')}，支出 ¥${metrics.financeExpense.toLocaleString('zh-CN')}，净流约 ¥${financeNet.toLocaleString('zh-CN')}。`,
  );
  lines.push(`心愿清单更新：${metrics.wishUpdates} 条。`);
}

export function buildPersonaContextText(
  slug: PersonaPortraitCacheSlug,
  user: UserRow | null,
  metrics: WeeklyReviewMetrics,
  healthRows: HealthRecordRow[],
  healthInput: PersonaHealthContextInput = {},
): string {
  const lines: string[] = [];
  const todayYmd = healthInput.todayYmd ?? localLogicalTodayYmd();
  const targets = getIntakeTargetsSnapshot();

  lines.push(`统计区间：${metrics.rangeDisplay}（${metrics.weekStartYmd} 至 ${metrics.weekEndYmd}）`);

  switch (slug) {
    case 'plan-completion':
      appendTaskMetricsLines(lines, metrics);
      break;
    case 'health':
      lines.push('');
      appendPersonaHealthContextLines(lines, {
        user,
        healthRows,
        prevWeekRows: healthInput.prevWeekHealthRows,
        todayYmd,
        targets,
        dailyAiTargets: healthInput.dailyAiTargets,
      });
      break;
    case 'savings':
      appendFinanceMetricsLines(lines, metrics);
      break;
    case 'ai-insight':
      appendTaskMetricsLines(lines, metrics);
      appendFinanceMetricsLines(lines, metrics);
      lines.push('');
      appendPersonaHealthContextLines(lines, {
        user,
        healthRows,
        prevWeekRows: healthInput.prevWeekHealthRows,
        todayYmd,
        targets,
        dailyAiTargets: healthInput.dailyAiTargets,
      });
      break;
  }

  lines.push('');
  const slugFocus: Record<PersonaPortraitCacheSlug, string> = {
    'plan-completion':
      '仅侧重任务页数据：任务完成/新建、习惯打卡与闭环节奏；禁止引用储蓄、记账、收支、饮水、心愿等非任务内容。',
    health:
      '综合健康页：身体档案（身高体重 BMI）、四营养维度（水/蛋白/碳水/钠）的日均与达成率、周环比、逐日明细与自我照料节律；须引用摘要数字，禁止编造体脂率或医疗诊断。',
    savings: '侧重收支净流、储蓄入账与延迟满足倾向。',
    'ai-insight': '综合任务、健康、财务与心愿线索，给出跨维度总评（overview 与 ai_quote 均需充实）。',
  };
  lines.push(`当前请求的画像维度 persona_slug = ${slug}。${slugFocus[slug]}`);
  lines.push(
    '请围绕该维度组织主标题区与正文。overview 须写满 300～400 汉字（分四段：数据回顾、模式洞察、优势与卡点、可执行微习惯）；不要编造摘要中未出现的金额或医疗诊断。',
  );
  return lines.join('\n');
}

/**
 * 应用启动后后台执行：对四个画像 slug，若本地尚无「今日」缓存则依次请求智谱并写入 SQLite。
 * Web 无数据库时直接跳过；失败仅打日志，不抛给 UI。
 */
export async function ensurePersonaPortraitsForTodayInBackground(): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  const today = localLogicalTodayYmd();
  const prevWeekEnd = ymdAddDays(today, -7);

  try {
    const u = await getDefaultUser();
    const metrics = await fetchWeeklyReviewMetrics(new Date(), 'rolling-7');
    const rows = u?.id ? await getHealthRecordsLast7Days(u.id, today) : [];
    const prevRows = u?.id ? await getHealthRecordsLast7Days(u.id, prevWeekEnd) : [];
    let dailyAiTargets: DailyAiIntakeTargetsRow | null = null;
    if (u) {
      const dailyRes = await ensureDailyAiIntakeTargetsForToday({ user: u, todayYmd: today });
      if (dailyRes.status === 'cached' || dailyRes.status === 'fresh') {
        dailyAiTargets = dailyRes.row;
      }
    }
    const healthInput: PersonaHealthContextInput = {
      prevWeekHealthRows: prevRows,
      dailyAiTargets,
      todayYmd: today,
    };

    for (const slug of PERSONA_PORTRAIT_SLUGS) {
      const cached = await getPersonaPortraitCache(slug);
      if (cached?.cache_date_ymd === today) continue;

      const context = buildPersonaContextText(slug, u, metrics, rows, healthInput);
      const res = await generatePersonaPortraitFromContext({
        apiKey: getActiveAiLlmApiKey(),
        personaSlug: slug,
        contextText: context,
      });
      if (res.ok) {
        await savePersonaPortraitCache(slug, today, res.data);
      }
    }
  } catch (e) {
    console.warn('[persona-portrait] background refresh failed', e);
  }
}
