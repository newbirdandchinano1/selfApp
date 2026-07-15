# 任务 Tab 页 — 后端 API 改动说明（APP 集成指南）

> 版本：2026-06-24  
> 后端仓库：`self_app_back`  
> 面向：移动端 APP 开发者  
> 对应前端 pageKey：`tabs/tasks`

---

## 一、改动摘要

后端已按任务 Tab 性能优化需求完成以下能力，**APP 可逐步接入**，旧接口保持兼容。

| 编号 | 状态 | 内容 |
|------|------|------|
| **P1** | ✅ 已实现 | 任务 Tab 聚合接口 `GET /api/pages/tasks`（一次 HTTP 替代 10 表串行 List） |
| **P2** | ✅ 已有 | 通用 List 分页 metadata（`page/limit/total/totalPages`）+ gzip 压缩 |
| **P3** | ✅ 已实现 | `habit_check_ins` 支持 `startDate` / `endDate` 范围过滤 |
| **P5** | ✅ 已实现 | `task_execution_events` / `frog_completion_events` 支持日期范围过滤 |
| **P6** | ✅ 已有 | 通用 List 支持 `updatedSince` 增量同步 |
| **P7** | ✅ 已有 | 通用 List 支持 `fields` 字段裁剪 |
| **P9** | ✅ SQL 脚本 | 事件表索引见 `sql/alter_tasks_page_api.sql`（部署时需执行） |

**尚未实现（可继续用原 List 接口）**：P4 习惯打卡摘要独立接口、P8 多表 batch 接口。

---

## 二、推荐接入方式

### 2.1 首次进入 / 下拉刷新（推荐）

将 `syncPageScopeFromApi('tabs/tasks')` 中的 **10 次串行 List** 替换为 **1 次 bootstrap**：

```
POST /api/auth/login          （若 token 无效，与现网相同）
GET  /api/pages/tasks         （替代 10 × GET /api/data/{table}）
→ syncApiReadResultToLocal 写入各表
→ reload() 一次
```

**预期收益**：HTTP 往返从 10+ 次降为 1 次；服务端并行查表，弱网下首屏可明显缩短。

### 2.2 增量刷新（二次进入 Tab）

继续使用现有通用 List，加 `updatedSince`：

```
GET /api/data/tasks?updatedSince=2026-06-24T10:00:00.000Z&page=1&limit=200
```

scope 内 10 表均可使用相同参数（各表 `updated_at > updatedSince`）。

### 2.3 大表按需拉取（与 bootstrap 配合）

bootstrap 默认对以下表做**范围裁剪**（见第三节）；若需要更老数据，可单独 List 补拉：

| 表 | bootstrap 默认范围 | 单独补拉示例 |
|----|-------------------|--------------|
| `habit_check_ins` | 近 **24 个月** | `?startDate=2020-01-01&endDate=2025-12-31` |
| `task_execution_events` | 热力图区间（约 15 周） | `?createdAtGte=2025-01-01&createdAtLte=2025-12-31` |
| `frog_completion_events` | 热力图区间 | `?assignedYmdGte=2025-01-01&assignedYmdLte=2025-12-31` |

---

## 三、新增接口：任务 Tab Bootstrap

### 3.1 基本信息

```
GET /api/pages/tasks
Authorization: Bearer <token>
```

鉴权与 `/api/data/*` 相同。

### 3.2 Query 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `dayBoundaryHour` | 否 | `0` | 逻辑日切换小时（与客户端 `TasksDayBoundary.hour` 一致） |
| `dayBoundaryMinute` | 否 | `0` | 逻辑日切换分钟 |
| `heatmapStart` | 否 | 自动 | 完成热力图起始日 `YYYY-MM-DD`；默认「今天所在周往前 14 周的周一」 |
| `heatmapEnd` | 否 | 逻辑今日 | 完成热力图结束日；不超过逻辑今日 |
| `habitCheckInMonths` | 否 | `24` | `habit_check_ins` 默认回溯月数（1～120） |
| `habitCheckInStart` | 否 | 按上项计算 | 显式指定打卡起始日 |
| `habitCheckInEnd` | 否 | 逻辑今日 | 显式指定打卡结束日 |
| `include` | 否 | 全部 | 逗号分隔子集，见下表 |

**`include` 可选值**（camelCase 或 snake_case 均可）：

| 值 | 响应字段 | 对应 SQLite 表 |
|----|----------|----------------|
| `projects` | `projects` | `projects` |
| `projectCategories` | `projectCategories` | `project_categories` |
| `tasks` | `tasks` | `tasks` |
| `taskCategories` | `taskCategories` | `task_categories` |
| `taskItems` | `taskItems` | `task_items` |
| `habits` | `habits` | `habits` |
| `habitContexts` | `habitContexts` | `habit_contexts` |
| `habitCheckIns` | `habitCheckIns` | `habit_check_ins` |
| `taskExecutionEvents` | `taskExecutionEvents` | `task_execution_events` |
| `frogCompletionEvents` | `frogCompletionEvents` | `frog_completion_events` |
| `heatmap` | 上述两个事件表 | — |

示例：仅拉核心表（不含热力图事件）

```
GET /api/pages/tasks?include=projects,tasks,habits,habitCheckIns
```

### 3.3 响应结构

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "projects": [ /* 与 GET /api/data/projects 列表项字段一致 */ ],
    "projectCategories": [],
    "tasks": [],
    "taskCategories": [],
    "taskItems": [],
    "habits": [],
    "habitContexts": [],
    "habitCheckIns": [],
    "taskExecutionEvents": [],
    "frogCompletionEvents": [],
    "meta": {
      "serverTime": "2026-06-24T12:00:00.000Z",
      "logicalToday": "2026-06-24",
      "heatmapStart": "2026-03-10",
      "heatmapEnd": "2026-06-24",
      "habitCheckInStart": "2024-06-01",
      "habitCheckInEnd": "2026-06-24",
      "completionHeatmapWeeks": 15,
      "tablesVersion": {
        "tasks": { "count": 1200, "maxUpdatedAt": "2026-06-24T11:30:00.000Z" },
        "habit_check_ins": { "count": 45000, "maxUpdatedAt": "2026-06-24T08:00:00.000Z" }
      }
    }
  }
}
```

**字段兼容性**：各数组元素与 `GET /api/data/{table}` 单条 JSON **完全一致**（含 datetime 格式、`extra_data` 等），可直接调用现有 `syncApiReadResultToLocal(table, rows)` 写入 SQLite。

**子习惯（客户端扩展，无后端 schema 改动）**：子习惯清单与打卡态写在 `habits.extra_data` 的 `subHabitsEnabled` / `subHabits` / `subHabitCheckIns` 中；全部子习惯完成后客户端再写 `habit_check_ins`。不新增表/列，现有同步与 `habits-grid` 协议保持兼容。

**范围说明（与全量 List 的差异）**：

- `projects` / `tasks` / `habits` 等 7 张表：**全量**
- `habitCheckIns`：默认近 24 个月（可通过 query 调整）
- `taskExecutionEvents` / `frogCompletionEvents`：仅热力图区间（与前端 `COMPLETION_HEATMAP_WEEKS = 15` 对齐）

---

## 四、通用 List 接口增强

基础路径不变：

```
GET /api/data/{table}?page=1&limit=200
```

### 4.1 已有参数（可直接使用）

| 参数 | 适用表 | 说明 |
|------|--------|------|
| `page` | 全部 | 页码，从 1 开始 |
| `limit` | 全部 | 每页条数，默认 50，最大 200（带日期范围时最大 2000） |
| `updatedSince` | 全部（有 `updated_at` 列） | 仅返回 `updated_at > updatedSince` 的行 |
| `fields` | 全部 | 逗号分隔列名，如 `id,title,status,project_id` |

### 4.2 新增 / 明确：日期范围参数

#### `habit_check_ins`（P3）

```
GET /api/data/habit_check_ins?startDate=2026-01-01&endDate=2026-06-24&page=1&limit=200
```

| 参数 | 条件 |
|------|------|
| `startDate` | `record_date >= startDate` |
| `endDate` | `record_date <= endDate` |

不带范围时行为与现网一致（全表分页）。

#### `task_execution_events`（P5）

```
GET /api/data/task_execution_events?createdAtGte=2026-03-10&createdAtLte=2026-06-24&page=1&limit=200
```

| 参数 | 条件 |
|------|------|
| `createdAtGte` | `created_at >=` 边界（支持 ISO 或 `YYYY-MM-DD`，日期按当天 00:00:00） |
| `createdAtLte` | `created_at <=` 边界（日期按当天 23:59:59） |

#### `frog_completion_events`（P5）

```
GET /api/data/frog_completion_events?assignedYmdGte=2026-03-10&assignedYmdLte=2026-06-24&page=1&limit=200
```

| 参数 | 条件 |
|------|------|
| `assignedYmdGte` | `assigned_ymd >=` |
| `assignedYmdLte` | `assigned_ymd <=` |

---

## 五、APP 集成示例

### 5.1 改造 `syncPageScopeFromApi`（伪代码）

```typescript
async function syncTasksPageFromApi(opts?: { forceRefresh?: boolean }) {
  await ensureApiLoggedIn();

  const boundary = await getTasksDayBoundary(); // 现有逻辑
  const res = await apiGet<TasksBootstrapPayload>('/api/pages/tasks', {
    dayBoundaryHour: boundary.hour,
    dayBoundaryMinute: boundary.minute,
  });

  const tableMap: [keyof TasksBootstrapPayload, string][] = [
    ['projects', 'projects'],
    ['projectCategories', 'project_categories'],
    ['tasks', 'tasks'],
    ['taskCategories', 'task_categories'],
    ['taskItems', 'task_items'],
    ['habits', 'habits'],
    ['habitContexts', 'habit_contexts'],
    ['habitCheckIns', 'habit_check_ins'],
    ['taskExecutionEvents', 'task_execution_events'],
    ['frogCompletionEvents', 'frog_completion_events'],
  ];

  for (const [responseKey, tableName] of tableMap) {
    const rows = res[responseKey];
    if (Array.isArray(rows) && rows.length >= 0) {
      await syncApiReadResultToLocal(tableName, rows, { forceRefresh: opts?.forceRefresh });
    }
  }
}
```

### 5.2 扩展 `ApiListOptions`（建议）

在 `lib/api-read.ts` 的 `ApiListOptions` 中补充（供单独 List 使用）：

```typescript
createdAtGte?: string;
createdAtLte?: string;
assignedYmdGte?: string;
assignedYmdLte?: string;
```

并在 `apiListRecords` 传参时透传到 query string。

### 5.3 习惯打卡同步策略建议

| 场景 | 建议 |
|------|------|
| 首次 bootstrap | 使用 `GET /api/pages/tasks` 默认 24 个月打卡数据 |
| 全量 reconcile 降级 | `fetchApiTableAll('habit_check_ins', { startDate, endDate })` 限制近 24 个月 |
| 查看更早历史 | 用户进入历史页时再按月份 List 补拉 |

### 5.4 完成热力图

bootstrap 已返回热力图区间内的事件；本地 `getFrogCompletionCountsByDayRange` / `getTaskCompletionCountsByDayRange` 可直接读 SQLite，**无需再全量同步事件表**。

若仍走旧 List 路径，请带范围参数：

```typescript
const { startYmd, endYmd } = heatmapRange; // 与 tasks.tsx 一致

await fetchApiTableAll('task_execution_events', {
  createdAtGte: startYmd,
  createdAtLte: endYmd,
  forceRefresh: true,
});

await fetchApiTableAll('frog_completion_events', {
  assignedYmdGte: startYmd,
  assignedYmdLte: endYmd,
  forceRefresh: true,
});
```

---

## 六、部署与索引

后端部署后请在 MySQL 执行（若索引已存在可跳过）：

```
self_app_back/sql/alter_tasks_page_api.sql
```

主要索引：

- `task_execution_events(created_at)`
- `frog_completion_events(assigned_ymd)`

若库表含 `user_id`，可使用脚本内注释的多用户复合索引版本。

日历相关索引见 `sql/alter_calendar_api.sql`（`habit_check_ins`、`tasks` 等）。

---

## 七、联调验收清单

- [ ] 任务 Tab 首次进入：1 次 `GET /api/pages/tasks` + 登录即可完成 scope 同步
- [ ] bootstrap 写入 SQLite 后，`reload()` 项目树 / 习惯网格 / 热力图数据正确
- [ ] `habit_check_ins?startDate&endDate` 与客户端本地过滤结果一致
- [ ] 热力图 105 天区间内 frog / task 完成数与旧全量同步一致
- [ ] `updatedSince` 增量后 reconcile 无丢数据
- [ ] bootstrap 失败时可降级回 10 表串行 List（建议保留 fallback）

---

## 八、错误与降级

| HTTP | code | 处理建议 |
|------|------|----------|
| 401 | -1 | 重新 `ensureApiLoggedIn()` |
| 404 | -1 | 检查后端版本是否已部署 pages 路由 |
| 5xx | -1 | 降级为原 `syncPageScopeFromApi` 逐表 List |

---

## 九、相关文件索引

| 端 | 路径 |
|----|------|
| 后端路由 | `self_app_back/src/routes/pages.ts` |
| 后端聚合逻辑 | `self_app_back/src/services/pages/tasks-bootstrap.ts` |
| List 过滤 | `self_app_back/src/services/list-query.ts` |
| 前端 scope | `lib/page-api-scope.ts` |
| 前端同步 | `lib/api-page-sync.ts` |
| 前端 List | `lib/api-read.ts` |
| 日历页 API（相关） | `GET /api/calendar/tasks` |

---

## 十、与旧文档关系

本文档为 **后端实现完成后的 APP 集成说明**。原需求分析（瓶颈描述、P4/P8 等待办）可参考 git 历史中的同路径文件版本。
