# 任务 Tab 页 — 后端配合清单（APP 已改，请按本文执行）

> 版本：2026-08-18  
> 后端仓库：`self_app_back`  
> 面向：后端开发者  
> 前端 pageKey：`tabs/tasks`  
> 前端入口：`screens/tasks/TasksScreen.tsx`  
> 相关旧文档：`BACKEND_TASKS_PAGE_API_TASKS.md`（bootstrap / 通用 List 方案，**APP 已不再走**）  
> 日历页另见：`BACKEND_TASKS_CALENDAR_API.md`（本文不覆盖日历）  
> **剩余专口缺口（habits-grid extra_data、today-frogs 项目青蛙、matrixWeek 分页）见 `BACKEND_TASKS_TAB_API_FIX.md`**

---

## 一、先看结论（必读）

1. **不要再给任务 Tab 做 `/api/data/{table}` 通用 List 全量/分页。** APP 首屏已停用该路径。
2. APP 现在只打 **页面专用接口**。慢、缺字段、口径不对，都要在这些专用接口上修，而不是补 List。
3. 最关键缺口：**完成热力图的待办计数必须由服务端按「净完成」口径算出。** APP 已改为信任接口，不再本地重算。

---

## 二、APP 已做的改动（后端对齐用）

任务 Tab 冷启动 / 下拉刷新 **不再**调用：

| 已停用 | 原因 |
|--------|------|
| `GET /api/pages/tasks/summary` + 逐表 `GET /api/data/{table}` | 会把 `habit_check_ins` 近 24 个月、事件表、habits 全表翻页，首屏被阻塞 |
| `GET /api/pages/tasks`（无 `taskView` 的 10 表 bootstrap） | payload 过大，且仍依赖通用 List 降级 |
| `GET /api/data/tasks` 全表分页（含 `updatedSince` 增量） | 筛选视图已能展示待办/四象限 |
| `GET /api/data/projects` / `project_categories` / `task_categories` 降级 | catalog 失败改为回退本地 SQLite，不再 List |
| `GET /api/data/habits`（日历补数字段） | 日历页本地回退只读 SQLite |

任务 Tab 首屏实际请求（可并行）：

```
GET /api/pages/tasks/catalog
GET /api/pages/tasks?include=tasks&taskView=standaloneTodos&...
GET /api/pages/tasks?include=tasks&taskView=matrixWeek&projectIds=...
GET /api/pages/projects?...
GET /api/pages/tasks/habits-grid
GET /api/pages/tasks/today-frogs
GET /api/pages/tasks/completion-heatmap
GET /api/app/wish-board/balance   （积分，已有）
```

**禁止**再为上述任一接口失败而降级到 `/api/data/*` List。

---

## 三、必须完成的后端工作

按优先级。P0 不完成，热力图会错（不是变慢）。

### P0（必做）`GET /api/pages/tasks/completion-heatmap` 待办必须净完成

**现状问题**：APP 以前青蛙计数用接口、待办计数用本地事件表重算，所以服务端待办口径不对也不显眼。现在 APP **格子计数和点开某天的待办明细都直接用接口**。

**必须对齐的口径**（与 APP 本地已实现、旧文档第五节一致）：

| 任务类型 | 规则 |
|----------|------|
| 非重复独立待办 | 同一 `task_id` **全局只保留最新一条** `task_execution_events`。最新为 `reopened` → 热力图任何一天都不再出现；最新为 `completed` → 只计该事件所在逻辑日。撤销后再完成，只计今天。 |
| 重复待办 | 同一 `task_id` + 逻辑日只保留最新一次；各执行日可分别计一次。 |
| 与青蛙互斥 | 某日某 `task_id` 已在青蛙完成里出现，**待办区不再计**该条（计数和明细都要扣掉）。 |

时间：`task_execution_events.created_at` / `tasks.completed_at` 为无时区 DATETIME 时，**按墙上时钟比较，禁止当 UTC 再加偏移**。带 `Z` 的 ISO 仍按标准瞬间解析。逻辑日用请求里的 `dayBoundaryHour` / `dayBoundaryMinute`。

#### 请求（已有，勿改名）

```
GET /api/pages/tasks/completion-heatmap
  ?dayBoundaryHour=0
  &dayBoundaryMinute=0
  &heatmapStart=YYYY-MM-DD
  &heatmapEnd=YYYY-MM-DD
  &day=YYYY-MM-DD                 // 可选，点某天才带
  &includeDayDetail=true          // 点某天才带
```

默认区间：今天所在周往前 14 周的周一 → 逻辑今日（约 15 周 / 105 天）。

#### 响应（计数必须可直出）

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "meta": {
      "logicalToday": "2026-08-18",
      "heatmapStart": "2026-05-04",
      "heatmapEnd": "2026-08-18",
      "completionHeatmapWeeks": 15,
      "serverTime": "2026-08-18T09:00:00.000Z",
      "todoNetCompleted": true
    },
    "countsByDay": {
      "2026-08-18": { "frogs": 1, "todos": 2, "total": 3 }
    },
    "dayDetail": {
      "ymd": "2026-08-18",
      "frogs": [{ "task_id": "t_xxx", "task_title": "写周报" }],
      "todos": [{ "id": "evt_xxx", "task_id": "t_yyy", "title": "买菜" }]
    }
  }
}
```

| 字段 | 要求 |
|------|------|
| `countsByDay[ymd].todos` | **净完成**待办数，不是事件表 raw count |
| `countsByDay[ymd].frogs` | 该日青蛙**净完成**数（`frog_completion_events` 按主体+指派日取最新；仅最新为 completed 计入）。**不要求** tasks/projects 行仍存在：完成并删除项目/任务后，事件行 + `task_title` 快照仍计入 |
| `dayDetail.frogs[]` | `task_id` 为青蛙主体（任务 id **或** 项目 id）；可带 `subject: "task" \| "project"`；标题优先活体行，否则用事件快照 |
| `countsByDay[ymd].total` | `frogs + todos`（已互斥去重后） |
| `meta.todoNetCompleted` | 新加，恒为 `true`，表示待办已按净完成计算。没有此标记时 APP 仍会用接口数，但联调时用它验收 |
| `dayDetail.todos` | 仅当日净完成待办；不含已在 `frogs` 里的 `task_id` |
| `dayDetail` | 仅 `includeDayDetail=true` 且带 `day` 时返回 |

**不要**为热力图再暴露 `task_execution_events` / `frog_completion_events` 的 List。事件表只给这个专用接口内部用。

**验收**

- [ ] 非重复待办：完成 → 撤销 → 再完成，热力图只出现在「再完成」当天
- [ ] 晚上完成、`completed_at` 无时区：算在当天逻辑日，不漂到次日
- [ ] 同一任务既是青蛙又完成：只出现在青蛙计数，待办计数不加 1
- [ ] 项目青蛙完成并选择「不保留」删除后：当日 `frogs` 计数仍含该条；`dayDetail.frogs` 能靠 `task_title` 快照展示
- [ ] 删除任务时**不得**级联删除 `frog_completion_events`（历史记录需保留）
- [ ] 区间约 105 天，响应应是按日聚合，体积远小于事件表全量 JSON

---

### P1（必做）`GET /api/pages/tasks/today-frogs` 一次返回任务青蛙 + 项目青蛙

**现状问题**：接口目前主要返回任务行；项目青蛙靠 APP 再扫本地 `projects`。本地库若未全量同步，项目青蛙会漏。

**请改成专口直出**，APP 将逐步改为直接渲染 `data.tasks` + `data.projectFrogs`，不再依赖全表。

```
GET /api/pages/tasks/today-frogs?dayBoundaryHour=0&dayBoundaryMinute=0
```

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "logicalToday": "2026-08-18",
    "count": 3,
    "tasks": [ /* 今日指派的任务青蛙，字段与 tasks 行一致，含 extra_data */ ],
    "projectFrogs": [ /* 今日指派的项目青蛙，字段与 projects 行一致，含 extra_data */ ],
    "projectFrogIds": ["p_xxx"],
    "meta": { "serverFiltered": true, "filtersVersion": "tasks-page-v1" }
  }
}
```

规则：

- 判定「今日青蛙」与客户端 `isFrogAssignedOn(extra_data, logicalToday)` 一致（`extra_data` 里的指派日）。
- `tasks` 不要只返回精简行；完成/撤销青蛙需要完整 `extra_data` / `status`。
- 任务 id 与项目 id 碰撞时，项目青蛙优先，任务侧去掉同 id。
- **不要**为此去拉 `GET /api/data/tasks` 全表。

**验收**

- [ ] 只把任务标成今日青蛙 → `tasks` 有、`projectFrogs` 空
- [ ] 无子任务的项目标成今日青蛙 → `projectFrogs` / `projectFrogIds` 有
- [ ] 跨逻辑日（日界小时非 0）指派日切换正确

---

### P2（必做）`GET /api/pages/tasks/habits-grid` 必须能单独支撑首页习惯区

APP 已不再同步 `habit_check_ins` 全量。首页习惯格 **只信这个接口**。

已有：

```
GET /api/pages/tasks/habits-grid?dayBoundaryHour=0&dayBoundaryMinute=0&logicalToday=YYYY-MM-DD
```

请确认并补齐：

| 项 | 要求 |
|----|------|
| 分组 | 按 `habit_contexts` 分段，与线上 UI 一致 |
| `todayCount` / `dailyGoal` / `displayCompleted` | 服务端按养成 / 戒除 / 任务型算好 |
| 任务型习惯 | `periodProgress` / `periodGoal` 必须有；打勾只看周期目标，不要用「今日有 1 次打卡」当完成 |
| 子习惯 | 子项清单在 `habits.extra_data`（`subHabitsEnabled` / `subHabits` / `subHabitCheckIns`）。网格至少返回父习惯今日进度；**不要**为此新增表，也 **不要** List `habit_check_ins` |
| `hiddenOnViewDay` | 创建日之后才显示的习惯，当日应对客户端隐藏 |
| `meta.serverFiltered` | `true` |
| `meta.filtersVersion` | `"tasks-page-v1"` |

**不要做**：独立的「打卡摘要 List」或 `GET /api/data/habit_check_ins?startDate&endDate` 给任务首页。日历页打卡热力走日历专口（见日历文档）。

**验收**

- [ ] 不请求任何 `/api/data/habit_check_ins` 时，任务首页习惯格进度与完成态正确
- [ ] 子习惯未全完成：父习惯不显示完成
- [ ] 任务型习惯周期未达标：即使今日打过卡也不打勾

---

### P3（强烈建议）两个 `taskView` 筛选接口保持权威、可分页

APP 调用：

```
GET /api/pages/tasks?include=tasks&taskView=standaloneTodos&logicalToday=&weekStart=&weekEnd=&dayBoundaryHour=&dayBoundaryMinute=&page=1&limit=200&includeShelved=true

GET /api/pages/tasks?include=tasks&taskView=matrixWeek&logicalToday=&weekStart=&weekEnd=&projectIds=&dayBoundaryHour=&dayBoundaryMinute=
```

要求：

| 项 | 说明 |
|----|------|
| 只返回 `tasks` 数组 + `meta`，不要 10 张表 | APP `include=tasks` |
| `meta.serverFiltered === true` | 否则 APP 会警告并本地全表筛（本地可能不全） |
| `meta.filtersVersion === "tasks-page-v1"` | 与前端常量一致 |
| `meta.tasksScope` | `standaloneTodos` 或 `matrixWeek`，必须与请求 `taskView` 一致 |
| 独立待办 | 含今日日界内已完成/取消、搁置、未到执行日的重复待办（APP 会再排序） |
| 四象限 | **时间范围与本周相交**（见 `BACKEND_MATRIX_WEEK.md`）；`projectIds` 可选，缺省=全部项目。**禁止**只按 `due_date` 落在本周 |
| 分页 | 待办 `limit=200`，`meta.totalPages` 必须准；APP 会翻页直到 `totalPages` |
| 他端完成 | 已完成且超出日界的独立待办 **不要**再出现在未完成列表 |

**不要**再要求 APP 先 `GET /api/data/tasks` 增量对齐全表。筛选结果必须是展示权威源。

---

### P4（强烈建议）`GET /api/pages/tasks/catalog` 与 `GET /api/pages/projects`

二者 APP 已在用，失败不再降级 List。

**catalog**

```
GET /api/pages/tasks/catalog?updatedSince=ISO
```

- 必须带 `meta.serverTime`、`meta.tablesVersion.{projects,project_categories,task_categories}.count`
- `meta.catalogComplete !== false`
- 全量时数组长度 = count；增量时只返回变更行
- **不要**在失败时让 APP 去 List 三张表

**projects 列表（带任务树）**

```
GET /api/pages/projects?page=1&limit=200&includeCompleted=&includeCancelled=&categoryId=&uncategorized=
```

- 每个项目带 `tasks` 树（含 children）
- `includeCompleted=false` 时树里不要已完成任务（与 APP「隐藏已完成」开关一致）
- 收集箱 Tab：APP 会打 `uncategorized=true` 与 `categoryId=inbox` 两次再合并，请保持语义稳定
- **不要**为此 List `tasks` 全表
- 任务树被 LIMIT 截断的改法见 **`BACKEND_PROJECTS_TASK_TREE.md`**（`limit` 只切项目、补 `taskCount` / `projectId`）

---

## 四、明确不要做的事

| 不要做 | 原因 |
|--------|------|
| 优化 / 继续依赖 `GET /api/data/habit_check_ins` 给任务首页 | APP 已不调用 |
| 继续提供任务 Tab 用的 `GET /api/pages/tasks/summary` + 逐表 List | APP 已跳过 |
| 无 `taskView` 的 10 表 bootstrap 给首页 | 太大；首页用拆开的专口 |
| 为多端同步再让 APP 翻 `GET /api/data/tasks` | 用筛选视图 + projects 树 |
| P8 多表 batch List | 与「不用通用 List」相反 |
| 新表存子习惯 | 继续放 `habits.extra_data` |
| 热力图返回原始事件数组 | 只返回按日聚合 |

旧 List 接口可保留给其它页面 / 管理端，**不要作为任务 Tab 的读模型**。

---

## 五、建议的服务端实现要点

1. **热力图**：SQL 先按 `task_id`（重复则再按逻辑日）取最新 `task_execution_events`，再过滤 `action='completed'`，再按逻辑日 `GROUP BY`。不要把整表事件 JSON 吐给 APP。
2. **索引**（若未建，部署时执行已有脚本）：
   - `task_execution_events(created_at)` 或 `(user_id, created_at)`
   - `frog_completion_events(assigned_ymd)` 或 `(user_id, assigned_ymd)`
   - `habit_check_ins(habit_id, record_date)`（仅供 habits-grid 内部查询）
3. **habits-grid**：服务端查近若干天打卡即可算今日/周期进度，**响应里不要带打卡明细数组**。
4. **today-frogs**：`JSON_EXTRACT` / 等价方式读 `extra_data` 的指派日，过滤逻辑今日；项目表同样处理。
5. 所有任务页专用接口继续 gzip；单接口超时目标 **2s 内**（热力图聚合若慢，加缓存，key = user + logicalToday + heatmapStart/End）。

---

## 六、联调验收清单（前后端一起勾）

抓包任务 Tab 冷启动，**不应出现**：

- [ ] `GET /api/data/habit_check_ins`
- [ ] `GET /api/data/task_execution_events`
- [ ] `GET /api/data/frog_completion_events`
- [ ] `GET /api/data/tasks`（无 `taskView` 的通用表 List）
- [ ] `GET /api/data/habits` / `habit_contexts` / `projects`（任务 Tab 路径）
- [ ] `GET /api/pages/tasks/summary`
- [ ] 无 `taskView` 的巨大 `GET /api/pages/tasks`

**应出现**（均可并行）：

- [ ] `GET /api/pages/tasks/catalog`
- [ ] `GET /api/pages/tasks?...taskView=standaloneTodos`
- [ ] `GET /api/pages/tasks?...taskView=matrixWeek`
- [ ] `GET /api/pages/projects`
- [ ] `GET /api/pages/tasks/habits-grid`
- [ ] `GET /api/pages/tasks/today-frogs`
- [ ] `GET /api/pages/tasks/completion-heatmap`

功能：

- [ ] 他端完成独立待办后，本机刷新待办栏不再显示未完成
- [ ] 热力图待办净完成口径（见 P0 验收）
- [ ] 项目青蛙出现在今日青蛙（见 P1）
- [ ] 习惯格不依赖打卡全表（见 P2）
- [ ] 弱网：专用接口失败时 APP 回退本地缓存，不转去打 List

---

## 七、接口与代码索引

| 端 | 路径 |
|----|------|
| 后端（建议） | `self_app_back/src/routes/pages.ts` |
| 热力图 | `self_app_back/src/services/pages/` 下 heatmap 相关 |
| 习惯网格 | habits-grid service |
| 今日青蛙 | today-frogs service |
| 前端热力图 | `lib/tasks-completion-heatmap-api.ts` |
| 前端习惯网格 | `lib/tasks-habits-grid-api.ts` |
| 前端今日青蛙 | `lib/today-frogs-api.ts` |
| 前端待办/四象限 | `lib/tasks-page-api.ts` |
| 前端 catalog | `lib/tasks-catalog-api.ts` |
| 前端项目树 | `lib/projects-list-api.ts` |
| 前端任务 Tab 同步 | `lib/api-page-sync.ts`（`tabs/tasks` 已跳过通用 List） |

---

## 八、与旧文档关系

| 文档 | 关系 |
|------|------|
| `BACKEND_TASKS_PAGE_API_TASKS.md` | 旧方案：bootstrap + 通用 List 增强。任务 Tab **不再按那份接入**。其中热力图净完成口径、`filtersVersion` 仍有效，已收入本文 P0/P3。 |
| `BACKEND_TASKS_CALENDAR_API.md` | 日历页专用接口，与本文独立。日历也不要用通用 List。 |

有问题对字段名时：保持现有 query / JSON 字段名，只补口径和缺失数组，避免 APP 再改契约。
