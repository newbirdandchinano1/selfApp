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

  lines.push('\n【目前的问题】');
  if (score <= 2) {
    lines.push('· 自评执行分偏低：本周交付与节律可能已明显脱节，需先缩范围再谈效率。');
  } else if (all.trim().length < 20) {
    lines.push('· 信息不足：周记文字过少，暂无法定位具体问题。');
  } else {
    lines.push('· 对照各栏目自述，优先核对「计划 vs 实际完成」是否自洽，避免只写愿景不写卡点。');
  }
  const plansCol = sections.find(s => s.dimensionTitle.includes('计划'))?.columns[0]?.value ?? '';
  if (input.metrics && input.metrics.tasksCompleted === 0 && plansCol.includes('完成')) {
    lines.push('· 自述谈到完成，但系统完成任务为 0：可能未在任务里点完成，或日期不在统计区间。');
  }

  lines.push('\n【潜在问题】');
  if (hasAnyOf(all, ['拖延', '分心', '手机', '熬夜', '太累', '焦虑', '压力'])) {
    lines.push('· 原文已出现压力/分心线索：若高认知任务仍挤在低能量时段，下周可能重复空转。');
  }
  if (hasAnyOf(all, ['家庭', '孩子', '伴侣', '父母'])) {
    lines.push('· 家庭相关叙述较多：若不预留不可压缩时间，工作计划易被冲掉并累积内疚。');
  }
  lines.push('· 若下周计划颗粒度过大且无「第一步」，未完成项可能继续堆积。');

  lines.push('\n【建议与修正提醒】');
  if (score <= 2) {
    lines.push('· 把「下周」拆成 1～2 个极小可交付项；每项写清 30 分钟内能开动的第一步与验收标准。');
  } else if (score >= 4) {
    lines.push('· 保留一条本周有效做法写成模板（如晚间 15 分钟复盘），并显式留缓冲时段防反弹。');
  } else {
    lines.push('· 下周只选「一件主线」写进日历（何时/何地/第一步），其余标为弹性。');
  }

  lines.push('\n【下周可做的一件事】');
  const nextSec = sections.find(s => s.dimensionTitle.includes('下周'));
  const nextText = nextSec?.columns.map(c => c.value).join('\n').trim() ?? '';
  lines.push(
    nextText
      ? `· 从你「下周计划」里抽出一条，写成「何时、何地、第一步做什么」三要素，并写如何算完成。`
      : `· 用 10 分钟只写「下周唯一主线」一条，放进任务置顶，并写验收标准。`,
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
    '【写作要求】禁止空泛鼓励与口水话；每条结论须回溯用户原文或统计数据；信息不足时写明缺什么，勿硬编。',
    '在固定小节内务必覆盖三点实质内容：① 本周目前暴露的问题；② 若延续当前节奏的潜在风险；③ 可执行建议（做什么/何时/如何验收）。',
    '',
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
