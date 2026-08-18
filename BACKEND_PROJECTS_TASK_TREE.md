# 项目列表任务树截断 — 后端改动说明

> 版本：2026-08-18  
> 后端仓库：`self_app_back`  
> 面向：后端开发者  
> 接口：`GET /api/pages/projects`  
> 前端：任务 Tab 项目列表（`screens/tasks/TasksScreen.tsx`）  
> APP **已经先改了客户端兜底**（翻页按任务 id 合并、按 `parent_task_id` 重组、本地 SQLite 补全、展开项目时按 `projectId` 再拉一次）。  
> **根因仍在服务端**：分页把任务截断了，或任务树没组全。请按本文改，否则大项目仍会丢任务。

---

## 一、现象（用户侧）

任务页项目列表有时：

1. **项目在，下面一个任务都没有**
2. **只显示一部分任务**（项目任务很多时几乎必现）

原因不是 UI 随机丢行，而是这个接口的 `tasks` 树不完整。

APP 现在**不再**全表拉 `GET /api/data/tasks`。项目来自 catalog，任务树只信本接口。树缺了，界面就缺。

---

## 二、先看结论（按这个做就对）

| 必须 | 说明 |
|------|------|
| `limit` **只限制项目条数** | 不要 `JOIN tasks ... LIMIT 200` |
| 每个项目的 `tasks` 必须是**完整树** | 含全部子孙，挂在 `children` 上 |
| 同一项目不要拆到多页 | 一页里这个项目只出现一次，树给全 |
| `pagination.total` 按**项目个数**计 | 不要按「项目×任务」行数计 |
| 加 `taskCount` | APP 用来发现树被截断 |
| 支持 `?projectId=` | 用户展开项目时 APP 会再拉这一棵完整树 |

**不要**为此恢复 `GET /api/data/tasks` 全表给任务 Tab。

---

## 三、错误写法 vs 正确写法

### 错：LIMIT 打在 JOIN 结果上

```sql
SELECT p.*, t.*
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id
WHERE ...
LIMIT 200 OFFSET 0;
```

这是 200 行「项目-任务」对，不是 200 个项目。一个大项目就能占满 200 行：

- 这个项目只剩一部分任务
- 其它项目变成「有项目、tasks 为空」

### 对：先分页项目，再无 LIMIT 拉这些项目的全部任务

```sql
-- 1) 只分页项目（limit=200 只作用在这里）
SELECT *
FROM projects
WHERE user_id = ? AND ...
ORDER BY updated_at DESC
LIMIT 200 OFFSET 0;

-- 2) 用上面得到的 id 列表，任务查询不要 LIMIT
SELECT *
FROM tasks
WHERE user_id = ?
  AND project_id IN (?, ?, ...);   -- 本页项目 id
```

然后在服务端内存里按 `parent_task_id` 组树，写入每个项目的 `tasks`。

伪代码：

```
projects = queryProjects(page, limit)          // 最多 200 个项目
ids      = projects.map(p => p.id)
allTasks = queryTasksWhereProjectIdIn(ids)     // 禁止 LIMIT
trees    = buildTreeByParentTaskId(allTasks)   // 按 project_id 分组后组树

for p in projects:
  p.tasks = trees[p.id] or []
  p.taskCount = countNodes(p.tasks)            // 该项目全部任务数
```

---

## 四、现有请求（APP 已在打，勿改名）

```
GET /api/pages/projects
  ?page=1
  &limit=200
  &includeCompleted=false          // 仅当用户打开「隐藏已完成」
  &includeCancelled=false
  &categoryId=...                  // 分类 Tab；收集箱另见下
  &uncategorized=true              // 收集箱无分类项目
```

收集箱 Tab 会打两次再合并：`uncategorized=true` 与 `categoryId=inbox`。语义不要改。

### 4.1 新增 query（请支持）

```
&projectId=<项目id>
```

- 只返回**这一个项目** + **完整任务树**
- 此时 `limit` 仍表示项目条数（最多 1 个），**绝不要**理解成「只返回 1 条任务」
- APP 用户点开项目时会打：  
  `GET /api/pages/projects?projectId=xxx&limit=1&includeCompleted=...`

未实现时 APP 会拿到别的项目或空树，大项目展开后仍缺任务。

---

## 五、响应要补的字段

每个项目：

```json
{
  "id": "p_xxx",
  "title": "周报",
  "taskCount": 128,
  "tasks": [
    {
      "id": "t_root",
      "parent_task_id": null,
      "title": "父任务",
      "status": "todo",
      "children": [
        {
          "id": "t_child",
          "parent_task_id": "t_root",
          "title": "子任务",
          "children": []
        }
      ]
    }
  ]
}
```

| 字段 | 要求 |
|------|------|
| `tasks` | 该项目**全部**任务组成的树。根节点放数组里，子孙放 `children` |
| `parent_task_id` | 每个节点都要带（APP 会用来重组；不要只靠嵌套） |
| `taskCount` | 该项目任务总数（过滤后的，见第六节）。必须等于树上节点数 |
| `children` | 没有子任务时给 `[]`，不要省略成「只返回根、不嵌套」 |

`pagination`：

```json
{
  "page": 1,
  "limit": 200,
  "total": 12,
  "totalPages": 1
}
```

`total` / `totalPages` 按**项目**计。12 个项目、其中 1 个有 500 条任务 → `total` 仍是 12，不是 500+。

`meta` 建议加上：

```json
{
  "includeCompleted": false,
  "includeCancelled": false,
  "tasksComplete": true,
  "projectId": "p_xxx"
}
```

| 字段 | 要求 |
|------|------|
| `tasksComplete` | 恒为 `true`，表示本页每个项目的树都已给全、没有按 LIMIT 截任务 |
| `projectId` | 请求带了 `projectId` 时原样回显 |

---

## 六、隐藏已完成（`includeCompleted=false`）

可以不把 `status=done` / `cancelled` 的任务放进树，但必须：

**已完成的父任务被拿掉后，它下面未完成的子任务要升为根，不能跟着消失。**

做法：先查出该项目过滤后的任务集合，再组树。父节点不在集合里 → 子节点当根（`parent_task_id` 仍保留原值也可以，APP 会升根）。

不要：先组完整树，再把已完成节点连同整棵子树删掉。

---

## 七、组树规则

1. 只把 `project_id = 该项目` 的任务放进该项目（子任务若只挂了 `parent_task_id`、没写 `project_id`，也要沿父链收进来）。
2. `parent_task_id` 为空 → 根。
3. `parent_task_id` 指向的父任务也在本项目集合里 → 挂到父的 `children`。
4. 父任务不在集合里（被过滤或数据残缺）→ **升为根**，不要丢弃。
5. 不要用 `GROUP_CONCAT` / 默认 `group_concat_max_len` 拼 JSON，默认 1024 字节会截断。在应用层组树。

---

## 八、建议实现步骤（后端）

1. 确认当前 SQL：有没有 `JOIN tasks` 后再 `LIMIT`；有没有对任务再套一层 `LIMIT 200`。有就删掉。
2. 改成「项目分页 + `IN (...)` 无 LIMIT 查任务 + 内存组树」。
3. 每个项目写 `taskCount`；`pagination.total` 改成项目数。
4. `includeCompleted=false` 时未完成子孙升根。
5. 增加 `projectId` 过滤；`meta.tasksComplete = true`。
6. 大项目（100+ 任务）用 gzip；单接口目标 2s 内。不要为了体积砍任务。

一个项目任务特别多（例如 1000+）时：仍应一次给全这一个项目的树。列表接口按项目分页已经限制了「一页多少个项目」。用户展开单个项目时走 `projectId`，只打一棵树，体积可接受。

---

## 九、验收

准备：一个项目 ≥ 80 条任务（含多层子任务）；另几个小项目。

- [ ] `GET /api/pages/projects?page=1&limit=200`：大项目 `taskCount` = `tasks` 递归节点数，一个不差
- [ ] 同页小项目的 `tasks` 不是空数组
- [ ] `pagination.total` 等于项目个数，不是任务条数
- [ ] `includeCompleted=false`：未完成子任务仍在（父已完成则升为根）
- [ ] `?projectId=<大项目id>&limit=1`：只返回这 1 个项目，树完整；`limit=1` 没有变成「只返回 1 条任务」
- [ ] 响应是合法 JSON（没有被 MySQL 字符串截断）
- [ ] 任务 Tab 抓包**不应**再出现 `GET /api/data/tasks` 全表

APP 侧已做的兜底（供联调对照）：

- 翻页同一项目的任务按 id **合并**，不再后一页整棵覆盖前一页
- 不信嵌套时，会用 `parent_task_id` 重新组树
- 接口树偏少时，用本地 SQLite 已有任务补上
- 用户展开项目时会再打 `?projectId=`

本地有缓存时，界面可能看起来「已经齐了」；**清过本地库的设备**仍完全依赖本接口给全。请用新账号或清库后的 APP 验收。

---

## 十、与其它文档的关系

| 文档 | 关系 |
|------|------|
| `BACKEND_TASKS_TAB_PERF.md` | 任务 Tab 总清单。其中 P4「每个项目带 tasks 树」就是本问题；本文是该条的实现细则 |
| 通用 `GET /api/data/tasks` | 不要拿来补这个洞 |

字段名保持现有：`list`、`tasks`、`children`、`pagination`。只补口径和 `taskCount` / `projectId` / `tasksComplete`。
