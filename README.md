# 小郑的自我修养

Expo Router + React Native 自我管理应用（健康 / 任务 / 财务 / 复盘 / 我的）。

侧边栏 **个人管理 → 我的衣柜** 路由为 `/my-wardrobe`，UI 对齐根目录设计稿 `衣橱-UI重构.html`（纸色 / 松绿 / 琥珀 ATELIER 风格）：衣橱 / 搭配 / 我的三 Tab、底栏 Dock、FAB 添加菜单、搜索、底栏 Sheet 详情与布局切换；左上角上下文按钮在搭配 Tab 打开「管理场合」，穿搭统计 Sheet 进度条带 growX 入场。

**排印（必须与设计稿同字族）**：`constants/wardrobe-theme.ts` + `components/wardrobe/use-wardrobe-fonts.ts`。Native 经 `expo-font` 加载 **Noto Serif SC / Noto Sans SC / Roboto Mono**（字重烤进 `fontFamily`，禁止再叠 `fontWeight`，否则 Android 会回退成系统默认字体）；Web 使用与 HTML 相同的 CSS 字族栈。设计稿已挂 Google Fonts，保证浏览器预览与 App 所见一致。演示数据在 `components/wardrobe/`，尚未接真实库存。

**近期 UI 对齐**：Hero「今天穿什么?」琥珀斜体问号（半角 + Georgia / Android skew，避免顶裁切）；搭配 / 我的页「自己」「衣橱」斜体 + 琥珀底划（`page-title-ital.tsx`，各端 skew 模拟）；周历下方常驻预留 tip 槽位，避免 tip 盖住「本周穿搭」卡。

**Tab 连点**：`wardrobe-screen` 用切换代数 + 停掉上一轮 `Animated` 再开新过渡，完成时强制 `enterX/enterOp` 归位，避免快速切换卡在 `translateX:26`（整体偏右、左侧空白）；设计稿 `衣橱-UI重构.html` 同步修了 leaving 定时器竞态与 `.active` 优先级。

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

侧边栏 **系统管理 → Vision 抠图测试** 可联调选图与抠图。改 Swift 后需重新打 **development 原生包**（Windows 上用 EAS：`npx eas build --profile development --platform ios`）并装到真机；仅 `npx expo start` 热更新 JS **不会**带上新原生模块。模拟器上人像分割通常不可用。

本地 Expo Module 必须带 `ios/*.podspec`，否则 iOS autolinking 会丢弃该模块（表现为测试页「模块已链入=否」）。

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
3. **青蛙周日程**：三天课表按类型分色（青蛙深绿 / 习惯虚线浅绿 / 待办琥珀 / 项目灰绿）；窄时间轴与 `M/D 周X` 日头；「今日」缩放用色块行（`.dl-block`）+ 预选空档呼吸 + `todayfoot` 已用/空闲；底部 `sc-foot` 入格统计。过期未完成独立待办继续虚拟入格；过期未完成青蛙滞留今日全天；过期未完成默认置顶；最简态焦点覆盖全天/跨格块。
4. **格内详情 · 确认弹窗**（shot 04）：底栏 380ms 上滑、青蛙跳一次、四宫格动作；完成 / 取消指派 / 移除本格段均用片内确认（积分·热力或危险色说明）。禁止在详情 Sheet（RN Modal）上再叠 `AppDialogHost`（也是 Modal），否则 Android 触摸层卡死；确认后先关 Sheet，父级 `runAfterUiSettles` 再写库。
5. **任务日历**（shot 09）：月历语义四色圆点（蛙/办/习/项）、点日展开明细、换月标题 120ms 淡出；本月概览数字滚动。
6. **新建 / 编辑待办**（shot 11）：折页表单卡、四象限 220ms 选中、自动入格弹簧开关（条件不足回弹）、条件预览展开、底栏创建。

## 项目完成条件 ↔ 小习惯

- 数据：`projects.extra_data.completion_habit_ids`（`lib/repositories/projects/project-completion-habits.ts`）。
- 口径：养成 `buildHabitCycle.completedAt` / 戒除 `breakHabitCycle.completedAt`（须已设周期目标）；**不是**当日打卡。任务型周期习惯不纳入。
- 门禁：手动完成 / 左滑收纳时未达成可拦截，并提供「仍要归档」。
- 自动收尾：习惯周期成功后，若任务树已全部 done/cancelled（或无任务），自动收入收集箱并写履历（`source: habit_completion`）。任务已齐但习惯未成时只 toast，不弹归档框。
- 与待办 `bound_habit_ids` 并存：待办管过程驱动，项目条件管结案门槛。
- UI：新建 / 编辑项目「完成习惯」行（复用 `BoundHabitPickerField`）。

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
- **AI 入口**：日复盘维度预览下方底部展示「AI 复盘分析」大按钮（写完全部维度后可生成）；更多菜单同入口须等系统 Alert 关闭后再开 Modal（避免 Android 卡住）。客户端传 `review_type` + 维度原文，并附带拼好的 `user_prompt`（兼容线上仍只认该字段的旧 Agent）。**JSON 契约以 App 为准**：`lib/review-ai-json-contract.ts`（title / overview / tags / suggestions ↔ 分析页 UI）；Agent `review_prompts.py` 按该契约约束模型。云端失败时**不**做本地模板兜底，直接失败提示。
- **反哺执行**：缺陷 / 新想法维度详情提供快捷入口（新建备忘 / 项目 / 小习惯 / 待办），见 `components/review/review-action-feed.tsx`。AI 分析页每条建议仅一个「+」图标；「落到哪里」在分析页 Modal 内以全屏遮罩 + 正中卡片展示（不做淡入透明度动画，避免 iOS 上看不见）。
