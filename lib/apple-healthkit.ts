import type { HealthKitCategoryRow, HealthKitQuantityRow, HealthKitSnapshot } from 'zheng-healthkit';

const CHARACTERISTIC_LABELS: Record<string, string> = {
  dateOfBirth: '出生日期',
  biologicalSex: '生理性别',
  bloodType: '血型',
  fitzpatrickSkinType: '肤色类型',
  wheelchairUse: '使用轮椅',
};

const QUANTITY_LABELS: Record<string, string> = {
  HKQuantityTypeIdentifierBodyMass: '体重',
  HKQuantityTypeIdentifierHeight: '身高',
  HKQuantityTypeIdentifierStepCount: '步数',
  HKQuantityTypeIdentifierActiveEnergyBurned: '活动能量',
  HKQuantityTypeIdentifierHeartRate: '心率',
  HKQuantityTypeIdentifierRestingHeartRate: '静息心率',
  HKQuantityTypeIdentifierOxygenSaturation: '血氧',
  HKQuantityTypeIdentifierBloodPressureSystolic: '收缩压',
  HKQuantityTypeIdentifierBloodPressureDiastolic: '舒张压',
  HKQuantityTypeIdentifierDietaryWater: '饮水量',
};

const CATEGORY_LABELS: Record<string, string> = {
  HKCategoryTypeIdentifierSleepAnalysis: '睡眠',
};

export type HealthKitDisplayRow = {
  key: string;
  label: string;
  value: string;
  meta?: string;
};

/** 健康数据读取后的友好说明（非错误） */
export function healthKitReadSummary(snapshot: HealthKitSnapshot, appDisplayName?: string): string | null {
  const parts: string[] = [];
  const unauthorized = snapshot.skippedUnauthorized ?? 0;
  const noData = snapshot.skippedNoData ?? 0;
  if (unauthorized > 0) parts.push(`${unauthorized} 项未授权`);
  if (noData > 0) parts.push(`${noData} 项暂无记录`);
  // 兼容旧版原生：把 errors 数量视为未读到的指标，不再展示「读取失败」
  if (!parts.length && snapshot.errors.length > 0 && snapshot.quantities.length + snapshot.categories.length > 0) {
    parts.push(`${snapshot.errors.length} 项无数据或未授权`);
  }
  if (!parts.length) return null;
  const name = appDisplayName?.trim() || '本 App';
  return `${parts.join('，')}。请在「健康」里找到「${name}」（名称与主屏幕图标下方一致）并开启读取权限。`;
}

/** 在系统「健康」里找不到本 App 时的说明 */
export function healthKitSettingsHelpLines(appDisplayName?: string): string[] {
  const name = appDisplayName?.trim() || '本 App';
  return [
    `列表里显示的是主屏幕图标下的名字「${name}」，不一定是项目里的中文名。`,
    '须先在编辑个人资料里点过「读取健康数据」并出现过系统授权弹窗，才会出现在列表中。',
    '路径一：设置 → 健康 → 数据访问与设备 → 找到本 App。',
    '路径二：打开「健康」App → 右上角头像 → 隐私与访问 → 编辑来源。',
    '若仍没有：请确认安装的是包含 HealthKit 的最新 iOS 开发包（旧包不会出现在健康列表里）。',
  ];
}

function formatNumber(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  let display = value;
  let displayUnit = unit;
  if (unit === '%' && value > 0 && value <= 1) {
    display = value * 100;
  }
  const rounded =
    Math.abs(display) >= 100 ? Math.round(display) : Math.round(display * 10) / 10;
  const unitLabel = displayUnit === 'count' ? '' : ` ${displayUnit}`;
  return `${rounded}${unitLabel}`.trim();
}

function formatIsoDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function characteristicLabel(key: string): string {
  return CHARACTERISTIC_LABELS[key] ?? key;
}

function quantityLabel(identifier: string): string {
  return QUANTITY_LABELS[identifier] ?? identifier.replace('HKQuantityTypeIdentifier', '');
}

function categoryLabel(identifier: string): string {
  return CATEGORY_LABELS[identifier] ?? identifier.replace('HKCategoryTypeIdentifier', '');
}

export function buildHealthKitDisplayRows(snapshot: HealthKitSnapshot): HealthKitDisplayRow[] {
  const rows: HealthKitDisplayRow[] = [];

  for (const [key, value] of Object.entries(snapshot.characteristics)) {
    if (!value) continue;
    const displayValue =
      key === 'dateOfBirth' ? formatIsoDateShort(value).split(' ')[0] ?? value : value;
    rows.push({
      key: `char-${key}`,
      label: characteristicLabel(key),
      value: displayValue,
    });
  }

  for (const q of snapshot.quantities) {
    rows.push(quantityRowToDisplay(q));
  }

  for (const c of snapshot.categories) {
    rows.push(categoryRowToDisplay(c));
  }

  return rows;
}

function quantityRowToDisplay(q: HealthKitQuantityRow): HealthKitDisplayRow {
  const agg = q.aggregation && q.aggregation !== 'latest' ? `（${q.aggregation}）` : '';
  return {
    key: `qty-${q.identifier}-${q.aggregation}-${q.endDate}`,
    label: `${quantityLabel(q.identifier)}${agg}`,
    value: formatNumber(q.value, q.unit),
    meta: `${formatIsoDateShort(q.endDate)} · ${q.source}`,
  };
}

function categoryRowToDisplay(c: HealthKitCategoryRow): HealthKitDisplayRow {
  return {
    key: `cat-${c.identifier}-${c.startDate}`,
    label: categoryLabel(c.identifier),
    value: c.value,
    meta: `${formatIsoDateShort(c.startDate)} – ${formatIsoDateShort(c.endDate)} · ${c.source}`,
  };
}

/** 从 HealthKit 体重(kg)、身高(cm) 提取可写入个人资料表的数值 */
export function extractProfileMetricsFromHealthKit(snapshot: HealthKitSnapshot): {
  heightCm: number | null;
  weightKg: number | null;
} {
  let heightCm: number | null = null;
  let weightKg: number | null = null;

  for (const q of snapshot.quantities) {
    if (q.identifier.endsWith('Height') && q.aggregation === 'latest') {
      if (q.unit === 'cm') heightCm = Math.round(q.value);
      else if (q.unit === 'm') heightCm = Math.round(q.value * 100);
      else heightCm = Math.round(q.value);
    }
    if (q.identifier.endsWith('BodyMass') && q.aggregation === 'latest') {
      weightKg = Math.round(q.value * 10) / 10;
    }
  }

  return { heightCm, weightKg };
}
