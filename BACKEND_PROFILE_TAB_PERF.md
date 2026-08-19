# 我的 Tab / 画像模块 — 后端配合清单（APP 已改，请按本文执行）

> 版本：2026-08-19  
> 后端仓库：`self_app_back`  
> 面向：后端开发者  
> 前端 pageKey：`tabs/profile`  
> 前端入口：`screens/profile/ProfileScreen.tsx`  
> 对照文档：`BACKEND_TASKS_TAB_PERF.md`、`BACKEND_FINANCE_TAB_PERF.md`、`BACKEND_REVIEW_TAB_PERF.md`（同类改造）

---

## 一、先看结论（必读）

1. **不要再给「我的」Tab 做 `GET /api/data/{table}` 通用 List 全量翻页。** APP 读路径已停用该路径。
2. APP 现在只打 **`/api/pages/profile/*` 页面专用接口**。慢、缺字段、预览不对，都要在这些专用接口上修，而不是补 List。
3. Tab 冷启动 **只应拉 home 专口**（用户 + 愿景 + 心愿预览 ≤12 条），**禁止**把健康记录、备忘、积分流水等 15 张表串行全量同步。
4. 任一专用接口失败时，APP **只回退本地 SQLite**，**禁止**再降级到 `/api/data/*` List。

---

## 二、APP 已做的改动（后端对齐用）

「我的」Tab 冷启动 / 下拉刷新 **不再**调用：

| 已停用 | 原因 |
|--------|------|
| `syncPageScopeFromApi('tabs/profile')` 串行全量拉 15 张表 | 含 `health_records`、`memos`、`points_ledger` 等首页不用的大表 |
| `GET /api/data/health_records` | 归属健康 Tab，与「我的」首页无关 |
| `GET /api/data/memos` / `memo_dimensions` | 改走 `memo-list` 专口（进子页才拉） |
| `GET /api/data/points_ledger` / `wish_board_items` | 改走 `wish-board` 专口 |
| `GET /api/data/savings_plan_deposits` 等 | 改走 `wish-list` 专口 |
| `GET /api/data/recipe_*` | 改走 `recipes` 专口（进菜谱页才拉） |

「我的」Tab 首屏实际请求：

```
GET /api/pages/profile/home?wishPreviewLimit=12
```

子页（进入时才拉）：

```
GET /api/pages/profile/wish-list
GET /api/pages/profile/memo-list
GET /api/pages/profile/vision-wall
GET /api/pages/profile/wish-board
GET /api/pages/profile/recipes
```

**写入**仍走现有 `POST/PUT/PATCH/DELETE /api/data/{table}`，只停 **读路径的 List**。

**禁止**再为上述任一接口失败而降级到 `/api/data/*` List。

---

## 三、通用约定（所有专口共用）

### 鉴权与信封

- 与现有一致：Bearer Token；成功 `code === 0`，业务体在 `data`。
- APP 客户端类型见 `lib/api-client.ts`（`apiGetProfile*`）。

### 行形状（务必对齐）

与 MySQL / APP SQLite 行字段一致（**不要**改成另一套 camelCase 业务 DTO）：

**`users`：**

```ts
{
  id, name, avatar_uri, persona_portrait, gender, lifestyle, goal,
  workout_days, rest_days, birthday,
  height, weight, age,
  created_at, updated_at, sync_status?, extra_data?
}
```

**`visions` / `wish_items` / `goal_dimensions` / `memo_dimensions` / `memos` / `savings_plans` / `savings_plan_deposits` / `points_wallet` / `wish_board_items` / `points_ledger` / `recipe_categories` / `recipe_items`：** 与现有表结构字段名一致，原样下发。

过滤：响应中不要包含 `sync_status = pending_delete` 或已软删行。

### 时间

- `created_at` / `updated_at` 无时区 DATETIME：按墙上时钟比较，**禁止当 UTC 再加偏移**。

---

## 四、必须完成的后端工作（按优先级）

### P0（必做）`GET /api/pages/profile/home`

Tab 冷启动 / 下拉刷新主口。一次返回默认用户 + 全部愿景 + 心愿预览。

#### 请求

```
GET /api/pages/profile/home
  ?wishPreviewLimit=12          // 可选，默认 12
```

#### 响应

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "user": { /* users 默认用户一行，或 null */ },
    "visions": [ /* visions 全表（通常体量小） */ ],
    "wishPreview": [ /* 未完成心愿，按 APP 排序后取前 N 条 */ ],
    "meta": {
      "serverTime": "2026-08-19T09:00:00.000Z",
      "wishPreviewLimit": 12
    }
  }
}
```

| 字段 | 要求 |
|------|------|
| `user` | 默认用户一行；无则 `null`，不要 404 |
| `visions` | 首页轮播需要全部愿景行（含 `extra_data`） |
| `wishPreview` | **仅未完成**心愿；排序：`desire_level DESC, price DESC, updated_at DESC`；条数 ≤ `wishPreviewLimit` |
| `wishPreview` 别名 | APP 也接受 `wishItems`，但请优先用 `wishPreview` 表示「预览子集」 |

**不要**在 home 里附带：健康记录、备忘、积分流水、攒钱明细、菜谱。

#### 验收

- [ ] 抓包「我的」Tab **没有** `GET /api/data/health_records` / `memos` / `points_ledger` 等
- [ ] 首屏愿景轮播、心愿预览与改前一致
- [ ] 响应体积远小于「15 表全量 List JSON」

---

### P1（必做）`GET /api/pages/profile/wish-list`

心愿清单子页（含攒钱关联）。

```
GET /api/pages/profile/wish-list
```

```json
{
  "code": 0,
  "data": {
    "wishItems": [ /* wish_items 全表（该页需要完整清单） */ ],
    "savingsPlans": [ /* savings_plans 活跃计划 */ ],
    "savingsDeposits": [ /* savings_plan_deposits 全表或按活跃计划过滤 */ ],
    "meta": { "serverTime": "..." }
  }
}
```

| 项 | 要求 |
|----|------|
| 体量 | 心愿表通常小于健康/备忘；可全量，但 **禁止** 在 Tab 冷启动拉 |
| 攒钱 | 子页「存款总览」依赖 plans + deposits |

---

### P1（必做）`GET /api/pages/profile/memo-list`

备忘录列表子页。

```
GET /api/pages/profile/memo-list
```

```json
{
  "code": 0,
  "data": {
    "dimensions": [ /* memo_dimensions */ ],
    "memos": [ /* memos 全表（含 body 富文本） */ ],
    "meta": { "serverTime": "..." }
  }
}
```

| 项 | 要求 |
|----|------|
| 使用场景 | 仅用户打开备忘列表时拉，**不要**绑在 Tab home |
| `body` | 原样下发字符串，不要服务端改写富文本结构 |

后续若单用户备忘极大，可加 `updatedSince` 增量；第一期允许全量，但 **仅限 memo-list 专口**。

---

### P1（必做）`GET /api/pages/profile/vision-wall`

愿景墙 / 目标维度子页。

```
GET /api/pages/profile/vision-wall
```

```json
{
  "code": 0,
  "data": {
    "user": { /* 可选，供 AI 评估展示昵称 */ },
    "visions": [ /* visions 全表 */ ],
    "goalDimensions": [ /* goal_dimensions 全表 */ ],
    "meta": { "serverTime": "..." }
  }
}
```

| 项 | 要求 |
|----|------|
| `goalDimensions` | 别名 `dimensions` APP 也接受 |
| 不要 | 在 home 重复拉 goal_dimensions（home 轮播不需要） |

---

### P1（必做）`GET /api/pages/profile/wish-board`

积分看板子页。

```
GET /api/pages/profile/wish-board
```

```json
{
  "code": 0,
  "data": {
    "pointsWallet": [ /* points_wallet 行，通常 1 条 */ ],
    "items": [ /* wish_board_items 活跃项 */ ],
    "pointsLedger": [ /* points_ledger；含 wish_redeem 兑换记录 */ ],
    "meta": { "serverTime": "..." }
  }
}
```

| 字段别名 | APP 兼容 |
|----------|----------|
| `pointsWallet` / `wallet` | 均可 |
| `items` / `wishBoardItems` | 均可 |
| `pointsLedger` / `ledger` | 均可 |

**不要**在 Tab home 拉积分流水。

---

### P2（必做）`GET /api/pages/profile/recipes`

我的菜谱子页。

```
GET /api/pages/profile/recipes
```

```json
{
  "code": 0,
  "data": {
    "categories": [ /* recipe_categories */ ],
    "items": [ /* recipe_items；别名 recipes */ ],
    "meta": { "serverTime": "..." }
  }
}
```

---

## 五、明确不要做的事

| 不要做 | 原因 |
|--------|------|
| 继续依赖 `GET /api/data/*` 全表给「我的」Tab 冷启动 | APP 已切断 |
| 在 home 返回 `health_records` | 归属健康 Tab |
| 在 home 返回 `memos` / `points_ledger` | 体积大且首页不用 |
| 失败时让 APP 降级 List | 只回退本地 |
| 把 15 表 bootstrap 塞回 profile | 与专口改造相反 |

旧 List 接口可保留给管理端 / 其它工具，**不要作为「我的」Tab 的读模型**。

---

## 六、建议的服务端实现要点

1. **home**：三表查询并行 — `users` LIMIT 1、`visions` 全量、`wish_items` WHERE 未完成 ORDER BY + LIMIT。
2. **索引**（若未建）：
   - `wish_items(user_id, updated_at)`
   - `memos(user_id, dimension_id, updated_at)`
   - `points_ledger(user_id, created_at)`
   - `savings_plan_deposits(user_id, savings_plan_id)`
3. 所有专口继续 gzip；单接口超时目标 **2s 内**（`memo-list` / `wish-list` 数据量大时可略放宽，但仍应分页或增量规划）。
4. 子页专口与 Tab home **解耦**：用户未打开子页时不应预拉。

---

## 七、联调验收清单（前后端一起勾）

抓包「我的」Tab 冷启动，**不应出现**：

- [ ] `GET /api/data/health_records`
- [ ] `GET /api/data/app_settings`（画像路径）
- [ ] `GET /api/data/memos` / `memo_dimensions`
- [ ] `GET /api/data/points_ledger` / `wish_board_items`
- [ ] `GET /api/data/savings_plans` / `savings_plan_deposits`
- [ ] `GET /api/data/recipe_categories` / `recipe_items`
- [ ] 15 表串行 List 任意组合

**应出现**：

- [ ] `GET /api/pages/profile/home?wishPreviewLimit=12`

打开子页：

- [ ] 心愿清单 → `GET /api/pages/profile/wish-list`
- [ ] 备忘录 → `GET /api/pages/profile/memo-list`
- [ ] 愿景墙 → `GET /api/pages/profile/vision-wall`
- [ ] 积分看板 → `GET /api/pages/profile/wish-board`
- [ ] 我的菜谱 → `GET /api/pages/profile/recipes`

功能：

- [ ] 他端改心愿后，本机下拉「我的」预览更新
- [ ] 弱网：专口失败时 APP 回退本地缓存，不转去打 List

---

## 八、接口与代码索引

| 端 | 路径 |
|----|------|
| 后端（建议） | `self_app_back/src/routes/pages.ts` |
| 前端 HTTP | `lib/api-client.ts` → `apiGetProfile*` |
| 前端灌库 | `lib/profile-page-api.ts` |
| 前端 Tab | `screens/profile/ProfileScreen.tsx` |
| 停 List scope | `lib/page-api-scope.ts`（`tabs/profile` 已返回空表列表） |
| 子页 | `app/(profile)/wish-list.tsx`、`memo-list.tsx`、`vision-wall.tsx`、`wish-board.tsx` |
| 菜谱 | `app/(health)/my-recipes.tsx` |

---

## 九、改造前后对比（给后端排期）

| 场景 | 改造前 | 改造后 |
|------|--------|--------|
| Tab 冷启动 | 15 表串行 `/api/data/*` List | 1 个 `profile/home` |
| 首屏无效流量 | ~12 张表首页不用 | 0 |
| 最慢瓶颈 | `health_records` / `memos` / `points_ledger` | 已移出冷启动 |
| 子页 | 依赖 Tab 预灌全表 | 进子页才打对应专口 |

有问题对字段名时：保持本文 query / JSON 字段名，只补缺失数组和排序口径，避免 APP 再改契约。
