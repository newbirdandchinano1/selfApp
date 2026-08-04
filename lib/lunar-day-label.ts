import { Solar } from 'lunar-typescript';

/**
 * 日历副文案：优先节气，农历初一显示月份，其余显示农历日。
 * @param month 公历月，1–12
 */
export function getCalendarLunarLabel(year: number, month: number, day: number): string {
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  const jieQi = lunar.getJieQi();
  if (jieQi) return jieQi;
  if (lunar.getDay() === 1) return `${lunar.getMonthInChinese()}月`;
  return lunar.getDayInChinese();
}
