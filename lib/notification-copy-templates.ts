/**
 * 通知文案 L0/L1：动态槽位 + 规则变体池。
 * 登记路径默认走这里；AI 缓存命中时仍优先 AI（见 notification-ai-copy）。
 */

export type NotificationCopy = { title: string; body: string };

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/** 稳定哈希：同 seed 同结果，便于预览/测试可复现 */
export function pickVariant(seed: string, variants: readonly string[]): string {
  if (variants.length === 0) return '';
  if (variants.length === 1) return variants[0]!;
  let h = 2166136261;
  const s = seed || 'x';
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return variants[Math.abs(h) % variants.length]!;
}

export function dayPartFromHour(hour: number): DayPart {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  if (h < 11) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

function dayPartGreeting(part: DayPart): string {
  switch (part) {
    case 'morning':
      return '早上好';
    case 'afternoon':
      return '下午好';
    case 'evening':
      return '傍晚好';
    default:
      return '今晚';
  }
}

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + '…';
}

// ─── 习惯 ───────────────────────────────────────────────

export function buildHabitPrimaryCopy(params: {
  habitName: string;
  intensity: 'soft' | 'normal' | 'strong';
  kind?: 'build' | 'break' | 'task' | string;
  /** 如 1/3；戒除可省略 */
  progressLabel?: string | null;
  hour?: number;
  seed?: string;
}): NotificationCopy {
  const name = truncate(params.habitName || '习惯', 18);
  const part = dayPartFromHour(params.hour ?? new Date().getHours());
  const seed = params.seed ?? `${name}|${params.intensity}|${part}`;
  const progress = params.progressLabel?.trim();

  const title =
    params.intensity === 'strong'
      ? pickVariant(seed + '|t', ['习惯 · 重点', '别放过这一下', '重点打卡'])
      : pickVariant(seed + '|t', ['习惯时刻', '打卡一下', dayPartGreeting(part)]);

  const breakBodies = [
    `${name}：今天标记一下就好`,
    `守住 ${name}，记一笔今日状态`,
    `${name} · 花几秒确认今天`,
  ];
  const progressBodies = progress
    ? [
        `${name} · 已完成 ${progress}`,
        `${name} 进度 ${progress}，再推一把`,
        `${name}：${progress}，到点补一记`,
      ]
    : [
        `${name}，到点了`,
        `${dayPartGreeting(part)}，轮到 ${name}`,
        `花半分钟完成 ${name}`,
        `${name} · 保持节奏`,
      ];

  const bodies =
    params.kind === 'break' ? breakBodies : progress ? progressBodies : progressBodies;

  return { title, body: pickVariant(seed + '|b', bodies) };
}

export function buildHabitEveningWrapCopy(params: {
  habitName: string;
  progressLabel?: string | null;
  seed?: string;
}): NotificationCopy {
  const name = truncate(params.habitName || '习惯', 18);
  const seed = params.seed ?? `${name}|wrap`;
  const progress = params.progressLabel?.trim();
  const title = pickVariant(seed + '|t', ['习惯收口', '今天还差一步', '傍晚补记']);
  const bodies = progress
    ? [
        `${name} 还在 ${progress}，收个尾？`,
        `${name} 今日 ${progress}，睡前补上也好`,
        `还没完成 ${name}（${progress}）`,
      ]
    : [
        `${name} 今天还没打上`,
        `傍晚了，${name} 要不要补一记`,
        `${name} · 今天还差最后一下`,
      ];
  return { title, body: pickVariant(seed + '|b', bodies) };
}

// ─── 日程格 ─────────────────────────────────────────────

export function buildScheduleSlotCopy(params: {
  subjectTitle: string;
  kind: 'task' | 'project' | 'habit';
  startHm?: string;
  seed?: string;
}): NotificationCopy {
  const subject = truncate(params.subjectTitle || '安排', 20);
  const seed = params.seed ?? `${params.kind}|${subject}|${params.startHm ?? ''}`;
  const hm = params.startHm?.trim();

  if (params.kind === 'project') {
    return {
      title: pickVariant(seed + '|t', ['推进项目', '项目时段', '该动手了']),
      body: hm
        ? pickVariant(seed + '|b', [
            `${subject} · ${hm} 开始`,
            `${hm} 起：${subject}`,
            `项目「${subject}」快到点了`,
          ])
        : subject,
    };
  }
  if (params.kind === 'habit') {
    return {
      title: pickVariant(seed + '|t', ['习惯时段', '入格习惯', '时段到了']),
      body: hm ? `${subject} · ${hm}` : subject,
    };
  }
  return {
    title: pickVariant(seed + '|t', ['该做了', '待办时段', '接下来']),
    body: hm
      ? pickVariant(seed + '|b', [
          `${subject} · ${hm} 开始`,
          `${hm}：${subject}`,
          `准备开始「${subject}」`,
        ])
      : subject,
  };
}

// ─── 待办截止 ───────────────────────────────────────────

export function buildTaskDeadlineCopy(params: {
  taskTitle: string;
  kind: 'due_soon' | 'overdue_sticky' | string;
  intensity?: 'soft' | 'normal' | 'strong';
  dueYmd?: string;
  seed?: string;
}): NotificationCopy {
  const titleText = truncate(params.taskTitle || '待办', 22);
  const strong = params.intensity === 'strong';
  const seed = params.seed ?? `${params.kind}|${titleText}|${params.dueYmd ?? ''}`;

  if (params.kind === 'overdue_sticky') {
    return {
      title: strong
        ? pickVariant(seed + '|t', ['今日滞留 · 重点', '过期未完成', '别再拖了'])
        : pickVariant(seed + '|t', ['今日滞留', '还堆在今天', '过期提醒']),
      body: pickVariant(seed + '|b', [
        titleText,
        `「${titleText}」还在今天`,
        params.dueYmd ? `${titleText} · 截止 ${params.dueYmd}` : titleText,
      ]),
    };
  }

  return {
    title: strong
      ? pickVariant(seed + '|t', ['该做 · 重点', '临期重点', '别错过截止'])
      : pickVariant(seed + '|t', ['该做了', '临期提醒', '截止将近']),
    body: pickVariant(seed + '|b', [
      titleText,
      params.dueYmd ? `${titleText} · 截止 ${params.dueYmd}` : `「${titleText}」快到期了`,
      `抽空处理：${titleText}`,
    ]),
  };
}

// ─── 项目推进 ───────────────────────────────────────────

export function buildProjectProgressCopy(params: {
  projectName: string;
  kind: 'stale' | 'due_soon' | string;
  lastPlacementYmd?: string | null;
  seed?: string;
}): NotificationCopy {
  const name = truncate(params.projectName || '项目', 18);
  const seed = params.seed ?? `${params.kind}|${name}`;
  const title = pickVariant(seed + '|t', ['推进项目', '项目在等你', '安排一下']);
  if (params.kind === 'due_soon') {
    return {
      title,
      body: pickVariant(seed + '|b', [
        `${name} · 临近截止，安排推进`,
        `「${name}」快到截止了，入一格？`,
        `${name} 临期，今天推进一步`,
      ]),
    };
  }
  const staleHint = params.lastPlacementYmd
    ? `上次入格 ${params.lastPlacementYmd}`
    : '多日未入格';
  return {
    title,
    body: pickVariant(seed + '|b', [
      `${name} · ${staleHint}，推进一下`,
      `「${name}」安静太久了，排个时段？`,
      `${name}：给自己留一格就好`,
    ]),
  };
}

// ─── 健康 ───────────────────────────────────────────────

export function buildHealthIntakeCopy(params: {
  primaryLabel: string;
  remainText: string;
  progress: string;
  hint: string;
  otherLabels: string[];
  role?: 'morning' | 'noon' | 'afternoon' | 'evening' | string;
  seed?: string;
}): NotificationCopy {
  const seed =
    params.seed ??
    `${params.role ?? 'period'}|${params.primaryLabel}|${params.remainText}`;
  const title =
    params.role === 'evening'
      ? pickVariant(seed + '|t', ['健康收口', '今天补一补', '晚上留意摄入'])
      : params.role === 'morning'
        ? pickVariant(seed + '|t', ['早上补补', '晨间摄入', '健康小提醒'])
        : params.role === 'noon'
          ? pickVariant(seed + '|t', ['午间看一眼', '午饭前后', '健康小提醒'])
          : params.role === 'afternoon'
            ? pickVariant(seed + '|t', ['下午补一补', '进度提醒', '健康小提醒'])
            : pickVariant(seed + '|t', ['健康小提醒', '摄入看一眼', '补一点']);

  const others = params.otherLabels.filter(Boolean);
  const core = `${params.primaryLabel}还差 ${params.remainText}（${params.progress}）`;
  const withHint = `${core} · ${params.hint}`;
  const body =
    others.length > 0
      ? pickVariant(seed + '|b', [
          `${withHint}；另有${others.join('、')}未跟上`,
          `${core}；${others.join('、')}也还差一口气`,
          `优先补 ${params.primaryLabel}（${params.progress}），其余稍后再说`,
        ])
      : pickVariant(seed + '|b', [withHint, `${core}，${params.hint}`, `差 ${params.remainText}：${params.hint}`]);

  return { title, body };
}

// ─── 财务 ───────────────────────────────────────────────

export function buildFinanceScheduledCopy(params: {
  name: string;
  amountLabel: string;
  kind: 'advance' | 'evening_wrap' | string;
  dueYmd?: string;
  timeLabel?: string;
  seed?: string;
}): NotificationCopy {
  const name = truncate(params.name || '定时支出', 14);
  const seed = params.seed ?? `${params.kind}|${name}|${params.dueYmd ?? ''}`;
  if (params.kind === 'evening_wrap') {
    return {
      title: pickVariant(seed + '|t', [
        `未入账 · ${name}`,
        '定时支出还没记',
        `${name} 待确认`,
      ]),
      body: pickVariant(seed + '|b', [
        `今日 ${params.amountLabel} 尚未入账，记得确认。`,
        `${name} ${params.amountLabel} 还在等你入账`,
        `花半分钟确认 ${name}（${params.amountLabel}）`,
      ]),
    };
  }
  const when =
    params.dueYmd && params.timeLabel
      ? `${params.dueYmd} ${params.timeLabel}`
      : params.dueYmd || params.timeLabel || '';
  return {
    title: pickVariant(seed + '|t', [`支出提醒 · ${name}`, name, '定时支出将至']),
    body: when
      ? pickVariant(seed + '|b', [
          `应记 ${when} · ${params.amountLabel}`,
          `${when} 记一笔 ${params.amountLabel}`,
          `${name} ${params.amountLabel} · ${when}`,
        ])
      : `${name} · ${params.amountLabel}`,
  };
}

export function buildBudgetThresholdCopy(params: {
  kind: 't50' | 't80' | 'over' | string;
  percent: number;
  usedLabel: string;
  totalLabel: string;
  seed?: string;
}): NotificationCopy {
  const pct = Math.round(params.percent);
  const seed = params.seed ?? `${params.kind}|${pct}`;
  const usedLine = `本周期已用 ${pct}%（${params.usedLabel} / ${params.totalLabel}）`;
  if (params.kind === 'over') {
    return {
      title: pickVariant(seed + '|t', ['预算已超支', '超支了', '预算告警']),
      body: pickVariant(seed + '|b', [
        `${usedLine}，留意后续开支。`,
        `${usedLine}。先缓一缓？`,
        `已用 ${pct}%，后面精打细算一点。`,
      ]),
    };
  }
  if (params.kind === 't80') {
    return {
      title: pickVariant(seed + '|t', ['预算已用八成', '花得差不多了', '预算提醒']),
      body: pickVariant(seed + '|b', [usedLine, `${usedLine}，看看还能怎么控。`, `八成已过：${usedLine}`]),
    };
  }
  return {
    title: pickVariant(seed + '|t', ['预算过半', '花了一半', '预算进度']),
    body: pickVariant(seed + '|b', [usedLine, `${usedLine}，节奏还行吗？`, `过半了：${usedLine}`]),
  };
}

export function buildFinanceSavingsCopy(params: {
  gapLabel: string;
  dailyLabel: string;
  seed?: string;
}): NotificationCopy {
  const seed = params.seed ?? `savings|${params.gapLabel}`;
  return {
    title: pickVariant(seed + '|t', ['储蓄轻催', '存一点', '目标还差一口气']),
    body: pickVariant(seed + '|b', [
      `距目标还差 ${params.gapLabel} · 建议每日存 ${params.dailyLabel}`,
      `缺口 ${params.gapLabel}，今天存 ${params.dailyLabel} 也行`,
      `向目标靠近：每日约 ${params.dailyLabel}`,
    ]),
  };
}

export function buildFinanceLedgerWrapCopy(params?: { seed?: string }): NotificationCopy {
  const seed = params?.seed ?? 'ledger-wrap';
  return {
    title: pickVariant(seed + '|t', ['今天还没记账', '记一笔？', '流水空着']),
    body: pickVariant(seed + '|b', [
      '花半分钟记一笔，预算与复盘会更准。',
      '随便记一笔今天的开销就好。',
      '记账收口：一笔也算有记录。',
    ]),
  };
}

// ─── 复盘 ───────────────────────────────────────────────

export function buildDailyReviewCopy(params: {
  bodyHint: string;
  hour?: number;
  seed?: string;
}): NotificationCopy {
  const part = dayPartFromHour(params.hour ?? 21);
  const seed = params.seed ?? `daily-review|${part}|${params.bodyHint.slice(0, 24)}`;
  return {
    title: pickVariant(seed + '|t', ['今日复盘', '写两句今天', dayPartGreeting(part)]),
    body: params.bodyHint.trim() || pickVariant(seed + '|b', ['花几分钟收个尾', '记下今天最想留下的']),
  };
}

export function buildWeeklyReviewCopy(params: {
  bodyHint: string;
  seed?: string;
}): NotificationCopy {
  const seed = params.seed ?? `weekly-review|${params.bodyHint.slice(0, 24)}`;
  return {
    title: pickVariant(seed + '|t', ['本周复盘', '周刊时间', '回看这一周']),
    body: params.bodyHint.trim() || pickVariant(seed + '|b', ['花几分钟整理本周', '给这一周留个脚印']),
  };
}

// ─── 强提醒升级 ─────────────────────────────────────────

/** 替代硬前缀「再次提醒：」 */
export function buildEscalationBody(originalBody: string, wave: number): string {
  const base = originalBody.replace(/^再次提醒：/, '').trim() || '还有一件事等你';
  const seed = `esc|${wave}|${base}`;
  if (wave <= 1) {
    return pickVariant(seed, [`还在：${base}`, `别忘了 · ${base}`, `再看一眼：${base}`]);
  }
  return pickVariant(seed, [
    `最后提醒 · ${base}`,
    `再催一次：${base}`,
    `还没动？${base}`,
  ]);
}

/** 前台合并多条提醒时的 Toast 文案 */
export function buildForegroundClusterToast(
  items: { title: string; body: string }[],
): string {
  if (items.length === 0) return '有新提醒';
  if (items.length === 1) {
    const one = items[0]!;
    const body = one.body.trim();
    return body ? `${one.title} · ${body}` : one.title;
  }
  const first = items[0]!.title;
  return `有 ${items.length} 条提醒 · ${first}等`;
}
