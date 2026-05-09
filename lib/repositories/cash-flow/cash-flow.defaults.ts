import type { CashFlowState } from './cash-flow.types';

/** 新用户/未填写时的空表；不再自动写入数据库 */
export const CASH_FLOW_EMPTY_STATE: CashFlowState = {
  necessaryExpenses: 0,
  unnecessaryExpenses: 0,
  incomes: [],
  holdings: [],
  expenseLines: [],
  goals: { targetPassiveIncome: 0, targetMonths: 60 },
};

/** 仅作参考示例，不会自动入库（可将来用于「加载示例数据」） */
export const CASH_FLOW_INITIAL_STATE: CashFlowState = {
  necessaryExpenses: 4000,
  unnecessaryExpenses: 1500,
  incomes: [
    { id: 'cf-seed-income-1', name: '主业薪资', amount: 12000, quadrant: 'E' },
    { id: 'cf-seed-income-2', name: '副业接单', amount: 3000, quadrant: 'S' },
    { id: 'cf-seed-income-3', name: '指数基金分红', amount: 800, quadrant: 'I' },
  ],
  holdings: [
    { id: 'cf-seed-holding-1', name: '自住房屋按揭', principal: 1_000_000, inflow: 0, outflow: 4500 },
    { id: 'cf-seed-holding-2', name: '出租公寓', principal: 500_000, inflow: 3500, outflow: 1500 },
    { id: 'cf-seed-holding-3', name: '车贷', principal: 150_000, inflow: 0, outflow: 2500 },
    { id: 'cf-seed-holding-4', name: '高息分红股', principal: 100_000, inflow: 800, outflow: 0 },
  ],
  expenseLines: [],
  goals: { targetPassiveIncome: 20000, targetMonths: 60 },
};
