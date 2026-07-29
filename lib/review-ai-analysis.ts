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

function periodNoun(scope: ReviewAiScope): string {
  if (scope === 'daily') return '今日';
  if (scope === 'monthly') return '本月';
  return '本周';
}

function nextPeriodHint(scope: ReviewAiScope): string {
  if (scope === 'daily') return '当天或次日';
  if (scope === 'monthly') return '下周或下月初';
  return '本周内或下周初';
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

function buildInstructionBlock(input: ReviewAiAnalysisInput): string {
  const title = scopeTitle(input.scope);
  const period = periodNoun(input.scope);
  const when = nextPeriodHint(input.scope);

  return [
    `【任务说明｜覆盖默认周教练模板】`,
    `你是严谨的${title}诊断助手，不是鸡汤/口号文案生成器。用户正在做「${title}」（周期：${input.periodLabel}）。`,
    `请忽略任何要求输出「总览 / 对齐重点 / 数据侧参考 / 温和结语」等周教练小节的默认模板；本次必须改用下方结构。`,
    '',
    `硬性规则：`,
    `1. 禁止空泛鼓励与口水话（如「继续加油」「相信自己」「贵在坚持」「保持积极」等无具体指向的句子）。`,
    `2. 每条结论必须能回溯到用户原文；引用或概括原文关键句，再下判断。原文不足时写「信息不足：还缺……」，禁止硬编。`,
    `3. 不要编造用户未写明的事实、情绪、人际关系或外部事件。`,
    `4. 涉及心理危机或自伤倾向时，简短提醒寻求专业帮助即可，勿展开诊断。`,
    `5. 必须且仅按以下三个小节标题（逐字）顺序输出，不要开场白、不要额外结语：`,
    '',
    `【目前的问题】`,
    `- 基于原文指出 1～3 个${period}已暴露的问题（执行缺口、节奏崩坏、情绪/精力、计划落空、自我欺骗等）。`,
    `- 每条格式：现象（对应原文）→ 为何成问题（1 句）。`,
    `- 若几乎找不出明确问题，写「暂未见明确问题」，并指出哪类信息不足，勿用夸奖凑字。`,
    '',
    `【潜在问题】`,
    `- 针对${period}复盘，推断 1～3 个「若按当前写法/节奏延续」可能出现的风险或盲点。`,
    `- 关注：未写清的关键缺口、栏目间矛盾、可复现的坏模式、计划过大/过虚、只写感受不写行动等。`,
    `- 推断须标明依据；信息不够则写清缺什么，禁止恐吓式夸张。`,
    '',
    `【建议】`,
    `- 给出 2～4 条可执行建议，优先小步、可在${when}验证。`,
    `- 每条须含：做什么 + 在什么情境/时段 + 如何算做完（验收标准）。`,
    `- 禁止只给抽象原则（如「注意劳逸结合」）；应落到可勾选的一步。`,
    '',
    `输出用简体中文；条目用「·」开头。`,
  ].join('\n');
}

function buildLocalAnalysis(input: ReviewAiAnalysisInput): string {
  const sections = buildSections(input);
  const all = sections.flatMap(s => s.columns.map(c => c.value)).join('\n');
  const period = periodNoun(input.scope);
  const when = nextPeriodHint(input.scope);
  const lines: string[] = [];

  lines.push('【目前的问题】');
  if (all.trim().length < 20) {
    lines.push('· 信息不足：留下的文字过少，暂无法判断具体问题；请补写具体事件、未完成事项与卡点。');
  } else {
    let any = false;
    for (const sec of sections) {
      const filled = sec.columns.filter(c => c.value.trim());
      if (filled.length === 0) continue;
      any = true;
      const snippet = compact(filled.map(c => c.value).join('；'), 160);
      lines.push(`· ${sec.dimensionTitle}侧：原文提到「${snippet}」——需核对是否已落到可执行的下一步，否则易停留在描述层。`);
    }
    if (!any) {
      lines.push(`· 暂未见明确问题：各栏目几乎未填，无法从${period}复盘中定位问题。`);
    }
  }

  lines.push('');
  lines.push('【潜在问题】');
  const emptyDims = sections.filter(s => s.columns.every(c => !c.value.trim()));
  if (emptyDims.length > 0) {
    lines.push(
      `· 有 ${emptyDims.length} 个维度未填写（如「${emptyDims
        .slice(0, 2)
        .map(d => d.dimensionTitle)
        .join('」「')}」），盲区可能被漏掉，后续难对照改进。`,
    );
  }
  if (input.scope === 'daily') {
    lines.push('· 若只写感受、不写「未完成原因 / 明日第一步」，次日容易重复同一卡点。');
  } else if (input.scope === 'monthly') {
    lines.push('· 若月度复盘缺少可复用的节奏模板，下月计划容易再次膨胀或空转。');
  } else {
    lines.push('· 若周计划颗粒度过大且无「第一步」，下周可能再次堆积未完成项。');
  }
  lines.push('· （本地兜底）未调用云端模型时仅能做结构提醒；填写更具体后重新分析会更准。');

  lines.push('');
  lines.push('【建议】');
  if (input.scope === 'daily') {
    lines.push('· 从今日记录抽出 1 件「明天可复用」的小做法，写进明日 Top1，并写验收标准（例如「完成/未完成」）。');
    lines.push(`· 任选 1 个遗留问题，拆成 ${when} 内 30 分钟能开动的第一步，写清何时做。`);
    lines.push('· 空着的维度补一句「今天为何空 / 是否可忽略」，避免默默漏项。');
  } else if (input.scope === 'monthly') {
    lines.push('· 把本月最有效的一条习惯固定进下月日历，并写连续天数验收。');
    lines.push('· 下月主线只保留 1～3 条，其余标为弹性；每条写「第一步」。');
  } else {
    lines.push('· 从本周计划抽出一条，写成「何时、何地、第一步做什么」，放进任务置顶。');
    lines.push('· 未完成项按「30 分钟可开动」改写；改不了的降级或砍掉。');
  }

  return lines.join('\n');
}

function buildPrompt(input: ReviewAiAnalysisInput): string {
  const sections = buildSections(input);
  const bodyParts: string[] = [buildInstructionBlock(input), '', '—— 用户复盘原文如下 ——', ''];
  let idx = 1;
  for (const sec of sections) {
    bodyParts.push(`${idx}、${sec.dimensionTitle}：`);
    for (const col of sec.columns) {
      if (sec.columns.length > 1) bodyParts.push(`【${col.title}】`);
      bodyParts.push(col.value.trim() || '（未填写）');
      bodyParts.push('');
    }
    idx += 1;
  }
  bodyParts.push('请严格按【目前的问题】【潜在问题】【建议】三节输出，勿使用其他小节标题。');
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
