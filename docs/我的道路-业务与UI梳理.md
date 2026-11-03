# 我的道路 · 业务与 UI 梳理（selfApp）

| 项 | 内容 |
|---|---|
| 产品 | 小郑的自我修养 · 「我的」→ 道路 |
| 代码根 | `selfApp/`（Expo Router + RN） |
| 整理日期 | 2026-11-03 |
| 对照需求 | 桌面《我的道路-年季月拆解需求说明.md》；`selfApp/PRODUCT.md` |
| 目的 | 说明「月目标 ↔ 项目」挂载断层、验收标准 checklist、以及道路业务 / UI 构成 |

---

## 0. 结论摘要

1. **产品设计上，只有「月目标」能挂项目**；年 / 季 / 多年 / 更远不挂项目。挂载字段是 `projects.life_month_goal_id` → `life_road_nodes.id`（`kind = month`）。
2. **导图里看不到项目，常见不是「功能没写」，而是数据仍停在旧字段 `life_bet_id`，或该月还没有写成月目标节点。** 导图只按 `life_month_goal_id` 聚合；空月槽也没有「从此月建项目」入口。
3. **验收标准 checklist（已拍板并落地）**：节点在标题 / 说明 / 状态之外，增加可选「验收标准」——可勾选、可增删的清单，表示「怎样算过关」；存 `extra_data.acceptance_criteria`。编辑页维护，导图可展开勾选。仍不进任务日历 / 积分 / 截止日期。
4. **项目挂载链路已有半成品**：新建 / 编辑项目有「月目标」选择器；导图月节点可「+ 从此月建项目」。缺的是旧 `life_bet_id` 迁完与空月入口。

---

## 1. 业务模型（现状）

### 1.1 层级

```
life_directions（总方向 · 一句长文）
  └── life_road_nodes
        ├── multi / farther     「今年之上」
        ├── year                今年目标（按自然年，一槽一条内容）
        ├── quarter             季度目标（年 × Q1–Q4）
        └── month               月目标（年 × 1–12）
              └── projects      通过 life_month_goal_id 挂载（一月目标 → 多项目）
```

时间骨架写死：4 季无重叠、12 月固定挂在对应季下。空窗合法：可以只写总方向 / 年目标，不强制填满季月。

### 1.2 各层写什么 / 不写什么（现行产品边界）

| 层级 | 存什么 | 明确不做 |
|---|---|---|
| 总方向 | `life_directions.body` | 任务步骤、完成百分比 |
| 多年 / 更远 / 年 / 季 / 月 | `title` + 可选 `note` + `status` + 可选**验收标准** checklist | 执行步骤、截止日期、优先级、完成百分比、入格 / 积分 |
| 项目 | 任务域实体；可选挂月目标 | — |

`status` 枚举：`on_track` / `paused` / `arrived` / `dropped`。  
与档案里的 `users.goal`（减脂等饮食枚举）无关，禁止混用。

### 1.3 项目挂载规则（已实现的契约）

| 规则 | 实现位置 |
|---|---|
| 项目挂月目标，非年 / 季 | `MonthGoalPickerField` 只列 `kind=month`；`getMonthGoalsLocal()` |
| 一月目标多项目 | 导图按 `life_month_goal_id` 分组；产品文案已写明 |
| 跨月归「当前推进月」 | **仅产品约定**；无自动改挂逻辑，需用户在项目表单改归属 |
| 删月目标 | `deleteLifeRoadNode` 会清空关联项目的 `life_month_goal_id` |
| 旧赌注 | 本地 v60 迁移：今年赌注 → 月节点（保留原 id），并把同 id 的 `life_bet_id` 拷到 `life_month_goal_id` |

### 1.4 数据表与关键文件

| 表 / 字段 | 作用 |
|---|---|
| `life_directions` | 总方向 |
| `life_road_nodes` | 年季月 / 多年 / 更远节点 |
| `life_bets` | **旧表**，仅兼容；新写入应走节点表 |
| `projects.life_month_goal_id` | **现行**挂载 |
| `projects.life_bet_id` | **旧**挂载；读写仍保留，导图**不读**此列 |

核心代码：

- 模型 / 校验：`lib/life-road/life-road-node-model.ts`
- 导图组装：`lib/life-road/life-road-tree.ts`
- 节点仓库：`lib/repositories/life-road/life-road-node.ts`
- 项目写库：`lib/repositories/projects/project.ts`
- 本地迁移：`lib/database.native.ts` → `migrateLifeBetsIntoRoadNodesLocal`
- 后端建表：`self_app_back` migration `021_life_road_nodes`

---

## 2. 为什么「月目标没有对接项目」——根因清单

按「看起来像没对接」的实际原因拆开（可并存）。

### 2.1 设计边界：只有月层对接项目

年目标、季目标在导图上**不会**直接展开项目列表。项目只出现在**已有内容的月节点**下方。若只写了「今年目标」、从未点开某月写下月焦点，界面上就像「目标和项目两套东西」。

### 2.2 导图只认 `life_month_goal_id`

`LifeRoadScreen` / `profile-hub-stats` 查询类似：

```sql
SELECT ... FROM projects
WHERE life_month_goal_id IS NOT NULL AND life_month_goal_id != ''
  AND status IN ('active', 'paused', ...)  -- hub 摘要甚至不含 completed
```

**不会**用 `life_bet_id` 反查。因此：

- 迁移前挂在旧赌注上的项目，若 `life_month_goal_id` 仍为空 → **导图下空白**；
- 编辑项目页会用 `life_month_goal_id || life_bet_id` 做选择器回显，任务列表标题也可能读到旧 id，**道路导图却仍对不上**，观感就是「月目标和项目没对接」。

### 2.3 本地迁移有条件，服务端无对等迁项目

`migrateLifeBetsIntoRoadNodesLocal` 开头：

- 若 `life_road_nodes` **已有任意行** → **整段迁移直接 return**；
- 只有节点表为空时，才把今年赌注写成月目标，并 `UPDATE projects SET life_month_goal_id = bet.id WHERE life_bet_id = bet.id`。

后端目前主要是 **建表 / 加列**（`021_life_road_nodes`），**没有**把存量 `life_bet_id` 批量写成 `life_month_goal_id` 的服务端迁移。典型踩坑：

1. App 先同步出空的或少量 `life_road_nodes`；
2. 本地迁移因「表非空」跳过；
3. 项目仍只有 `life_bet_id` → 导图永远挂不上。

### 2.4 空月槽没有「建项目」入口

导图里「+ 从此月建项目」仅当 `m.node` 已存在（该月已有月目标行）。空窗月只能先点进表单创建月目标，再回来挂项目。未写月目标时，项目表单选择器也会提示「还没有月目标」。

### 2.5 选择器与导图依赖「先有月节点」

`getMonthGoalsLocal()` 过滤 `kind === 'month'` 且状态为在路上 / 暂搁 / 已抵达。没有月节点 = 项目侧无法选归属 = 导图侧无挂载。链路是通的，但**前置条件**容易被忽略。

### 2.6 验收标准 ≠ 项目挂载

即便挂上了项目，导图月下展开的是**项目卡片**；节点自己的可勾选清单是**验收标准**（§4），两者并存、职责不同。

---

## 3. UI 构成（页面与组件）

### 3.1 入口与路由

| 表面 | 路由 / 文件 | 职责 |
|---|---|---|
| 「我的」摘要卡 | `ProfileScreen` + `ProfileRoadCard` | 总方向一句 + 今年焦点；点进导图；空态 CTA「写下总方向」 |
| 道路导图子页 | `/life-road` → `LifeRoadScreen` | 可折叠树：总方向 → 今年之上 → 年 → 季 → 月 → 项目 |
| 编辑总方向 | `/edit-life-direction` | 长文总方向 |
| 编辑 / 新建节点 | `/edit-life-road-node/[id]` → `EditLifeRoadNodeScreen` | 标题 / 说明 / 状态；`id=new` + query 带 kind/年/季/月 |
| 新建项目（预填月） | `/add-project?life_month_goal_id=` | 道路「+ 从此月建项目」跳入 |
| 编辑项目 | `/edit-project` | 表单行「月目标」=`MonthGoalPickerField` |
| 旧赌注页（遗留） | `/add-life-bet`、`edit-life-bet` | 兼容旧路径；产品主路径应走节点编辑 |

摘要卡「今年焦点」取值（`resolveYearFocusLine`）：**当前月标题 → 当前季 → 年目标**。

### 3.2 导图交互（`LifeRoadScreen`）

- 默认展开键：`above`、当前年、当前季、当前月。
- 行组件 `NodeRow`：左 chevron 折叠，右侧点标题进编辑 / 建空槽。
- 月行：有挂载项目才给折叠钮；meta 显示「N 个项目」。
- 项目行 depth=3，点进 `/edit-project`。
- 顶栏「+ 多年」；底部「+ 下一年目标」；今年之上内「+ 更远」。
- 文案提示：「浏览与定位年季月拆解。具体做法与推进在项目里完成。」

### 3.3 节点编辑表单（`EditLifeRoadNodeScreen`）

字段仅：**标题、说明（note）、状态**。无子任务、无勾选列表、无截止日期 / 优先级 / 进度条。删除在编辑页确认。

### 3.4 项目侧对接 UI

- `MonthGoalPickerField`：按年 · 季 · 月分组单选，可清除；说明「一条月目标可挂多个项目；跨月请改挂到当前推进月」。
- 保存时写 `life_month_goal_id`，并常把 `life_bet_id` 置 `null`（新路径）。
- 任务 Tab 项目卡可用 `life_month_goal_id || life_bet_id` 显示道路标题（`TasksScreen` + `lifeRoadTitleById`），与导图数据源不完全一致。

### 3.5 数据流（读）

```
进入「我的」/ 道路页
  → fetchProfileLifeRoad（REST 灌 life_directions / life_road_nodes，顺带兼容 life_bets）
  → 本地 SQLite 读节点 + 按 life_month_goal_id 读项目
  → buildRoadMindMap → UI
```

权威在服务端；SQLite 是在线缓存。断网读写失败可重试，无离线 pending 业务。

---

## 4. 验收标准 = 可扩展 checklist（已拍板）

### 4.1 产品含义

| 字段 | 作用 |
|---|---|
| 标题 | 方向短句 |
| 说明 | 背景 / 补充（可选） |
| 状态 | 在路上 / 暂搁 / 已抵达 / 已放弃 |
| **验收标准** | 可勾选 checklist：「做成了算过关」；最多 20 条，单条 ≤80 字 |

- 适用节点：多年 / 更远 / 年 / 季 / 月（凡 `life_road_nodes`）。
- **不是**第二套任务系统：不入格、不计积分、无截止日期 / 优先级 / 完成百分比。
- 执行细节仍归项目；验收标准只回答「怎样算抵达」。

### 4.2 实现要点（代码）

| 项 | 位置 |
|---|---|
| 读写协议 | `lib/life-road/life-road-acceptance.ts` → `extra_data.acceptance_criteria` |
| 编辑 | `AcceptanceChecklistEditor` + `EditLifeRoadNodeScreen` |
| 导图展开 / 勾选 | `LifeRoadScreen` → `AcceptanceInline`；meta 显示「验收 done/total」 |
| 产品边界 | `PRODUCT.md` 已写明允许验收标准 checklist |

---

## 5. UI / 业务结构一览（给实现用）

```
我的 Tab
 └─ ProfileRoadCard（摘要）
      └─ /life-road  LifeRoadScreen（导图）
           ├─ 总方向 → /edit-life-direction
           ├─ 今年之上（multi/farther）→ /edit-life-road-node
           ├─ 年 → 季 → 月 → /edit-life-road-node
           └─ 月下项目 → /edit-project
                └─ 月下「+ 从此月建项目」→ /add-project?life_month_goal_id=

任务域
 └─ 新建 / 编辑项目
      └─ MonthGoalPickerField ← getMonthGoalsLocal()
```

仓库分层：

- UI：`screens/profile/*`、`components/profile/ProfileRoadCard`、`components/life-road/*`
- 领域：`lib/life-road/*`
- 仓储：`lib/repositories/life-road/*`、`lib/repositories/projects/*`
- 同步入口：`lib/profile-page-api.ts` → `fetchProfileLifeRoad`

---

## 6. 建议修复 / 迭代优先级（产品向，非排期）

### P0 · 让「月 ↔ 项目」在数据上真正对齐

1. **存量回填**：凡 `life_bet_id` 有值且 `life_month_goal_id` 空，且该 id 已是 `life_road_nodes.kind=month`，则写回 `life_month_goal_id`（本地 + 服务端各做一次幂等脚本 / 启动修补）。
2. **放宽或重跑迁移条件**：不要仅在「节点表为空」时迁；对未映射项目做补迁。
3. **导图双读过渡期**（可选）：临时把仅有 `life_bet_id` 且能解析到月节点的项目也挂上，避免空白；稳定后去掉。

### P1 · 降低「看起来没对接」的操作成本

1. 空月槽也提供「先写月目标并建项目」或「仅建项目并顺带建空月标题」的快捷路径。
2. 无月目标时，项目选择器引导跳转道路页建月节点，而不是只显示空列表。
3. 任务列表与导图统一只展示 `life_month_goal_id`，旧 `life_bet_id` 仅后台兼容。

### P2 · 验收标准（已落地，可继续打磨）

1. ~~协议 / 编辑 / 导图勾选~~ 已接。  
2. 可选：勾满验收标准时软提示是否改状态为「已抵达」（不自动改）。  
3. 明确 checklist 完成**不**驱动项目 / 任务状态（保持）。

---

## 7. 验收对照（现状自检）

| 检查点 | 现状 |
|---|---|
| 层级：项目 → 月 → 季 → 年；总方向 / 多年在上 | 模型与导图已按此建 |
| 4 季 12 月骨架 | `buildRoadMindMap` 已写死 |
| 一月目标多项目 | 支持 |
| 跨月自动迁到当前推进月 | **未做**（靠手改挂载） |
| 道路不写执行步骤；允许验收标准 checklist | **成立**（已落地） |
| 目标内可扩展验收标准 TodoList | **已做** |
| 默认展开当前年 / 季 / 月 | 已做 |
| 摘要卡极简 | 已做 |
| 从月目标快速建项目并预填 | 有节点时已做；空月无入口 |
| 旧项目在导图月下可见 | **常失败**（见 §2.2 / §2.3） |
---

## 8. 相关文档

- 桌面：`我的道路-年季月拆解需求说明.md`（产品对齐原文）
- `selfApp/PRODUCT.md` · Capabilities「我的 · 道路」
- `selfApp/README.md` 开篇「我的 · 道路」一行说明
- `self_app_back/README.md` · migration `021_life_road_nodes`

---

*本文只梳理现状与缺口，不代替实现；不知道的服务端存量数据是否已手工迁过，需连真实库核验，代码侧无法断言你的设备上 `life_month_goal_id` 是否为空。*
