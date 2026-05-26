/** 待办总览热力图：纯展示计算，不含数据读取 */

export type HeatmapCell = { ymd: string; inRange: boolean; count: number };

export function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 列 = 周（左旧右新），行 = 周一至周日；minDataYmd 之前视为无统计区间 */
export function buildGlobalTaskHeatmapGrid(
  numWeeks: number,
  countByDay: Map<string, number>,
  minDataYmd: string | null,
  logicalTodayYmd?: string,
): HeatmapCell[][] {
  const todayYmd = logicalTodayYmd ?? ymdFromDate(new Date());
  const endMonday = startOfWeekMonday(logicalTodayYmd ? logicalYmdToLocalDate(logicalTodayYmd) : new Date());
  const gridStart = new Date(endMonday);
  gridStart.setDate(gridStart.getDate() - (numWeeks - 1) * 7);

  const cells: HeatmapCell[][] = [];
  for (let w = 0; w < numWeeks; w += 1) {
    const col: HeatmapCell[] = [];
    const monday = new Date(gridStart);
    monday.setDate(monday.getDate() + w * 7);
    for (let r = 0; r < 7; r += 1) {
      const d = new Date(monday);
      d.setDate(d.getDate() + r);
      const ymd = ymdFromDate(d);
      const inFuture = ymd > todayYmd;
      const beforeData = minDataYmd ? ymd < minDataYmd : false;
      const inRange = !inFuture && !beforeData;
      const count = inRange ? countByDay.get(ymd) ?? 0 : 0;
      col.push({ ymd, inRange, count: inFuture || beforeData ? 0 : count });
    }
    cells.push(col);
  }
  return cells;
}

function logicalYmdToLocalDate(ymd: string): Date {
  const [y, mo, d] = ymd.split('-').map((x) => parseInt(x, 10));
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

export function heatmapGridDayRange(numWeeks: number, logicalTodayYmd?: string): { startYmd: string; endYmd: string } {
  const todayYmd = logicalTodayYmd ?? ymdFromDate(new Date());
  const endMonday = startOfWeekMonday(logicalTodayYmd ? logicalYmdToLocalDate(logicalTodayYmd) : new Date());
  const gridStart = new Date(endMonday);
  gridStart.setDate(gridStart.getDate() - (numWeeks - 1) * 7);
  return { startYmd: ymdFromDate(gridStart), endYmd: todayYmd };
}

/** 按自然月统计有效日内的日均完成次数（有效日 = 热力图范围内且 ≤ 逻辑今日） */
export function computeMonthlyAverageMap(
  validDayYmds: string[],
  countByYmd: Map<string, number>,
): Map<string, number> {
  const totals = new Map<string, { sum: number; days: number }>();
  for (const ymd of validDayYmds) {
    const monthKey = ymd.slice(0, 7);
    const prev = totals.get(monthKey) ?? { sum: 0, days: 0 };
    prev.sum += countByYmd.get(ymd) ?? 0;
    prev.days += 1;
    totals.set(monthKey, prev);
  }
  const avgMap = new Map<string, number>();
  for (const [monthKey, { sum, days }] of totals) {
    avgMap.set(monthKey, days > 0 ? sum / days : 0);
  }
  return avgMap;
}

/** 将当日完成数相对当月日均映射为 0–4 色阶 */
export function heatmapLevelFromMonthlyAverage(
  count: number,
  monthKey: string,
  monthAvgMap: Map<string, number>,
): number {
  if (count <= 0) return 0;
  const avg = monthAvgMap.get(monthKey) ?? 0;
  if (avg <= 0) return Math.min(4, count);
  const ratio = count / avg;
  if (ratio <= 0.5) return 1;
  if (ratio <= 1) return 2;
  if (ratio <= 1.5) return 3;
  return 4;
}
