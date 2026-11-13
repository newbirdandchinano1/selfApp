/**
 * 阶段 F：时间线布局 / 语义分段纯逻辑契约（无 React / 无 DB）
 * 运行：npm run test:schedule-timeline-layout
 */
import assert from 'node:assert/strict';
import {
  clampTimedEventToAxis,
  columnWidthForCluster,
  eventFrameInAxis,
  eventHeightPx,
  formatEventDuration,
  layoutCardsHorizontally,
  layoutOverlappingEvents,
  preferredEventCardWidth,
  splitAllDayEvents,
  TIMELINE_MIN_COLUMN_W,
  TIMELINE_MIN_EVENT_H,
  TIMELINE_MINUTE_PX,
  timelineBodyHeightPx,
} from '../lib/schedule/timeline/layout.ts';
import {
  semanticBucketsForAxis,
  semanticLabelForMinutes,
} from '../lib/schedule/timeline/labels.ts';

const ev = (id, startMinutes, endMinutes, allDay = false, extra = {}) => ({
  id,
  startMinutes,
  endMinutes,
  allDay,
  kind: 'frog',
  title: id,
  done: false,
  overdue: false,
  priority: 0,
  ...extra,
});

// 传递重叠簇：A 9-11 与 B 9:30-10:30 重叠；C 11:30-12:30 独立
{
  const laid = layoutOverlappingEvents([
    ev('A', 540, 660),
    ev('B', 570, 630),
    ev('C', 690, 750),
  ]);
  const byId = Object.fromEntries(laid.map((x) => [x.event.id, x]));
  assert.equal(byId.A.column, 0);
  assert.equal(byId.A.columns, 2);
  assert.equal(byId.B.column, 1);
  assert.equal(byId.B.columns, 2);
  assert.equal(byId.C.column, 0);
  assert.equal(byId.C.columns, 1);
}

// 三重叠 → 3 栏
{
  const laid = layoutOverlappingEvents([
    ev('A', 540, 660),
    ev('B', 550, 660),
    ev('C', 560, 660),
  ]);
  assert.equal(laid.length, 3);
  assert.equal(Math.max(...laid.map((x) => x.columns)), 3);
  assert.deepEqual(
    laid.map((x) => x.column).sort(),
    [0, 1, 2],
  );
}

// 半开区间：首尾相接不算重叠
{
  const laid = layoutOverlappingEvents([ev('A', 540, 600), ev('B', 600, 660)]);
  const byId = Object.fromEntries(laid.map((x) => [x.event.id, x]));
  assert.equal(byId.A.columns, 1);
  assert.equal(byId.B.columns, 1);
}

// 全天 / 定时分离
{
  const { allDay, timed } = splitAllDayEvents([
    ev('H', 0, 1440, true),
    ev('T', 540, 600),
  ]);
  assert.equal(allDay.length, 1);
  assert.equal(allDay[0].id, 'H');
  assert.equal(timed.length, 1);
  assert.equal(timed[0].id, 'T');
}

// 高度：按时长线性 + 最小高度
{
  assert.equal(eventHeightPx(ev('x', 0, 30)), TIMELINE_MIN_EVENT_H);
  assert.ok(Math.abs(eventHeightPx(ev('x', 0, 120)) - 120 * TIMELINE_MINUTE_PX) < 1e-6);
  assert.ok(Math.abs(timelineBodyHeightPx({ startMinutes: 480, endMinutes: 1320 }) - 840 * TIMELINE_MINUTE_PX) < 1e-6);
}

// 长跨度裁进轴：不溢出 body；轴外返回 null
{
  const axis = { startMinutes: 480, endMinutes: 1320 };
  const clipped = clampTimedEventToAxis(ev('L', 400, 1400), axis);
  assert.deepEqual(clipped, { startMinutes: 480, endMinutes: 1320 });
  const frame = eventFrameInAxis(ev('L', 400, 1400), axis);
  assert.ok(frame);
  assert.equal(frame.top, 0);
  const body = timelineBodyHeightPx(axis);
  assert.ok(frame.height <= body + 1e-6);
  assert.equal(clampTimedEventToAxis(ev('O', 0, 100), axis), null);

  // 旧均分 API：够宽则不横滑；过窄保底
  const fits = columnWidthForCluster(300, 2, { gap: 4, minColW: TIMELINE_MIN_COLUMN_W });
  assert.equal(fits.scrollable, false);
  assert.ok(Math.abs(fits.colW - (300 - 4) / 2) < 1e-6);
  const squeezed = columnWidthForCluster(200, 8, { gap: 4, minColW: TIMELINE_MIN_COLUMN_W });
  assert.equal(squeezed.colW, TIMELINE_MIN_COLUMN_W);
  assert.equal(squeezed.scrollable, true);
}

// 卡片宽随标题长度自适应
{
  const short = preferredEventCardWidth({ title: '短', icon: null, done: false });
  const long = preferredEventCardWidth({
    title: '这是一个比较长的日程标题用来测宽度',
    icon: '🐸',
    done: false,
  });
  assert.ok(short >= TIMELINE_MIN_COLUMN_W);
  assert.ok(long > short);
  const capped = preferredEventCardWidth(
    { title: '一二三四五六七八九十'.repeat(8), icon: null, done: false },
    { maxW: 200 },
  );
  assert.equal(capped, 200);
}

// 同簇横排：短卡窄、长卡宽；列不重叠
{
  const items = [
    {
      event: { id: 'a', title: '短', icon: null, done: false },
      column: 0,
      columns: 2,
      clusterId: 0,
    },
    {
      event: { id: 'b', title: '这是一个很长的标题内容', icon: '📌', done: false },
      column: 1,
      columns: 2,
      clusterId: 0,
    },
  ];
  const { frames, contentWidth } = layoutCardsHorizontally(items, { gap: 4, maxW: 280 });
  const a = frames.get('a');
  const b = frames.get('b');
  assert.ok(a && b);
  assert.ok(a.width < b.width);
  assert.equal(a.left, 0);
  assert.equal(b.left, a.width + 4);
  assert.equal(contentWidth, a.width + 4 + b.width);
}

// 友好时长
{
  assert.equal(formatEventDuration(0, 75), '1 小时 15 分');
  assert.equal(formatEventDuration(0, 45), '45 分钟');
  assert.equal(formatEventDuration(0, 120), '2 小时');
  assert.equal(formatEventDuration(100, 100), '');
}

// 语义分段：8:00–22:00 覆盖完整、标签命中
{
  const axis = { startMinutes: 480, endMinutes: 1320, slotHours: 2 };
  const segs = semanticBucketsForAxis(axis);
  assert.ok(segs.length >= 4, `expected several segments, got ${segs.length}`);
  assert.equal(segs[0].startMinutes, 480);
  assert.equal(segs[segs.length - 1].endMinutes, 1320);
  // 相邻段落首尾相接、无空洞
  for (let i = 1; i < segs.length; i++) {
    assert.equal(segs[i].startMinutes, segs[i - 1].endMinutes);
  }
  assert.ok(segs.some((s) => s.label === '上午'));
  assert.ok(segs.some((s) => s.label === '晚上'));
}

// 跨午夜轴：20:00 – 次日 02:00 → 含晚上 + 凌晨
{
  const axis = { startMinutes: 20 * 60, endMinutes: 26 * 60, slotHours: 2 };
  const segs = semanticBucketsForAxis(axis);
  assert.ok(segs.some((s) => s.label === '晚上'));
  assert.ok(segs.some((s) => s.label === '凌晨'));
  assert.equal(segs[segs.length - 1].endMinutes, 26 * 60);
}

// 分钟 → 语义标签
{
  assert.equal(semanticLabelForMinutes(540), '上午'); // 9:00
  assert.equal(semanticLabelForMinutes(750), '午间'); // 12:30
  assert.equal(semanticLabelForMinutes(1080), '晚餐'); // 18:00
  assert.equal(semanticLabelForMinutes(1260), '晚上'); // 21:00
  assert.equal(semanticLabelForMinutes(60), '凌晨'); // 1:00
}

console.log('ok: schedule timeline layout (phase F)');
