/**
 * 健康摄入缺口 · 纯规则（可单测）。
 * 口径对齐 health-intake-reminder：关注项缺口、进度百分比、收口态文案。
 */

export type HealthIntakeFocusKey = 'hydration' | 'protein' | 'carbohydrate' | 'calories';

export type HealthIntakeRingStyle = 'single' | 'dual';

export type HealthIntakeFocusSource = 'follow_care' | 'manual';

export type HealthIntakeMetricInput = {
  key: HealthIntakeFocusKey;
  current: number;
  target: number;
};

export type HealthIntakeRing = {
  key: HealthIntakeFocusKey;
  label: string;
  current: number;
  target: number;
  percent: number;
  unit: string;
  valueLine: string;
};

export type HealthIntakeGlance = {
  status: 'empty' | 'progress' | 'cleared';
  rings: HealthIntakeRing[];
  statusLine: string;
};

export type HealthIntakeWidgetProps = {
  title: string;
  statusLine: string;
  ringCount: number;
  ring1Label: string;
  ring1Percent: number;
  ring1ValueLine: string;
  ring2Label: string;
  ring2Percent: number;
  ring2ValueLine: string;
  hasItems: number;
  allDone: number;
  deepLink: string;
};

const LABEL_BY_KEY: Record<HealthIntakeFocusKey, string> = {
  hydration: '水分',
  protein: '蛋白质',
  carbohydrate: '碳水',
  calories: '热量',
};

const UNIT_BY_KEY: Record<HealthIntakeFocusKey, string> = {
  hydration: 'ml',
  protein: 'g',
  carbohydrate: 'g',
  calories: 'kcal',
};

const ALL_KEYS: HealthIntakeFocusKey[] = [
  'hydration',
  'protein',
  'carbohydrate',
  'calories',
];

export function healthIntakeFocusLabel(key: HealthIntakeFocusKey): string {
  return LABEL_BY_KEY[key];
}

export function clampHealthIntakePercent(current: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((current / target) * 100)));
}

function formatValueLine(key: HealthIntakeFocusKey, current: number, target: number): string {
  const unit = UNIT_BY_KEY[key];
  const cur = Math.max(0, Math.round(current));
  const tgt = Math.max(0, Math.round(target));
  return `${cur}/${tgt} ${unit}`;
}

function toRing(m: HealthIntakeMetricInput): HealthIntakeRing | null {
  if (!(m.target > 0)) return null;
  const current = Math.max(0, Number(m.current) || 0);
  const target = Math.max(0, Number(m.target) || 0);
  return {
    key: m.key,
    label: LABEL_BY_KEY[m.key],
    current,
    target,
    percent: clampHealthIntakePercent(current, target),
    unit: UNIT_BY_KEY[m.key],
    valueLine: formatValueLine(m.key, current, target),
  };
}

/** 解析展示关注项：跟随「我关心」或手动最多 2 项 */
export function resolveHealthIntakeDisplayKeys(input: {
  focusSource: HealthIntakeFocusSource;
  careKeys: HealthIntakeFocusKey[];
  manualKeys: HealthIntakeFocusKey[];
}): HealthIntakeFocusKey[] {
  if (input.focusSource === 'manual') {
    const seen = new Set<HealthIntakeFocusKey>();
    const out: HealthIntakeFocusKey[] = [];
    for (const k of input.manualKeys) {
      if (!ALL_KEYS.includes(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
      if (out.length >= 2) break;
    }
    return out.length > 0 ? out : ['hydration', 'calories'];
  }
  const care =
    input.careKeys.length > 0
      ? input.careKeys.filter((k) => ALL_KEYS.includes(k))
      : [...ALL_KEYS];
  return care.length > 0 ? care : [...ALL_KEYS];
}

/**
 * 选环：单环取最大缺口；双环取缺口最大的两项。
 * 全部达标时仍展示关注项进度（收口态）。
 */
export function pickHealthIntakeRings(input: {
  metrics: HealthIntakeMetricInput[];
  displayKeys: HealthIntakeFocusKey[];
  ringStyle: HealthIntakeRingStyle;
}): HealthIntakeRing[] {
  const byKey = new Map<HealthIntakeFocusKey, HealthIntakeRing>();
  for (const m of input.metrics) {
    if (!input.displayKeys.includes(m.key)) continue;
    const ring = toRing(m);
    if (ring) byKey.set(m.key, ring);
  }

  const ordered = input.displayKeys
    .map((k) => byKey.get(k))
    .filter((r): r is HealthIntakeRing => !!r);

  if (ordered.length === 0) return [];

  const byGap = [...ordered].sort((a, b) => {
    const gapA = Math.max(0, a.target - a.current) / a.target;
    const gapB = Math.max(0, b.target - b.current) / b.target;
    return gapB - gapA || b.target - b.current - (a.target - a.current);
  });

  const limit = input.ringStyle === 'dual' ? 2 : 1;
  const picked = byGap.slice(0, limit);
  if (picked.length >= limit) return picked;

  // 双环但缺口不足两项时，用关注项顺序补齐（含已达标）
  const seen = new Set(picked.map((r) => r.key));
  for (const r of ordered) {
    if (seen.has(r.key)) continue;
    picked.push(r);
    if (picked.length >= limit) break;
  }
  return picked;
}

export function buildHealthIntakeGlance(input: {
  metrics: HealthIntakeMetricInput[];
  displayKeys: HealthIntakeFocusKey[];
  ringStyle: HealthIntakeRingStyle;
  statusLine: string;
}): HealthIntakeGlance {
  const rings = pickHealthIntakeRings({
    metrics: input.metrics,
    displayKeys: input.displayKeys,
    ringStyle: input.ringStyle,
  });
  const statusLine = (input.statusLine || '').trim() || '打开 App 后同步摄入';

  if (rings.length === 0) {
    return { status: 'empty', rings: [], statusLine };
  }

  const allMet = rings.every((r) => r.percent >= 100);
  const displayKeysWithTarget = input.displayKeys.filter((k) =>
    input.metrics.some((m) => m.key === k && m.target > 0),
  );
  const focusAllMet =
    displayKeysWithTarget.length > 0 &&
    displayKeysWithTarget.every((k) => {
      const m = input.metrics.find((x) => x.key === k);
      return m != null && m.target > 0 && m.current >= m.target;
    });

  if (focusAllMet || allMet) {
    return {
      status: 'cleared',
      rings,
      statusLine: statusLine.includes('达标') ? statusLine : '今日关注项已达标',
    };
  }

  return { status: 'progress', rings, statusLine };
}

export function healthIntakeGlanceToWidgetProps(
  glance: HealthIntakeGlance,
  opts?: { deepLink?: string },
): HealthIntakeWidgetProps {
  const deepLink = opts?.deepLink ?? 'zheng://';
  const r1 = glance.rings[0];
  const r2 = glance.rings[1];

  if (glance.status === 'empty' || !r1) {
    return {
      title: '健康摄入',
      statusLine: glance.statusLine || '暂无关注项',
      ringCount: 0,
      ring1Label: '',
      ring1Percent: 0,
      ring1ValueLine: '',
      ring2Label: '',
      ring2Percent: 0,
      ring2ValueLine: '',
      hasItems: 0,
      allDone: 0,
      deepLink,
    };
  }

  return {
    title: '健康摄入',
    statusLine: glance.statusLine,
    ringCount: glance.rings.length,
    ring1Label: r1.label,
    ring1Percent: r1.percent,
    ring1ValueLine: r1.valueLine,
    ring2Label: r2?.label ?? '',
    ring2Percent: r2?.percent ?? 0,
    ring2ValueLine: r2?.valueLine ?? '',
    hasItems: 1,
    allDone: glance.status === 'cleared' ? 1 : 0,
    deepLink,
  };
}
