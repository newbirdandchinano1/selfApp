export function parseScheduleDisplay(deadlineText: string) {
  const match = deadlineText.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const timeTail = deadlineText.replace(match[0], '').trim();
  return {
    day: d,
    month: m,
    year: y,
    weekday: weekdays[date.getDay()] ?? '',
    timeTail: timeTail || null,
  };
}
