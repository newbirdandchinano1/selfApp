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
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { generatePersonaPortraitFromContext, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

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

function appendUserBodyLines(lines: string[], user: UserRow | null): void {
  if (!user) {
    lines.push('用户档案（本地）：尚未填写身高、体重。');
    return;
  }
  lines.push('用户档案（本地）：');
  lines.push(
    `称呼/昵称：${(user.name || '').trim() || '未填'}；身高：${user.height ? `${user.height} cm` : '未填'}；体重：${user.weight ? `${user.weight} kg` : '未填'}。`,
  );
  if (user.height && user.weight) {
    const h = user.height / 100;
    const bmi = user.weight / (h * h);
    if (Number.isFinite(bmi)) lines.push(`由身高体重推算 BMI≈${bmi.toFixed(1)}（仅供生活方式参考，非医疗结论）。`);
  }
}

function appendHydrationLines(lines: string[], healthRows: HealthRecordRow[]): void {
  let totalHydrationMl = 0;
  const daysWithIntake = new Set<string>();
  let maxDayTargetMl = 0;
  for (const r of healthRows) {
    totalHydrationMl += r.hydration ?? 0;
    if ((r.hydration ?? 0) > 0 || (r.target_hydration ?? 0) > 0) daysWithIntake.add(r.record_date);
    if ((r.target_hydration ?? 0) > maxDayTargetMl) maxDayTargetMl = r.target_hydration ?? 0;
  }
  const avgDailyMl = totalHydrationMl / 7;
  const assumedTarget = maxDayTargetMl > 0 ? maxDayTargetMl : 2000;
  lines.push('饮水与摄入记录（近 7 个日历日窗口、所有健康记录累加）：');
  lines.push(`近 7 日饮水总量合计约 ${Math.round(totalHydrationMl)} ml；按 7 天均摊约 ${avgDailyMl.toFixed(0)} ml/天。`);
  const hydrationPct =
    assumedTarget > 0 ? Math.min(999, Math.round((avgDailyMl / assumedTarget) * 100)) : 0;
  lines.push(
    `有饮水或目标的记录日天数：${daysWithIntake.size}/7；常见日目标饮水 ${assumedTarget} ml；均摊达成率约 ${hydrationPct}%（若无记录则为默认假设）。`,
  );
}

export function buildPersonaContextText(
  slug: PersonaPortraitCacheSlug,
  user: UserRow | null,
  metrics: WeeklyReviewMetrics,
  healthRows: HealthRecordRow[],
): string {
  const lines: string[] = [];
  lines.push(`统计区间：${metrics.rangeDisplay}（${metrics.weekStartYmd} 至 ${metrics.weekEndYmd}）`);

  switch (slug) {
    case 'plan-completion':
      appendTaskMetricsLines(lines, metrics);
      break;
    case 'body-composition':
      lines.push('');
      appendUserBodyLines(lines, user);
      break;
    case 'hydration':
      lines.push('');
      appendHydrationLines(lines, healthRows);
      break;
    case 'savings':
      appendFinanceMetricsLines(lines, metrics);
      break;
    case 'ai-insight':
      appendTaskMetricsLines(lines, metrics);
      appendFinanceMetricsLines(lines, metrics);
      lines.push('');
      appendUserBodyLines(lines, user);
      lines.push('');
      appendHydrationLines(lines, healthRows);
      break;
  }

  lines.push('');
  const slugFocus: Record<PersonaPortraitCacheSlug, string> = {
    'plan-completion':
      '仅侧重任务页数据：任务完成/新建、习惯打卡与闭环节奏；禁止引用储蓄、记账、收支、饮水、心愿等非任务内容。',
    'body-composition': '仅侧重身高体重与 BMI 的生活方式侧写（非医疗诊断）；勿展开饮水、营养或财务。',
    hydration: '侧重饮水均值、目标达成率与自我照料节律。',
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
 * 应用启动后后台执行：对五个画像 slug，若本地尚无「今日」缓存则依次请求智谱并写入 SQLite。
 * Web 无数据库时直接跳过；失败仅打日志，不抛给 UI。
 */
export async function ensurePersonaPortraitsForTodayInBackground(): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  const today = localLogicalTodayYmd();

  try {
    const u = await getDefaultUser();
    const metrics = await fetchWeeklyReviewMetrics(new Date(), 'rolling-7');
    const rows = u?.id ? await getHealthRecordsLast7Days(u.id) : [];

    for (const slug of PERSONA_PORTRAIT_SLUGS) {
      const cached = await getPersonaPortraitCache(slug);
      if (cached?.cache_date_ymd === today) continue;

      const context = buildPersonaContextText(slug, u, metrics, rows);
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
