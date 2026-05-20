import {
  DEFAULT_CARBOHYDRATE_TARGET_G,
  DEFAULT_HYDRATION_TARGET_ML,
  DEFAULT_PROTEIN_TARGET_G,
  DEFAULT_SODIUM_TARGET_MG,
  globalCarbohydrateTargetG,
  globalHydrationTargetMl,
  globalProteinTargetG,
  globalSodiumTargetMg,
} from '@/lib/global-intake-targets';
import type { DailyAiIntakeTargetsRow } from '@/lib/daily-intake-ai-targets';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import type { UserRow } from '@/lib/repositories/users/user.types';

export type IntakeTargetsSnapshot = {
  hydrationMl: number;
  proteinG: number;
  carbohydrateG: number;
  sodiumMg: number;
};

export function getIntakeTargetsSnapshot(): IntakeTargetsSnapshot {
  return {
    hydrationMl: globalHydrationTargetMl,
    proteinG: globalProteinTargetG,
    carbohydrateG: globalCarbohydrateTargetG,
    sodiumMg: globalSodiumTargetMg,
  };
}

export function ymdAddDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

type DayTotals = { hydration: number; protein: number; carbohydrate: number; sodium: number };

function aggregateByDate(rows: HealthRecordRow[]): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>();
  for (const r of rows) {
    const key = r.record_date;
    const cur = map.get(key) ?? { hydration: 0, protein: 0, carbohydrate: 0, sodium: 0 };
    cur.hydration += Number(r.hydration) || 0;
    cur.protein += Number(r.protein) || 0;
    cur.carbohydrate += Number(r.carbohydrate) || 0;
    cur.sodium += Number(r.sodium) || 0;
    map.set(key, cur);
  }
  return map;
}

function sumWeekTotals(rows: HealthRecordRow[]): DayTotals {
  const t: DayTotals = { hydration: 0, protein: 0, carbohydrate: 0, sodium: 0 };
  for (const r of rows) {
    t.hydration += Number(r.hydration) || 0;
    t.protein += Number(r.protein) || 0;
    t.carbohydrate += Number(r.carbohydrate) || 0;
    t.sodium += Number(r.sodium) || 0;
  }
  return t;
}

function countDaysWithMetric(rows: HealthRecordRow[], metric: keyof DayTotals): number {
  const days = new Set<string>();
  for (const r of rows) {
    const v = Number(r[metric]) || 0;
    if (v > 0) days.add(r.record_date);
  }
  return days.size;
}

function weekProgressScore(totals: DayTotals, targets: IntakeTargetsSnapshot): number {
  const targetSum =
    targets.hydrationMl + targets.proteinG + targets.carbohydrateG + targets.sodiumMg;
  if (targetSum <= 0) return 0;
  const intakeSum = totals.hydration + totals.protein + totals.carbohydrate + totals.sodium;
  return Math.max(0, (intakeSum / (targetSum * 7)) * 100);
}

function formatWeekDeltaPct(current: number, previous: number): string {
  if (previous <= 0) return current <= 0 ? '0%（上周无有效记录）' : '+100%（上周无有效记录）';
  const delta = ((current - previous) / previous) * 100;
  const rounded = Math.round(delta);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

function buildSevenDayDigestLines(rows: HealthRecordRow[], endYmd: string): string[] {
  const byDate = aggregateByDate(rows);
  const lines: string[] = [];
  const [y, m, d] = endYmd.split('-').map(Number);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(end.getTime())) {
    for (const [ymd, v] of [...byDate.entries()].sort()) {
      lines.push(
        `${ymd}：水分 ${Math.round(v.hydration)} ml，蛋白质 ${Math.round(v.protein)} g，碳水 ${Math.round(v.carbohydrate)} g，钠 ${Math.round(v.sodium)} mg`,
      );
    }
    return lines.length ? lines : ['（近 7 日无摄入记录）'];
  }
  for (let i = 6; i >= 0; i -= 1) {
    const dt = new Date(end);
    dt.setDate(dt.getDate() - i);
    const ymd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const v = byDate.get(ymd) ?? { hydration: 0, protein: 0, carbohydrate: 0, sodium: 0 };
    lines.push(
      `${ymd}：水分 ${Math.round(v.hydration)} ml，蛋白质 ${Math.round(v.protein)} g，碳水 ${Math.round(v.carbohydrate)} g，钠 ${Math.round(v.sodium)} mg`,
    );
  }
  return lines;
}

export type HealthCardPreview = {
  heroMain: string;
  heroSub: string;
  tag: string;
};

export function buildHealthNutrientStats(
  healthRows: HealthRecordRow[],
  targets: IntakeTargetsSnapshot = getIntakeTargetsSnapshot(),
): { label: string; value: string; hint: string }[] {
  const week = sumWeekTotals(healthRows);
  const avgHyd = week.hydration / 7;
  const avgPro = week.protein / 7;
  const avgCarb = week.carbohydrate / 7;
  const avgNa = week.sodium / 7;
  const pct = (current: number, target: number) =>
    target > 0 ? Math.min(999, Math.round((current / target) * 100)) : 0;
  const fmtMl = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}L` : `${Math.round(n)}ml`);
  return [
    {
      label: '饮水均值',
      value: avgHyd >= 50 ? fmtMl(avgHyd) : '—',
      hint: `达成约 ${pct(avgHyd, targets.hydrationMl)}% · ${countDaysWithMetric(healthRows, 'hydration')}/7 日有记录`,
    },
    {
      label: '蛋白质',
      value: avgPro >= 1 ? `${Math.round(avgPro)}g` : '—',
      hint: `达成约 ${pct(avgPro, targets.proteinG)}% · 目标 ${targets.proteinG}g/日`,
    },
    {
      label: '碳水/钠',
      value:
        avgCarb >= 1 || avgNa >= 1
          ? `${avgCarb >= 1 ? Math.round(avgCarb) + 'g碳' : ''}${avgNa >= 1 ? ` ${Math.round(avgNa)}mg钠` : ''}`.trim()
          : '—',
      hint: `碳水 ${pct(avgCarb, targets.carbohydrateG)}% · 钠 ${pct(avgNa, targets.sodiumMg)}%`,
    },
  ];
}

export function computeHealthCardPreview(
  user: UserRow | null,
  healthRows: HealthRecordRow[],
  targets: IntakeTargetsSnapshot = getIntakeTargetsSnapshot(),
): HealthCardPreview {
  const week = sumWeekTotals(healthRows);
  const avgHydMl = week.hydration / 7;
  const hydPct =
    targets.hydrationMl > 0 ? Math.min(999, Math.round((avgHydMl / targets.hydrationMl) * 100)) : 0;
  let bmi = '—';
  if (user?.height && user?.weight) {
    const h = user.height / 100;
    const v = user.weight / (h * h);
    if (Number.isFinite(v)) bmi = v.toFixed(1);
  }
  const hydL =
    avgHydMl >= 1000 ? `${(avgHydMl / 1000).toFixed(1)}L` : avgHydMl > 0 ? `${Math.round(avgHydMl)}ml` : '—';
  return {
    heroMain: bmi !== '—' ? `BMI ${bmi}` : hydL !== '—' ? hydL : '健康',
    heroSub:
      hydL !== '—'
        ? `饮水 ${hydL}/日 · 达成约 ${hydPct}%`
        : bmi !== '—'
          ? '身体档案 · 近 7 日营养'
          : '记录身体与摄入，解锁侧写',
    tag: hydPct >= 80 ? '照料良好' : hydPct >= 50 ? '稳步提升' : '可加强记录',
  };
}

export function appendPersonaHealthContextLines(
  lines: string[],
  params: {
    user: UserRow | null;
    healthRows: HealthRecordRow[];
    prevWeekRows?: HealthRecordRow[];
    todayYmd: string;
    targets?: IntakeTargetsSnapshot;
    dailyAiTargets?: DailyAiIntakeTargetsRow | null;
  },
): void {
  const { user, healthRows, prevWeekRows = [], todayYmd } = params;
  const targets = params.targets ?? getIntakeTargetsSnapshot();

  lines.push('【健康页 · 用户档案】');
  if (!user) {
    lines.push('尚未登录或缺少用户档案。');
  } else {
    lines.push(
      `称呼：${(user.name || '').trim() || '未填'}；性别：${user.gender || '未填'}；生日：${user.birthday ?? '未填'}；年龄(档案)：${user.age || '未填'}；生活方式：${user.lifestyle || '未填'}；目标：${user.goal || '未填'}。`,
    );
    lines.push(
      `身高：${user.height ? `${user.height} cm` : '未填'}；体重：${user.weight ? `${user.weight} kg` : '未填'}。`,
    );
    if (user.height && user.weight) {
      const h = user.height / 100;
      const bmi = user.weight / (h * h);
      if (Number.isFinite(bmi)) {
        lines.push(`由身高体重推算 BMI≈${bmi.toFixed(1)}（仅供生活方式参考，非医疗结论）。`);
      }
    }
  }

  lines.push('');
  lines.push('【健康页 · 当前设定的每日摄入目标（用户可在首页调整）】');
  lines.push(
    `水分 ${targets.hydrationMl} ml；蛋白质 ${targets.proteinG} g；碳水化合物 ${targets.carbohydrateG} g；钠 ${targets.sodiumMg} mg。`,
  );
  if (!targets.hydrationMl && !targets.proteinG) {
    lines.push(
      `（若尚未自定义，应用默认约为 水分 ${DEFAULT_HYDRATION_TARGET_ML} ml、蛋白质 ${DEFAULT_PROTEIN_TARGET_G} g、碳水 ${DEFAULT_CARBOHYDRATE_TARGET_G} g、钠 ${DEFAULT_SODIUM_TARGET_MG} mg。）`,
    );
  }

  const daily = params.dailyAiTargets;
  if (daily) {
    lines.push('');
    lines.push(`【健康页 · 今日 AI 推荐目标（${daily.dateYmd}，本地缓存）】`);
    lines.push(
      `水分 ${daily.hydration_ml} ml；蛋白质 ${daily.protein_g} g；碳水 ${daily.carbohydrate_g} g；钠 ${daily.sodium_mg} mg。`,
    );
    if (daily.rationale_zh?.trim()) {
      lines.push(`推荐理由摘要：${daily.rationale_zh.trim().slice(0, 280)}`);
    }
  }

  const weekTotals = sumWeekTotals(healthRows);
  const avg = {
    hydration: weekTotals.hydration / 7,
    protein: weekTotals.protein / 7,
    carbohydrate: weekTotals.carbohydrate / 7,
    sodium: weekTotals.sodium / 7,
  };
  const pct = (current: number, target: number) =>
    target > 0 ? Math.min(999, Math.round((current / target) * 100)) : 0;

  lines.push('');
  lines.push('【健康页 · 近 7 日四营养维度汇总（所有记录按日累加后，再按 7 天均摊）】');
  lines.push(
    `水分：合计 ${Math.round(weekTotals.hydration)} ml，日均约 ${avg.hydration.toFixed(0)} ml（目标 ${targets.hydrationMl} ml，均摊达成率约 ${pct(avg.hydration, targets.hydrationMl)}%）；有记录日 ${countDaysWithMetric(healthRows, 'hydration')}/7。`,
  );
  lines.push(
    `蛋白质：合计 ${Math.round(weekTotals.protein)} g，日均约 ${avg.protein.toFixed(0)} g（目标 ${targets.proteinG} g，均摊达成率约 ${pct(avg.protein, targets.proteinG)}%）；有记录日 ${countDaysWithMetric(healthRows, 'protein')}/7。`,
  );
  lines.push(
    `碳水化合物：合计 ${Math.round(weekTotals.carbohydrate)} g，日均约 ${avg.carbohydrate.toFixed(0)} g（目标 ${targets.carbohydrateG} g，均摊达成率约 ${pct(avg.carbohydrate, targets.carbohydrateG)}%）；有记录日 ${countDaysWithMetric(healthRows, 'carbohydrate')}/7。`,
  );
  lines.push(
    `钠：合计 ${Math.round(weekTotals.sodium)} mg，日均约 ${avg.sodium.toFixed(0)} mg（目标 ${targets.sodiumMg} mg，均摊达成率约 ${pct(avg.sodium, targets.sodiumMg)}%）；有记录日 ${countDaysWithMetric(healthRows, 'sodium')}/7。`,
  );

  const curScore = weekProgressScore(weekTotals, targets);
  const prevScore = weekProgressScore(sumWeekTotals(prevWeekRows), targets);
  lines.push('');
  lines.push('【健康页 · 周趋势（四维度加总相对目标包络的粗略进度分）】');
  lines.push(`本周综合进度分约 ${curScore.toFixed(1)}；上周约 ${prevScore.toFixed(1)}；环比 ${formatWeekDeltaPct(curScore, prevScore)}。`);

  lines.push('');
  lines.push('【健康页 · 近 7 日逐日摄入明细】');
  for (const line of buildSevenDayDigestLines(healthRows, todayYmd)) {
    lines.push(line);
  }

  const recordCount = healthRows.length;
  const aiPhotoCount = healthRows.filter(
    r => !r.quick_add_key && (r.hydration > 0 || r.protein > 0 || r.carbohydrate > 0 || r.sodium > 0),
  ).length;
  lines.push('');
  lines.push(
    `【记录概况】近 7 日 health_records 条数 ${recordCount}；其中疑似 AI/拍照识别录入约 ${aiPhotoCount} 条（无 quick_add_key 且有摄入）。`,
  );
}
