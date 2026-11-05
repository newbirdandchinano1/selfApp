# 日程表时间线 · 阶段 J（桌面对齐）

App 时间线稳定后，桌面读分钟、不抹字段，并上日视图时间线；桌面 write 默认仍关。

## 已完成

| 项 | 说明 |
|----|------|
| J0 透传 | `serializeDesktopPlacementUpsert`：缺分钟键不带字段，避免抹 null |
| 域对齐 | `deriveSlotSpanForMinutes` / `breakIntersectingInterval` / `workCoverageMinutes`；`timeline/{layout,labels,events,from-placement}` |
| 加载 normalize | `loadScheduleForDayWindow` → `normalizePlacementsMinutesInMemory` |
| 分钟写入 API | `placeFrogOnScheduleAt` / `rematerializeOrphanedPlacementAtMinutes`（与 App 同校验：轴内、半开、禁跨 break、同主体区间） |
| 日视图 UI | `DayTimelineSchedule` 三列；设置可关回经典格子 |
| 开关 | 桌面 `timeline_ui` 默认开、`timeline_write` 默认关（localStorage） |

## 完成标准对照

- [x] App 写入 ↔ 桌面读取分钟一致（时间线优先存库分钟）
- [x] 桌面写入不把分钟抹成 null（缺键不传）
- [ ] 桌面时间线上线满 14 天后评估停双写（决议 #17，观察中）

## 回滚

- 设置关掉「时间线日视图」→ 三列经典格子
- 桌面 write 保持关即可不走分钟写路径
