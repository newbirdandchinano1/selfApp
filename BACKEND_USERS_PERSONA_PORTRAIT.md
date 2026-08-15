# users 表 — 人物画像字段改动说明（后端）

> 版本：2026-08-15  
> 前端仓库：`selfApp`  
> 面向：后端开发者（`self_app_back`）  
> 关联：编辑个人资料页 / 「我的」页用户资料同步

---

## 一、改动摘要

前端已调整个人资料交互：

1. **「我的」页**：不再展示头像与姓名，仅保留体征数据（身高 / 体重 / BMI / 年龄）与「编辑个人信息」入口。
2. **编辑个人资料页**：去掉头像选择；新增 **人物画像**（自我介绍大文本框，最多 **500** 字）。
3. **数据同步**：通过现有通用表接口读写 `users`（主键 `id = 'default'`），需在 MySQL `users` 表增加字段 `persona_portrait`。

`avatar_uri`、`name` 等历史字段可保留兼容；前端编辑页不再更新 `avatar_uri`。

---

## 二、数据库变更（必须）

在 MySQL `users` 表增加可空文本列：

```sql
ALTER TABLE users
  ADD COLUMN persona_portrait TEXT NULL
  COMMENT '人物画像/自我介绍，客户端限制最多 500 字'
  AFTER avatar_uri;
```

若项目使用迁移脚本，请新增等价 migration，并在部署后执行。

### 字段约定

| 字段 | 类型建议 | 可空 | 默认 | 说明 |
|------|----------|------|------|------|
| `persona_portrait` | `TEXT` 或 `VARCHAR(500)` | 是 | `NULL` | 用户自我介绍；空字符串可规范为 `NULL` |

**服务端校验建议（推荐）：**

- 写入时若非空，按 Unicode 字符计长度，`LENGTH` / 字符数 ≤ **500**。
- 超长返回 `400`，错误信息建议：`persona_portrait 最多 500 字`。
- 允许 `null` 或省略该字段（PATCH/部分更新场景下表示不修改；全量 PUT 时以客户端提交为准）。

若使用 `VARCHAR(500)`，请确认字符集为 `utf8mb4`，避免中文被截断。

---

## 三、API 行为（沿用现有 `/api/data/users`）

前端仍走通用 CRUD，**无需新开独立路由**，但响应与写入 payload 需包含新字段。

### 3.1 读取

```
GET /api/data/users/default
Authorization: Bearer <token>
```

响应示例（节选）：

```json
{
  "id": "default",
  "name": "默认用户",
  "avatar_uri": null,
  "persona_portrait": "我喜欢早起跑步，工作节奏偏紧凑……",
  "gender": "男",
  "lifestyle": "健身",
  "goal": "减脂",
  "workout_days": "[\"周一\",\"周三\",\"周五\"]",
  "rest_days": "[\"周二\",\"周四\",\"周六\",\"周日\"]",
  "birthday": "1995-03-12",
  "height": 175,
  "weight": 70,
  "age": 31,
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-08-15T02:00:00.000Z",
  "sync_status": "synced"
}
```

列表接口 `GET /api/data/users` 返回的每一行同样应带上 `persona_portrait`（无数据时为 `null`）。

### 3.2 写入 / 更新

客户端本地更新后，通过既有同步机制推送，例如：

```
PUT /api/data/users/default
PATCH /api/data/users/default
```

或批量 upsert / 增量同步中的 `users` 行。

写入 body 示例（节选）：

```json
{
  "id": "default",
  "name": "默认用户",
  "persona_portrait": "一段不超过五百字的自我介绍……",
  "gender": "女",
  "lifestyle": "长期静坐不运动",
  "goal": "无",
  "workout_days": "[]",
  "rest_days": "[]",
  "birthday": "1998-08-08",
  "height": 162,
  "weight": 52,
  "age": 27
}
```

**注意：**

- 若服务端有字段白名单 / schema 校验，请把 `persona_portrait` 加入允许列表。
- 若有 ORM / DTO / OpenAPI / Zod / Joi 模型，同步增加该字段。
- 备份、还原、管理后台用户详情若投影了 `users` 列，建议一并带上该字段。

---

## 四、兼容与回滚

| 场景 | 建议 |
|------|------|
| 旧客户端 | 不读不写该字段；后端返回 `null` 即可 |
| 新客户端 + 旧后端（未加列） | 写入会失败或字段被丢弃；**必须先部署 DB/API 再发客户端** |
| 回滚前端 | 保留 DB 列无害；可暂不删除 |

**推荐发布顺序：** 执行 `ALTER TABLE` → 部署后端（白名单/校验）→ 发布 App。

---

## 五、验收清单

- [ ] `users` 表存在 `persona_portrait` 列
- [ ] `GET /api/data/users/default` 响应含 `persona_portrait`
- [ ] `PUT/PATCH`（或同步推送）可写入并持久化该字段
- [ ] 超过 500 字时服务端拒绝或截断策略与产品一致（前端已截断至 500）
- [ ] 字段白名单 / schema / 备份导出已更新

---

## 六、前端字段名（对照）

| UI 文案 | JSON / DB 字段 | 约束 |
|---------|----------------|------|
| 人物画像 / 自我介绍 | `persona_portrait` | 最多 500 字，可空 |

请勿使用已废弃的本地表 `persona_portrait_cache`；人物画像现为 `users` 表上的普通用户字段。
