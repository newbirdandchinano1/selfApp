# selfApp AI 接口说明（App 端）

> 版本：2.0.0  
> 更新日期：2026-10-29  
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
| 3 | POST | `/api/v1/ai/food/nutrition-from-image` | 拍照识营养 |
| 4 | POST | `/api/v1/ai/food/daily-targets` | 日摄入目标估算 |
| 5 | POST | `/api/v1/ai/finance/parse-one-liner` | 一句话记账 |
| 6 | POST | `/api/v1/ai/finance/parse-one-liner-from-image` | 截图记账 |
| 7 | POST | `/api/v1/ai/finance/txn-comment` | 流水短评 |
| 8 | POST | `/api/v1/ai/finance/bill-summary-analysis` | 账单统计分析 |
| 9 | POST | `/api/v1/ai/finance/dashboard-analysis` | 财务仪表盘分析 |
| 10 | POST | `/api/v1/ai/finance/cash-flow-analysis` | 现金流分析 |
| 11 | POST | `/api/v1/ai/memo/review` | 备忘点评（不落库） |
| 12 | POST | `/api/app/memos/:id/ai-review` | 备忘点评并写库（业务后端 → Agent） |
| 13 | POST | `/api/v1/ai/weekly-review/coaching` | 周复盘教练文案 |

> 上表以外的 AI 场景（心愿、项目点评、缺点、目标墙、技能等）**当前 Agent 未提供路由**，本文不再描述。

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

**`POST .../food/daily-targets`**

```json
{ "context_block": "用户档案与近七日摄入摘要…" }
```

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

### 4.4 备忘

**`POST .../ai/memo/review`**（纯分析，走 Agent）

```json
{ "memo_context_text": "…" }
```

返回 `evaluation`、`suggestions`。

**`POST /api/app/memos/:id/ai-review`**（业务后端，JWT）

对指定备忘分析并写入 `ai_evaluation` / `ai_suggestions` / `ai_review_at`（后端内部代调 Agent）。

### 4.5 周复盘

**`POST .../weekly-review/coaching`**

```json
{ "user_prompt": "本周复盘上下文…" }
```

返回 `{ "text": "…" }`。

---

## 5. App 调用约定

优先使用 `lib/ai-api-client.ts` 的 `ai*` 方法，或经 `lib/zhipu-image-parse.ts` 门面（统一错误形态）。

图片请用 `splitImageBase64AndMime` 拆成 `image_base64` + `image_mime_type`。

摘要拼装（如账单摘要、复盘 prompt）仍在 App 本地完成，只把文本 POST 给 Agent。

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
