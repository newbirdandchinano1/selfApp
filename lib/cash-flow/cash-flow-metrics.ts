import type { CashFlowState, Holding } from '@/lib/repositories/cash-flow/cash-flow.types';

export type CategorizedHolding = Holding & { netCashflow: number; isAsset: boolean };

export type CashFlowMetrics = {
  activeIncome: number;
  totalPassiveIncome: number;
  totalIncome: number;
  totalExpenses: number;
  freeCashFlow: number;
  assetInflow: number;
  liabilityOutflow: number;
  freedomProgress: number;
  passiveRatio: number;
  pattern: string;
  categorizedHoldings: CategorizedHolding[];
  totalAssetsValue: number;
  totalLiabilitiesValue: number;
};

function formatMoney(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function calculateCashFlowMetrics(state: CashFlowState): CashFlowMetrics {
  const activeIncome = state.incomes
    .filter((i) => ['E', 'S'].includes(i.quadrant))
    .reduce((sum, i) => sum + i.amount, 0);
  const purePassiveIncome = state.incomes
    .filter((i) => ['B', 'I'].includes(i.quadrant))
    .reduce((sum, i) => sum + i.amount, 0);

  let assetInflow = 0;
  let liabilityOutflow = 0;
  let totalAssetsValue = 0;
  let totalLiabilitiesValue = 0;

  const categorizedHoldings: CategorizedHolding[] = state.holdings.map((h) => {
    const netCashflow = h.inflow - h.outflow;
    const isAsset = netCashflow > 0;
    if (isAsset) {
      assetInflow += netCashflow;
      totalAssetsValue += h.principal;
    } else {
      liabilityOutflow += Math.abs(netCashflow);
      totalLiabilitiesValue += h.principal;
    }
    return { ...h, netCashflow, isAsset };
  });

  const totalPassiveIncome = purePassiveIncome + assetInflow;
  const totalIncome = activeIncome + totalPassiveIncome;
  const totalExpenses = state.necessaryExpenses + state.unnecessaryExpenses + liabilityOutflow;
  const freeCashFlow = totalIncome - totalExpenses;

  const freedomProgress =
    state.necessaryExpenses > 0 ? (totalPassiveIncome / state.necessaryExpenses) * 100 : 0;
  const passiveRatio = totalIncome > 0 ? (totalPassiveIncome / totalIncome) * 100 : 0;

  let pattern = '穷人模式';
  if (freedomProgress >= 100) pattern = '财务自由 🎉';
  else if (liabilityOutflow > assetInflow && activeIncome > 0) pattern = '老鼠赛跑 🐀';
  else if (assetInflow > 0) pattern = '快车道起步 🚀';

  return {
    activeIncome,
    totalPassiveIncome,
    totalIncome,
    totalExpenses,
    freeCashFlow,
    assetInflow,
    liabilityOutflow,
    freedomProgress,
    passiveRatio,
    pattern,
    categorizedHoldings,
    totalAssetsValue,
    totalLiabilitiesValue,
  };
}

export function computeCashFlowAiFingerprint(state: CashFlowState, metrics: CashFlowMetrics): string {
  return JSON.stringify({
    necessaryExpenses: state.necessaryExpenses,
    unnecessaryExpenses: state.unnecessaryExpenses,
    goals: state.goals,
    incomes: [...state.incomes]
      .map((i) => [i.id, i.name, i.amount, i.quadrant])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    holdings: [...state.holdings]
      .map((h) => [h.id, h.name, h.principal, h.inflow, h.outflow, h.extra])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    expenseLines: [...state.expenseLines]
      .map((l) => [l.id, l.name, l.amount, l.bucket])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    pattern: metrics.pattern,
    freedomProgress: Math.round(metrics.freedomProgress * 100) / 100,
    passiveRatio: Math.round(metrics.passiveRatio * 100) / 100,
    freeCashFlow: Math.round(metrics.freeCashFlow * 100) / 100,
    totalIncome: Math.round(metrics.totalIncome * 100) / 100,
    totalExpenses: Math.round(metrics.totalExpenses * 100) / 100,
  });
}

/** 供现金流图页与 AI 财务分析页共用的结构化中文摘要 */
export function buildCashFlowAiSummaryText(state: CashFlowState, metrics: CashFlowMetrics): string {
  const lines: string[] = [];
  lines.push('【说明】以下为应用内「现金流图」同一套口径的月度模型数据，非银行对账单。');
  lines.push('');
  lines.push('【汇总指标】');
  lines.push(`财务形态：${metrics.pattern}`);
  lines.push(`财务自由进度(被动收入÷必要支出)：${metrics.freedomProgress.toFixed(1)}%`);
  lines.push(`被动收入占比：${metrics.passiveRatio.toFixed(1)}%`);
  lines.push(`主动收入(E/S)：${formatMoney(metrics.activeIncome)}`);
  lines.push(`被动收入(B/I+资产净流入)：${formatMoney(metrics.totalPassiveIncome)}`);
  lines.push(`月度总收入：${formatMoney(metrics.totalIncome)}`);
  lines.push(`月度总流出(必要+非必要+负债月供)：${formatMoney(metrics.totalExpenses)}`);
  lines.push(`自由现金流：${formatMoney(metrics.freeCashFlow)}`);
  lines.push(`资产净流入(口袋)：${formatMoney(metrics.assetInflow)}`);
  lines.push(`负债净流出(月供等)：${formatMoney(metrics.liabilityOutflow)}`);
  lines.push(`台账资产本金合计(约)：${formatMoney(metrics.totalAssetsValue)}`);
  lines.push(`台账负债本金合计(约)：${formatMoney(metrics.totalLiabilitiesValue)}`);
  lines.push(`目标被动收入：${formatMoney(state.goals.targetPassiveIncome)}；目标月数：${state.goals.targetMonths}`);
  lines.push('');
  lines.push('【收入明细】');
  if (state.incomes.length === 0) {
    lines.push('（无）');
  } else {
    for (const i of state.incomes) {
      lines.push(`- ${i.name || '未命名'}｜${formatMoney(i.amount)}｜象限${i.quadrant}`);
    }
  }
  lines.push('');
  lines.push('【资产负债台账·现金流】');
  const holdRows = metrics.categorizedHoldings;
  const maxH = 36;
  const slice = holdRows.slice(0, maxH);
  for (const h of slice) {
    const tag = h.isAsset ? '资产(净入袋)' : '负债(消耗)';
    lines.push(
      `- ${h.name || '未命名'}｜${tag}｜净现金流 ${h.netCashflow >= 0 ? '+' : ''}${formatMoney(h.netCashflow)}｜流入${formatMoney(h.inflow)}流出${formatMoney(h.outflow)}｜本金约${formatMoney(h.principal)}`,
    );
  }
  if (holdRows.length > maxH) {
    lines.push(`… 另有 ${holdRows.length - maxH} 条台账未列出`);
  }
  if (holdRows.length === 0) {
    lines.push('（无）');
  }
  lines.push('');
  lines.push('【生活流出】');
  lines.push(`必要支出(汇总)：${formatMoney(state.necessaryExpenses)}`);
  lines.push(`非必要消费(汇总)：${formatMoney(state.unnecessaryExpenses)}`);
  lines.push('支出流水行：');
  if (state.expenseLines.length === 0) {
    lines.push('（无单独行，可能仅填了汇总）');
  } else {
    for (const l of state.expenseLines) {
      lines.push(`- ${l.name || '未命名'}｜${l.bucket === 'necessary' ? '必要' : '非必要'}｜${formatMoney(l.amount)}`);
    }
  }
  return lines.join('\n');
}
