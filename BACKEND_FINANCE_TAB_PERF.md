# 财务 Tab / 财务模块 — 后端配合清单（APP 已改，请按本文执行）

> 版本：2026-08-19  
> 后端仓库：`self_app_back`  
> 面向：后端开发者  
> 前端 pageKey：`tabs/finance`  
> 前端入口：`screens/finance/FinanceScreen.tsx`  
> 对照文档：`BACKEND_TASKS_TAB_PERF.md`（任务 Tab 已完成的同类改造）  
> **LLM / AI 接口（一句话记账、截图、短评等）本文不覆盖，可后做。**

---

## 一、先看结论（必读）

1. **不要再给财务 Tab / 财务子页做 `GET /api/data/{table}` 通用 List 全量翻页。** APP 首屏与子页读路径已停用该路径。
2. APP 现在只打 **`/api/pages/finance/*` 页面专用接口**。慢、缺字段、余额不对，都要在这些专用接口上修，而不是补 List。
3. **账户余额必须由服务端按全量流水汇总后下发。** APP 本地只缓存近期流水窗口，**禁止**再用不全量流水重算余额。
4. 任一专用接口失败时，APP **只回退本地 SQLite**，**禁止**再降级到 `/api/data/finance_transactions` 等全表 List。

---

## 二、APP 已做的改动（后端对齐用）

财务 Tab 冷启动 / 下拉刷新 **不再**调用：

| 已停用 | 原因 |
|--------|------|
| `syncPageScopeFromApi('tabs/finance')` 串行全量拉 12 张表 | 含 `finance_transactions` 无限增长、以及首页不用的 cash_flow / savings / 遗留 `accounts` |
| `GET /api/data/finance_transactions` 全表翻页 | 首页 / 统计 / 日历 / 资产余额共用，主瓶颈 |
| `GET /api/data/finance_accounts` 等 List 读路径 | 改走 catalog / home |
| `GET /api/data/cash_flow_*` 四表 List | 改走 `/api/pages/finance/cash-flow` |
| 把 `savings_plans` / `savings_plan_deposits` 绑在财务 Tab dirty | 已改绑 `tabs/profile` |

财务 Tab 首屏实际请求（可并行，优先）：

```
GET /api/pages/finance/home?...
```

资产页 / 分类补齐：

```
GET /api/pages/finance/catalog
```

子页：

```
GET /api/pages/finance/recent-days?...          // 首页触底更早流水
GET /api/pages/finance/transactions?start&end... // 统计 / 日历单日
GET /api/pages/finance/daily-summaries?start&end // 日历月网格
GET /api/pages/finance/account-detail?...       // 账户详情
GET /api/pages/finance/cash-flow                // 现金流台账
GET /api/pages/finance/insights?months=6         // 现金流洞察聚合
```

**写入**仍走现有 `POST/PUT/PATCH/DELETE /api/data/{table}`（`finance_transactions` 等），只停 **读路径的 List**。

**禁止**再为上述任一接口失败而降级到 `/api/data/*` List。

---

## 三、通用约定（所有专口共用）

### 鉴权与信封

- 与现有一致：Bearer Token；成功 `code === 0`，业务体在 `data`。
- APP 客户端类型见 `lib/api-client.ts`（`apiGetFinance*`）。

### 行形状（务必对齐，方便 stub）

与 MySQL / APP SQLite 行字段一致（**不要**改成另一套 camelCase 业务 DTO，除下文注明的聚合字段）：

**`finance_accounts` 行 + `balance`（仅专口下发，不落库列）：**

```ts
{
  id, name, account_no, account_type, sign_rule, note,
  created_at, updated_at, sync_status?, extra_data,
  balance: number   // 服务端全量汇总
}
```

**`finance_transactions` 行：**

```ts
{
  id, name, happened_at, account_id, ai_comment,
  transaction_type, // income | expense | transfer
  flow_category_id, amount, note,
  created_at, updated_at, sync_status?, extra_data
}
```

**`finance_flow_categories` / `finance_account_types`：** 与表结构一致。

过滤：响应中不要包含 `sync_status = pending_delete` 或已软删行。

### 余额口径（必须与 APP 一致）

对每个 `account_id`，遍历该账户全部未删除流水：

| `transaction_type` | 对余额影响 |
|--------------------|------------|
| `income` | `+|amount|` |
| `expense` | `-|amount|` |
| `transfer` | 看 `extra_data.transfer_leg`：`out` → `-|amount|`，`in` → `+|amount|`；缺省按实现与 APP `computeTransactionLedgerEffect` 对齐 |

`extra_data` 为 JSON 字符串原样下发。

### 净资产

`netWorth` = 所有账户 `balance` 之和，但排除 `extra_data.exclude_from_total_assets === true`（或 APP 现用同名字段）的账户。

### 收入/支出日汇总（日历）

- **不计转账**。
- `income` = 当日 income 绝对值之和；`expense` = 当日 expense 绝对值之和；`net = income - expense`。

### 时间

- `happened_at` 无时区 DATETIME：按墙上时钟比较，**禁止当 UTC 再加偏移**。
- 逻辑日可用 `dayBoundaryHour` / `dayBoundaryMinute`（与任务 Tab 一致，默认 0/0）。

---

## 四、必须完成的后端工作（按优先级）

### P0（必做）`GET /api/pages/finance/home`

首页冷启动 / 下拉刷新主口。

#### 请求

```
GET /api/pages/finance/home
  ?logicalToday=YYYY-MM-DD
  &dayBoundaryHour=0
  &dayBoundaryMinute=0
  &historyDays=2
  &daysBack=90
  &budgetRefreshDay=1..31
```

| 参数 | 含义 |
|------|------|
| `daysBack` | 默认 **90**。返回流水至少覆盖「今天往前 daysBack 天」∪「当前预算周期 + 上一预算周期」（由 `budgetRefreshDay` 算出） |
| `historyDays` | 列表首屏需要的「有流水的历史日」数量（不含今天），默认 2；这些日的流水必须包含在 `transactions` 里 |
| `budgetRefreshDay` | 预算刷新日（1–31），与 APP 本地设置一致 |

#### 响应

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "accounts": [ /* FinanceAccountBalanceRow[]，含 balance */ ],
    "categories": [ /* FinanceFlowCategoryRow[] */ ],
    "transactions": [ /* 并集去重后的 FinanceTransactionRow[] */ ],
    "historyHasMore": true,
    "netWorth": 12345.67,
    "monthly": { "income": 0, "expense": 0 },
    "meta": {
      "serverTime": "2026-08-19T03:00:00.000Z",
      "logicalToday": "2026-08-19",
      "daysBack": 90,
      "budgetRefreshDay": 1
    }
  }
}
```

| 字段 | 要求 |
|------|------|
| `accounts[].balance` | **全量流水**汇总，不是 daysBack 窗口 |
| `transactions` | 窗口并集；**不要**全表历史 |
| `historyHasMore` | 是否还有早于窗口的流水（供触底） |
| `monthly` | 自然月 income/expense（不含转账）；可选但建议有 |
| `meta.serverTime` | 建议有 |

**不要**为 home 再暴露 `finance_transactions` List。

#### 验收

- [ ] 抓包财务 Tab **没有** `GET /api/data/finance_transactions`
- [ ] 账户卡片余额与改前全量汇总一致
- [ ] 预算卡（约 2 个周期）数字正确
- [ ] 首屏 payload 远小于全表 List

---

### P0（必做）`GET /api/pages/finance/catalog`

资产页、分类、账户类型。

```
GET /api/pages/finance/catalog
```

```json
{
  "accounts": [ /* 含 balance */ ],
  "accountTypes": [ /* finance_account_types */ ],
  "categories": [ /* finance_flow_categories */ ],
  "meta": {
    "serverTime": "...",
    "tablesVersion": {
      "finance_accounts": { "count": 3 },
      "finance_account_types": { "count": 2 },
      "finance_flow_categories": { "count": 10 }
    }
  }
}
```

- [ ] 资产页总资产 / 负债 / 环形图正确，且无流水 List

---

### P0（必做）`GET /api/pages/finance/recent-days`

首页触底加载更早流水。

```
GET /api/pages/finance/recent-days
  ?before=YYYY-MM-DD
  &days=3
  &dayBoundaryHour=0
  &dayBoundaryMinute=0
```

```json
{
  "transactions": [ /* happened 逻辑日 < before 的最近 days 个「有流水日」的全部流水 */ ],
  "historyHasMore": true,
  "meta": { "serverTime": "...", "before": "...", "days": 3 }
}
```

---

### P0（必做）`GET /api/pages/finance/transactions`

统计页、日历点某日、按账户拉流水。

```
GET /api/pages/finance/transactions
  ?start=YYYY-MM-DD
  &end=YYYY-MM-DD
  &accountId=可选
  &page=1
  &limit=200
  &excludeCorrections=true   // 可选：排除 balance_correction
```

```json
{
  "transactions": [ /* FinanceTransactionRow[] */ ],
  "pagination": { "page": 1, "limit": 200, "total": 100, "totalPages": 1 },
  "meta": { "serverTime": "...", "start": "...", "end": "...", "accountId": null }
}
```

约束：

- 统计自定义区间最长约 **731 天**；APP 目前常拉约 800 天窗口再本地筛。
- 单日：`start === end`。
- 有 `accountId` 时只返回该账户流水。
- 必须支持分页；APP 会翻页直到 `totalPages`。

---

### P0（必做）`GET /api/pages/finance/daily-summaries`

财务日历月网格（约 42 天）。

```
GET /api/pages/finance/daily-summaries?start=YYYY-MM-DD&end=YYYY-MM-DD
```

```json
{
  "days": [
    { "day": "2026-08-01", "income": 100, "expense": 50, "net": 50 }
  ],
  "meta": { "serverTime": "...", "start": "...", "end": "..." }
}
```

- 无流水的日期可省略或给 0。
- **转账不计入**。

---

### P0（必做）`GET /api/pages/finance/account-detail`

```
GET /api/pages/finance/account-detail?accountId=...
// 或 accountName=...
```

```json
{
  "account": { /* FinanceAccountBalanceRow 或 null */ },
  "transactions": [ /* 该账户流水；现 UI 期望一次给全历史，可后续再加 month 分页 */ ],
  "meta": { "serverTime": "..." }
}
```

说明：相对全用户全表，按账户过滤已经大幅减负。若单账户流水极大，可后续加 `month=YYYY-MM`；第一期允许一次返回该账户全部历史。

---

### P1 `GET /api/pages/finance/cash-flow`

```
GET /api/pages/finance/cash-flow
```

```json
{
  "profile": { /* cash_flow_profile 一行，id=default */ },
  "incomes": [ /* cash_flow_incomes */ ],
  "holdings": [ /* cash_flow_holdings */ ],
  "expenseLines": [ /* cash_flow_expense_lines */ ],
  "meta": { "serverTime": "..." }
}
```

---

### P1 `GET /api/pages/finance/insights`

现金流页洞察：月汇总 / Top 分类 / 月末净值。**不要**回传 6 个月全量流水。

```
GET /api/pages/finance/insights?months=6
```

```json
{
  "netWorth": 12345.67,
  "monthly": [
    { "key": "2026-03", "income": 0, "expense": 0, "net": 0 }
  ],
  "categoryTop": [
    { "categoryId": "...", "name": "餐饮", "amount": 100 }
  ],
  "monthEndNetWorth": [
    { "key": "2026-03", "netWorth": 10000 }
  ],
  "meta": { "serverTime": "...", "months": 6 }
}
```

---

## 五、余额与流水窗口（防踩坑）

| 场景 | 服务端必须 | APP 行为 |
|------|------------|----------|
| 账户卡片 / 资产 / 净资产 | `balance` / `netWorth` 基于 **全量**流水 | 写入余额缓存，不全量重算 |
| 首页列表 / 预算 | 约 90 天 ∪ 预算两周期 | 本地只存窗口 |
| 本地新记账 | 写路径仍走 `/api/data` | APP 对缓存 `balance` 做 delta |

**错误示范**：home 只返回近 90 天流水，却让 APP 用这 90 天重算余额 → 余额错误。

---

## 六、明确不要做的事

| 不要做 | 原因 |
|--------|------|
| 优化 / 继续提供财务读路径的 `GET /api/data/finance_transactions` 全表 | APP 已切断 |
| 首页失败再降级 List | 会重新拖死首屏 |
| 把 `savings_plans` 塞进财务 home | 攒钱在画像/心愿；APP 已解绑 |
| 为日历再 List 全表再聚合 | 用 `daily-summaries` |
| 在专口里塞 AI 分析 | LLM 另议 |

---

## 七、抓包验收清单

财务 Tab 冷启动 / 下拉刷新 **不应**再出现：

- [ ] `GET /api/data/finance_transactions`
- [ ] `GET /api/data/finance_accounts`
- [ ] `GET /api/data/finance_flow_categories`
- [ ] `GET /api/data/finance_account_types`
- [ ] `GET /api/data/accounts` / `account_transactions`
- [ ] `GET /api/data/savings_plans` / `savings_plan_deposits`
- [ ] `GET /api/data/cash_flow_profile` / `cash_flow_incomes` / `cash_flow_holdings` / `cash_flow_expense_lines`

**应**出现（视打开页面）：

- [ ] `GET /api/pages/finance/home`
- [ ] `GET /api/pages/finance/catalog`（资产等）
- [ ] `GET /api/pages/finance/daily-summaries`（日历）
- [ ] `GET /api/pages/finance/transactions?...`（统计 / 日历日）
- [ ] `GET /api/pages/finance/account-detail?...`
- [ ] `GET /api/pages/finance/cash-flow`
- [ ] `GET /api/pages/finance/insights?...`（洞察）

---

## 八、建议实现顺序（后端）

1. **catalog** + **home**（含 balance / netWorth）→ 财务 Tab 与资产可测  
2. **transactions** + **daily-summaries** → 统计 + 日历  
3. **account-detail** + **recent-days**  
4. **cash-flow** + **insights**  
5. 压测：万级流水下 home / transactions 延迟与 payload 大小  

Stub 建议：第一期可用 SQL `SUM` + `WHERE happened_at BETWEEN` 实现窗口；余额单独 `SUM` 全表（可加账户维物化/缓存）。

---

## 九、APP 代码索引（联调）

| 区域 | 路径 |
|------|------|
| 专口 HTTP | `lib/api-client.ts` → `apiGetFinance*` |
| 专口灌库 | `lib/finance-page-api.ts` |
| 余额缓存 | `lib/finance-account-balance-cache.ts` |
| 停 List scope | `lib/page-api-scope.ts`（`tabs/finance` → `[]`） |
| 首页 | `screens/finance/FinanceScreen.tsx` |
| 统计 / 日历 / 资产 / 账户详情 | `app/(finance)/finance-stats.tsx` 等 |
| 现金流 | `lib/repositories/cash-flow/cash-flow.ts`、`screens/finance/cash-flow/*` |

---

## 十、与任务 Tab 的一致性

财务改造与任务 Tab 同一原则：

> **页面要什么，专用接口给什么；通用 List 不再作为读权威源。**

任务已完成专口迁移；财务按本文补齐后，两端读模型一致，后续可再统一增量游标（`updatedSince`）——**但第一期不要用「全表 List + updatedSince」冒充专口。**
