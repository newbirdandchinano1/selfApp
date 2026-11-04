# 小郑的自我修养

Expo Router + React Native 自我管理应用（健康 / 任务 / 财务 / 复盘 / 我的）。

**我的 · 道路**（年 / 季 / 月拆解）：`life_directions` + `life_road_nodes`（kind: multi / farther / year / quarter / month）；项目挂 `life_month_goal_id`。节点除标题 / 说明 / 状态外，可写**验收标准** checklist（`extra_data.acceptance_criteria`；编辑页增删勾选，导图展开勾选）。摘要卡 / 导图 / 编辑总方向 UI 对齐根目录设计稿 `我的道路-UI重构.html`（纸色 ATELIER：深色摘要卡、north-card、道路树、字数环与实时预览）；令牌见 `constants/life-road-theme.ts`，排印复用衣橱 Noto / Mono 字族。摘要卡展示总方向 + 今年焦点（含 glance / 验收进度）；卡下三项统计（今年节点 / 已抵达 / 更远层）+「今年的节奏」12 月轨；空态 CTA 进 `/edit-life-direction`，有内容点卡进 `/life-road`。子页可折叠导图默认展开当下；节点编辑 `/edit-life-road-node/[id]`。

**道路归属 × 项目 / 任务**：新建 / 编辑项目用 `MonthGoalPickerField`（年·季分段 + 月目标 Sheet，对齐设计稿）；从道路「从此月建项目」带 `life_month_goal_id` 预填。任务 Tab 项目卡与任务详情页（`/task/[id]`）均展示 `ProjectRoadLinkBar`（「道路归属 · N 月 · 标题」），点按打开 `/life-road?focus_month_id=` 并展开对应月。本地 schema v60；后端 migration `021_life_road_nodes`。旧 `life_bets` 仅迁移兼容，已取消今年五条限额。`initDatabase` 在建 `idx_projects_life_month_goal_id` 之前就会 `ensureColumn(projects.life_month_goal_id)`，避免旧库缺列导致整段初始化失败；v60 迁移对缺列也可幂等自愈。业务 / UI 梳理见 `docs/我的道路-业务与UI梳理.md`。

侧边栏 **个人管理 → 我的衣柜** 路由为 `/my-wardrobe`，UI 对齐根目录设计稿 `衣橱-UI重构.html`（纸色 / 松绿 / 琥珀 ATELIER 风格）：衣橱 / 搭配 / 我的三 Tab、底栏 Dock、FAB 添加菜单（衣橱 Tab 仅「拍照 / 从相册导入」）、搜索、底栏 Sheet 详情与布局切换；左上角上下文按钮在搭配 Tab 打开「管理场合」，穿搭统计 Sheet 进度条带 growX 入场。

**搭配 · 拼图编辑器**：对齐 `衣橱-UI重构-拼图版.html`。搭配 Tab「从单品组合 / 拍照上传」、详情「编辑拼图」、单品「加入搭配」均打开全屏拼图页（深色画布、比例 / 背景色板与纹理、拖拽单品 / 照片 / 文字 / 贴纸、底栏五工具 Tray、完成保存 Sheet）。版式写入 `wardrobe_outfits.extra_data.collage`（后端 create/update 已透传 `extra_data`）。`DraggableLayer` 用 Gesture Handler 固定 pan + pinch（ref 避免重建打断），单指拖动、双指缩放单品 / 照片。有抠图的单品在画布与 Tray 去掉纸色卡底，只留透明 PNG。点「完成」打开保存 Sheet 时延迟武装遮罩点击，避免同一次触摸穿透立刻关闭；缺单品时在 Modal 内提示并打开单品 Tray（根级 Toast 会被 Modal 盖住）。新建画布不预置照片 / 文字 / 贴纸，需从对应 Tray 添加；有种子单品或已保存版式时仍按数据还原。「拍照上传」与照片 Tray 均走与衣橱相同的选图 + `zheng-vision-cutout` 抠图流水线（优先透明 PNG，不可用时保留原图），种子写入 `seedPhotoUri`；保存时上传统一图片库并写入 `extra_data.collage.photo`；可清除。旧 portrait/detail 预设仅读兼容。

**数据 / 云同步**：本地 SQLite 镜像 9 张 `wardrobe_*` 表（`database.native.ts` v59）；白名单 / 禁通用写 / `api-app-domain` 专用上传与后端一致。首屏 `GET /api/app/wardrobe/bootstrap`；CRUD 与穿着写路径见 `lib/repositories/wardrobe/*` + `lib/api/endpoints/wardrobe.ts` + `components/wardrobe/wardrobe-editors.tsx`（单品 / 搭配 / 分类 / 场合 / 衣橱 / 选项 / 身材）。「穿这件 / 穿这套」走 `/wardrobe/wear/*`；衣橱首页周历与「本周穿搭」卡对接 `GET /wardrobe/wear/week`（失败回退本地 `wardrobe_wear_logs`）；28 天点阵走 history 接口；统计 Sheet 按本地聚合。演示数组仅作设计对照，默认不灌云。

**单品图片流水线**（`lib/wardrobe-images.ts`）：衣橱 Tab FAB「拍照 / 从相册导入」先选图，再调 `zheng-vision-cutout`（iOS 实机可用时抠透明 PNG，否则保留原图），随后打开创建单品表单并带入种子图。表单主图也可再选拍照 / 相册并重跑抠图。保存时本地 URI 上传至 `/api/app/images`（`purpose: wardrobe-item`），写入 `image_uri` / `cutout_uri`；列表与详情优先展示抠图，无图回退线稿 SVG。原生合成用显式透明底 + RGBA8 导出，避免透明区被压成实色底；有 `cutout_uri` 时列表 / 详情 / 拼图不再垫 pastel tint，创建表单主图用棋盘格衬透明 PNG。

**单品表单**（结构对齐参考「创建单品」页，色板 / 字族仍为纸色 ATELIER）：顶栏返回 + 居中标题 + 松绿「保存」；顶部主图卡；分组列表为名称 / 分类 / 季节 / 颜色 · 品牌 / 价格 / 尺码 / 购买日期 · 备注。分类来自衣橱分类（表单隐藏「未分类」，未分类仅作删分类后的归宿）；季节 / 颜色 / 品牌 / 尺码（版型 `fit`）来自衣橱设置词条；购买日期为纸色自定义月历底栏（今天 / 清除）。主图 `image_uri`、抠图 `cutout_uri`；备注图写入 `extra_data`。

**排印（必须与设计稿同字族）**：`constants/wardrobe-theme.ts` + `components/wardrobe/use-wardrobe-fonts.ts`。Native 经 `expo-font` 加载 **Noto Serif SC / Noto Sans SC / Roboto Mono**（字重烤进 `fontFamily`，禁止再叠 `fontWeight`，否则 Android 会回退成系统默认字体）；Web 使用与 HTML 相同的 CSS 字族栈。设计稿已挂 Google Fonts，保证浏览器预览与 App 所见一致。

**夜间模式**：衣橱令牌分 `WARDROBE_LIGHT` / `WARDROBE_DARK`，经 `useWardrobeTheme()` 随全局 `useAppTheme` 切换（同财务 / 复盘折页）。各衣橱组件用 `createStyles(w)` 工厂接入；`pine` 作标题强调（夜间变浅），FAB / Dock / 选中 chip / 主按钮实心底用 `pineSolid`，玻璃底用 `glass` / `glassStrong` / `glassBorder`，遮罩用 `dim`。空分类卡在夜间改用 `card2` / `pine`，避免 pastel 底刺眼。设计稿 `衣橱-UI重构.html` 同步 `data-theme` 色板，右上角 DAY/NIGHT 可切换。

**近期 UI 对齐**：Hero「今天穿什么?」琥珀斜体问号（半角 + Georgia / Android skew，避免顶裁切）；搭配 / 我的页「自己」「衣橱」斜体 + 琥珀底划（`page-title-ital.tsx`，各端 skew 模拟）；周历下方常驻预留 tip 槽位，避免 tip 盖住「本周穿搭」卡。

**Tab 连点**：`wardrobe-screen` 用切换代数 + 停掉上一轮 `Animated` 再开新过渡，完成时强制 `enterX/enterOp` 归位，避免快速切换卡在 `translateX:26`（整体偏右、左侧空白）；设计稿 `衣橱-UI重构.html` 同步修了 leaving 定时器竞态与 `.active` 优先级。

**下拉刷新**：衣橱 / 搭配 / 我的三个 Tab 的主 `ScrollView` 均支持下拉刷新；走 `fetchAndCacheWardrobe` 再重读本地镜像，指示色用衣橱 `pine`。

**布局切换**：双列 / 单列按全量单品渲染（含分类已删的孤儿单品）；双列卡片用 `flexBasis` 定宽，避免 `flexWrap` 下百分比宽塌成空白；切换时不再 `holdHidden`。

**未分类**：衣橱卡片布局下，若「未分类」没有可见单品则不展示该分类行；管理分类中「未分类」为系统分类，不可重命名 / 删除（列表锁定，分类详情也不提供编辑项；后端同步拒绝）。

**FAB / CreatePop / LayoutPop 遮罩**：两者都用透明 Modal + 全屏 `Pressable` 关闭层（`collapsable={false}`，避免 Android 折叠空 View 导致点空白关不掉）。顶栏 flex + 标题不接手势。

**确认删除**：`confirm-delete` 改为底栏内容高度 Sheet（遮罩 + 上滑卡片），不再走全屏编辑页，避免大片空白。

**选项管理**：「我的」Tab 选项 Sheet 中，颜色 / 品牌 / 季节 / 版型词条按分类挂在对应分组下，不再统一堆在底部；分组头点击添加，子项长按删除。衣橱设置已去掉「详细尺码管理」入口（剩 5 项；身材数据仍保留）。

**我的页数据**：使用率 / 本月穿过 / 近 8 日迷你柱接本地 `wardrobe_wear_logs`（`loadWardrobeMineWearExtras`）；色彩分布按单品真实颜色聚合；资料卡 / 页脚 / 设置行备注接当前衣橱名、衣橱数、身材档案与词条数，不再用演示死数据。

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
- `npm run test:task-reminder` — 待办截止提醒纯规则（fireAt / 临期 / 抑制）
- `npm run test:frog-schedule-glance` — 今日青蛙桌面组件纯规则（焦点 / 倒计时文案 / Live Activity 条件）
- `npm run test:habits-today-glance` — 今日习惯桌面组件纯规则（进度 / 未完成列表 / 收齐态）
- `npm run test:health-intake-glance` — 健康摄入桌面组件纯规则（选环 / 百分比 / 收口态）
- `npm run test:finance-glance` — 财务一眼桌面组件纯规则（今日已花 / 预算剩余 / 脱敏）
- `npm run test:health-intake-reminder` — 健康摄入提醒纯规则

## 备忘录 RichDoc（镜像同步）

权威层在 `lib/memo-richdoc/`。桌面必须保持**字节级同源拷贝**：

`selfAPP_destop/src/renderer/src/shared/domain/memo-richdoc/`

**改一处必须同步另一处。** 存储是 versioned JSON（`selfapp-richdoc`），不是 HTML / 旧 markup。旧 markup 仅读兼容（`legacy.ts`）。保存出口一律 `serialize` / `serializeEditModelToBody`。

## 任务页 UI（对齐设计稿）

**标签色防护**：读库 `coerceTagRow` 会规范化 `color` 为 `#RRGGBB`；`getTagsByEntityIds` 对重复 `tag_links` 去重。列表芯片用 `tagColorWithAlpha`，避免脏色值拼 alpha 导致原生 `View` 渲染崩溃（习惯区曾因此红屏）。

对照 `任务APP-设计稿.html` 的近期修正：

1. **完成热力选中**：`HeatBloomCell` 用纸色内垫 + pond/sun 外环（对应 `.hcell.sel` 双环），不再用大面积半透明填充，避免黑影。
2. **待办窗格**（shot 06）：左圆形勾选 · 中文案 · 右状态标签 / 更多；快捷输入收拢 180ms；新建行高亮；「⋯」展开行下操作抽屉（升级 / 搁置 / 删除）；长按 420ms 预选入格。日程落在明天的待办提前出现在「今日已完成」下方，置灰并以右侧「明天」标签区分；更远未来日程仍不提前展示。
3. **青蛙周日程**：缩放仅 **最简 / 课表** 两档（原「今日」列表已并入课表）。单日课表按类型分色（青蛙深绿 / 习惯虚线浅绿 / 待办琥珀 / 项目灰绿）；顶部周条点日切换查看日，课表左右滑亦按日翻页；窄时间轴与 `M/D 周X` 日头；全天指派收拢在课表顶部专属格（不铺满时段）；时段格 / 全天格高度随指派条数叠放加高（邻日取 max 对齐时间轴），多项各画一条色块；若本日条数少于邻日 max，色块均分剩余高度；叠放色块用文档流样式。最简态展示当前时段 + 倒计时与焦点色块行；课表底部 `sc-foot` 入格统计。过期未完成独立待办继续虚拟入格；过期未完成青蛙滞留今日全天；过期未完成默认置顶；最简态焦点不含全天块。
4. **格内详情 · 确认弹窗**（shot 04）：底栏 380ms 上滑、青蛙跳一次、四宫格动作；完成 / 取消指派 / 移除本格段均用片内确认（积分·热力或危险色说明）。禁止在详情 Sheet（RN Modal）上再叠 `AppDialogHost`（也是 Modal），否则 Android 触摸层卡死；确认后先关 Sheet，父级 `runAfterUiSettles` 再写库。
5. **任务日历**（shot 09）：月历语义四色圆点（蛙/办/习/项）、点日展开明细、换月标题 120ms 淡出；本月概览数字滚动。
6. **新建 / 编辑待办**（shot 11）：折页表单卡、四象限 220ms 选中、自动入格弹簧开关（条件不足回弹）、条件预览展开、底栏创建。
7. **编辑任务状态**（shot 15 / `edit-task`）：芯片 `doing`（进行中）/ `todo`（待办）/ `blocked`（受阻）/ `cancelled`（已取消）/ `shelved`（暂时搁置）；保存写入 `tasks.status` 并同步后端（后端枚举已含上述取值）。搁置会清空本任务日程（继承项目日程除外）；从 `done` 改回非完成会扣回完成积分并级联重开父任务；进入/离开终态（done/cancelled）会触发父链级联。
8. **状态标记 UI**：共用 `components/tasks/task-status-tag.tsx`（文案 + 色调）。项目任务树、独立待办右侧标签、任务详情标题与子任务行均展示；非 `todo` 才出芯片（待办列表在默认态仍显示已入格/未入格）。色调：进行中 pond 绿、受阻 amber、搁置灰、已取消 rose、已完成 lily 绿。
9. **备注贴图**：新建 / 编辑项目与任务（含独立待办）的备注下方可从相册贴多张图（最多 9）；落库为 `extra_data.note_image_uris`（兼容旧单图 `note_image_uri`；统一图片库 `purpose: task-note` / `project-note`）；长期模式改验收标准时清空附图；任务详情备注区只读预览。

## 小习惯三类

- **养成**（`habitKind=build`）：节奏循环（每天 / 每周定期 / 每月定期）；当日目标达标计分；可选一次性累计目标。新建不再提供「每周/每月 N 天」（凑量请用周期配额）；旧 N 天数据仍可打卡，编辑时保留当前 tab 并提示改走周期配额。
- **戒除**（`break`）：破戒 / 守住 / 连续挑战三轨。
- **周期配额**（`task`，文案不再称「完成任务」）：日/周/月/年周期内累计进度，达标发奖并隐藏至下周期。存储字段仍为 `habitKind: "task"`。

## 项目 / 任务 ↔ 小习惯（三层）

分步构建说明（根目录）：[项目任务与小习惯联动-分步构建.md](../项目任务与小习惯联动-分步构建.md)。

- **任务日绑定**（已有）：`tasks.extra_data.bound_habit_ids`（`lib/repositories/tasks/task-habit-binding.ts`）。当日目标都达标 → 任务可自动完成并级联。
- **项目完成条件**（已有）：`projects.extra_data.completion_habit_ids`（`lib/repositories/projects/project-completion-habits.ts`）。口径为养成 `buildHabitCycle.completedAt` / 戒除 `breakHabitCycle.completedAt`（须已设周期目标）；**不是**当日打卡。周期配额不纳入。门禁：手动完成 / 左滑收纳未达成可拦截并提供「仍要归档」。自动收尾：习惯周期成功且任务树已全部 done/cancelled（或无任务）→ 收入收集箱并写履历（`source: habit_completion`）；任务已齐习惯未成时只 toast。UI：新建 / 编辑项目「完成条件」行（`BoundHabitPickerField`）。
- **项目进度燃料**（Step 1–8 已落地）：`projects.extra_data.progress_habit_bindings`（`[{ habit_id, target_days }]`）。实现：`lib/repositories/projects/project-progress-habits.ts`。双轨：有自身目标则**养成**跟 `expectedGoal`、**戒除**跟连续守住；无则用 `target_days` 按达标日累计。只计绑定日起（`since_ymd`）之后的打卡；零进度也出轨。周期配额不纳入。项目级 ratio 为各轨平均。打卡后先任务日绑定、再进度重算、再结案尝试；刚满进度 toast「可考虑结案」，**不**自动归档。UI：新建 / 编辑「推进进度」（`ProgressHabitBindingsField`）；任务页项目卡在任务树外独立进度条（`ProjectHabitProgressBlock`）。与完成条件分键，勿混用。纯规则自测：`node scripts/test-project-progress-habits.mjs`。手工剧本见根目录 [项目任务与小习惯联动-分步构建.md](../项目任务与小习惯联动-分步构建.md) Step 8。

## 心愿板 · 兑换条件绑定

- UI：`WishBoardRedeemConditionsField`。绑定选择器 **项目树** / **小习惯** / **待办**；项目与任务为可展开树（任意层级可勾选，项目与旗下任务互斥）。点名称进详情，仅右侧选中框勾选。
- **小习惯**：仅养成/戒除；口径与项目完成条件相同（`buildHabitCycle.completedAt` / `breakHabitCycle.completedAt`），非当日打卡；周期配额不纳入；未设周期目标默认不可选；与项目/任务/待办 AND 并存、习惯之间不互斥；不做「选项目隐含其完成习惯」。已是某项目完成条件时弱提示。缺口 Sheet「去打卡」进习惯详情。
- 另可开关 **开放兑换时间**（`available_from`）：到点后才可兑。
- 数据：`extra_data.redeem_conditions` 的 `project_ids` / `task_ids` / `todo_ids` / `habit_ids` / `min_net_worth` / `available_from`；本地评估 + 后端兑换硬校验。

## 财务 · 储蓄目标

`FinanceSavingsGoalBlock`：设定目标金额与日期后，卡片右侧主数字展示 **每日需存**（缺口 ÷ 剩余天数，含定时预扣抬高）；副文案为当前/目标进度与倒计时；可选展示服务端「预测可存」。

## 同步注意（app_settings）

增量上传会把超长**实体 id**缩短到 36 字符（`lib/api-mysql-id.ts`），但 **`app_settings` / `app_meta` 的 `key` 是业务语义键（库侧 VARCHAR(255)），禁止缩短**。否则本地仍是长 key、上传用短 key，`markLocalRowsSynced` 会更新 0 行并死循环推送。`setAppSetting` 在值未变时直接跳过，避免迁移标记等被反复写脏。

## 同步 apply / 请求队列

- **Pull apply**（`lib/sync-apply.ts`）落库前走 `sanitizeRowForLocalSeed(..., { allowNetwork: false })`：补 `health_records.user_id`、压平 JSON 绑定；NOT NULL 外键父行缺失时跳过本行（不置 null、不联网拉父行）。同页事件按父表优先排序（`users` / `finance_accounts` 等）。
- **Dirty 合并**：`sync-pull` 短时合并 dirty 通知，减轻 UI 重载风暴。
- **请求闸门**（`lib/api-request-queue.ts`）：排队满时挤掉最旧读而非拒新读；`ApiRequestQueueFullError` 对过期读吞掉 Uncaught。自测：`node scripts/test-api-request-queue.mjs`。

## 博客内嵌

个人管理「博客」走 WebView / 桌面 iframe，地址统一为 **`https://jaxz.xyz`（无 www）**。站点证书未覆盖 `www.jaxz.xyz`，带 www 会 SSL 失败。登录态仍由 App 侧 AsyncStorage 桥接（`@selfapp/blog-auth-v1`）。

## 消息 · 资讯（TrendRadar）

「我的 → 消息 → 资讯」拉取 `GET /api/app/news/latest`（`lib/api/endpoints/news.ts` + `lib/api/remote-inbox.ts`），列表 UI 在 `MessagesFeedPanel`：搜索栏 + 按 `platformName` 渠道分类 Tab、本机已读、点击打开原文。完整接口说明见仓库根目录 `TrendRadar热点接口使用报告.md`。

**提醒设置**：主页保留权限 / 总开关 / 已预约入口；频道按页面分为健康 / 财务 / 任务 / 复盘（底层类别并入：摄入→健康，截图记账+财务预约提醒→财务，入格+截止+习惯→任务，日/周复盘→复盘）。点标题进 `/notification-channel/[id]`（`health|finance|tasks|review`；旧类别 id 深链仍兼容）。页面开关按「至少一类开启」判定。

**来源红点角标**：本地提醒送达后写入消息「通知」Tab；底部健康 / 任务 / 财务 / 复盘 Tab 显示红色小点（「我的」不打角标，铃铛仍用数字）。页内来源入口同步打红点（健康状态行、财务预算 / 储蓄 / 定时支出、任务习惯 / 待办 / 项目行、复盘日 / 周分段）。用户点进对应功能确认后，`acknowledgeInboxSources` 标已读，红点与 Tab 角标一并消失；消息列表点开标已读行为不变。规则：`lib/notification-inbox-source.ts`；自测：`npm run test:notification-inbox`。

**健康摄入提醒**（`lib/health-intake-reminder-logic.ts` 纯规则 + `lib/health-intake-reminder-notifications.ts` 排期）：默认「餐次窗口 + 傍晚收口」双轨，亦可仅傍晚收口或水分轻间隔（从最近一次摄入起算）。按「我关心」关注项催最大缺口，文案带进度与动作提示；每日最多 2 条未来预约（免打扰延后不吃配额）。通知可「稍后再说」（90 分）/「今日不催这项」。健康页状态行展示下次提醒 / 已达标 / 已推迟，点按进频道设置。旧 `fixed`/`interval` 偏好读兼容为 `evening_wrap`/`hydration_interval`。单测：`npm run test:health-intake-reminder`。

**财务提醒**（方案见仓库根目录 `财务提醒对接方案.md`；`lib/finance-reminder-logic.ts` + `lib/finance-reminder-notifications.ts`）：① 定时支出应记前提醒（默认提前 30 分，可选傍晚收口；已入账静默）；② 预算阈值（默认 80% + 超支，每档每周期一次）；③ 储蓄目标周轻催（默认关）；④ 当日未记账收口（默认关）。财务页副标题展示下次提醒，点按进财务频道。单测：`npm run test:finance-reminder`。

**任务提醒（按锚点分策略）**：方案见仓库根目录 `任务提醒规则重构方案.md`（P0–P2 已落地）。
- **入格** `schedule-slot-reminder`：分类型默认提前量；单条可经日程 `advanceMinutesOverride` 覆盖。文案区分「该做」与「推进项目」。
- **截止** `task-deadline-reminder`：主路径「自动临期」（窗口 1/2/3 天可配）；高级仍可自定义提前 N 天；过期可推「今日滞留」。青蛙 / 高优先偏强提醒。
- **项目推进** `project-progress-reminder`：活跃项目多日无入格（或临近截止）催「推进」；暂停 / 归档静默。
- **习惯** `habit-reminder`：轻 / 标准 / 强；标准与强带傍晚收口；养成看日目标，戒除看当日是否已标记。
- 纯函数单测：`npm run test:task-reminder`。

**桌面组件（仅 iOS）**：方案见仓库根目录 `桌面与状态栏组件方案.md`。
- **§3.1 今日青蛙**：`FrogScheduleWidget`（主屏小/中号 + 锁屏）+ `FrogScheduleLiveActivity`（入格进行中上岛）。规则 `lib/widgets/frog-schedule-glance.ts`，推送 `frog-schedule-widget-sync.ts`。
- **§3.2 今日习惯**：`HabitsTodayWidget`。规则 `lib/widgets/habits-today-glance.ts`，推送 `habits-today-widget-sync.ts`（打卡 / 习惯 CRUD / 回前台 / 设置变更）。默认纳入养成 + 戒除，周期配额可选；组件内不打卡，深链任务页。
- **§3.3 健康摄入**：`HealthIntakeWidget`。规则 `lib/widgets/health-intake-glance.ts`，推送 `health-intake-widget-sync.ts`（摄入 CRUD / 目标变更 / 回前台 / 设置变更）。环口径跟「我关心」或手动最多 2 项；副行复用 `getHealthIntakeReminderStatusSummary`；深链健康首页。
- **§3.4 财务一眼**：`FinanceGlanceWidget`。规则 `lib/widgets/finance-glance.ts`，推送 `finance-glance-widget-sync.ts`（流水 / 预算 / 定时支出 / 回前台）。主数字今日已花或预算剩余%；下一笔跳过已入账槽位；脱敏 follow/force/plain，锁屏默认关且开启强制脱敏；深链 `zheng://finance`。
- 控制中心：侧边栏 **系统管理 → 桌面与状态栏**（`/widgets-center`、`frog-schedule` / `habits-today` / `health-intake` / `finance-glance`）。改 widgets 插件后须重打 **iOS** 包；Expo Go 不可用。单测：`test:frog-schedule-glance`、`test:habits-today-glance`、`test:health-intake-glance`、`test:finance-glance`。

## AI

App **不直连**智谱。场景请求经 `lib/ai-api-client.ts` → **Agent** `/api/v1/ai/*`（Key 仅存 `selfAPP_AIAgent`；App 持共享 `X-API-Key`）。  
备忘落库点评仍走业务后端 `POST /api/app/memos/:id/ai-review`（后端代调 Agent）。  
配置：`lib/agent-config.ts`（`EXPO_PUBLIC_AGENT_BASE_URL` / `EXPO_PUBLIC_AGENT_API_KEY`）。  
门面：`lib/zhipu-image-parse.ts`。接口清单见 [AI_API.md](./AI_API.md)。

## 复盘（折页）

- **排版规范（日 / 周 / 月共用）**（`lib/review-day-facts.ts`）：区块用【】、列表用「· 」、块间空行。健康只写摄入汇总（+ 体重），不含逐条记录 / AI 点评；任务分【任务（青蛙）】【待办】【小习惯】并列出未完成；财务为周期汇总 + 流水。日复盘「一键写入」；周/月空栏 rollup 时健康/任务/财务优先写结构化周期事实（`rollupWeekly*` / `rollupMonthly*`），日常/缺陷/新想法仍拼接子周期原文。
- **完成门禁**：当日模板全部维度格子写完后才发放日复盘积分（`review-points-grant`），且才允许打开 / 生成 AI 复盘分析。
- **AI 入口**：日复盘维度预览下方底部展示「AI 复盘分析」大按钮（写完全部维度后可生成）；更多菜单同入口须等系统 Alert 关闭后再开 Modal（避免 Android 卡住）。客户端传 `review_type` + 维度原文，并附带拼好的 `user_prompt`（兼容线上仍只认该字段的旧 Agent）。**JSON 契约以 App 为准**：`lib/review-ai-json-contract.ts`（title / overview / tags / suggestions ↔ 分析页 UI）；Agent `review_prompts.py` 按该契约约束模型。云端失败时**不**做本地模板兜底，直接失败提示。
- **反哺执行**：缺陷 / 新想法维度详情提供快捷入口（新建备忘 / 项目 / 小习惯 / 待办），见 `components/review/review-action-feed.tsx`。从复盘新建待办默认带当日全天 +「自动临期」提醒。AI 分析页每条建议仅一个「+」图标；「落到哪里」在分析页 Modal 内以全屏遮罩 + 正中卡片展示（不做淡入透明度动画，避免 iOS 上看不见）。
- **复盘提醒**（方案见仓库根目录 `复盘提醒对接方案.md`）：`daily-review-reminder` 到点催日刊（已填 / 周复盘日跳过）；`weekly-review-reminder` 在配置的周复盘日催周刊。通知点击进 `/daily-review/[ymd]?focusEmpty=1`（或 Hub `focus=weekly`），尽量打开首个未写维度；日提醒正文可附未完成青蛙 / 待办 / 习惯摘要。写完后 sync 停催。设置入口：复盘设置 + 通知中心「复盘」频道。
