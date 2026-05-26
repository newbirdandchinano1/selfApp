import type { WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { totalFilledLength } from '@/lib/repositories/insights/review-journal-body';
import type { ReviewFieldValues } from '@/lib/repositories/insights/review-journal-body';
import { generateWeeklyReviewCoachingFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

export type WeeklyCoachingSection = {
  dimensionTitle: string;
  columns: { title: string; value: string }[];
};

export type WeeklyCoachingInput = {
  weekRangeLabel: string;
  template: ReviewDimensionTemplate[];
  fields: ReviewFieldValues;
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
    `心愿单更新: ${m.wishUpdates} 条`,
  ].join('\n');
}

function buildSections(input: WeeklyCoachingInput): WeeklyCoachingSection[] {
  const out: WeeklyCoachingSection[] = [];
  for (const dim of input.template) {
    const columns = dim.columns.map(col => ({
      title: col.title,
      value: input.fields[col.id] ?? '',
    }));
    out.push({ dimensionTitle: dim.title, columns });
  }
  return out;
}

function allUserText(sections: WeeklyCoachingSection[]): string {
  return sections
    .flatMap(s => s.columns.map(c => c.value))
    .join('\n');
}

function buildLocalCoaching(input: WeeklyCoachingInput): string {
  const score = Math.min(5, Math.max(1, input.executionScore || 3));
  const sections = buildSections(input);
  const all = allUserText(sections);

  const lines: string[] = [];
  lines.push(`【总览】\n周期：${input.weekRangeLabel}。你为本周期自评执行分 ${score}/5。`);
  lines.push('以下结合你的文字复盘与 App 内本周统计，给出参考性小结（非专业心理咨询）。');

  if (all.trim().length < 20) {
    lines.push('\n【提醒】\n你留下的文字较少，建议尽量写具体事件与感受，下次 AI/本地建议会更贴近你。');
  }

  lines.push('\n【对齐你写下的重点】');
  for (const sec of sections) {
    const filled = sec.columns.filter(c => c.value.trim());
    if (filled.length === 0) continue;
  if (filled.length === 1 && sec.columns.length === 1) {
      lines.push(`· ${sec.dimensionTitle}：${compact(filled[0].value, 280)}`);
    } else {
      lines.push(`· ${sec.dimensionTitle}`);
      for (const c of filled) {
        lines.push(`  - ${c.title}：${compact(c.value, 220)}`);
      }
    }
  }

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
  const plansCol = sections.find(s => s.dimensionTitle.includes('计划'))?.columns[0]?.value ?? '';
  if (input.metrics && input.metrics.tasksCompleted === 0 && plansCol.includes('完成')) {
    lines.push('· 自述里谈到完成，但系统里本周期完成任务为 0：核对是否忘了在任务里点「完成」，或任务日期不在统计区间内。');
  }

  lines.push('\n【下周可做的一件事】');
  const nextSec = sections.find(s => s.dimensionTitle.includes('下周'));
  const nextText = nextSec?.columns.map(c => c.value).join('\n').trim() ?? '';
  lines.push(
    nextText
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
  const sections = buildSections(input);
  const bodyParts: string[] = [
    `复盘周期：${input.weekRangeLabel}`,
    `自评执行分（1-5）：${input.executionScore}`,
    '',
  ];
  let idx = 1;
  for (const sec of sections) {
    bodyParts.push(`${idx}、${sec.dimensionTitle}（用户原文）：`);
    for (const col of sec.columns) {
      if (sec.columns.length > 1) {
        bodyParts.push(`【${col.title}】`);
      }
      bodyParts.push(col.value.trim() || '（未填写）');
      bodyParts.push('');
    }
    idx += 1;
  }
  bodyParts.push('App 内本周期统计（供对照，勿与用户原文矛盾时武断否定用户）：');
  bodyParts.push(buildMetricsBlock(input.metrics));
  if (input.dailyReviewsDigest && input.dailyReviewsDigest.trim().length > 0) {
    bodyParts.push('');
    bodyParts.push('以下为近七日「每日复盘」用户原文（若有重复或空缺以用户周记为准）：');
    bodyParts.push(input.dailyReviewsDigest.trim());
  }
  return bodyParts.filter(Boolean).join('\n');
}

export async function generateWeeklyReviewCoaching(input: WeeklyCoachingInput): Promise<string> {
  const prompt = buildPromptForModel(input);
  const remote = await tryZhipuWeeklyCoaching(prompt);
  if (remote) return remote;
  return buildLocalCoaching(input);
}

/** 供 UI 校验最低填写量 */
export function weeklyReviewHasEnoughText(template: ReviewDimensionTemplate[], fields: ReviewFieldValues): boolean {
  return totalFilledLength(fields) >= 30;
}
