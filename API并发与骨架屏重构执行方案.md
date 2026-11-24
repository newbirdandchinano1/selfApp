# API 并发超时与骨架屏重构执行方案

范围：前端 `F:\project\APP\selfApp`，后端 `F:\project\APP\self_app_back`。本文件用于指导 Cursor 分阶段执行，要求每阶段独立测试、可灰度、可回滚。

## 目标与判断

当前核心风险：后端 API 并发默认 50，而 MySQL 连接池默认 20；`queueLimit=0` 会无限等待；任务页同时请求多个专用接口；旧 tasks bootstrap 可并发加载多个大表；热力图先取事件再由 Node 聚合；前端单一 pending 控制整页骨架。

目标：核心数据 P95 小于 2～3 秒；连接池等待 P95 小于 300ms；有本地缓存时 500ms 内可交互；局部失败不阻塞整页；不改变任务、青蛙、逻辑日、热力图净完成口径。

## 执行纪律

Cursor 每阶段先读目标文件和测试，只改本阶段范围；增加测试；执行类型检查、自测和压测；输出修改文件、指标变化、风险、回滚方式。禁止直接把连接池扩大到 50，禁止用无限重试掩盖过载。

## 阶段 A：后端观测与容量保护（P0）

### A1 建立指标

修改后端请求入口和数据库访问封装，记录 `request_id`、脱敏 `user_id`、route、status、total_ms、`db_acquire_wait_ms`、`db_query_ms`、`node_compute_ms`、`serialize_ms`、response bytes、pool active/idle/waiting。覆盖 tasks、catalog、habits-grid、completion-heatmap、projects、points。SQL 生产日志只记录模板/哈希，不记录参数。验收：能区分连接池等待慢和 SQL 执行慢。

### A2 限制数据库等待

先灰度：

```env
DB_CONNECTION_LIMIT=20
API_CONCURRENCY_MAX=12
```

`src/db/index.ts`：将 `queueLimit=0` 改为可配置有限值（建议 50）；增加获取连接超时；所有连接 `finally` 释放；队列满快速返回 503/429、`Retry-After` 和 request id。不要无限等待到客户端超时。

### A3 拆分并发池

新增 `API_LIGHT_CONCURRENCY_MAX=16`、`API_PAGE_CONCURRENCY_MAX=6`、`API_SYNC_CONCURRENCY_MAX=4`、`API_WRITE_CONCURRENCY_MAX=6`。在 `src/routes/app/index.ts` 按轻量读、页面重查询、同步、写入分池；支持全局和单用户上限；SSE 继续独立限制。验收：同步流量不会挤占任务页槽位。

## 阶段 B：后端任务页查询（P0/P1）

### B1 保护旧 Bootstrap

目标 `src/routes/app/pages/tasks.ts`、`src/services/pages/tasks-bootstrap.ts`。有 `taskView` 只返回 tasks/meta；无 `taskView` 且 include 含事件、打卡或多个大表时生产直接返回 400/410 和迁移提示；保留旧接口但记录调用方；禁止失败后链式通用 List。验收：任务页无无 taskView 大 bootstrap。

### B2 任务视图 SQL

检查 `loadFilteredTasks`：user、日期、状态、项目过滤必须在 SQL；只选页面字段；分页有上限和稳定排序，优先 keyset；`total/totalPages` 准确；不带 habits/events/打卡。用 EXPLAIN 验证后再建索引：

```sql
tasks(user_id, project_id, status, updated_at, id)
tasks(user_id, due_date, status, id)
tasks(user_id, updated_at, id)
```

### B3 项目树

`src/services/pages/tasks-list.ts` 必须先取得当前页项目 ID，再按这些 ID 查询任务树；禁止扫描用户全部 tasks；`includeCompleted=false` 在 SQL 过滤；收集箱条件去重；裁剪字段。验证：

```sql
projects(user_id, category_id, updated_at, id)
tasks(user_id, project_id, status, updated_at, id)
```

### B4 habits-grid

今日只查逻辑日，周期只查周期起点到今日；不返回打卡明细；保留 `extra_data`、`todayCount`、`dailyGoal`、`displayCompleted`、`periodProgress`、`periodGoal`、`hiddenOnViewDay`。确认：

```sql
habit_check_ins(user_id, habit_id, record_date)
habit_check_ins(user_id, record_date)
```

### B5 heatmap

`src/services/pages/tasks-overview.ts`：事件查询必须带 user 和日期范围；EXPLAIN 检查索引；将每任务最新事件、重复任务按逻辑日去重尽量下推 SQL；Node 只组装按日响应；单日明细单独查询。建议：

```sql
task_execution_events(user_id, task_id, created_at)
task_execution_events(user_id, created_at)
frog_completion_events(user_id, assigned_ymd, created_at)
```

保留净完成、撤销重做、重复任务和青蛙互斥测试。

## 阶段 C：缓存和核心快照（P1）

新增 cache abstraction，支持 key、TTL、stale-while-revalidate、失效和统计。优先缓存 catalog（30～120 秒）、heatmap（按用户和范围，30～120 秒）、day boundary（5 分钟）；写入后失效；多实例切 Redis。

新增 `GET /api/app/pages/tasks/bootstrap-v2`，只返回 standaloneTodos、当前项目及必要任务树、分类和版本；不返回热力图事件、全量 habits/check-ins、execution/frog events。保证单 snapshot 一致、查询有限、字段稳定。可对同用户同 query 做短窗口 single-flight，异常不缓存且设最大等待时间。

## 阶段 D：前端加载模型（P0/P1）

目标：`screens/tasks/TasksScreen.tsx`、`hooks/use-home-skeleton-reveal.ts`、`lib/tasks-page-api.ts`、`lib/projects-list-api.ts`。

将单一 pending 拆为：

```ts
type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type TasksLoadState = { core: LoadState; projects: LoadState; habits: LoadState; heatmap: LoadState; frogs: LoadState; points: LoadState };
```

整页 skeleton 只在“无本地快照且 core loading”时显示。先读 SQLite 渲染，再后台刷新；核心返回更新任务/项目；其他模块独立更新；失败保留缓存并可重试。页面级调度最大并发 2～3、core 优先、复用 in-flight Promise、取消旧 reload、只有最新 generation 更新 UI：

```text
第一批：core tasks + projects
第二批：matrixWeek + habits-grid
第三批：today-frogs + heatmap + points
```

timeout：core/projects 5s、habits 3s、heatmap 8s、后台同步 20s。区分 timeout、abort、429、503、离线和业务 4xx。

## 阶段 E：测试、压测、灰度

补充连接池耗尽、全局/单用户限流、taskView 契约、危险 bootstrap 拒绝、habits 时间窗口、heatmap 口径、项目分页和任务树测试。优先运行：

```text
scripts/tasks-page-selftest.ts
scripts/task-tree-filter-selftest.ts
scripts/project-list-selftest.ts
scripts/logical-day-selftest.ts
```

压测：单用户连续打开 10 次、20 用户同时打开、任务页与同步并发、大历史数据、收集箱双查询、连接池已满。记录 P50/P95/P99、错误率、连接池等待、慢 SQL、CPU、内存。灰度：开发→内部账号→10%→50%→全量。保留：

```env
TASKS_BOOTSTRAP_V2_ENABLED=false
TASKS_MODULE_LOADING_ENABLED=false
PAGE_CONCURRENCY_LIMIT_ENABLED=true
```

## 执行顺序与交付格式

```text
1 建立日志基线
2 限制连接池队列并降低并发
3 拆分并发池
4 禁止危险大 Bootstrap
5 优化 tasks/projects/habits/heatmap SQL
6 增加缓存
7 增加 bootstrap-v2
8 前端本地快照优先
9 前端模块 loading 和调度
10 压测、灰度、调参
```

每阶段输出：阶段、修改文件、接口/数据库变化、测试命令和结果、性能基线和结果、风险、回滚方式、下一阶段。最终必须证明超时减少而不是简单变成 503；连接池等待下降；有缓存时页面快速可交互；局部失败不阻塞整页；业务口径不回归。
