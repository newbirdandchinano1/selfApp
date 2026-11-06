# selfApp AI 接口说明（App 端）

> 版本：2.3.0  
> 更新日期：2026-11-07  
> 适用：React Native / Expo 客户端  
> 服务端：`selfAPP_AIAgent`（`/api/v1/ai/*`）；备忘落库点评仍经业务后端代调 Agent

---

## 1. 架构

```
App（X-API-Key）──► selfAPP_AIAgent /api/v1/ai/*
                       └──► 智谱 open.bigmodel.cn（Key 仅存 Agent）

App（JWT）──► self_app_back /api/app/memos/:id/ai-review
                 └──► Agent /api/v1/ai/memo/review（分析后写库）
```

- App **不**持有、不配置智谱 API Key。
- 场景 AI 鉴权：`X-API-Key`（见 `lib/agent-config.ts`）。
- 业务 JWT 仅用于 CRUD / 同步 / 备忘落库点评等业务后端接口。
- 客户端封装：`lib/ai-api-client.ts`；业务门面：`lib/zhipu-image-parse.ts`（返回 `{ ok, ... }` 形态）。

### Base URL（Agent）

| 环境 | Base URL |
|------|----------|
| 生产默认 | 见 `lib/agent-config.ts` 内 `DEFAULT_AGENT_BASE_URL` |
| 开发 | `EXPO_PUBLIC_AGENT_BASE_URL`（仅 `__DEV__`） |
| 用户覆盖 | AsyncStorage（`setAgentBaseUrl`） |

路径前缀：**`/api/v1/ai`**。

密钥：`EXPO_PUBLIC_AGENT_API_KEY` 或 `DEFAULT_AGENT_API_KEY`（须与 Agent `.env` 的 `API_KEY` 一致）。

---

## 2. 通用约定

- **鉴权：** `X-API-Key: <agent-api-key>`
- **Content-Type：** `application/json`（图片类传 Base64 字段，不走 multipart）
- **成功：** `{ code: 0, message: "ok", data: ... }`
- **失败：** 非 2xx 或 `code !== 0`；常见 401 / 400 / 502（上游智谱失败）

---

## 3. 已落地接口总览

| # | 方法 | 路径 | 用途 |
|---|------|------|------|
| 1 | GET | `/api/v1/ai/health` | 探测 Agent → 智谱 |
| 2 | POST | `/api/v1/ai/food/intake-from-text` | 文字记饮食 |
| 3 | POST | `/api/v1/ai/food/nutrition-from-image` | 拍照识营养（含 hydration_ml） |
| 4 | POST | `/api/v1/ai/food/daily-targets` | 日摄入目标估算 |
| 4a | POST | `/api/v1/ai/food/weekly-insights` | 健康分析周洞察（只读） |
| 4b | POST | `/api/v1/ai/food/suggest-next-meal` | 今日缺口 → 下一餐建议 |
| 4c | POST | `/api/v1/ai/food/nutrition-from-image-split` | 一图拆多条摄入草稿 |
| 4d | POST | `/api/v1/ai/food/adjust-intake` | 份量修正 / 再解析 |
| 4e | POST | `/api/v1/ai/food/daily-wrapup` | 日终收口文案（只读） |
| 4f | POST | `/api/v1/ai/food/weight-comment` | 体重趋势短评（只读） |
| 4g | POST | `/api/v1/ai/food/nutrition-from-label-image` | 包装营养标签识图 |
| 4h | POST | `/api/v1/ai/food/intake-comment` | 重新生成摄入点评 |
| 5 | POST | `/api/v1/ai/finance/parse-one-liner` | 一句话记账 |
| 6 | POST | `/api/v1/ai/finance/parse-one-liner-from-image` | 截图记账 |
| 7 | POST | `/api/v1/ai/finance/txn-comment` | 流水短评 |
| 8 | POST | `/api/v1/ai/finance/bill-summary-analysis` | 账单统计分析 |
| 9 | POST | `/api/v1/ai/finance/dashboard-analysis` | 财务仪表盘分析 |
| 10 | POST | `/api/v1/ai/finance/cash-flow-analysis` | 现金流分析 |
| 10a | POST | `/api/v1/ai/finance/budget-suggest` | 预算周期建议（草稿） |
| 10b | POST | `/api/v1/ai/finance/savings-goal-coach` | 储蓄目标可行性教练 |
| 10c | POST | `/api/v1/ai/finance/simulate-advice` | 决策模拟 AI 建议 |
| 10d | POST | `/api/v1/ai/finance/parse-transfer` | 一句话转账草稿 |
| 10e | POST | `/api/v1/ai/finance/parse-multi-from-image` | 一图拆多笔账单 |
| 10f | POST | `/api/v1/ai/finance/parse-scheduled-expense` | 定时支出一句话草稿 |
| 10g | POST | `/api/v1/ai/finance/suggest-category` | 分类纠偏建议 |
| 10h | POST | `/api/v1/ai/finance/anomaly-hints` | 异常消费 / 重复支付提示（只读） |
| 10i | POST | `/api/v1/ai/finance/daily-wrapup` | 日终 / 周财务收口文案（只读） |
| 10j | POST | `/api/v1/ai/finance/parse-cash-flow-entry` | 现金流记一笔自然语言草稿 |
| 11 | POST | `/api/v1/ai/memo/review` | 备忘点评（不落库） |
| 12 | POST | `/api/app/memos/:id/ai-review` | 备忘点评并写库（业务后端 → Agent） |
| 12a | POST | `/api/v1/ai/memo/convert-draft` | 备忘 → 待办/项目结构化草稿 |
| 12b | POST | `/api/v1/ai/memo/suggest-tags` | 备忘 → 标签建议（锁请求内 id） |
| 12c | POST | `/api/v1/ai/memo/draft-from-text` | 一句话 → 备忘草稿 |
| 12d | POST | `/api/v1/ai/memo/draft-from-image` | 白板/便签图 → 备忘草稿 |
| 12e | POST | `/api/v1/ai/memo/rewrite` | 备忘改写草稿 |
| 12f | POST | `/api/v1/ai/memo/dedupe-hints` | 重复/可合并检测（只读） |
| 12g | POST | `/api/v1/ai/memo/collection-insights` | 跨条主题洞察（只读） |
| 13 | POST | `/api/v1/ai/weekly-review/coaching` | 日/周/月复盘分析 |
| 13a | POST | `/api/v1/ai/review/draft-dimension` | 单栏复盘 AI 起草 |
| 13b | POST | `/api/v1/ai/review/convert-actions` | 缺陷/新想法 → 行动草稿 |
| 13c | POST | `/api/v1/ai/review/rewrite-dimension` | 单栏复盘改写 / 精炼 |
| 13d | POST | `/api/v1/ai/review/outline` | 写前提纲（日 / 周） |
| 13e | POST | `/api/v1/ai/review/period-insights` | 跨周期趋势洞察（只读） |
| 13f | POST | `/api/v1/ai/review/suggest-template-copy` | 模板栏目文案建议 |
| 14 | POST | `/api/v1/ai/recipe/parse-from-text` | 文本 → 菜谱结构化草稿 |
| 15 | POST | `/api/v1/ai/recipe/parse-from-image` | 成品图/菜谱截图 → 菜谱草稿 |
| 16 | POST | `/api/v1/ai/recipe/suggest-week-plan` | 库内周排餐候选 |
| 17 | POST | `/api/v1/ai/recipe/suggest-from-pantry` | 现有食材 → 库内选菜 |
| 18 | POST | `/api/v1/ai/recipe/scale-or-rewrite` | 份量缩放 / 步骤改写 |
| 19 | POST | `/api/v1/ai/recipe/cook-comment` | 做完点评 → 备注草稿 |
| 20 | POST | `/api/v1/ai/wish-board/draft-from-text` | 一句话 → 心愿草稿 |
| 21 | POST | `/api/v1/ai/wish-board/suggest-cost` | 建议积分定价 |
| 22 | POST | `/api/v1/ai/wish-board/coach-unlock` | 缺口解释 + 下一步文案（只润色） |
| 23 | POST | `/api/v1/ai/wish-board/suggest-conditions` | 建议兑换条件（锁候选 id） |
| 24 | POST | `/api/v1/ai/wish-board/draft-from-image` | 配图/截图 → 心愿草稿 |
| 25 | POST | `/api/v1/ai/wish-board/suggest-next` | 下一颗心愿候选（不自动创建） |
| 26 | POST | `/api/v1/ai/wish-board/insights` | 积分与心愿健康度（只读 tips） |
| 27 | POST | `/api/v1/ai/wardrobe/parse-item-from-image` | 单品图 → 属性草稿 |
| 28 | POST | `/api/v1/ai/wardrobe/suggest-today` | 库内「今天穿什么」推荐 |
| 29 | POST | `/api/v1/ai/wardrobe/parse-item-from-text` | 一句话 → 单品属性草稿 |
| 30 | POST | `/api/v1/ai/wardrobe/suggest-outfit` | 按场合库内组一套 |
| 31 | POST | `/api/v1/ai/wardrobe/idle-insights` | 闲置 / 少穿洞察（只读） |
| 32 | POST | `/api/v1/ai/wardrobe/wear-comment` | 穿着短评草稿 |
| 33 | POST | `/api/v1/ai/wardrobe/similar-items` | 库内找相似单品 |
| 34 | POST | `/api/v1/ai/task/parse-one-liner` | 一句话 → 独立待办草稿 |
| 35 | POST | `/api/v1/ai/task/suggest-today` | 今日优先 / 吃哪只青蛙 |
| 36 | POST | `/api/v1/ai/task/breakdown` | 大任务 → 子任务 / 验收 checklist |
| 37 | POST | `/api/v1/ai/task/parse-schedule` | 一句话改日程 / 提醒 / 重复 |
| 38 | POST | `/api/v1/ai/task/parse-from-image` | 截图 / 白板 → 多条待办草稿 |
| 39 | POST | `/api/v1/ai/task/parse-habit` | 一句话 → 习惯草稿 |
| 40 | POST | `/api/v1/ai/task/overview-insights` | 待办总览 / 周积压洞察 |
| 41 | POST | `/api/v1/ai/task/plan-project` | 项目目标 → 里程碑任务树草稿 |
| 42 | POST | `/api/v1/ai/task/task-comment` | 任务短评 / 阻塞诊断 |
| 43 | POST | `/api/v1/ai/task/habit-nudge` | 习惯缺口 → 今日补打建议 |
| 44 | POST | `/api/v1/ai/task/parse-filter` | 自然语言 → 列表筛选草稿 |
| 45 | POST | `/api/v1/ai/profile/persona-draft` | 一句话 / 润色 → 人物画像草稿 |
| 46 | POST | `/api/v1/ai/profile/week-rhythm-insights` | 本周节奏洞察（只读） |
| 47 | POST | `/api/v1/ai/life-road/plan-from-direction` | 总方向 → 年/季/月节点草稿 |
| 48 | POST | `/api/v1/ai/life-road/acceptance-draft` | 单节点 → 验收标准增量草稿 |
| 49 | POST | `/api/v1/ai/life-road/parse-node-update` | 一句话 → 节点字段 patch |
| 50 | POST | `/api/v1/ai/profile/completeness-nudge` | 资料缺口 → 补全引导 |
| 51 | POST | `/api/v1/ai/life-road/parse-from-image` | 手写便签/截图 → 方向或节点草稿 |
| 52 | POST | `/api/v1/ai/life-road/suggest-links` | 焦点 ↔ 任务/习惯/项目弱绑定建议 |
| 53 | POST | `/api/v1/ai/profile/weight-comment` | 体重趋势短评（只读，非医疗） |
| 54 | POST | `/api/v1/ai/profile/completion-log-comment` | 完成履历短评（可复制/存备忘） |
| 55 | POST | `/api/v1/ai/profile/notification-copy` | 通知文案批量预生成（≤10，写缓存） |
| 56 | POST | `/api/v1/ai/life-road/period-review` | 季末 / 年终道路回顾（只读） |
| 57 | POST | `/api/v1/ai/assistant/route` | 全局助手单轮万能路由 → ActionCard[] |
| 58 | POST | `/api/v1/ai/assistant/daily-brief` | 今日简报：规则 facts + LLM 短文案 ≤3 卡 |
| 59 | POST | `/api/v1/ai/assistant/turn` | 多轮改草稿 / 澄清追问 → ActionCard[] |
| 60 | POST | `/api/v1/ai/assistant/compose` | 跨域编排：goal + 白名单域 → ≤5 张 ActionCard |

> 上表以外的 AI 场景（项目点评、缺点、目标墙、技能等）**当前 Agent 未提供路由**，本文不再描述。  
> 心愿兑换 / 扣分**永不**经 Agent；资格仍用本地评估 + 业务 `POST /wish-board/redeem`。  
> 衣橱写库仍走 App → `self_app_back` `/api/app/wardrobe/*`；抠图仍为本地 Vision，不经 Agent。  
> 任务写库仍走 App → 本地 SQLite → `self_app_back` `/api/app/pages/tasks*`；青蛙指派仍走 `frog-assign`。  
> 我的页写库仍走 App → `users` / `life_*` 确认后脏同步；Agent 不写库、不改积分。  
> 全局助手写库仍须用户确认后走各域现有预览 / `frog-assign` / `review_quick_create`；`ref_ids` 仅允许来自请求 `brief_context`。

---

## 4. 接口摘要

### 4.1 `GET /api/v1/ai/health`

探测智谱连通性。`data` 含 `ok`、`model`、`latency_ms` 等字段。

### 4.2 健康 / 饮食

**`POST .../food/intake-from-text`**

```json
{ "text": "一碗冒菜", "question": "可选补充指令" }
```

**`POST .../food/nutrition-from-image`**

```json
{
  "image_base64": "<纯 Base64 或可拆分 data URI>",
  "image_mime_type": "image/jpeg",
  "supplement_text": "可选"
}
```

成功 `data` 在原有蛋白/碳水/热量之外增加 `hydration_ml`（汤/粥/饮料等可饮水毫升；固体正餐无汤饮时为 0）。旧客户端忽略即可。

**`POST .../food/daily-targets`**

```json
{ "context_block": "用户档案与近七日摄入摘要…" }
```

**`POST .../food/weekly-insights`**

```json
{
  "context_block": "近7日按日合计、目标、训练/休息日…",
  "rule_insights": [{ "title": "水分空窗", "body": "…", "metric_hint": "hydration" }]
}
```

成功 `data`：`score?`、`insights[{ title, body, metric_hint }]`（≤3）、`suggestion`、`tags?`。只读，不写库；App 失败时回退本地规则洞察。

**`POST .../food/suggest-next-meal`**

```json
{
  "context_block": "今日合计、目标、缺口、时刻、饮食偏好…",
  "quick_adds": [{ "key": "water", "name": "一杯水", "nutrition_summary": "水分 +250 ml" }],
  "recipes": [{ "id": "recipe_xxx", "title": "番茄炒蛋" }]
}
```

成功 `data`：`tips[]`、`quick_add_keys[]` / `recipe_ids[]`（必须 ⊆ 请求）、可选 `draft_intake`。不自动写库；推荐 id 禁止捏造。

**`POST .../food/nutrition-from-image-split`**

```json
{
  "image_base64": "<纯 Base64 或可拆分 data URI>",
  "image_mime_type": "image/jpeg",
  "supplement_text": "可选",
  "dish_count_hint": 3
}
```

成功 `data`：`is_food`、`non_food_code`、`items[{ food_name, protein_g, carbohydrate_g, calories_kcal, hydration_ml, ai_evaluation }]`（≤8）。App 多行预览后逐条确认写库；同源图通常只挂第一条。

**`POST .../food/adjust-intake`**

```json
{
  "title": "番茄牛腩面",
  "hydration_ml": 350,
  "protein_g": 28,
  "carbohydrate_g": 75,
  "calories_kcal": 620,
  "ai_comment": "可选原点评",
  "adjustment_text": "其实只吃了一半"
}
```

成功 `data`：与文字记饮食同形（`food_summary` + 四项 + `ai_evaluation`）。预填编辑表单，确认后 `updateHealthRecord`。

**`POST .../food/daily-wrapup`**

```json
{ "context_block": "今日合计、目标、达标项、缺口…" }
```

成功 `data`：`title`、`body`（1～2 句）。只读；失败时 App 回退规则提醒文案。快捷卡「AI 填入」复用 `intake-from-text`，映射为 name + 四项后预填卡片表单。

**`POST .../food/weight-comment`**

```json
{ "context_block": "近14～30日 ymd+kg、目标、同期热量日均…" }
```

成功 `data`：`comment`、可选 `caution`。只读；非医疗建议。`weight_logs` 仅本地，由 App 上传摘要。

**`POST .../food/nutrition-from-label-image`**

```json
{
  "image_base64": "<纯 Base64 或可拆分 data URI>",
  "image_mime_type": "image/jpeg",
  "supplement_text": "可选"
}
```

成功 `data`：`is_label`、`non_label_code`、`product_name`、`basis`（`per_100g` | `per_serving`）、`serving_size_g`、四项营养、`ai_evaluation`。App 按份数/克数换算后预填确认写入。

**`POST .../food/intake-comment`**

```json
{
  "title": "番茄牛腩面",
  "hydration_ml": 350,
  "protein_g": 28,
  "carbohydrate_g": 75,
  "calories_kcal": 620,
  "gap_hint": "今日蛋白还差约20g"
}
```

成功 `data`：`ai_evaluation`。详情页「换一句」确认后写入 `intake_ai_comment`。

### 4.3 财务

**`POST .../finance/parse-one-liner`**

```json
{
  "text": "午饭外卖28元支付宝",
  "accounts": [{ "name": "支付宝", "account_no": null }]
}
```

**`POST .../finance/parse-one-liner-from-image`**

```json
{
  "image_base64": "...",
  "image_mime_type": "image/jpeg",
  "accounts": [{ "name": "微信" }]
}
```

**`POST .../finance/txn-comment`** / **`bill-summary-analysis`** / **`cash-flow-analysis`**

```json
{ "summary_text": "…" }
```

**`POST .../finance/dashboard-analysis`**

```json
{
  "summary_text": "…",
  "past6_net_savings": [1, 2, 3, 4, 5, 6],
  "past6_income": [1, 2, 3, 4, 5, 6]
}
```

**`POST .../finance/budget-suggest`**

```json
{
  "summary_text": "近周期预算/支出/分类 Top/定时预扣摘要…",
  "current_base_amount": 6000
}
```

成功 `data`：`suggested_base_amount`、`rationale_zh`、可选 `daily_cap_hint`、`cut_tips[]`。App 预填预算 Sheet，**确认后**再持久化。

**`POST .../finance/savings-goal-coach`**

```json
{ "summary_text": "目标额/日期/净资产/缺口/日均需存/近月净储蓄…" }
```

成功 `data`：`feasible`、`pace_comment`、可选 `adjust_options[]`（`kind`/`label`/`days?`/`amount?`）。只读；可选「应用」预填编辑器。

**`POST .../finance/simulate-advice`**

```json
{ "summary_text": "情景参数 + 当前/模拟后 FCF 与进度差分…" }
```

成功 `data`：`advice`、可选 `risk_level`（`low|medium|high`）。失败由 App 回退本地规则文案。

**`POST .../finance/parse-transfer`**

```json
{
  "text": "工资卡转到招行信用卡 2000",
  "accounts": [{ "name": "工资卡" }, { "name": "招行信用卡" }]
}
```

成功 `data`：`amount`、`name`、`from_account_hint` / `to_account_hint`（须 ⊆ 请求 accounts，否则 null）、可选 `fee_amount`。

**`POST .../finance/parse-multi-from-image`**

```json
{
  "image_base64": "...",
  "image_mime_type": "image/jpeg",
  "accounts": [{ "name": "微信" }],
  "max_items": 8
}
```

成功 `data`：`items[]`（同 one-liner 字段 + 可选 `happened_at`）。自动记账默认仍单笔。

**`POST .../finance/parse-scheduled-expense`**

```json
{
  "text": "每月 1 号扣房贷 5200 招行",
  "accounts": [{ "name": "招行" }],
  "category_names": ["房贷", "生活"]
}
```

成功 `data`：`name`、`amount`、`repeat_hint`、`days`、`hour`/`minute`、`account_hint`/`category_hint`、`include_in_budget`。

**`POST .../finance/suggest-category`**

```json
{
  "summary_text": "标题：星巴克…",
  "category_names": ["餐饮", "购物", "交通"]
}
```

成功 `data`：`category_label`（须 ∈ 候选）、`confidence`、`reason`。

**`POST .../finance/anomaly-hints`**

```json
{
  "summary_text": "近 14 日流水摘要（含 id=…）…",
  "txn_ids": ["t1", "t2"]
}
```

成功 `data`：`hints[{ txn_ids?, title, body }]`；`txn_ids` 必须 ⊆ 请求。只读弱提示，App 不自动删改。

**`POST .../finance/daily-wrapup`**

```json
{
  "summary_text": "今日/本周收支、预算剩余、储蓄缺口、未执行定时支出…",
  "period": "daily"
}
```

成功 `data`：`title`、`body`（1～2 句）。失败由 App 回退 `finance-reminder-logic` 规则文案；仅在通知排期/阈值推送时低频预取，勿启动全量轰炸。

**`POST .../finance/parse-cash-flow-entry`**

```json
{
  "text": "每月房租 3200 记必要支出",
  "existing_names": ["工资", "房租"]
}
```

成功 `data`：`entry_kind`（`income|necessary|unnecessary|asset|liability`）、`amount`、`name_hint`、可选 `quadrant` / `asset_return` / `liability_months`。预填现金流折页表单，确认后写本地模型（非 `finance_transactions`）。

### 4.4 备忘

**`POST .../ai/memo/review`**（纯分析，走 Agent）

```json
{ "memo_context_text": "…" }
```

返回必含 `evaluation`、`suggestions`；可选结构化字段（旧端忽略）：`bullets[]`、`suggested_action`（`todo|project|keep|archive`）、`draft_title`。业务后端 `ai-review` 仍只落库评价三字段，结构化字段可随本次响应透出。

**`POST /api/app/memos/:id/ai-review`**（业务后端，JWT）

对指定备忘分析并写入 `ai_evaluation` / `ai_suggestions` / `ai_review_at`（后端内部代调 Agent）。

**`POST .../ai/memo/convert-draft`**

```json
{
  "memo_context_text": "…",
  "target": "auto",
  "ai_summary": "可选：已有评价摘要"
}
```

`target`：`todo` | `project` | `auto`。返回 `mode`、`todo?`、`project?`、`split_todos?`、`rationale`。Agent **不**建任务/项目、不删备忘。

**`POST .../ai/memo/suggest-tags`**

```json
{
  "memo_context_text": "…",
  "tags": [{ "id": "tag_work", "name": "工作" }],
  "tag_ids": ["已挂标签 id"]
}
```

返回 `tag_ids[]`（必须 ⊆ 请求 `tags[].id`）、可选 `new_tag_names[]`。

**`POST .../ai/memo/draft-from-text`**

```json
{ "text": "下周要交年报，先对齐指标", "style": "brief" }
```

`style` 可选：`brief` | `checklist` | `meeting`。返回 `title`、`body_plain`、`tag_name_hints[]`。用户确认后再 `createMemo`。语音转写文本也走本接口（不单开路由）。

**`POST .../ai/memo/draft-from-image`**

```json
{
  "image_base64": "<纯 Base64 或可拆分 data URI>",
  "image_mime_type": "image/jpeg",
  "supplement_text": "可选"
}
```

返回 `title`、`body_plain`、`confidence`；非备忘内容可带 `reject_reason`（服务端亦可直接失败）。

**`POST .../ai/memo/rewrite`**

```json
{ "memo_context_text": "…", "mode": "polish" }
```

`mode`：`polish` | `shorten` | `checklist` | `fill_gaps`。返回 `title?`、`body_plain`、`change_summary`。用户接受后写入编辑缓冲再手动保存。

**`POST .../ai/memo/dedupe-hints`**

```json
{
  "memo_context_text": "…",
  "current_memo_id": "m_cur",
  "candidates": [{ "id": "m1", "title_preview": "…", "body_preview": "…", "tag_names": [], "updated_at": "…" }]
}
```

返回 `similar[{ memo_id, score, reason }]`（id ⊆ 请求）。

**`POST .../ai/memo/collection-insights`**

```json
{
  "period_label": "近 7 天",
  "memos": [{ "id": "m1", "title_preview": "…", "body_preview": "…" }]
}
```

返回 `themes[]`、`open_loops[]`、`tips[]`、`memo_ids[]`（id ⊆ 请求）。

**`POST .../ai/memo/link-suggest`**

```json
{
  "memo_context_text": "…",
  "projects": [{ "id": "p1", "name": "年报" }],
  "todos": [{ "id": "t1", "title": "对齐指标" }]
}
```

返回 `project_ids[]` / `task_ids[]`（必须 ⊆ 请求）、可选 `reasons`、可选 `create_todo_draft{title,note}`。禁止捏造 id。

> 语音转写后结构化：App 侧 ASR 得到文本后复用 `draft-from-text`，不单开语音路由。

### 4.5 日 / 周 / 月复盘

**`POST .../weekly-review/coaching`**

客户端只传复盘页数据。**返回 JSON 契约由 App 定义**（`lib/review-ai-json-contract.ts`），Agent `review_prompts.py` 按该契约写 system prompt。

```json
{
  "review_type": "daily",
  "period_label": "2026-03-30",
  "dimensions": [
    { "title": "健康", "columns": [{ "title": "记录", "value": "…" }] }
  ],
  "metrics_text": null,
  "related_digest": null,
  "execution_score": null
}
```

`review_type`：`daily` | `weekly` | `monthly`。兼容旧字段 `user_prompt`。

返回结构化 JSON（App 落库用 `text`，UI 用其余字段）：

| 字段 | UI |
|------|-----|
| `title` | 分析页顶部总结标题 |
| `overview` | 「复盘概览」卡 |
| `tags` | 标题下维度标签（0～4；健康/任务/财务/日常/缺陷/新想法） |
| `suggestions[]` | 「明天/下周/下月可以试试」；每项 `text` / `action` / `draft_title` / `draft_body` |
| `text` | 上述结构的规范 JSON 字符串，供落库 |

```json
{
  "title": "今天执行集中，睡眠偏晚",
  "overview": "上午推进了关键任务……",
  "tags": ["任务", "健康"],
  "suggestions": [
    {
      "text": "明天上午只排一项青蛙任务并完成。",
      "action": "todo",
      "draft_title": "明日青蛙",
      "draft_body": "只排一项，完成即勾选"
    }
  ],
  "text": "{\"title\":\"…\",\"overview\":\"…\",\"tags\":[…],\"suggestions\":[…]}"
}
```

`suggestions[].action`：`memo` | `project` | `habit` | `todo`（建议更合适的落地点；App 每条仅一个「+」，点开后再选备忘/项目/习惯/待办）。条数由模型按内容给出，客户端按返回长度动态展示。

日 / 月 / 周格子分析入口会由 App 本地拼 `metrics_text` / `related_digest`（系统事实、昨刊/上一周刊/上一月刊、子周期摘要、心愿 digest），再调本接口；契约字段不变。有可比上一期数据时，模型可在 overview 中短对照（不另开 compare 路由）。

**`POST .../review/draft-dimension`**

单栏「AI 起草」：根据系统事实（+ 可选已有正文）生成人话复盘段落，**不落库**。

```json
{
  "scope": "daily",
  "period_label": "2026-11-06",
  "dimension_title": "任务",
  "column_title": "记录",
  "facts_text": "【任务（青蛙）】…",
  "existing_text": null,
  "user_hint": null
}
```

成功 `data`：

```json
{
  "draft_text": "【任务】青蛙「周报」已完成；待办「报销」未勾选。…",
  "confidence": 0.84
}
```

App 门面：`draftReviewDimension`；维度详情栏「✦」→ 确认后写入编辑缓冲。

**`POST .../review/convert-actions`**

缺陷 / 新想法栏「智能拆分」→ 可确认行动草稿。

```json
{
  "scope": "daily",
  "period_label": "2026-11-06",
  "dimension_title": "缺陷",
  "text": "晚上刷手机太久，报销一直拖着。",
  "open_items": [{ "id": "task_x", "title": "报销" }]
}
```

成功 `data`：

```json
{
  "actions": [
    {
      "action": "todo",
      "draft_title": "补交本周报销",
      "draft_body": "发票拍照上传；今晚完成",
      "ref_task_id": "task_x",
      "text": "补交本周报销"
    }
  ]
}
```

`action` 同 coaching suggestions；`ref_task_id` 必须 ⊆ 请求 `open_items[].id`。App 门面：`convertReviewActions`；Feed「智能拆分」→ Modal 逐条确认新建。

**`POST .../review/rewrite-dimension`**

单栏「AI 改写」：精炼 / 理清 / 温和三种模式，**不落库**；对齐备忘 `memo/rewrite`。

```json
{
  "text": "青蛙完成两项，但报销一直拖着，晚上刷手机太久。",
  "mode": "tighten",
  "dimension_title": "缺陷",
  "scope": "daily",
  "period_label": "2026-11-06",
  "column_title": "记录"
}
```

`mode`：`tighten` | `clarify` | `gentle`。成功 `data`：

```json
{
  "text": "报销仍未办；晚间刷手机过久。",
  "change_summary": "压缩冗余并保留关键名词"
}
```

硬约束：不新增事实；不删用户明确写出的关键名词。App 门面：`rewriteReviewDimension`；维度详情顶栏「改写」→ 接受后进编辑缓冲。

**`POST .../review/outline`**

写前提纲：根据 facts / metrics / 模板维度标题生成起笔问句，**不直接写库**。

```json
{
  "scope": "daily",
  "period_label": "2026-11-06",
  "facts_text": "【任务（青蛙）】…",
  "metrics_text": "当日系统事实：…",
  "dimension_titles": ["健康", "任务", "财务", "日常", "缺陷", "新想法"],
  "open_defect_hint": "昨晚睡太晚"
}
```

`scope`：`daily` | `weekly`。成功 `data`：

```json
{
  "headline": "今天先收口青蛙，再写清一处卡点",
  "outline": [
    {
      "dimension_title": "任务",
      "prompts": ["青蛙完成了吗？卡在哪一步？", "哪件待办可以移到明天上午？"]
    }
  ]
}
```

App 门面：`outlineReview`；日格子「生成写前提纲」/ 提醒 `focusEmpty` 落地 → Sheet；点维可带问句进编辑，或一键写入空栏（仍须用户确认保存）。

**`POST .../review/period-insights`**

跨周期趋势洞察（只读）：近 N 周 / N 月裁剪摘要 → 主题 / 反复缺陷 / tips；可选 `suggested_actions`（形状同 coaching suggestions）。**不改历史刊**。

```json
{
  "scope": "weekly",
  "periods": [
    {
      "period_label": "11/3 – 11/9",
      "tags": ["任务", "健康"],
      "title_or_overview": "上午执行集中，睡眠偏碎",
      "defects_preview": "报销拖延；晚间刷手机",
      "ideas_preview": "想固定周一青蛙",
      "metrics": "执行分 3/5"
    }
  ],
  "aggregate_metrics": "近 4 周刊参与洞察（有正文）；平均执行分 3.2/5"
}
```

`scope`：`weekly` | `monthly`。成功 `data`：

```json
{
  "themes": ["上午执行集中", "睡眠碎片化反复出现"],
  "recurring_defects": ["报销拖延"],
  "tips": ["周一上午办报销"],
  "suggested_actions": [
    {
      "text": "周一办报销",
      "action": "todo",
      "draft_title": "办报销",
      "draft_body": "发票拍照上传"
    }
  ]
}
```

App 门面：`periodInsightsReview` + `buildReviewPeriodInsightPeriods`；Hub「更多 → 近月模式」/ 月复盘 AI 卡「近月模式」→ Sheet；「+」走 `review-ai-quick-create`。

语音记一笔：**不单开路由**；维度详情 🎤 粘贴转写 → `draft-dimension`（`user_hint`）。

**`POST .../review/suggest-template-copy`**

模板栏目 placeholder / hint 文案建议；确认后写入模板草稿，**不默认改 builtin 结构**。

```json
{
  "scope": "daily",
  "dimension_titles": ["健康", "任务", "财务", "日常", "缺陷", "新想法"],
  "user_goal": "更关注睡眠与青蛙收口"
}
```

成功 `data`：

```json
{
  "columns": [
    {
      "dimension_title": "任务",
      "column_title": "记录",
      "placeholder": "今天青蛙完成了吗？卡在哪？",
      "hint": "写清青蛙与卡点即可"
    }
  ]
}
```

App 门面：`suggestReviewTemplateCopy`；模板设置「AI 建议栏目说明」→ 逐栏 / 全部写入 placeholder 草稿 → 用户再点保存。

### 4.6 菜谱

与 `food/*`（记摄入/营养）分离：本接口只返回**可确认草稿**，写库仍走 `createRecipe` / `updateRecipe`（JWT）。

**`POST .../recipe/parse-from-text`**

```json
{
  "text": "番茄炒蛋：鸡蛋3个，番茄2个…",
  "category_hints": ["家常", "汤羹"]
}
```

**`POST .../recipe/parse-from-image`**

```json
{
  "image_base64": "...",
  "image_mime_type": "image/jpeg",
  "supplement_text": "可选",
  "category_hints": ["家常"]
}
```

成功 `data`：

```json
{
  "title": "番茄炒蛋",
  "category_hint": "家常",
  "ingredients": [{ "name": "鸡蛋", "amount": "3个", "remark": "" }],
  "steps": ["打蛋加盐", "炒番茄出汁"],
  "notes": "少油",
  "confidence": 0.86
}
```

App 门面：`parseRecipeFromText` / `parseRecipeFromImage`（`lib/zhipu-image-parse.ts`）。UI：`recipe-edit`「AI 填入」。

**`POST .../recipe/suggest-week-plan`**

```json
{
  "start_date": "2026-11-03",
  "end_date": "2026-11-09",
  "recipes": [{ "id": "recipe_x", "title": "番茄炒蛋", "ingredients": ["鸡蛋"], "times_cooked": 2 }],
  "existing_plan": [{ "date": "2026-11-03", "slot": "dinner", "recipeId": "recipe_x", "recipeTitle": "番茄炒蛋" }],
  "preferences": "少油、不重复",
  "target_slots": ["lunch", "dinner"]
}
```

成功 `data`：`entries[]`（仅含请求内 `recipeId`）、`unmet_slots[]`、`suggest_new_drafts[]`、`notes`。  
App：`suggestRecipeWeekPlan`；UI：计划 Tab「AI 排本周」→ 勾选 → `addRecipePlanEntry`。

**`POST .../recipe/suggest-from-pantry`**

```json
{
  "pantry": ["鸡蛋", "番茄"],
  "recipes": [{ "id": "recipe_x", "title": "番茄炒蛋", "ingredients": ["鸡蛋", "番茄"] }],
  "limit": 6
}
```

成功 `data`：`suggestions[]`（`recipeId` / `reason` / `missing_ingredients`）、`notes`。  
App：`suggestRecipeFromPantry`；UI：采购 Tab「AI 选菜」→ 进菜单篮 / 加入采购。

**`POST .../recipe/scale-or-rewrite`**

```json
{
  "title": "番茄炒蛋",
  "ingredients": [{ "name": "鸡蛋", "amount": "3个" }],
  "steps": ["打蛋", "炒蛋"],
  "notes": "少油",
  "goal": "改成 2 人份"
}
```

成功 `data`：`title` / `ingredients` / `steps` / `notes` / `summary`。  
App：`scaleOrRewriteRecipe`；UI：菜谱详情「AI 改写」→ 预览 → `updateRecipe`。

**`POST .../recipe/cook-comment`**

```json
{
  "recipe_title": "番茄炒蛋",
  "rating": 4,
  "user_note": "有点咸",
  "improvement_hint": null
}
```

成功 `data`：`{ "comment": "…" }`。  
App：`generateRecipeCookComment`；UI：完成制作 Sheet「AI 备注」。

### 4.7 心愿板

与积分兑换硬校验分离：本接口只返回**可确认草稿 / 文案**；创建走 `createWishBoardItem`，兑换仍由用户点按钮走业务 API。

**`POST .../wish-board/draft-from-text`**

```json
{
  "text": "周末想看场电影",
  "balance": 2680,
  "icon_keys": ["gift", "movie", "coffee"],
  "recent_titles": ["周末咖啡"]
}
```

成功 `data`：`title`、`description_text`、`icon_key`（须 ∈ 请求枚举）、`wish_type`（`once`|`repeat`）、`cost_points`、`cost_reason`、`confidence`。  
App：`aiWishBoardDraftFromText`；UI：心愿表单「AI 填入」。

**`POST .../wish-board/suggest-cost`**

```json
{
  "title": "周末看场电影",
  "description_text": "含小食可另计",
  "wish_type": "repeat",
  "balance": 2680,
  "month_earned": 900,
  "existing_costs": [200, 500, 1200],
  "incentive_strength": "normal"
}
```

`incentive_strength` 可选：`soft` | `normal` | `strong`；`recent_redeem_count` 可选（repeat 节奏）。  
成功 `data`：`cost_points`、`range{min,max}`、`reason`、可选 `available_from_hint`（仅文案，不自动写库）。  
App：`aiWishBoardSuggestCost`；UI：表单「估个分」。

**`POST .../wish-board/coach-unlock`**

```json
{
  "wish_title": "周末电影",
  "eligibility": {
    "points_ok": false,
    "cost_points": 800,
    "balance": 480,
    "pending": [{ "kind": "project", "id": "p_xxx", "title": "季度总结" }],
    "checks_summary": "积分不足；项目未结案"
  }
}
```

成功 `data`：`headline`、`steps[{text,action_kind,action_id?}]`（`action_id` ⊆ pending）。  
一期缺口 Sheet 也可纯模板（`lib/wish-board-gap-coach-template.ts`），不强制调本接口。

**`POST .../wish-board/suggest-conditions`**

```json
{
  "title": "周末电影",
  "wish_type": "repeat",
  "cost_points": 800,
  "projects": [{ "id": "p_xxx", "title": "季度总结", "progress_hint": "2/5" }],
  "tasks": [],
  "todos": [],
  "habits": [{ "id": "hab_yyy", "title": "早睡", "eligible": true }],
  "current_net_worth": 120000
}
```

成功 `data`：`redeem_conditions`（ids ⊆ 候选；习惯仅 eligible）、`reason`。`available_from` 一期恒为 null。  
App：`aiWishBoardSuggestConditions`；UI：条件区「帮我绑」。

**`POST .../wish-board/draft-from-image`**

```json
{
  "image_base64": "...",
  "image_mime_type": "image/jpeg",
  "supplement_text": "可选",
  "balance": 2680,
  "icon_keys": ["gift", "movie", "shopping"]
}
```

成功 `data` 同 `draft-from-text`。图是否写入描述由用户确认。  
App：`aiWishBoardDraftFromImage`；UI：表单「AI 填入」→ 拍照/相册。

**`POST .../wish-board/suggest-next`**

```json
{
  "active": [{ "title": "周末咖啡", "cost_points": 200, "wish_type": "repeat", "status": "active" }],
  "redeemed": [{ "title": "短途旅行", "cost_points": 3000 }],
  "balance": 2680,
  "month_earned": 900,
  "preference": "想多出门",
  "limit": 3
}
```

成功 `data`：`candidates[{title,cost_points,icon_key,wish_type,reason}]`（无 id）。  
App：`aiWishBoardSuggestNext`；UI：空态 / 足迹「下一颗心愿」→ 点选预填新建。

**`POST .../wish-board/insights`**

```json
{
  "balance": 2680,
  "month_earned": 900,
  "active": [{ "title": "周末咖啡", "cost_points": 200, "wish_type": "repeat", "status": "active" }],
  "redeemed": [{ "title": "短途旅行", "cost_points": 3000 }],
  "waiting_gap_avg": 1200,
  "repeat_ratio": 0.6,
  "period_label": "近期"
}
```

成功 `data`：`{ "tips": ["…"] }`（≤5，只读）。  
App：`aiWishBoardInsights`；UI：足迹 / 管理「积分健康度」。  
周复盘联动：本地 `buildWishBoardPeriodDigest` 拼进 `related_digest`，不另开路由。

### 4.8 衣橱

Agent 只出**可确认草稿 / 库内推荐**；创建单品、记录穿着仍走 JWT 业务 API。推荐类 **id 必须 ⊆ 请求摘要**。

**`POST .../wardrobe/parse-item-from-image`**

```json
{
  "image_base64": "...",
  "image_mime_type": "image/png",
  "supplement_text": "可选",
  "category_names": ["外套", "上装", "下装"],
  "option_hints": {
    "colors": ["米色", "藏青"],
    "seasons": ["春夏", "秋冬", "四季"],
    "brands": ["优衣库"],
    "fits": ["宽松", "合身"],
    "warmth": ["薄", "厚"]
  }
}
```

成功 `data`：`name`、`category_hint`、`color`、`season`、`brand`、`fit`、`warmth`、`tags[]`、`art_key?`（须 ∈ App 已有集合）、`confidence`。  
词条尽量映射 `option_hints`；未命中可返回自由文本由用户改。  
App：`parseWardrobeItemFromImage`；UI：创建/编辑单品「AI 填属性」（优先抠图）。

**`POST .../wardrobe/suggest-today`**

```json
{
  "today_ymd": "2026-11-06",
  "season_hint": "秋冬",
  "weather_hint": null,
  "occasion_pref": "通勤",
  "items": [
    {
      "id": "witem_a",
      "name": "米色大衣",
      "category": "外套",
      "color": "米色",
      "season": "秋冬",
      "brand": "优衣库",
      "warmth": "厚",
      "wear_count": 2,
      "last_worn_on": null,
      "tags": ["通勤"]
    }
  ],
  "outfits": [
    { "id": "woutfit_xxx", "name": "周一通勤", "occasion": "通勤", "itemIds": ["witem_a"], "wear_count": 1 }
  ],
  "recently_worn_item_ids": [],
  "recently_worn_outfit_ids": [],
  "seed_item_ids": [],
  "avoid_repeat": true
}
```

成功 `data`：`mode`（`outfit`|`items`）、`outfitId?`、`outfitName?`、`itemIds[]`、`reason`、`alternatives[]`、`avoid_repeat`。  
`mode=outfit` 时 `outfitId` 必填且合法；`mode=items` 时 `itemIds` 必填且全部合法。  
App：`suggestWardrobeToday`；UI：衣橱 Tab Hero「今天穿什么」→ 候选卡 → 打开详情 / 穿这套 / 生成拼图种子。

**`POST .../wardrobe/parse-item-from-text`**

```json
{
  "text": "优衣库米色羊毛大衣 秋冬 L",
  "category_names": ["外套", "上装"],
  "option_hints": { "colors": ["米色"], "seasons": ["秋冬"], "brands": ["优衣库"], "fits": ["宽松"] }
}
```

成功 `data` 同 `parse-item-from-image`。  
App：`parseWardrobeItemFromText`；UI：创建单品「一句话添加」。

**`POST .../wardrobe/suggest-outfit`**

```json
{
  "occasion": "通勤",
  "season_hint": "秋冬",
  "seed_item_ids": ["witem_a"],
  "items": [{ "id": "witem_a", "name": "米色大衣", "category": "外套" }],
  "outfits": [{ "id": "woutfit_x", "name": "周一通勤", "itemIds": ["witem_a"] }],
  "preferences": "偏正式"
}
```

成功 `data`：`itemIds[]`（须 ⊆ 请求；含种子）、`name_hint`、`occasion_hint`、`reason`、可选 `near_outfit_id` / `near_outfit_name`。  
App：`suggestWardrobeOutfit`；UI：搭配 Tab「AI 组一套」/ 单品详情「用它出一套」→ 拼图 `seedItemIds`。

**`POST .../wardrobe/idle-insights`**

```json
{
  "items": [{ "id": "witem_b", "name": "针织衫", "wear_count": 0, "last_worn_on": null }],
  "category_names": ["外套", "上装", "下装"],
  "wear_summary_90d": "近 90 天记录 12 次穿着",
  "limit": 8
}
```

成功 `data`：`idle_item_ids[]`（⊆ 请求）、`capsule_gaps[]`、`tips[]`。只读，不自动删改。  
App：`analyzeWardrobeIdleInsights`；UI：「我的」使用率 / 穿搭统计「闲置洞察」。

**`POST .../wardrobe/wear-comment`**

```json
{
  "subject_name": "米色大衣",
  "subject_kind": "item",
  "occasion": "通勤",
  "weather_hint": "阴凉有风",
  "user_note": "袖子略长"
}
```

成功 `data`：`{ "comment": "…" }`。确认后写入 `wear_logs.note`（经业务 `wear/item` / `wear/outfit`）。  
App：`generateWardrobeWearComment`；UI：穿这件/这套 → 可选短评 Sheet。

**`POST .../wardrobe/similar-items`**

```json
{
  "items": [{ "id": "witem_a", "name": "米色大衣", "category": "外套", "color": "米色" }],
  "target_item_id": "witem_a",
  "target_description": null,
  "image_base64": null,
  "limit": 8
}
```

成功 `data`：`similar[{ item_id, score, reason }]`（id ⊆ 请求且 ≠ 目标）。支持 `target_item_id` / `target_description` / 参考图三选一或组合。  
App：`analyzeWardrobeSimilarItems`；UI：单品详情「找相似」。

### 4.9 任务（P0）

Agent 只出**可确认草稿 / 只读洞察**；创建待办、指派青蛙、写验收仍走 App 现有路径。推荐类 **id 必须 ⊆ 请求摘要**。

**`POST .../task/parse-one-liner`**

```json
{
  "text": "周五前交季度总结，重要紧急，提前一天提醒，每周复盘",
  "today_ymd": "2026-11-06",
  "category_names": ["工作"],
  "tag_names": ["工作", "复盘"]
}
```

成功 `data`：`title`、`note?`、`priority`(0–4)、`due_ymd?`、`schedule`（提醒/重复枚举对齐 App）、`category_hint?`、`tag_hints[]`、`reward_points?`、`confidence`。  
App：`parseTaskOneLiner`；UI：新建独立待办「AI 填入」。

**`POST .../task/suggest-today`**

```json
{
  "today_ymd": "2026-11-06",
  "day_boundary": "00:00",
  "preference": "想先做深度工作",
  "tasks": [
    {
      "id": "tsk_aaa",
      "title": "交季度总结",
      "status": "todo",
      "priority": 4,
      "due_ymd": "2026-11-06",
      "is_overdue": false,
      "is_frog_today": false,
      "tags": ["工作"],
      "has_repeat": false
    }
  ],
  "frog_candidates": [
    { "id": "tsk_aaa", "title": "交季度总结", "kind": "task", "priority": 4, "already_assigned": false }
  ],
  "habits": [
    { "id": "hab_x", "name": "冥想", "kind": "build", "today_count": 0, "daily_goal": 1, "streak": 3 }
  ]
}
```

成功 `data`：`primary_task_ids[]`（≤3）、`frog_task_id?`、`habit_ids[]`、`reason`、`tips[]`。所有 id ⊆ 请求。  
App：`suggestTaskToday`；UI：任务首页「今天先做什么」→ 打开 / 指派青蛙（`frog-assign`）。

**`POST .../task/breakdown`**

```json
{
  "title": "交季度总结",
  "note": "含数据附录",
  "due_ymd": "2026-11-07",
  "project_name": "Q4 复盘",
  "existing_subtask_titles": ["收集指标"],
  "mode": "both",
  "today_ymd": "2026-11-06"
}
```

成功 `data`：`mode`、`subtasks[{ title, priority?, due_ymd_offset? }]`、`acceptance_items[{ text }]`、`reason?`。  
验收项与子任务语义分离；确认后批量 `createTask(parent_task_id=…)` 或写入 `acceptanceChecklist`。  
App：`breakdownTask`；UI：任务详情「AI 拆解」。

### 4.10 任务（P1）

**`POST .../task/parse-schedule`**

```json
{
  "text": "改到下周五，提前一天提醒，每周复盘",
  "today_ymd": "2026-11-06",
  "due_ymd": "2026-11-07",
  "schedule": { "mode": "date", "allDay": true, "reminderOption": "不提前", "repeatOption": "不重复" }
}
```

成功 `data`：`ok`、`due_ymd?`、`schedule`（提醒/重复枚举对齐 App）、`confidence`。无法解析则接口失败，由用户手选。  
App：`parseTaskSchedule`；UI：`schedule-picker`「一句话改」。

**`POST .../task/parse-from-image`**

```json
{
  "image_base64": "<base64>",
  "image_mime_type": "image/jpeg",
  "supplement_text": "都是本周要做的",
  "today_ymd": "2026-11-06"
}
```

成功 `data`：`items[{ title, priority?, due_ymd?, note? }]`（≤20）。图仅请求内传输。  
App：`parseTaskFromImage`；UI：待办列表「拍照建待办」。

**`POST .../task/parse-habit`**

```json
{ "text": "每天晨跑 30 分钟，连续 21 天奖励", "today_ymd": "2026-11-06" }
```

成功 `data`：`name`、`habitKind`(build/break/task)、`daily_goal?`、`reminder?`、`reward_points?`、`rationale_zh?`。  
App：`parseTaskHabit`；UI：`add-habit`「AI 填入」。

**`POST .../task/overview-insights`**

```json
{
  "insight_counts": { "open": 12, "recurring": 3, "doneOrCancelled": 5 },
  "completion_counts_7d": 8,
  "completion_counts_14d": 15,
  "reopen_count": 2,
  "open_tasks": [{ "id": "tsk_aaa", "title": "交季度总结", "status": "todo", "priority": 4, "is_overdue": true }],
  "today_ymd": "2026-11-06"
}
```

成功 `data`：`insights[{ title, body }]`（≤3）、`suggestion`、`focus_task_ids[]`（⊆ 请求）。只读。  
App：`analyzeTaskOverviewInsights`；UI：`tasks-overview`「洞察」。

**`POST .../task/plan-project`**

```json
{
  "project_name": "Q4 复盘",
  "description": "汇总指标并出报告",
  "due_ymd": "2026-12-20",
  "existing_top_titles": ["收集指标"],
  "today_ymd": "2026-11-06"
}
```

成功 `data`：`milestones[{ title, priority?, children_titles[] }]`。确认后批量建任务树；不改项目 status。  
App：`planTaskProject`；UI：项目详情「AI 规划」。

### 4.11 任务（P2）

**`POST .../task/task-comment`**

```json
{
  "title": "交季度总结",
  "note": "卡在数据附录",
  "status": "blocked",
  "subtask_done_ratio": 0.33,
  "overdue_days": 2,
  "today_ymd": "2026-11-06"
}
```

成功 `data`：`comment`（1～2 句下一步建议）。用户确认后可追加到备注。  
App：`analyzeTaskComment`；UI：任务详情 status=`blocked` 或长时间 `doing`「AI 解阻 / 短评」。

**`POST .../task/habit-nudge`**

```json
{
  "today_ymd": "2026-11-06",
  "habits": [
    { "id": "hab_x", "name": "冥想", "kind": "build", "today_count": 0, "daily_goal": 1, "streak": 3 }
  ],
  "bound_task_ids": ["tsk_aaa"]
}
```

成功 `data`：`tips[]`、`habit_ids[]`（⊆ 请求）。只读，不自动打卡。  
App：`analyzeTaskHabitNudge`；UI：小习惯 Tab「补打」。

**`POST .../task/parse-filter`**

```json
{
  "text": "找本周逾期的重要任务",
  "today_ymd": "2026-11-06",
  "tag_names": ["工作", "复盘"]
}
```

成功 `data`：`ok`、`search`、`date_preset`、`priorities[]`、`tag_hints[]`、`long_term`、`entity_scope`、`confidence`。映射到 `TaskListFilterState`；无法解析则失败由用户手选。  
App：`parseTaskFilter`；UI：待办/项目筛选条「AI 筛选」。

复盘「+ 待办」复用 `parse-one-liner` 增强预填（`priority` / `due_ymd` / `schedule` query），见 `enrichReviewTodoPrefill`。

### 4.12 我的页（P0 / P1）

**`POST .../profile/persona-draft`**

```json
{
  "text": "久坐加班，想稳定作息",
  "current_persona": "",
  "mode": "write",
  "gender": "男",
  "lifestyle": "长期静坐不运动",
  "goal": "减脂",
  "dietary_summary": "低糖 · 忌口：油炸"
}
```

`mode`：`write` | `polish` | `shorten`。成功 `data`：`persona_portrait`（≤500 字）、`keyword_hints[]`、`confidence`。  
App：`draftProfilePersona`；UI：编辑资料画像 Tab「AI 写画像 / 润色」→ 预填输入框，**确认保存**后写 `users`。

**`POST .../profile/week-rhythm-insights`**

```json
{
  "week": {
    "habit_check_in_rate_percent": 55,
    "tasks_completed": 4,
    "daily_review_days": 2,
    "weekly_review_done": false
  },
  "road_focus_line": "11 月：固定起床",
  "wish_gap_line": "离心愿还差 120 分",
  "persona_one_liner": "画像已填 · 86 字",
  "today_ymd": "2026-11-06"
}
```

成功 `data`：`insights[{ title, body }]`（≤3）、`suggestion`、`open_hint`（`tasks`|`review`|`life-road`|`wish-board`|null）。只读；非法 `open_hint` App 忽略。  
App：`analyzeProfileWeekRhythmInsights`；UI：我的页「本周节奏」旁「洞察」。

**`POST .../life-road/plan-from-direction`**

```json
{
  "body": "把健康与深度工作做成可重复的节奏",
  "year_theme": null,
  "calendar_year": 2026,
  "existing_node_titles": ["Q3 打基础"],
  "preference": "偏少而硬"
}
```

成功 `data`：`year_theme?`、`nodes[{ kind, title, note?, quarter?, month?, calendar_year?, parent_hint?, acceptance_items[{ text }] }]`（kind 仅 year/quarter/month）。确认后批量 `createLifeRoadNode`（跳过已占槽）；**不**自动建任务。  
App：`planLifeRoadFromDirection`；UI：道路页「AI 拆解方向」。

**`POST .../life-road/acceptance-draft`**

```json
{
  "title": "11 月：固定起床与训练日",
  "note": "工作日优先",
  "kind": "month",
  "existing_acceptance": ["训练日按档案执行不少于 8 次"],
  "direction_body": "把健康与深度工作做成可重复的节奏"
}
```

成功 `data`：`acceptance_items[{ text }]`（增量、去重、≤80 字）。预览勾选后合并进编辑态；**不**自动标 done。  
App：`draftLifeRoadAcceptance`；UI：节点编辑「生成验收」。

**`POST .../life-road/parse-node-update`**

```json
{
  "text": "先暂停，备注改成等肩颈恢复",
  "node": {
    "title": "11 月：固定起床",
    "note": "",
    "kind": "month",
    "status": "on_track",
    "acceptance": ["起床后不做手机 30 分钟"]
  }
}
```

成功 `data`：可选 patch `status` / `title` / `note` / `acceptance_items`。确认后写入编辑态；`arrived` / `dropped` App 二次确认。  
App：`parseLifeRoadNodeUpdate`；UI：节点编辑「一句话更新」。

**`POST .../profile/completeness-nudge`**

```json
{
  "fill_chips": [
    { "key": "persona", "label": "人物画像", "filled": false, "tab": "persona" }
  ],
  "filled_summary": { "persona": false, "dietary": true, "birthday": true, "body": false },
  "completeness_percent": 50
}
```

成功 `data`：`primary_chip`（`persona`|`dietary`|`birthday`|`body`）、`reason`、`example_fill`。只读引导；示例**不**自动写入。  
App：`nudgeProfileCompleteness`；UI：我的页「资料待完善」高亮优先芯片。

**`POST .../life-road/parse-from-image`**

```json
{
  "image_base64": "<base64>",
  "image_mime_type": "image/jpeg",
  "supplement_text": "偏少而硬",
  "calendar_year": 2026
}
```

成功 `data`：`direction_body?`、`year_theme?`、`nodes[]`（同 plan-from-direction 子集）。预览确认后写方向/节点；图不落 Agent 长存。  
App：`parseLifeRoadFromImage`；UI：道路页「拍照导入」。

**`POST .../life-road/suggest-links`**

```json
{
  "focus_node": { "id": "lrn_xxx", "title": "11 月：固定起床", "kind": "month" },
  "candidate_tasks": [{ "id": "tsk_1", "title": "早起不刷手机" }],
  "candidate_habits": [{ "id": "hab_1", "title": "晨间拉伸" }],
  "candidate_projects": [{ "id": "prj_1", "title": "作息重建" }]
}
```

成功 `data`：`suggested_task_ids[]` / `suggested_habit_ids[]` / `suggested_project_ids[]` + `reason`。**只能返回请求里出现过的 id**；App 仅导航或预填新建待办，不在道路表伪造 FK。  
App：`suggestLifeRoadLinks`；UI：道路页「关联执行」。

**`POST .../profile/weight-comment`**（P2）

```json
{
  "points": [{ "ymd": "2026-11-01", "kg": 72.4 }, { "ymd": "2026-11-07", "kg": 71.8 }],
  "goal": "减脂",
  "height_cm": 175
}
```

成功 `data`：`comment`（1～2 句）、可选 `caution`。只读、非医疗；`weight_logs` 仅本机，App 上传近 N 点摘要（≤30）。  
App：`analyzeProfileWeightComment`；UI：我的页「身体数据」卡「短评」。

**`POST .../profile/completion-log-comment`**（P2）

```json
{
  "project_title": "Q4 复盘",
  "archive_summary": "汇总指标并出报告 · 标签：工作",
  "duration_label": "2026-10-01 – 2026-11-06",
  "points_delta": 40,
  "source": "archive"
}
```

成功 `data`：`comment`（一句「这次做成了什么」）。App 可复制或确认后 `createMemo`（标题 `履历短评 · ${project}`）。  
App：`draftProfileCompletionLogComment`；UI：完成履历详情「AI 短评」。

**`POST .../profile/notification-copy`**（P2）

```json
{
  "items": [
    {
      "identifier": "selfapp-habit-reminder:hab_1",
      "fingerprint": "2026-11-07",
      "context_block": "习惯：晨间拉伸今日还未打卡",
      "fallback_title": "还差一次打卡",
      "fallback_body": "今天的拉伸还没做，抽 5 分钟完成。"
    }
  ]
}
```

成功 `data`：`copies[{ identifier, fingerprint, title, body }]`（≤10；`identifier` + `fingerprint` 必须 ⊆ 请求）。  
App 写入 `notificationAiCopyCache`；**登记路径仍只读缓存 + 硬编码兜底**，默认关闭，仅用户显式「立即预热」时批量生成。  
App：`draftProfileNotificationCopy` / `prefetchProfileNotificationCopy`；UI：提醒设置「更自然的通知文案」+「立即预热」。

**`POST .../life-road/period-review`**（P2）

```json
{
  "period": "quarter",
  "calendar_year": 2026,
  "quarter": 4,
  "direction_body": "把健康与深度工作做成可重复的节奏",
  "year_theme": "少而硬的主线",
  "status_counts": { "on_track": 6, "paused": 1, "arrived": 2, "dropped": 0 },
  "arrived_titles": ["11 月：固定起床与训练日"],
  "node_summaries": [
    { "title": "Q4 打通早晨深度块", "kind": "quarter", "status": "on_track" }
  ]
}
```

成功 `data`：`review`、`highlights[]`、可选 `next_theme_draft`（≤40 字）、可选 `open_hint`（`tasks`|`review`|`life-road`|`wish-board`|null）。只读；`next_theme_draft` 须用户确认后才写 `year_theme`。不替代 `weekly-review/coaching`。  
App：`analyzeLifeRoadPeriodReview`；UI：道路页「季末回顾」。

### 4.x 全局助手（L2）

**`POST .../assistant/route`**（P0-2）

请求：`{ text?, image_base64?, image_mime_type?, brief_context?, locale? }`（`text` 与图至少其一）。  
成功 `data`：`reply_text?`、`routed_domains[]`、`cards[]`（ActionCard）。  
App：`aiAssistantRoute` / `runAssistantRoute`；UI：全局悬浮助手输入。

**`POST .../assistant/daily-brief`**（P0-3）

请求：`{ brief_context, locale? }`（App 已算好计数与候选 id）。  
成功 `data`：

```json
{
  "headline": "今天先啃青蛙，饮食蛋白还差一截。",
  "facts": [
    { "domain": "task", "text": "逾期 2 项；青蛙候选「写方案」" },
    { "domain": "health", "text": "蛋白已摄入 42g / 目标 110g" }
  ],
  "cards": []
}
```

约束：`facts` 数字以 `brief_context` 为准；`cards` ≤3；LLM 只写 headline / 卡文案与落地点，失败回退规则卡。Agent 不写库。  
App：`aiAssistantDailyBrief` / `runAssistantDailyBrief`；UI：首页「今日」模块；失败仅展示本地规则 facts。

**`POST .../assistant/turn`**（P1-1）

请求：`{ session_id?, message, history?, brief_context?, pending_cards?, locale? }`（`message` 必填）。  
成功 `data`：`session_id`、`reply_text?`、`cards[]`（可同 id 更新草稿；`needs_confirm` 仍为 true）。  
用途：改草稿（「改成支付宝」「截止改周五」）、澄清追问；无 pending 时内部回落 `route`。Agent 不写库。  
App：`aiAssistantTurn` / `runAssistantTurn`；UI：全局助手有未确认卡时走 turn。

**P1-2 域卡**：`route` / `turn` 可对 finance / food / task / habit / memo / wardrobe / recipe / wish / profile 出 `preview_*`（兑奖仅 `open_route` → 心愿板，禁止确认即兑）。新增确认动作：`preview_recipe`、`preview_profile`。

**`POST .../assistant/compose`**（P2-1）

请求：`{ goal, brief_context, allowed_domains?: string[], locale? }`（`brief_context` 必填；`allowed_domains` 白名单，空则全开）。  
成功 `data`：`reply_text?`、`composed_domains[]`、`cards[]`（≤5；可含多域；复盘建议用 `confirm_action=review_quick_create`，`draft` 对齐 `{ action: memo|project|habit|todo, title, body }`，与 `review-ai-quick-create` / coaching suggestions 同路径）。  
约束：超时或 LLM 失败降级规则卡；禁止编造 id；兑奖等敏感动作永不作为 confirm。  
App：`aiAssistantCompose` / `runAssistantCompose`；UI：全局助手识别「按缺口安排晚上 / 复盘后给三件…」等编排句走 compose，否则仍 route/turn。

**P3 入口与深链（App 侧，非新 Agent 路由）**

| 入口 | 行为 |
|---|---|
| 助手 Sheet 剪贴板按钮 / `zheng://assistant/clipboard` | 读剪贴板图或文 → `openGlobalAssistant` → `route`（确认后写库） |
| iOS 快捷指令「用助手处理」 | pending 图 / 剪贴板标记 → 同上（需 prebuild 刷新 Intent） |
| `zheng://assistant` | 打开全局助手 |
| `zheng://assistant/brief` | 打开首页「今日」简报 + 助手提示（Widget **不**在组件内调 LLM） |
| `zheng://finance` / `tasks` / `profile` / `wardrobe` / `review` | 打开对应 Tab / 页 |
| 会话缓存 | AsyncStorage `@selfapp/assistant_session_v1`，TTL 24h；不进云同步 |

桌面 Widget：已有财务 / 青蛙 / 习惯 / 健康 / 紧急度均挂 `widgetURL(deepLink)`；健康默认 `zheng://assistant/brief?domain=health`。衣橱 / 我的独立 Widget 可按同模式扩展（深链已就绪）。

---

## 5. App 调用约定

优先使用 `lib/ai-api-client.ts` 的 `ai*` 方法，或经 `lib/zhipu-image-parse.ts` 门面（统一错误形态）。

图片请用 `splitImageBase64AndMime` 拆成 `image_base64` + `image_mime_type`。

账单等摘要仍可在 App 本地拼装后 POST；复盘分析请传结构化字段（`review_type` + `dimensions` 等），不要在客户端写写作指令。

---

## 6. 服务端配置（运维）

Agent（`selfAPP_AIAgent`）：

| 变量 | 说明 |
|------|------|
| `API_KEY` | App / 业务后端调用 Agent 的共享密钥 |
| `ZHIPU_API_KEY` | 智谱密钥（优先） |
| `ZHIPU_TEXT_MODEL` | 文本模型，默认 `glm-4-flash` |
| `ZHIPU_VISION_MODEL` | 视觉模型，默认 `glm-4.6v-flash` |

业务后端代调：

| 变量 | 说明 |
|------|------|
| `AGENT_BASE_URL` | Agent 根地址 |
| `AGENT_API_KEY` | 与 Agent `API_KEY` 一致 |
