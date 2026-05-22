import type {
  HealthKitAuthorizationRequestStatus,
  HealthKitCategoryRow,
  HealthKitQuantityRow,
  HealthKitSnapshot,
} from 'zheng-healthkit';

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

/** 编辑个人资料页副标题：避免把「HealthKit 可用」误显示成「已授权」 */
export function healthKitStatusSubtitle(
  snapshot: HealthKitSnapshot | null,
  authStatus: HealthKitAuthorizationRequestStatus | null,
  rowCount: number,
): string {
  if (!snapshot?.available) {
    return '点击下方「读取健康数据」连接 Apple 健康';
  }
  if (rowCount > 0) {
    const when = snapshot.fetchedAt
      ? new Date(snapshot.fetchedAt).toLocaleString('zh-CN')
      : '';
    return `已读取 ${rowCount} 项${when ? ` · ${when}` : ''}`;
  }

  const unauthorized = snapshot.skippedUnauthorized ?? 0;
  const noData = snapshot.skippedNoData ?? 0;
  const status = snapshot.requestStatus ?? authStatus;

  if (status === 'shouldRequest') {
    return '尚未向系统登记。点「读取健康数据」应出现系统授权弹窗；若无弹窗请重装含 HealthKit 的 iOS 包。';
  }

  if (unauthorized > 0) {
    return `已向系统登记，但有 ${unauthorized} 项未允许读取。请到「健康 → 数据访问与设备」为本 App 打开开关。`;
  }

  if (noData > 0) {
    return `已连接 Apple 健康，${noData} 项暂无记录（健康 App 里可能还没有体重/步数等数据）。`;
  }

  if (status === 'unnecessary') {
    return '系统不会第二次弹出授权窗（正常）。请到「健康 → 数据访问与设备」查找本 App 并打开读取权限。';
  }

  return '已连接，但未读到数据。请在「健康」App 中确认有数据，并检查本 App 的读取权限。';
}

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
export function healthKitSettingsHelpLines(
  appDisplayName?: string,
  authStatus?: HealthKitAuthorizationRequestStatus | null,
): string[] {
  const name = appDisplayName?.trim() || '本 App';
  const lines: string[] = [
    `在「健康」与「设置 → 健康 → 数据访问与设备」里，请搜索主屏幕图标下的名字：「${name}」。`,
  ];

  if (authStatus === 'shouldRequest') {
    lines.push('当前尚未向系统登记：请先点「读取健康数据」，等系统弹出授权窗口并点允许。');
  } else if (authStatus === 'unnecessary') {
    lines.push(
      '已向系统登记过：再次点「读取健康数据」不会出现弹窗，这是 iOS 正常行为，不是故障。',
      '请到下方路径手动打开读取开关；列表里可能是空白图标名，可改搜 Bundle ID（见页面上灰色小字）。',
    );
  }

  lines.push(
    '路径一：设置 → 健康 → 数据访问与设备（或 隐私与安全性 → 健康）。',
    '路径二：健康 App → 右上角头像 → 隐私与访问 → App 与服务。',
    '若主屏幕图标下没有名字：设置 → 主屏幕与 App 资源库 → 关闭「隐藏 App 名称」类选项后查看。',
  );
  return lines;
}

export function healthKitAuthStatusHint(
  status: HealthKitAuthorizationRequestStatus | null,
  appDisplayName?: string,
): string | null {
  const name = appDisplayName?.trim() || '本 App';
  switch (status) {
    case 'shouldRequest':
      return `尚未登记健康访问。请先点「读取健康数据」，出现系统弹窗后再到「健康」里找「${name}」。`;
    case 'unnecessary':
      return `已向系统登记（故不会再次弹窗）。请到「健康 → 数据访问与设备」查找「${name}」或 Bundle ID。`;
    case 'unavailable':
      return '当前设备不可用 HealthKit（请使用 iPhone 真机）。';
    default:
      return null;
  }
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
