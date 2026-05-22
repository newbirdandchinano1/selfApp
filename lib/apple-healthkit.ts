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
  HKQuantityTypeIdentifierBodyMassIndex: 'BMI',
  HKQuantityTypeIdentifierBodyFatPercentage: '体脂率',
  HKQuantityTypeIdentifierLeanBodyMass: '去脂体重',
  HKQuantityTypeIdentifierWaistCircumference: '腰围',
  HKQuantityTypeIdentifierStepCount: '步数',
  HKQuantityTypeIdentifierDistanceWalkingRunning: '步行+跑步距离',
  HKQuantityTypeIdentifierDistanceCycling: '骑行距离',
  HKQuantityTypeIdentifierFlightsClimbed: '爬楼层数',
  HKQuantityTypeIdentifierActiveEnergyBurned: '活动能量',
  HKQuantityTypeIdentifierBasalEnergyBurned: '基础代谢',
  HKQuantityTypeIdentifierAppleExerciseTime: '锻炼时长',
  HKQuantityTypeIdentifierAppleStandTime: '站立时长',
  HKQuantityTypeIdentifierHeartRate: '心率',
  HKQuantityTypeIdentifierRestingHeartRate: '静息心率',
  HKQuantityTypeIdentifierWalkingHeartRateAverage: '步行平均心率',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: '心率变异性',
  HKQuantityTypeIdentifierOxygenSaturation: '血氧',
  HKQuantityTypeIdentifierRespiratoryRate: '呼吸频率',
  HKQuantityTypeIdentifierVO2Max: '最大摄氧量',
  HKQuantityTypeIdentifierBloodPressureSystolic: '收缩压',
  HKQuantityTypeIdentifierBloodPressureDiastolic: '舒张压',
  HKQuantityTypeIdentifierBloodGlucose: '血糖',
  HKQuantityTypeIdentifierInsulinDelivery: '胰岛素',
  HKQuantityTypeIdentifierDietaryEnergyConsumed: '膳食能量',
  HKQuantityTypeIdentifierDietaryProtein: '蛋白质摄入',
  HKQuantityTypeIdentifierDietaryCarbohydrates: '碳水摄入',
  HKQuantityTypeIdentifierDietaryFatTotal: '脂肪摄入',
  HKQuantityTypeIdentifierDietarySugar: '糖摄入',
  HKQuantityTypeIdentifierDietaryFiber: '膳食纤维',
  HKQuantityTypeIdentifierDietarySodium: '钠摄入',
  HKQuantityTypeIdentifierDietaryWater: '饮水量',
  HKQuantityTypeIdentifierDietaryCaffeine: '咖啡因',
  HKQuantityTypeIdentifierNumberOfAlcoholicBeverages: '酒精饮品',
  HKQuantityTypeIdentifierEnvironmentalAudioExposure: '环境音量',
  HKQuantityTypeIdentifierHeadphoneAudioExposure: '耳机音量',
  HKQuantityTypeIdentifierNumberOfTimesFallen: '跌倒次数',
  HKQuantityTypeIdentifierSixMinuteWalkTestDistance: '6分钟步行距离',
  HKQuantityTypeIdentifierWalkingSpeed: '步行速度',
  HKQuantityTypeIdentifierWalkingStepLength: '步幅',
  HKQuantityTypeIdentifierWalkingAsymmetryPercentage: '步态不对称',
  HKQuantityTypeIdentifierWalkingDoubleSupportPercentage: '双脚支撑占比',
  HKQuantityTypeIdentifierStairAscentSpeed: '上楼梯速度',
  HKQuantityTypeIdentifierStairDescentSpeed: '下楼梯速度',
};

const CATEGORY_LABELS: Record<string, string> = {
  HKCategoryTypeIdentifierSleepAnalysis: '睡眠',
  HKCategoryTypeIdentifierAppleStandHour: '站立小时',
  HKCategoryTypeIdentifierMindfulSession: '正念',
  HKCategoryTypeIdentifierHighHeartRateEvent: '高心率事件',
  HKCategoryTypeIdentifierLowHeartRateEvent: '低心率事件',
  HKCategoryTypeIdentifierIrregularHeartRhythmEvent: '心律不齐',
  HKCategoryTypeIdentifierLowCardioFitnessEvent: '低心肺适能',
  HKCategoryTypeIdentifierSexualActivity: '性生活',
  HKCategoryTypeIdentifierMenstrualFlow: '月经流量',
  HKCategoryTypeIdentifierOvulationTestResult: '排卵检测',
  HKCategoryTypeIdentifierPregnancy: '怀孕',
};

export type HealthKitDisplayRow = {
  key: string;
  label: string;
  value: string;
  meta?: string;
};

function formatNumber(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  const rounded =
    Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  const unitLabel = unit === 'count' ? '' : ` ${unit}`;
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

  if (snapshot.characteristics.dateOfBirth) {
    // 生日由 characteristics 单独展示，不在此返回
  }

  return { heightCm, weightKg };
}
