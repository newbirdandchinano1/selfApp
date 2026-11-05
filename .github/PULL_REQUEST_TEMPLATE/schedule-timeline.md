## Summary

<!-- 本 PR 所属阶段（A–L）与目的 -->

## 日程契约（不可破坏）

- [ ] 入格成功路径：先本地 placement → assign → 远端 upsert；assign 失败须回滚本地行
- [ ] 过去日只读：`isEditableScheduleDay` / `isEditableWeek` 拒绝写入
- [ ] 删一段 vs 取消指派语义不变（基线 B4 / B5）
- [ ] 同步表名未改：`schedule_placements`、`schedule_week_axis_snapshot`
- [ ] 分钟语义：逻辑日 axis 分钟（可跨午夜）；区间半开 `[start, end)`
- [ ] break 仍为禁排来源；新写入不得跨 / 与 break 相交（write 开启后）
- [ ] 最简态 minimal 路径未改坏
- [ ] 阶段 L 后：App 日视图固定时间线；无 `ScheduleZoomMode='grid'`
- [ ] 未停双写 / 未 DROP slot 列（待桌面写入稳定 ≥14 天 + 决议 #17）

## 回归（按阶段勾选）

对照：`selfApp/docs/schedule-timeline-phase-a.md`

- [ ] 相关基线条目已手测 / 说明跳过原因

## Test plan

- [ ]
