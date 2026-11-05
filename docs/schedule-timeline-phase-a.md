# 日程表时间线 · 阶段 A 基线与契约

> 日期：2026-11-05  
> 对照方案：`日程表时间线重构方案.md` §阶段 A / §0.1  
> 用途：后续阶段回归勾选；PR 须附「不可破坏契约」。

---

## 1. 行为基线（可勾选复现）

### 1.1 占用写入 / 删除

| # | 场景 | 预期 |
|---|------|------|
| B1 | 今日空格点选 → 入格 Sheet → 确认 | 本地出现 `schedule_placements`；当日指派绑定；UI 刷新；失败则本地行回滚 |
| B2 | 同主体再落入重叠格段 | 拒绝：「该项已在该格子内…」 |
| B3 | 过去日点格 / 入格 | 拒绝：「过去日程不可编辑」 |
| B4 | 详情 → 删一段 | 仅删该 placement；若当日该主体无剩余占用 → 取消当日指派 |
| B5 | 详情 → 取消当日指派 | 删该日该主体全部占用 + unassign |
| B6 | 未入格（orphaned）→ 点空档重新落入 | `rematerializeOrphanedPlacement`；可改日；失败回滚为未入格 |

### 1.2 改轴

| # | 场景 | 预期 |
|---|------|------|
| B7 | 缩日范围 / 加 break，使部分占用落轴外 | 对应行 `orphaned` / `start_slot_index=null`；「未入格」入口可见 |
| B8 | 改 `slotHours` 后仍在轴内 | 按绝对开始时间 remap 到新工作格；课表标签与 `formatMinuteRangeLabel` 一致 |
| B9 | 断开时段过多导致 0 工作格 | 保存拒绝：「断开时段过多…」 |

### 1.3 虚拟块

| # | 场景 | 预期 |
|---|------|------|
| B10 | 习惯（循环命中日） | 一律全天虚拟块；不写 `schedule_placements`；完成走打卡 |
| B11 | 独立待办有具体时刻 | 落对应工作格；时刻在 break / 轴外 → 回退全天 |
| B12 | 过期未完成青蛙 / 待办 | 今日可见滞留虚拟块（与现实现一致） |
| B13 | 同日已有手动占用 | 不再叠同主体虚拟待办块 |

### 1.4 视图与导航

| # | 场景 | 预期 |
|---|------|------|
| B14 | 默认最简态 | 当前时段 + 倒计时；**本重构不得改坏**（决议 #2） |
| B15 | 最简 ↔ 课表展开 | 动效可减弱；数据一致 |
| B16 | 左右滑日 / 周条跳转 / `jumpToYmd` | `periodIndex` 与 `onViewYmdChange` 正确；邻日预载 |
| B17 | 长按项目指派 pending | 自动展开课表并提示点空格 |

### 1.5 提醒（若已开通知）

| # | 场景 | 预期 |
|---|------|------|
| B18 | 格提醒触发时刻 | 现行为：`slotStartMinutes(axis, startSlotIndex)` → 墙钟；阶段 I 前保持；之后须与分钟区间对齐 |

### 1.6 Break 禁排基线

| 项 | 现状 |
|----|------|
| 存储 | `ScheduleAxisSettings.breaks`（`@selfapp/frog_schedule_axis_v1`） |
| 默认轴 | `08:00–22:00`、`slotHours=2`、**`breaks: []`**（`DEFAULT_SCHEDULE_AXIS`） |
| 语义 | 断开行占时间线；工作格索引不含 break；`maxSpanFromSlot` 遇 break 截断 |
| 决议 | 配置的断开时段**继续作为禁排区**（方案 §9）；时间线 UI 不画旧厚休息行，但校验仍拒绝跨 break（阶段 G） |
| 记录本机 | 打开「周日程表设置」→ 记下当前 breaks 列表（标签 + 起止）作为个人禁排对照 |

---

## 2. 不可破坏契约（PR 必勾）

复制到涉及日程/同步的 PR 描述：

```markdown
## 日程契约（阶段 A+）

- [ ] 入格成功路径：先本地 placement → assign → 远端 upsert；assign 失败须回滚本地行
- [ ] 过去日只读：`isEditableScheduleDay` / `isEditableWeek` 拒绝写入
- [ ] 删一段 vs 取消指派语义不变（见基线 B4 / B5）
- [ ] 同步表名未改：`schedule_placements`、`schedule_week_axis_snapshot`（及轴 settings 键）
- [ ] 分钟语义：逻辑日 axis 分钟（可跨午夜）；区间 **半开 `[start, end)`**（决议 #12/#13）
- [ ] break 仍为禁排来源；新写入不得跨 / 与 break 相交（决议 #6；write 开关开启后强制）
- [ ] 最简态 `WeeklyFrogSchedule` minimal 路径未改坏（决议 #2）
- [ ] 阶段 K 后：`timeline_ui` 默认开（时间线路径）；关 UI 可回经典课表
- [ ] `timeline_write` 默认关时：仍为选格写入；未默认开 write 前不删旧 grid、不 DROP slot 列
```

模板文件：`selfApp/.github/PULL_REQUEST_TEMPLATE/schedule-timeline.md`

---

## 3. 特性开关

| Key | 读写 | 默认 | 阶段接线 |
|-----|------|------|----------|
| `@selfapp/schedule_timeline_ui_v1` | 阶段 L 起 App 不再读取（日视图固定时间线）；键位保留防同步冲突 | — | L 退役 UI 开关 |
| `@selfapp/schedule_timeline_write_v1` | `load/saveScheduleTimelineWriteEnabled` | **关**（J 完成后再默认开） | G |

实现：`selfApp/lib/schedule/timeline-flags.ts`  
存储：`app_settings`（`AppSettingKey.scheduleTimelineUiV1` / `scheduleTimelineWriteV1`）

---

## 4. 已删入口（阶段 L）

| 入口 | 状态 |
|------|------|
| 复制上周 UI | 已删；`copyPreviousWeekToThisWeek` 标 `@deprecated` |
| 格备注 | 已删 `slot-notes.ts` |
| 经典课表 / 格宽设置 | 设置页已移除 |

详见 `schedule-timeline-phase-l.md`。
