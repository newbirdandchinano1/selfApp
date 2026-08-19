# 本周列表 `taskView=matrixWeek` — 后端必须改筛选口径

> 版本：2026-08-19  
> 仓库：`self_app_back`  
> 接口：`GET /api/pages/tasks?include=tasks&taskView=matrixWeek`  
> APP：任务 Tab「本周列表」四象限

---

## 结论

**是接口问题。** APP 已不再按分类 Tab 切四象限。现在要的是：**计划时间范围与本周有交集的项目任务**。

当前后端仍按旧口径「`due_date` 落在本周，或已过期未完成」。这会把绝大多数任务滤空，因为：

- 时间段写在 `tasks.extra_data.schedule.range`，**不是**只看 `due_date`
- `due_date` 一般等于区间 **结束日**（例如 8/1–8/31 的任务 `due_date=2026-08-31`），本周（8/17–8/23）对不上

抓包若 `tasks: []` 且 `meta.total=0`，就是这条 SQL/筛选写错了，不是 APP 没带参数。

---

## 请求（已有，勿改名）

```
GET /api/pages/tasks?include=tasks&taskView=matrixWeek
  &logicalToday=YYYY-MM-DD
  &weekStart=YYYY-MM-DD
  &weekEnd=YYYY-MM-DD
  &dayBoundaryHour=
  &dayBoundaryMinute=
  &page=1&limit=200
  &projectIds=           // 可选；缺省 = 全部项目，不要返回空数组
```

`weekStart` / `weekEnd`：本周一至周日（与 APP `getCurrentWeekRange` 一致）。

---

## 必须改的纳入规则

只返回 **未完成/未取消** 的 **项目任务**（`project_id` 非空，或 `parent_task_id` 非空）。**不要**返回独立待办。

一条任务入选，当且仅当其 **计划窗与 [weekStart, weekEnd] 有交集**：

| 优先级 | 数据 | 规则（日期取前 10 位 YYYY-MM-DD，按墙上日期，禁止当 UTC 再加偏移） |
|--------|------|------|
| 1 | `extra_data.schedule.mode === "time"` 且有 `range.start` / `range.end` | `start <= weekEnd AND weekStart <= end` |
| 2 | `extra_data.schedule.date` | `date` 落在 `[weekStart, weekEnd]` |
| 3 | 以上都没有时才看 `due_date` | `due_date` 落在 `[weekStart, weekEnd]` |

**不要再**把「过期但时间范围完全不在本周」的任务塞进来。

`extra_data` 示例：

```json
{
  "schedule": {
    "mode": "time",
    "range": {
      "start": "2026-08-01T00:00:00",
      "end": "2026-08-31T23:59:59"
    }
  }
}
```

这条必须出现在 `weekStart=2026-08-17&weekEnd=2026-08-23` 的结果里，即使 `due_date=2026-08-31`。

MySQL 取值示例：

```sql
JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.schedule.range.start'))
JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.schedule.range.end'))
JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.schedule.date'))
JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.schedule.mode'))
```

`projectIds`：

- **缺省或不传**：不要当「无项目」→ 空列表；应返回全部命中任务
- 有值：再限制 `project_id IN (...)`（含子任务按祖先项目）

---

## 响应 meta（必须）

```json
{
  "tasks": [ /* Task 行 */ ],
  "meta": {
    "serverFiltered": true,
    "filtersVersion": "tasks-page-v1",
    "tasksScope": "matrixWeek",
    "page": 1,
    "limit": 200,
    "total": 12,
    "totalPages": 1
  }
}
```

- `include=tasks`，禁止再附带 10 张表
- `totalPages` 必须准；APP `limit=200` 会翻页

---

## 验收

- [ ] 时间段跨整月、结束日不在本周的未完成项目任务，本周列表有
- [ ] 单日 `schedule.date` 在本周的有
- [ ] 时间范围完全在下周/上月、且不与本周相交的没有
- [ ] 独立待办（无 `project_id` / `parent_task_id`）没有
- [ ] 不传 `projectIds` 仍返回上述全集，而不是 `[]`
- [ ] `meta.serverFiltered=true` 且 `tasksScope=matrixWeek`
