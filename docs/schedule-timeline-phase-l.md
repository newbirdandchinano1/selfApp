# 日程表时间线 · 阶段 L（App）

退役经典课表格子 UI；日视图固定时间线。最简态保留。

## 已做（App）

| 项 | 结果 |
|----|------|
| `WeeklyFrogSchedule` grid 渲染 | 已删；`ScheduleZoomMode = 'minimal' \| 'day'` |
| 经典课表 / `timeline_ui` 开关 | 设置页移除；日视图恒时间线 |
| 格宽设置 | 设置页移除；`slotHours` 仍随轴保存供双写 |
| 格备注 `slot-notes.ts` | 已删 |
| 复制上周 UI | 已删；`copyPreviousWeekToThisWeek` 标 `@deprecated` |

## 刻意延后（决议）

| 项 | 原因 |
|----|------|
| 停双写 slot | 决议 #17：等桌面时间线写入稳定 ≥14 天 |
| 桌面旧 panel 删除 | 阶段 J 未完成，桌面仍依赖格子 UI |
| `timeline_write` 默认开 | 依赖 J；现仍默认关 |
| DROP `start_slot_index` 等列 | 更晚：先停写 → deprecated → 再 DROP |

## 回滚

恢复 git 中本阶段前的 `WeeklyFrogSchedule` / 设置卡；数据层未 DROP，无需迁库。
