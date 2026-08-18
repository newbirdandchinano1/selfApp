# 任务 Tab — 剩余专口必须补齐（APP 已切断全表 List）

> 版本：2026-08-18  
> 后端仓库：`self_app_back`  
> 面向：后端开发者  
> 前端 pageKey：`tabs/tasks`  
> 前端入口：`screens/tasks/TasksScreen.tsx`  
> 配套总览：`BACKEND_TASKS_TAB_PERF.md`（热力图净完成、catalog、projects 树仍有效）  
> 本机桌面亦有同名副本，便于发给后端。

---

## 一、先看结论（必读）

APP **已经不再**为任务 Tab 打这些通用 List（含打卡后刷新、习惯绑定任务、习惯格补字段）：

| 禁止再依赖 | 以前为什么会打 |
|------------|----------------|
| `GET /api/data/habit_check_ins` 全表翻页 | 首页习惯格 / 打卡后 `loadActiveCheckIns` |
| `GET /api/data/habits` 全表翻页 | `getHabits()` 补 extra_data、戒除/养成完成态 |
| `GET /api/data/tasks` 全表翻页 | 习惯绑定任务完成、今日青蛙本地重扫 |
| `GET /api/data/projects` 全表翻页 | 今日青蛙补项目青蛙 |
| `GET /api/pages/tasks/summary` | 旧 bootstrap |
| 无 `taskView` 的 10 表 `GET /api/pages/tasks` | 旧 bootstrap |

**缺字段、缺项目青蛙、四象限一次吐太多，都只能改专用接口。不要再让 APP 去 List。**

任务 Tab 冷启动 / 下拉刷新 **只允许**这些请求（可并行）：

```
GET /api/pages/tasks/catalog
GET /api/pages/tasks?include=tasks&taskView=standaloneTodos&page=&limit=200&includeShelved=true&...
GET /api/pages/tasks?include=tasks&taskView=matrixWeek&page=&limit=200&projectIds=...
GET /api/pages/projects?...
GET /api/pages/tasks/habits-grid
GET /api/pages/tasks/today-frogs
GET /api/pages/tasks/completion-heatmap
GET /api/app/wish-board/balance
```

抓包若再出现 `/api/data/habits`、`/api/data/habit_check_ins`、`/api/data/tasks`，视为回归，不要用「前端再降级 List」来修。

---

## 二、P0（必做）`GET /api/pages/tasks/habits-grid` 必须能单独支撑习惯格

APP 已：

- 只信这个接口渲染首页习惯格
- 把返回的习惯 **upsert 进本地 SQLite**（不做全表 reconcile）
- **不再** List `habits` / `habit_check_ins`

因此响应里必须带齐写操作所需字段，否则子习惯、积分、戒除/养成完成会缺数据。

```
GET /api/pages/tasks/habits-grid
  ?dayBoundaryHour=0
  &dayBoundaryMinute=0
  &logicalToday=YYYY-MM-DD
```

### 每个 `items[]` 至少返回

| 字段 | 要求 |
|------|------|
| `id` `name` `icon` `kind` | 已有 |
| `todayCount` `dailyGoal` `displayCompleted` | 服务端按养成 / 戒除 / 任务型算好 |
| `periodProgress` `periodGoal` | 任务型必须有 |
| `hiddenOnViewDay` | 创建日之后才显示的习惯，当日 true |
| **`extra_data`** | **必补。** 与 `habits.extra_data` 同内容（JSON 字符串或对象均可）。含子习惯 `subHabitsEnabled` / `subHabits` / `subHabitCheckIns`、积分、周期目标 |
| `note` | 建议有 |
| `rewardPoints` | 建议有；没有则 APP 从 extra_data 解析 |
| `context` | 建议为 `habit_contexts` 的 id 或名称 |

`meta.serverFiltered === true` 且 `meta.filtersVersion === "tasks-page-v1"`。

**不要做**：为首页再提供 `GET /api/data/habit_check_ins` 或打卡摘要 List。打卡明细只给这个接口内部算进度，响应里不要带打卡数组。

### 验收

- [ ] 不请求任何 `/api/data/habit_check_ins` / `/api/data/habits` 时，习惯格进度、打勾、子习惯弹窗正确
- [ ] 子习惯未全完成：父习惯不显示完成
- [ ] 任务型习惯周期未达标：即使今日打过卡也不打勾
- [ ] extra_data 缺失时 APP 只能靠本地缓存，他端新建的子习惯会丢

---

## 三、P0（必做）`GET /api/pages/tasks/today-frogs` 一次返回任务青蛙 + 项目青蛙

APP 已改为：

- **直出** `data.tasks` + `data.projectFrogs`
- 只按 id 回填本地已有行，**不再扫 tasks 全表**
- 仅叠加本地 `pending_*` 未上传行

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
    "tasks": [ { "id": "t_xxx", "title": "写周报", "status": "todo", "extra_data": "{...}", "...tasks 全字段..." } ],
    "projectFrogs": [ { "id": "p_xxx", "name": "无子任务项目", "extra_data": "{...}", "...projects 全字段..." } ],
    "projectFrogIds": ["p_xxx"],
    "meta": {
      "serverFiltered": true,
      "filtersVersion": "tasks-page-v1",
      "serverTime": "2026-08-18T09:00:00.000Z"
    }
  }
}
```

| 规则 | 说明 |
|------|------|
| 判定「今日青蛙」 | 与客户端 `isFrogAssignedOn(extra_data, logicalToday)` 一致 |
| `tasks` | 完整任务行，必须含 `extra_data` / `status` / `priority`（完成、撤销青蛙要用） |
| `projectFrogs` | 今日指派的**项目**青蛙，完整 projects 行 |
| 互斥 | 任务 id 与项目 id 碰撞时，项目优先，tasks 里去掉同 id |
| `meta.serverFiltered` | **必须 `true`**，否则 APP 会再用本地 projects 补项目青蛙（本地可能不全） |
| `meta.filtersVersion` | `"tasks-page-v1"` |

**不要**为此去拉 `GET /api/data/tasks` 或 `GET /api/data/projects` 全表。

### 验收

- [ ] 只把任务标成今日青蛙 → `tasks` 有、`projectFrogs` 空
- [ ] 无子任务的项目标成今日青蛙 → `projectFrogs` / `projectFrogIds` 有
- [ ] 跨逻辑日（日界小时非 0）指派日切换正确
- [ ] 抓包任务 Tab **没有** `/api/data/tasks`

---

## 四、P1（必做）两个 `taskView` 都必须可分页，limit=200

APP 现在 **待办栏和四象限都带 `page` + `limit=200`**，并翻页直到 `meta.totalPages`。

```
GET /api/pages/tasks?include=tasks&taskView=standaloneTodos
  &logicalToday=&weekStart=&weekEnd=
  &dayBoundaryHour=&dayBoundaryMinute=
  &page=1&limit=200&includeShelved=true

GET /api/pages/tasks?include=tasks&taskView=matrixWeek
  &logicalToday=&weekStart=&weekEnd=&projectIds=
  &dayBoundaryHour=&dayBoundaryMinute=
  &page=1&limit=200
```

| 项 | 说明 |
|----|------|
| 只返回 `tasks` + `meta` | `include=tasks`，**禁止**再附带 10 张表 |
| `meta.serverFiltered === true` | 否则 APP 警告；本地库可能不全 |
| `meta.filtersVersion === "tasks-page-v1"` | |
| `meta.tasksScope` | 必须等于请求的 `taskView` |
| `meta.page` `meta.limit` `meta.total` `meta.totalPages` | **必须准**。`totalPages` 缺省时 APP 只读第 1 页，多出来的行会丢 |
| 独立待办 | 含今日日界内已完成/取消、搁置、未到执行日的重复待办 |
| 四象限 | 本周到期 + 过期未完成；`projectIds` 为当前分类下项目 id 逗号串 |
| 超时 | 筛选视图应在 **2s 内**；APP 对带 `taskView` 的请求超时已改为 20s（不再按 10 表 bootstrap 等 180s） |

**带 `taskView` 时禁止返回** `habits`、`habitCheckIns`、`taskExecutionEvents`、`frogCompletionEvents` 等。

### 验收

- [ ] `matrixWeek` 超过 200 条时第 2 页能继续拉到，且 `totalPages >= 2`
- [ ] 响应 JSON 只有 `tasks` / `meta`，体积远小于无 taskView 的 bootstrap
- [ ] 他端完成独立待办后，本机刷新待办栏不再显示未完成

---

## 五、P1（强烈建议）catalog / projects 不要变相全量

### `GET /api/pages/tasks/catalog?updatedSince=`

- 全量只在 APP 无游标或强制刷新时发生
- 增量只返回变更行；`meta.tablesVersion.*.count` 仍是服务端全表行数
- `meta.catalogComplete !== false`
- **不要**失败时让 APP 去 List 三张表（APP 已改为回退 SQLite）

### `GET /api/pages/projects`

- `limit` 只切**项目**，不要把任务树截断在 limit 里
- 每个项目带完整 `tasks` 树 + `taskCount`
- `includeCompleted=false` 时树里不要已完成任务
- 收集箱 Tab：APP 会打 `uncategorized=true` 与 `categoryId=inbox` 两次再合并
- 任务树被 LIMIT 截断的改法见 `BACKEND_PROJECTS_TASK_TREE.md`

项目很多时，宁可分页项目，也不要一次把所有项目的整棵树塞进单响应。

---

## 六、P0（热力图，仍有效）`GET /api/pages/tasks/completion-heatmap`

待办必须 **净完成** 口径，APP 已信任 `countsByDay` / `dayDetail`，不再拉事件表 List。

细则、验收见 `BACKEND_TASKS_TAB_PERF.md` 第三节 P0。`meta.todoNetCompleted: true` 用于联调确认。

---

## 七、明确不要做的事

| 不要做 | 原因 |
|--------|------|
| 优化 / 继续提供任务 Tab 用的 `GET /api/data/habit_check_ins` | APP 已切断；再提供也打不到 |
| 继续提供 `GET /api/data/habits` 给首页补 extra_data | 改 habits-grid |
| 为习惯绑定任务再 List `GET /api/data/tasks` | APP 只用筛选视图 + 本地 |
| 无 `taskView` 的 10 表 bootstrap 给首页 | 太大 |
| 带 `taskView` 仍附带打卡/事件表 | 与筛选契约相反 |
| 热力图返回原始事件数组 | 只返回按日聚合 |
| P8 多表 batch List | 与「不用通用 List」相反 |

旧 List 接口可保留给管理端 / 其它页面，**不要作为任务 Tab 的读模型**。

---

## 八、建议的服务端实现要点

1. **habits-grid**：内部按 `habit_id` 查近若干天 `habit_check_ins` 即可算今日/周期进度；把父习惯 `extra_data` 原样放进 item。建索引 `(user_id, habit_id, record_date)`。
2. **today-frogs**：`JSON_EXTRACT(extra_data, ...)` 过滤逻辑今日指派；tasks 与 projects 各查一次。项目青蛙不要只给 id。
3. **taskView 分页**：`LIMIT/OFFSET` 或 keyset；`totalPages = ceil(total / limit)`。matrixWeek 与 standaloneTodos 同一套分页字段。
4. **带 taskView 的 `/api/pages/tasks`**：查询层只选 `tasks` 表，不要 join 出 10 张表再丢掉。
5. 所有任务页专用接口继续 gzip；单接口超时目标 **2s 内**。热力图可按 `user + logicalToday + heatmapStart/End` 缓存。

---

## 九、联调验收（抓包任务 Tab 冷启动 + 打一次卡）

**不应出现：**

- [ ] `GET /api/data/habit_check_ins`
- [ ] `GET /api/data/habits`
- [ ] `GET /api/data/tasks`
- [ ] `GET /api/data/projects`
- [ ] `GET /api/data/frog_completion_events`
- [ ] `GET /api/data/task_execution_events`
- [ ] `GET /api/pages/tasks/summary`
- [ ] 无 `taskView` 的巨大 `GET /api/pages/tasks`

**应出现（均可并行）：**

- [ ] `GET /api/pages/tasks/catalog`
- [ ] `GET /api/pages/tasks?...taskView=standaloneTodos&limit=200`
- [ ] `GET /api/pages/tasks?...taskView=matrixWeek&limit=200`
- [ ] `GET /api/pages/projects`
- [ ] `GET /api/pages/tasks/habits-grid`
- [ ] `GET /api/pages/tasks/today-frogs`
- [ ] `GET /api/pages/tasks/completion-heatmap`

功能：

- [ ] 他端完成独立待办后，本机刷新待办栏不再显示未完成
- [ ] 项目青蛙出现在今日青蛙（见第三节）
- [ ] 习惯格子习惯 / 积分不依赖 habits 全表（见第二节）
- [ ] 四象限超过 200 条能翻页（见第四节）
- [ ] 弱网：专用接口失败时 APP 回退本地缓存，不转去打 List

---

## 十、接口与代码索引

| 端 | 路径 |
|----|------|
| 后端（建议） | `self_app_back/src/routes/pages.ts` |
| 习惯网格 | habits-grid service |
| 今日青蛙 | today-frogs service |
| 筛选视图 | `GET /api/pages/tasks?taskView=` |
| 前端习惯网格 | `lib/tasks-habits-grid-api.ts` |
| 前端今日青蛙 | `lib/today-frogs-api.ts` |
| 前端待办/四象限 | `lib/tasks-page-api.ts` |
| 前端习惯仓库 | `lib/repositories/habits/habit.ts`（只读 SQLite） |
| 前端打卡仓库 | `lib/repositories/habits/habit-check-in.ts`（只读 SQLite） |

字段名保持现有 query / JSON，只补缺失数组和口径，避免 APP 再改契约。
