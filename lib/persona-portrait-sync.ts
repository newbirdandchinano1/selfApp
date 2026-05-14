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
import { generatePersonaPortraitFromContext, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

export function localCalendarYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildPersonaContextText(
  slug: PersonaPortraitCacheSlug,
  user: UserRow | null,
  metrics: WeeklyReviewMetrics,
  healthRows: HealthRecordRow[],
): string {
  const lines: string[] = [];
  lines.push(`统计区间：${metrics.rangeDisplay}（${metrics.weekStartYmd} 至 ${metrics.weekEndYmd}）`);
  lines.push(
    `完成任务：${metrics.tasksCompleted} 项；新建任务：${metrics.tasksCreated} 项；习惯打卡合计：${metrics.habitCheckInTotal} 次。`,
  );
  lines.push(`存钱计划入账合计：¥${metrics.savingsWeekTotal.toLocaleString('zh-CN')}。`);
  lines.push(
    `记账：收入 ¥${metrics.financeIncome.toLocaleString('zh-CN')}，支出 ¥${metrics.financeExpense.toLocaleString('zh-CN')}。`,
  );
  lines.push(`心愿清单更新：${metrics.wishUpdates} 条。`);

  if (user) {
    lines.push('');
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
  lines.push('');
  lines.push('饮水与摄入记录（近 7 个日历日窗口、所有健康记录累加）：');
  lines.push(`近 7 日饮水总量合计约 ${Math.round(totalHydrationMl)} ml；按 7 天均摊约 ${avgDailyMl.toFixed(0)} ml/天。`);
  lines.push(`有饮水或目标的记录日天数：${daysWithIntake.size}；常见日目标饮水 ${assumedTarget} ml（若无记录则为默认假设）。`);

  lines.push('');
  lines.push(`当前请求的画像维度 persona_slug = ${slug}。请围绕该维度组织主标题区与正文，不要编造摘要中未出现的金额或医疗诊断。`);
  return lines.join('\n');
}

/**
 * 应用启动后后台执行：对五个画像 slug，若本地尚无「今日」缓存则依次请求智谱并写入 SQLite。
 * Web 无数据库时直接跳过；失败仅打日志，不抛给 UI。
 */
export async function ensurePersonaPortraitsForTodayInBackground(): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  const today = localCalendarYmd();

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
