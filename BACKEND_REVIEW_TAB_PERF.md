# 复盘 Tab / 复盘模块 — 后端配合清单（APP 已改，请按本文执行）

> 版本：2026-08-19  
> 后端仓库：`self_app_back`  
> 面向：后端开发者  
> 前端 pageKey：`tabs/review`  
> 前端入口：`components/review/review-hub-screen.tsx` / `app/(tabs)/review.tsx`  
> 对照文档：`BACKEND_TASKS_TAB_PERF.md`、`BACKEND_FINANCE_TAB_PERF.md`（同类改造）  
> **LLM / AI 分析接口本文不覆盖，可后做。**

---

## 一、先看结论（必读）

1. **不要再给复盘 Tab / 子页做 `GET /api/data/{table}` 通用 List 全量翻页。** APP 读路径已停用该路径。
2. APP 现在只打 **`/api/pages/review/*` 页面专用接口**。慢、缺字段、区间不对，都要在这些专用接口上修，而不是补 List。
3. 日刊 / 周刊 / 月刊必须按 **日期区间或单期** 下发，**禁止**把用户历史全部 journal 一次吐给 APP。
4. 任一专用接口失败时，APP **只回退本地 SQLite**，**禁止**再降级到 `/api/data/daily_review_journal` 等全表 List。

---

## 二、APP 已做的改动（后端对齐用）

复盘 Tab 冷启动 / 下拉刷新 **不再**调用：

| 已停用 | 原因 |
|--------|------|
| `syncPageScopeFromApi('tabs/review')` 串行全量拉 5 张表 | `daily_review_journal` 按日增长、`body` 富文本体积大 |
| `GET /api/data/daily_review_journal` 全表翻页 | 首屏只要周期 ~7 天或单日 |
| `GET /api/data/weekly_review_journal` 全表 | 只要当前周 1 条 |
| `GET /api/data/monthly_review_journal` 全表 | 只要当前月 1 条 |
| `GET /api/data/review_dimensions` / `review_columns` List | 改走 catalog / home |
| 周复盘旧表单对 `tasks` / `habit_check_ins` / `finance_transactions` 等全表 List | 改走 `week-metrics` 聚合 |

复盘 Tab 首屏实际请求（优先）：

```
GET /api/pages/review/home?logicalToday=&dailyStart=&dailyEnd=&weekStart=&monthStart=
```

子页 / 换日 / 换月：

```
GET /api/pages/review/catalog?scope=daily|weekly|monthly
GET /api/pages/review/daily?start=&end=
GET /api/pages/review/weekly?weekStart=
GET /api/pages/review/monthly?monthStart=
GET /api/pages/review/week-metrics?start=&end=     // 旧周复盘表单指标
```

**写入**仍走现有 `POST/PUT/PATCH/DELETE /api/data/{table}`（journal / dimensions / columns），只停 **读路径的 List**。

**禁止**再为上述任一接口失败而降级到 `/api/data/*` List。

---

## 三、通用约定（所有专口共用）

### 鉴权与信封

- 与现有一致：Bearer Token；成功 `code === 0`，业务体在 `data`。
- APP 客户端类型见 `lib/api-client.ts`（`apiGetReview*`）。

### 行形状（务必对齐）

与 MySQL / APP SQLite 行字段一致（**不要**改成另一套 camelCase 业务 DTO，除 `week-metrics` 聚合字段）：

**`review_dimensions`：**

```ts
{
  id, scope, // 'daily' | 'weekly' | 'monthly'
  title, sort_order,
  created_at, updated_at, sync_status?, extra_data
}
```

**`review_columns`：**

```ts
{
  id, dimension_id, title, placeholder,
  sort_order, created_at, updated_at, sync_status?, extra_data
}
```

**`daily_review_journal`：**

```ts
{
  id, record_date_ymd, // YYYY-MM-DD
  body, // 富文本 JSON 字符串或 null
  created_at, updated_at, sync_status?, extra_data
}
```

**`weekly_review_journal`：**

```ts
{
  id, week_start_ymd,
  section_summary, section_plans, section_reflect, section_learnings, section_next_week,
  execution_score, // 0..5
  ai_coaching,
  adjust_tasks, adjust_savings, adjust_plans, // 0|1
  created_at, updated_at, sync_status?, extra_data
}
```

**`monthly_review_journal`：**

```ts
{
  id, month_start_ymd, // YYYY-MM-01
  body,
  created_at, updated_at, sync_status?, extra_data
}
```

过滤：响应中不要包含 `sync_status = pending_delete` 或已软删行。

### 时间

- `record_date_ymd` / `week_start_ymd` / `month_start_ymd` 为日历日字符串，按字符串比较即可。
- `created_at` / `updated_at` 无时区 DATETIME：按墙上时钟比较，**禁止当 UTC 再加偏移**。

---

## 四、必须完成的后端工作（按优先级）

### P0（必做）`GET /api/pages/review/home`

Tab 冷启动 / 下拉刷新主口。一次返回模板 + 当前周期日刊 + 当前周刊 + 当前月刊。

#### 请求

```
GET /api/pages/review/home
  ?logicalToday=YYYY-MM-DD
  &dailyStart=YYYY-MM-DD
  &dailyEnd=YYYY-MM-DD
  &weekStart=YYYY-MM-DD
  &monthStart=YYYY-MM-01
```

| 参数 | 含义 |
|------|------|
| `dailyStart` / `dailyEnd` | APP 当前复盘周期（通常约 7 天，含周复盘日） |
| `weekStart` | 当前周期起点（与日刊周期一致），用于取周刊 |
| `monthStart` | 逻辑今日所在自然月月初 |

#### 响应

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "dimensions": [ /* 全部 scope 的 review_dimensions 行 */ ],
    "columns": [ /* 对应 review_columns 行 */ ],
    "dailyJournals": [ /* [dailyStart, dailyEnd] 内的日刊行 */ ],
    "weeklyJournal": { /* week_start_ymd = weekStart 的一行，或 null */ },
    "monthlyJournal": { /* month_start_ymd = monthStart 的一行，或 null */ },
    "meta": {
      "serverTime": "2026-08-19T03:00:00.000Z",
      "logicalToday": "2026-08-19",
      "dailyStart": "2026-08-13",
      "dailyEnd": "2026-08-19",
      "weekStart": "2026-08-13",
      "monthStart": "2026-08-01",
      "catalogComplete": true
    }
  }
}
```

| 字段 | 要求 |
|------|------|
| `dimensions` / `columns` | 模板体量小，可全量；`catalogComplete` 建议 `true` |
| `dailyJournals` | **仅区间内**，不要用户全部历史日刊 |
| `weeklyJournal` / `monthlyJournal` | 单行或 `null`；不要数组灌全历史 |
| `meta.serverTime` | 建议有 |

**验收**

- [ ] 区间外旧日刊不出现在 `dailyJournals`
- [ ] 无对应周/月刊时字段为 `null`，不 404
- [ ] 响应体积远小于「5 表全量 List JSON」

---

### P1（必做）`GET /api/pages/review/daily`

日历月网格、换日到周期窗外时使用。

```
GET /api/pages/review/daily?start=YYYY-MM-DD&end=YYYY-MM-DD
```

```json
{
  "code": 0,
  "data": {
    "journals": [ /* [start, end] 内 daily_review_journal 行 */ ],
    "meta": { "serverTime": "...", "start": "...", "end": "..." }
  }
}
```

| 项 | 要求 |
|----|------|
| 区间 | 日历通常约 42 天；单日则为 `start=end` |
| 空区间 | 返回 `journals: []`，不要 404 |
| **不要** | 返回区间外历史；不要附带 dimensions/columns（日历会另打 catalog） |

---

### P1（必做）`GET /api/pages/review/weekly` / `monthly`

```
GET /api/pages/review/weekly?weekStart=YYYY-MM-DD
GET /api/pages/review/weekly?start=YYYY-MM-DD&end=YYYY-MM-DD

GET /api/pages/review/monthly?monthStart=YYYY-MM-01
GET /api/pages/review/monthly?start=YYYY-MM-01&end=YYYY-MM-01
```

```json
{
  "code": 0,
  "data": {
    "journals": [ /* 命中的周刊/月刊行；单期时 0~1 条 */ ],
    "meta": { "serverTime": "..." }
  }
}
```

- `weekStart` / `monthStart` 与 `start`/`end` 二选一即可；都带时以区间为准。
- **不要**无过滤全表。

---

### P1（必做）`GET /api/pages/review/catalog`

模板设置页、子页补模板。

```
GET /api/pages/review/catalog
GET /api/pages/review/catalog?scope=daily|weekly|monthly
```

```json
{
  "code": 0,
  "data": {
    "dimensions": [ /* 可选按 scope 过滤 */ ],
    "columns": [ /* 属于上述 dimensions 的栏目 */ ],
    "meta": { "serverTime": "...", "catalogComplete": true }
  }
}
```

- 无 `scope` 或 `scope=all`：返回全部三个 scope。
- 有 `scope`：只返回该 scope 的 dimensions，及这些维度下的 columns。

---

### P2（强烈建议）`GET /api/pages/review/week-metrics`

旧周复盘表单（`/weekly-review-form`）展示「近 7 天」任务/习惯/财务等指标。APP **已禁止**为指标再 List `tasks` / `habit_check_ins` / `finance_transactions` 等全表。

```
GET /api/pages/review/week-metrics
  ?start=YYYY-MM-DD
  &end=YYYY-MM-DD
  &rangeKind=rolling-7
```

```json
{
  "code": 0,
  "data": {
    "rangeKind": "rolling-7",
    "weekStartYmd": "2026-08-13",
    "weekEndYmd": "2026-08-19",
    "rangeDisplay": "8月13日 – 8月19日",
    "weekTitle": "近七天复盘 · 8月13日 – 8月19日",
    "tasksCompleted": 3,
    "tasksCreated": 1,
    "habitCheckInTotal": 12,
    "savingsWeekTotal": 200,
    "financeIncome": 0,
    "financeExpense": 350,
    "wishUpdates": 0,
    "meta": { "serverTime": "..." }
  }
}
```

口径建议（与 APP 旧本地粗算对齐）：

| 字段 | 规则 |
|------|------|
| `tasksCompleted` | `status=done` 且 `completed_at` 落在 `[start,end]` |
| `tasksCreated` | `created_at` 落在区间 |
| `habitCheckInTotal` | 活跃习惯在区间内打卡 `count` 之和 |
| `savingsWeekTotal` | 活跃存钱计划区间内存入金额之和（取整） |
| `financeIncome` / `financeExpense` | 区间内流水，**不含转账**，绝对值之和（取整） |
| `wishUpdates` | `wish_items.updated_at` 落在区间的条数 |

**不要**把原始 tasks/流水数组回传，只要聚合数。

---

## 五、明确不要做的事

| 不要做 | 原因 |
|--------|------|
| 继续依赖 `GET /api/data/daily_review_journal` 全表给复盘页 | APP 已不调用 |
| 为多端同步再让 APP 翻 journal 全表 | 用 home / daily / weekly / monthly 区间口 |
| home 返回「用户全部历史日刊」 | 首屏只要 ~7 天 |
| week-metrics 返回原始事件/流水数组 | 只要聚合 |
| 失败时让 APP 降级 List | 只回退本地 |
| 为子习惯/模板新开表 | 继续现有 dimensions/columns + journal.body |

旧 List 接口可保留给管理端 / 其它工具，**不要作为复盘 Tab 的读模型**。

---

## 六、建议的服务端实现要点

1. **home**：`dimensions`/`columns` 一次查出；日刊 `WHERE record_date_ymd BETWEEN ? AND ?`；周刊 / 月刊按主键日等值查询。
2. **索引**（若未建）：
   - `daily_review_journal(user_id, record_date_ymd)`
   - `weekly_review_journal(user_id, week_start_ymd)`
   - `monthly_review_journal(user_id, month_start_ymd)`
   - `review_dimensions(user_id, scope, sort_order)`
   - `review_columns(user_id, dimension_id, sort_order)`
3. 所有专口继续 gzip；单接口超时目标 **2s 内**。
4. `body` / `extra_data` / 周刊段落字段原样下发字符串，不要服务端改写富文本结构。

---

## 七、联调验收清单（前后端一起勾）

抓包复盘 Tab 冷启动，**不应出现**：

- [ ] `GET /api/data/daily_review_journal`
- [ ] `GET /api/data/weekly_review_journal`
- [ ] `GET /api/data/monthly_review_journal`
- [ ] `GET /api/data/review_dimensions`
- [ ] `GET /api/data/review_columns`
- [ ] 为周指标再打 `GET /api/data/tasks` / `habit_check_ins` / `finance_transactions` 等全表

**应出现**：

- [ ] `GET /api/pages/review/home?...`

打开日历 / 换月：

- [ ] `GET /api/pages/review/daily?start&end`（约 42 天）
- [ ] `GET /api/pages/review/catalog?scope=daily`（或 home 已灌模板则可省略）

打开模板设置：

- [ ] `GET /api/pages/review/catalog?scope=...`

打开旧周复盘表单且可编辑：

- [ ] `GET /api/pages/review/week-metrics?start&end`

功能：

- [ ] 他端改日刊后，本机下拉刷新可见
- [ ] 日历格子「已填写」与区间内有内容的日刊一致
- [ ] 弱网：专口失败时 APP 回退本地缓存，不转去打 List

---

## 八、接口与代码索引

| 端 | 路径 |
|----|------|
| 后端（建议） | `self_app_back/src/routes/pages.ts` |
| 前端客户端 | `lib/api-client.ts`（`apiGetReview*`） |
| 前端灌库 | `lib/review-page-api.ts` |
| 前端仓库（只读 SQLite） | `lib/repositories/insights/*-review-journal.ts`、`review-template.ts` |
| 前端 Hub 同步 | `components/review/review-utils.ts`（`loadReviewPeriodSnapshot` → home） |
| page scope | `lib/page-api-scope.ts`（`tabs/review` 已返回空表列表） |

---

## 九、与旧方案关系

| 文档 | 关系 |
|------|------|
| `BACKEND_TASKS_TAB_PERF.md` | 任务 Tab 已完成的同类改造（停 List、专口直出） |
| `BACKEND_FINANCE_TAB_PERF.md` | 财务 Tab 同类改造 |

有问题对字段名时：保持本文 query / JSON 字段名，只补口径和缺失数组，避免 APP 再改契约。
