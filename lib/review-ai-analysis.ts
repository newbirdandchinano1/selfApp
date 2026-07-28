import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { totalFilledLength, type ReviewFieldValues } from '@/lib/repositories/insights/review-journal-body';
import { generateWeeklyReviewCoachingFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';

export type ReviewAiScope = 'daily' | 'weekly' | 'monthly';

export type ReviewAiAnalysisInput = {
  scope: ReviewAiScope;
  periodLabel: string;
  template: ReviewDimensionTemplate[];
  fields: ReviewFieldValues;
};

function compact(s: string, max = 600) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function scopeTitle(scope: ReviewAiScope): string {
  if (scope === 'daily') return '日复盘';
  if (scope === 'monthly') return '月复盘';
  return '周复盘';
}

function buildSections(input: ReviewAiAnalysisInput) {
  return input.template.map(dim => ({
    dimensionTitle: dim.title,
    columns: dim.columns.map(col => ({
      title: col.title,
      value: input.fields[col.id] ?? '',
    })),
  }));
}

function buildLocalAnalysis(input: ReviewAiAnalysisInput): string {
  const sections = buildSections(input);
  const all = sections.flatMap(s => s.columns.map(c => c.value)).join('\n');
  const lines: string[] = [];
  lines.push(`【总览】\n周期：${input.periodLabel}（${scopeTitle(input.scope)}）。`);
  lines.push('以下结合你写下的内容，给出参考性小结（非专业心理咨询）。');

  if (all.trim().length < 20) {
    lines.push('\n【提醒】\n你留下的文字较少，建议尽量写具体事件与感受，下次分析会更贴近你。');
  }

  lines.push('\n【对齐你写下的重点】');
  let any = false;
  for (const sec of sections) {
    const filled = sec.columns.filter(c => c.value.trim());
    if (filled.length === 0) continue;
    any = true;
    if (filled.length === 1 && sec.columns.length === 1) {
      lines.push(`· ${sec.dimensionTitle}：${compact(filled[0]!.value, 280)}`);
    } else {
      lines.push(`· ${sec.dimensionTitle}`);
      for (const c of filled) {
        lines.push(`  - ${c.title}：${compact(c.value, 220)}`);
      }
    }
  }
  if (!any) {
    lines.push('· 暂无已填写栏目。');
  }

  lines.push('\n【建议】');
  if (input.scope === 'daily') {
    lines.push('· 从今日记录里抽出 1 件「明天可复用」的小做法，写进明日 Top 目标。');
    lines.push('· 若有遗留问题，尽量拆成 30 分钟内能开动的第一步。');
  } else if (input.scope === 'monthly') {
    lines.push('· 把本月最有效的一条习惯或节奏，固定进下月日历。');
    lines.push('· 下月计划只保留 1～3 条主线，其余允许弹性。');
  } else {
    lines.push('· 从本周计划里抽出一条，写成「何时、何地、第一步做什么」三要素。');
    lines.push('· 未完成往往是颗粒度太大；试着把任务写成可立即开动的一小步。');
  }

  return lines.join('\n');
}

function buildPrompt(input: ReviewAiAnalysisInput): string {
  const sections = buildSections(input);
  const bodyParts: string[] = [
    `${scopeTitle(input.scope)}周期：${input.periodLabel}`,
    '',
    '请基于用户原文给出简洁、可执行的复盘分析与建议（中文）。',
    '',
  ];
  let idx = 1;
  for (const sec of sections) {
    bodyParts.push(`${idx}、${sec.dimensionTitle}（用户原文）：`);
    for (const col of sec.columns) {
      if (sec.columns.length > 1) bodyParts.push(`【${col.title}】`);
      bodyParts.push(col.value.trim() || '（未填写）');
      bodyParts.push('');
    }
    idx += 1;
  }
  return bodyParts.filter(Boolean).join('\n');
}

export async function generateReviewAiAnalysis(input: ReviewAiAnalysisInput): Promise<string> {
  const prompt = buildPrompt(input);
  const key = getActiveAiLlmApiKey().trim();
  if (key) {
    const r = await generateWeeklyReviewCoachingFromText({ apiKey: key, userPrompt: prompt });
    if (r.ok) return r.text;
  }
  return buildLocalAnalysis(input);
}

export function reviewHasEnoughTextForAi(fields: ReviewFieldValues): boolean {
  return totalFilledLength(fields) >= 30;
}
