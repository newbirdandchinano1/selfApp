# 小郑的自我修养

Expo Router + React Native 自我管理应用（健康 / 任务 / 财务 / 复盘 / 我的）。

## 开发

```bash
npm install
npx expo start
```

自定义原生模块需使用 development build（`expo-dev-client`），不可依赖 Expo Go。

### 本地原生模块

| 包名 | 作用 |
|---|---|
| `zheng-background` | 后台保活 / 切后台（自动记账） |
| `zheng-vision-cutout` | iOS Vision 人像抠图 → 透明 PNG（仅实机） |

侧边栏 **系统管理 → Vision 抠图测试** 可联调选图与抠图。改 Swift 后需 `npx expo run:ios` 重编；模拟器上人像分割通常不可用。

## 常用命令

- `npm run android` / `npm run ios` — 本地原生运行
- `npm run lint` — ESLint
- `npm run test:memo-richdoc` — 备忘录 RichDoc 契约 / 往返 / 边界单测

## 备忘录 RichDoc（镜像同步）

权威层在 `lib/memo-richdoc/`。桌面必须保持**字节级同源拷贝**：

`selfAPP_destop/src/renderer/src/shared/domain/memo-richdoc/`

**改一处必须同步另一处。** 存储是 versioned JSON（`selfapp-richdoc`），不是 HTML / 旧 markup。旧 markup 仅读兼容（`legacy.ts`）。保存出口一律 `serialize` / `serializeEditModelToBody`。

## 任务页 UI（对齐设计稿）

对照 `任务APP-设计稿.html` 的近期修正：

1. **完成热力选中**：`HeatBloomCell` 用纸色内垫 + pond/sun 外环（对应 `.hcell.sel` 双环），不再用大面积半透明填充，避免黑影。
2. **待办窗格**（shot 06）：左圆形勾选 · 中文案 · 右状态标签 / 更多；快捷输入收拢 180ms；新建行高亮；「⋯」展开行下操作抽屉（升级 / 搁置 / 删除）；长按 420ms 预选入格。
3. **青蛙周日程**：三天课表按类型分色（青蛙深绿 / 习惯虚线浅绿 / 待办琥珀 / 项目灰绿）；窄时间轴与 `M/D 周X` 日头；「今日」缩放用色块行（`.dl-block`）+ 预选空档呼吸 + `todayfoot` 已用/空闲；底部 `sc-foot` 入格统计。
4. **格内详情 · 完成确认**（shot 04）：底栏 380ms 上滑、青蛙跳一次、四宫格动作、完成前 340ms 确认弹窗（积分 / 热力说明）。
5. **任务日历**（shot 09）：月历语义四色圆点（蛙/办/习/项）、点日展开明细、换月标题 120ms 淡出；本月概览数字滚动。
6. **新建 / 编辑待办**（shot 11）：折页表单卡、四象限 220ms 选中、自动入格弹簧开关（条件不足回弹）、条件预览展开、底栏创建。

## 财务 · 储蓄目标

`FinanceSavingsGoalBlock`：设定目标金额与日期后，卡片右侧主数字展示 **每日需存**（缺口 ÷ 剩余天数，含定时预扣抬高）；副文案为当前/目标进度与倒计时；可选展示服务端「预测可存」。

## 同步注意（app_settings）

增量上传会把超长**实体 id**缩短到 36 字符（`lib/api-mysql-id.ts`），但 **`app_settings` / `app_meta` 的 `key` 是业务语义键（库侧 VARCHAR(255)），禁止缩短**。否则本地仍是长 key、上传用短 key，`markLocalRowsSynced` 会更新 0 行并死循环推送。`setAppSetting` 在值未变时直接跳过，避免迁移标记等被反复写脏。

## AI

App **不直连**智谱。场景请求经 `lib/ai-api-client.ts` → **Agent** `/api/v1/ai/*`（Key 仅存 `selfAPP_AIAgent`；App 持共享 `X-API-Key`）。  
备忘落库点评仍走业务后端 `POST /api/app/memos/:id/ai-review`（后端代调 Agent）。  
配置：`lib/agent-config.ts`（`EXPO_PUBLIC_AGENT_BASE_URL` / `EXPO_PUBLIC_AGENT_API_KEY`）。  
门面：`lib/zhipu-image-parse.ts`。接口清单见 [AI_API.md](./AI_API.md)。

## 复盘（折页）

- **排版规范（日 / 周 / 月共用）**（`lib/review-day-facts.ts`）：区块用【】、列表用「· 」、块间空行。健康只写摄入汇总（+ 体重），不含逐条记录 / AI 点评；任务分【任务（青蛙）】【待办】【小习惯】并列出未完成；财务为周期汇总 + 流水。日复盘「一键写入」；周/月空栏 rollup 时健康/任务/财务优先写结构化周期事实（`rollupWeekly*` / `rollupMonthly*`），日常/缺陷/新想法仍拼接子周期原文。
- **完成门禁**：当日模板全部维度格子写完后才发放日复盘积分（`review-points-grant`），且才允许打开 / 生成 AI 复盘分析。
- **AI 入口**：日复盘维度预览下方底部展示「AI 复盘分析」大按钮（写完全部维度后可生成）；更多菜单同入口须等系统 Alert 关闭后再开 Modal（避免 Android 卡住）。客户端传 `review_type` + 维度原文，并附带拼好的 `user_prompt`（兼容线上仍只认该字段的旧 Agent）；角色与日/周/月策略写在 `selfAPP_AIAgent` 的 `review_prompts.py`。云端失败时**不**做本地模板兜底，直接失败提示。部署新版 Agent 后可逐步去掉对 `user_prompt` 的依赖。
- **反哺执行**：缺陷 / 新想法维度详情与 AI 分析页提供快捷入口（新建备忘 / 项目 / 小习惯 / 待办），见 `components/review/review-action-feed.tsx`。
