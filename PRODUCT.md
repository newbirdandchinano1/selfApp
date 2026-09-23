# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

## Users

主用户为产品作者本人（「小郑」），单人自用。打开「我的」Tab 时最常见目的是：查看积分 / 进入心愿相关能力，以及修改身体资料。

## Product Purpose

「小郑的自我修养」是一套个人自我管理应用，覆盖健康、任务、财务、复盘与「我的」。成功意味着用户能在一个 App 里持续记录与推进自己的日常修养节奏，并在「我的」里管理身份数据与积分激励。

## Positioning

未定。仓库中可见积分心愿、任务青蛙、截图 AI 记账、复盘等机制，但产品方尚未确认哪一项是不可被邻品如实抄走的核心主张。后续视觉与文案不得捏造差异化口号，直至此处被明确。

## Operating Context

- Expo Router + React Native；以 iOS 习惯为主（亦有 Android 构建，但设计语言优先 iOS）。
- 本地 SQLite 为主，配合云同步；离线回退本地。
- Tab 信息架构：健康 / 任务 / 财务 / 复盘 / 我的。
- 「我的」页 redesign 必须保留：积分、编辑资料、现有菜单入口与导航；旧 UI 仅作反例，不作为视觉权威。

## Capabilities and Constraints

- 已有：用户资料（姓名、身体数据等）、积分余额与心愿板相关入口、备忘录 / 菜谱等菜单导航、编辑资料子页。
- 单用户语境（默认用户），无多账号产品叙事需求。
- Positioning 未定：不得编造商业证明、竞品对比或未确认的独特卖点文案。
- 技术栈由现有代码库决定（Expo / RN），不另选。

## Evidence on Hand

- 应用显示名：小郑的自我修养（`app.json` / README）。
- 设计令牌与主题：`constants/design-tokens.ts`、`hooks/use-app-theme.ts`（财务页为既有视觉基准之一；「我的」reDesign 将旧 Profile UI 视为反例）。
- 目标表面：`screens/profile/ProfileScreen.tsx`。
- 缺：正式品牌手册、用户证言、对外定位一句话。未来工作不得伪造。

## Product Principles

1. 自用优先：界面服务高频动作（积分 / 心愿、身体资料），不为演示受众堆功能。
2. 诚实状态：缺数据、加载失败不得伪装成真实数值。
3. 导航诚实：保留既有入口与路由，不借 redesign 删除产品能力。
4. iOS 优先：控件、导航与触控习惯对齐 iOS，不把 Android Material 当默认语法。
5. 不发明主张：定位未定前，视觉表达产品已有能力与数据，不编造差异化叙事。

## Accessibility & Inclusion

遵循 iOS 可达性惯例（可读标签、足够触控热区、跟随系统外观 / 字号缩放已有基础设施）。未另行指定 WCAG 等级。
