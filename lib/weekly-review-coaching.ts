import type { WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import { generateWeeklyReviewCoachingFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

export type WeeklyCoachingInput = {
  weekRangeLabel: string;
  section_summary: string;
  section_plans: string;
  section_reflect: string;
  section_learnings: string;
  section_next_week: string;
  executionScore: number;
  metrics: WeeklyReviewMetrics | null;
  /** 近七日每日复盘原文汇编，供周度建议对照 */
  dailyReviewsDigest?: string;
};

function compact(s: string, max = 600) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function hasAnyOf(text: string, keys: string[]) {
  const t = text.toLowerCase();
  return keys.some(k => text.includes(k) || t.includes(k.toLowerCase()));
}

function buildMetricsBlock(m: WeeklyReviewMetrics | null): string {
  if (!m) return '（本周期暂无自动统计数据或读取失败。）';
  return [
    `完成任务（系统）: ${m.tasksCompleted} 项`,
    `新建任务（系统）: ${m.tasksCreated} 项`,
    `习惯打卡合计: ${m.habitCheckInTotal} 次`,
    `存钱入账: ¥${m.savingsWeekTotal.toLocaleString('zh-CN')}`,
    `记账收入: ¥${m.financeIncome.toLocaleString('zh-CN')}，支出: ¥${m.financeExpense.toLocaleString('zh-CN')}`,
    `心愿清单更新: ${m.wishUpdates} 条`,
  ].join('\n');
}

function buildLocalCoaching(input: WeeklyCoachingInput): string {
  const score = Math.min(5, Math.max(1, input.executionScore || 3));
  const all = [
    input.section_summary,
    input.section_plans,
    input.section_reflect,
    input.section_learnings,
    input.section_next_week,
  ].join('\n');

  const lines: string[] = [];
  lines.push(`【总览】\n周期：${input.weekRangeLabel}。你为本周期自评执行分 ${score}/5。`);
  lines.push('以下结合你的文字复盘与 App 内本周统计，给出参考性小结（非专业心理咨询）。');

  if (all.trim().length < 20) {
    lines.push('\n【提醒】\n你留下的文字较少，建议尽量写具体事件与感受，下次 AI/本地建议会更贴近你。');
  }

  lines.push('\n【对齐你写下的重点】');
  if (input.section_summary.trim())
    lines.push(`· 一周回顾：${compact(input.section_summary, 280)}`);
  if (input.section_plans.trim())
    lines.push(`· 计划与交付：${compact(input.section_plans, 280)}`);
  if (input.section_reflect.trim())
    lines.push(`· 反思：${compact(input.section_reflect, 220)}`);
  if (input.section_learnings.trim())
    lines.push(`· 收获：${compact(input.section_learnings, 220)}`);
  if (input.section_next_week.trim())
    lines.push(`· 下周打算：${compact(input.section_next_week, 220)}`);

  lines.push('\n【数据侧参考（可与自述对照）】');
  lines.push(buildMetricsBlock(input.metrics));

  const digest = (input.dailyReviewsDigest ?? '').trim();
  if (digest.length > 0) {
    lines.push('\n【近七日每日复盘（用户原文摘录）】');
    lines.push(compact(digest, 1200));
  }

  lines.push('\n【建议与修正提醒】');
  if (score <= 2) {
    lines.push('· 自评偏低时，优先保护睡眠与节律，把「下周」拆成 1～2 个极小的可交付项即可。');
    lines.push('· 未完成往往不是意志力问题，而是颗粒度太大；试试把任务写成 30 分钟内能开动的第一步。');
  } else if (score >= 4) {
    lines.push('· 自评较高：在保持节奏的同时，留一点缓冲给突发与家庭互动，避免「全速」后反弹。');
    lines.push('· 可把本周一条有效做法固定成模板（例如固定晚间 15 分钟复盘），降低下周启动成本。');
  } else {
    lines.push('· 中段自评很常见：建议下周选「一件主线任务」写进日历，其余允许弹性完成。');
  }

  if (hasAnyOf(all, ['拖延', '分心', '手机', '熬夜', '太累', '焦虑', '压力'])) {
    lines.push('· 你提到了压力或分心：尝试把高认知任务放在精力最好的时段，低能量时段只做整理/记账类。');
  }
  if (hasAnyOf(all, ['家庭', '孩子', '伴侣', '父母'])) {
    lines.push('· 家庭相关叙述：下周计划里显式预留「不可压缩时间」，再排工作，会减少内疚与冲突。');
  }
  if (input.metrics && input.metrics.tasksCompleted === 0 && input.section_plans.includes('完成')) {
    lines.push('· 自述里谈到完成，但系统里本周期完成任务为 0：核对是否忘了在任务里点「完成」，或任务日期不在统计区间内。');
  }

  lines.push('\n【下周可做的一件事】');
  lines.push(
    input.section_next_week.trim()
      ? `· 从你「下周计划」里抽出一条，写成「何时、何地、第一步做什么」三要素。`
      : `· 用 10 分钟只写「下周唯一主线」一条，并放进任务列表的置顶。`,
  );

  lines.push('\n【是否调整】\n生成后可在页面勾选「是否愿意调整任务/存钱/时间安排」，仅作自我承诺记录，随时可改。');

  return lines.join('\n');
}

async function tryZhipuWeeklyCoaching(prompt: string): Promise<string | null> {
  const key = getActiveAiLlmApiKey().trim();
  if (!key) return null;
  const r = await generateWeeklyReviewCoachingFromText({ apiKey: key, userPrompt: prompt });
  return r.ok ? r.text : null;
}

function buildPromptForModel(input: WeeklyCoachingInput): string {
  return [
    `复盘周期：${input.weekRangeLabel}`,
    `自评执行分（1-5）：${input.executionScore}`,
    '',
    '一、汇总本周事件（用户原文）：',
    input.section_summary || '（未填写）',
    '',
    '二、计划完成情况（用户原文）：',
    input.section_plans || '（未填写）',
    '',
    '三、本周反思（用户原文）：',
    input.section_reflect || '（未填写）',
    '',
    '四、复盘收获（用户原文）：',
    input.section_learnings || '（未填写）',
    '',
    '五、下周计划（用户原文）：',
    input.section_next_week || '（未填写）',
    '',
    'App 内本周期统计（供对照，勿与用户原文矛盾时武断否定用户）：',
    buildMetricsBlock(input.metrics),
    input.dailyReviewsDigest && input.dailyReviewsDigest.trim().length > 0
      ? [
          '',
          '以下为近七日「每日复盘」用户原文（若有重复或空缺以用户周记为准）：',
          input.dailyReviewsDigest.trim(),
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function generateWeeklyReviewCoaching(input: WeeklyCoachingInput): Promise<string> {
  const prompt = buildPromptForModel(input);
  const remote = await tryZhipuWeeklyCoaching(prompt);
  if (remote) return remote;
  return buildLocalCoaching(input);
}
