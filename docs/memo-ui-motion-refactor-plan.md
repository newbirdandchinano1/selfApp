# 备忘录 UI 与动效升级实施方案

状态：方案待审核。本文件只描述后续怎么改，当前没有改任何页面、业务逻辑、配置或依赖。

适用范围：`selfApp`（Expo Router）里的备忘录列表、详情、编辑。桌面端 `selfAPP_destop` 不在本次范围内。

文档路径：`selfApp/docs/memo-ui-motion-refactor-plan.md`。`selfApp` 原先没有 `docs/` 目录，根目录只有产品说明类 Markdown，因此新建该目录存放本方案。

## 1. 当前实现盘点

### 1.1 页面与路由

三个页面都是路由文件，没有再拆出独立 Screen 组件。

| 页面 | 路径 | 导出 | 壳组件 |
| --- | --- | --- | --- |
| 列表 | `selfApp/app/(profile)/memo-list.tsx` | `MemoListScreen` | `CrudListScreen` |
| 详情 | `selfApp/app/(profile)/memo-view/[id].tsx` | `MemoViewScreen` | `CrudDetailScreen` |
| 编辑 / 新建 | `selfApp/app/(profile)/memo-edit/[id].tsx` | `MemoEditScreen` | `CrudEditScreen`，`id === 'new'` 为新建 |

入口：

- 个人页 `selfApp/screens/profile/ProfileScreen.tsx` 跳转 `/memo-list`。
- 设置抽屉 `selfApp/components/settings-drawer/global-settings-panel.tsx` 同样 `router.push('/memo-list')`。
- 列表点卡片进入 `/memo-view/[id]`。
- 列表右上角、长按「编辑」进入 `/memo-edit/[id]`。
- 详情顶栏编辑按钮进入同一编辑路由。
- 编辑页标签弹层里的「管理标签」进入 `/project-tags?domain=memo`。

根导航在 `selfApp/app/_layout.tsx`：

- 全局 `GestureHandlerRootView` 包住应用。
- `Stack` 只设置 `headerShown: false`。
- `memo-list`、`memo-view/[id]`、`memo-edit/[id]` 没有单独的 `animation`、`presentation`、`gestureEnabled`。
- 因此这三个页面使用 Expo Router / `react-native-screens` 的默认原生栈转场（iOS 为从右滑入，边缘返回手势默认开启）。
- 全库只有 `reminder-dispose` 显式写了 `animation: 'fade'`。没有共享元素转场实现。

### 1.2 列表页结构

`memo-list.tsx` 约 890 行，UI 与数据操作写在同一个默认导出里。本地纯函数：

- `dayKey`、`sectionLabelForDay`、`buildTimelineRows`：按更新日或创建日分组；标题排序时不分组。
- `timeShort`：卡片右侧时分。
- `SORT_OPTIONS`：最近更新、最近创建、标题。

数据与交互（必须原样保留）：

- `usePageApiSync('memo-list')` + `fetchProfileMemoList` + `listMemos()` + `getMemoTags()` + `getTagsByEntityIds('memo', ...)`。
- `usePageFocusReload`：首次挂载加载；再次聚焦时重读 SQLite，且 **不会** 把 `loading` 设回 `true`。本地表变更有 280ms 防抖。
- `usePagePullRefresh`：下拉走 `refreshFromUser()` 再 `reload(false)`，系统 `RefreshControl`，`tintColor` / `colors` 为主色。刷新期间不切整页 loading。
- 搜索 `memoMatchesSearch`：标题 + 正文字面包含，客户端即时过滤。
- 标签筛选：`__all__`、`__none__`、具体标签 id，以及「管理标签」。
- 排序调用 `sortMemos`：置顶永远优先，然后按模式比较。这是排序语义，不能改。
- 卡片点击进详情；`delayLongPress={360}` 后 `Alert.alert` 系统菜单：置顶 / 取消置顶、AI 分析、编辑、删除、取消。
- `Swipeable`（`react-native-gesture-handler`）：`overshootRight={false}`，`rightThreshold={48}`，右侧四个操作：置顶、转待办、转项目、删除。没有同时只展开一行的互斥关闭逻辑。
- 转待办 `createStandaloneTodoFromMemo`、转项目 `createProjectFromMemoInInbox` 成功后从列表移除并 `Alert`。删除走 `deleteMemo`。置顶走 `setMemoPinned`。
- AI：`openAiModal`、`runAiForMemo`（先 `runMemoAiReviewOnServer`，失败再本地 `analyzeMemoReviewFromText` + `setMemoAiReview`）。后台分析用 `addMemoAiPendingAnalysisListener` / `addMemoAiReviewSavedListener`。
- 两个 `Modal`：`animationType="fade"`，透明遮罩 `rgba(0,0,0,0.35)`，内容居中。点遮罩关闭；内层 `Pressable` 空 `onPress` 阻止冒泡。
- 空列表用 `ScreenEmptyState`，没有传入 `actionLabel`。
- `FlatList` 未设置 `initialNumToRender` 以外的动画，也没有 `LayoutAnimation`。

卡片视觉（`StyleSheet`，约 738–889 行）：

- 白/表面色底、`hairline` 边框、圆角 14、无阴影。置顶与普通卡片同一套底。
- 左侧 8px 圆点 + 每张卡自己的竖线。竖线在 `noteOuter.paddingBottom: 10` 处断开，不是一条连续时间线。
- 标题 `fontSize: 16, fontWeight: '800'`。预览、标签、AI 一行摘要都是硬编码字号字重。
- 标签最多显示 4 个，色块为 `` `${color}22` ``。
- AI 已有评价时单行 `AI · {evaluation}`；分析中是 `ActivityIndicator` + 「AI 分析中…」。
- 搜索框、芯片、排序按钮只有静态样式。清除按钮是无动效的 `Pressable`。排序按钮 40×40，低于 `Layout.minTouchTarget`（44）。

### 1.3 详情页结构

`memo-view/[id].tsx`：

- 顶栏：返回、标题「备忘」、图钉、编辑。图钉和编辑使用 `AppIconButton`（已带按压缩放）。
- `ScrollView` + `refreshControl`。
- 大标题 26 / 800，其下一条 meta：更新时间、可选创建月日、可选「已置顶」。
- 标签芯片与列表类似，但是另一套硬编码样式。
- 正文 `MemoFormattedBody`。
- 有 AI 结果时底部一块：评价、建议、`ai_review_at`。没有「分析中」态；分析中状态只存在于列表。
- `useFocusEffect` 每次聚焦都 `setLoading(true)` 再 `reload()`。已打开过的详情返回再进、或从编辑页返回，会先被 `ScreenLoadingShell` 换成大号菊花，加载完再 300ms 淡入。这是详情过渡生硬的直接原因。

### 1.4 编辑页结构

`memo-edit/[id].tsx`：

- `CrudEditScreen` 默认包 `KeyboardAvoidingView`，iOS `behavior="padding"`，`keyboardVerticalOffset = insets.top + 56`（`components/crud/crud-screen.tsx`）。
- 顶栏图钉只改本地 `pinned`，随保存写入。保存按钮是普通 `Pressable`：`saving` 时显示 `ActivityIndicator`，`overLimit || saving || loading` 时 `disabled`。成功路径是 `toast.success('已保存')` 后立刻 `router.back()`，没有成功动画，也没有在动画结束后才返回。
- `onSave` 已有 `setSaving(true)`，但函数开头没有 `if (saving) return`。快速连点在第一次 `setSaving` 生效前仍可能进入两次。本次只允许在按钮侧用现有 `saving` 挡住重复渲染后的点击，并在 `onSave` 入口补一行早退。这是防重复提交，不改变保存参数。
- 标签不是页面内横滑多选，而是共用 `ProjectTagPickerField`：点开居中 `Modal`（`animationType="fade"`），草稿多选，确认后回写。组件同时服务任务。选中反馈目前只有 `opacity: pressed ? 0.88 : 1`。
- 标题 `TextInput`，底部 `hairline`，超过 `MEMO_TITLE_MAX`（120）在 `onChangeText` 里截断。
- `MemoFormatToolbar`：15 个动作，固定两行。按钮用 `onPressIn` 调 `applyFormat`，注释写明是为了比 `onPress` 更早、减少 iOS 上 WebView 选区被清掉。按下只改透明度到 0.65。没有持久的「当前格式已激活」状态。父组件把 `onSelectionChange` 传成空函数。
- 正文字数按 UTF-8 字节，上限 `MEMO_BODY_MAX_BYTES = 524288`（512KB，`lib/memo-richdoc/types.ts`）。超限时提示变 `colors.danger`，保存禁用。
- 正文是 `MemoRichBodyInput`（WebView）。`keyboardShouldPersistTaps="always"`。最小高度 `max(360, 42% 窗口高)`。
- `useFocusEffect` 每次聚焦都 `reload()`，且 `reload` 会 `setLoading(true)` 并用数据库覆盖 `title`、`bodyModel`、`pinned`、`selectedTagIds`。从「管理标签」返回时会把未保存草稿清掉。这是现有缺陷，**不纳入本次动效改造**，见 1.8。

### 1.5 备忘录专用组件与业务文件

| 文件 | 作用 | 本次动效是否可改 |
| --- | --- | --- |
| `components/memo/memo-formatted-body.tsx` | 详情富文本渲染。段落 `fontWeight: '600'`，块间距 `marginBottom: 6` + `root.gap: 2`。引用、代码、图片、分割线已有样式 | 只调阅读样式，不改解析 |
| `components/memo/memo-format-toolbar.tsx` | 格式工具栏 | 可改按下外观；不能把 `onPressIn` 换成会延迟的动画组件 |
| `components/memo/memo-rich-body-input.tsx` | WebView 编辑器 | 默认不动。读取当前格式需要新的 WebView 消息，风险高，放到不做清单 |
| `lib/memos.ts` | CRUD、`sortMemos`、搜索、预览 | 不改 |
| `lib/memo-format.ts`、`lib/memo-richdoc/` | 文档模型与 512KB 校验 | 不改 |
| `lib/memo-ai-background.ts` | 后台分析中集合与完成监听 | 不改；UI 只订阅现有集合 |
| `lib/memo-to-task.ts`、`lib/memo-to-project.ts`、`lib/memo-images.ts` | 转换与图片 | 不改 |
| `lib/profile-page-api.ts` | `fetchProfileMemoList` | 不改 |
| `hooks/use-page-api-sync.ts`、`hooks/use-page-focus-reload.ts`、`hooks/use-pull-to-refresh.tsx` | 加载、聚焦刷新、下拉 | 不改这些 hook 的语义 |

### 1.6 已安装的相关依赖（`selfApp/package.json`）

以仓库声明为准，不新增、不升级。

| 包 | 版本 | 备忘录里的实际用法 |
| --- | --- | --- |
| `expo` | `^57.0.0` | 运行时 |
| `expo-router` | `~57.0.18` | 文件路由与 Stack |
| `react` | `19.2.3` | |
| `react-native` | `0.86.3` | `Animated`、`Modal`、`FlatList`、`Alert`、`RefreshControl` |
| `react-native-gesture-handler` | `~2.32.0` | 列表 `Swipeable`；根上已有 `GestureHandlerRootView` |
| `react-native-reanimated` | `4.5.1` | 备忘录未引用。全库仅财务页和设置抽屉使用 |
| `react-native-worklets` | `0.10.1` | Reanimated 4 的配套，备忘录未用 |
| `react-native-screens` | `~4.26.0` | 原生栈转场 |
| `@expo/vector-icons` | `^15.0.3` | `MaterialIcons` |
| `expo-haptics` | `~57.0.2` | 备忘录未用。现有调用在 `components/haptic-tab.tsx`、`components/completion-celebration-host.tsx` |
| `react-native-webview` | `13.16.1` | 正文编辑器 |

仓库内没有 `babel.config.js`。Expo SDK 57 默认带 Reanimated 插件，但备忘录不依赖这条路径。没有 Framer Motion。没有共享元素库。

### 1.7 可复用的动效与 UI

全局令牌在 `selfApp/constants/design-tokens.ts`：

- `Spacing`：4–28 的 4pt 网格。
- `Radius`：8–28，`pill: 999`，`sheet: 22`。
- `Layout`：页边 20、顶栏高 48、触控 44、图标按钮 44。
- `Typography`：`h1` 28/700、`h2` 22/700、`title` 16/600、`body` 14/400、`caption` 12、`label` 11。备忘录几乎没用这些角色，而是页面内写死 800 字重。
- `Motion`：按钮按下缩放 `0.98`、透明度 `0.94`、按下 90ms；抬起 spring `speed: 24, bounciness: 3`；卡片按下缩放 `0.985` 且注释写明不叠透明度；`enterMs: 220`。令牌注释：「动效只服务按压和进入，不做逐项编排」。
- `Shadows.card`：`shadowOpacity: 0.06`，`shadowRadius: 12`，`elevation: 2`。备忘录卡片当前没用阴影。
- 色板：`background #faf8ff`、`surface #ffffff`、`surfaceMuted`、`surfaceSubtle`、`primary`、`secondary`（同时是成功绿）、`tertiary`（置顶金）、`danger`、`outline`、`overlay`。深色有对应 `PaletteDark`。

可复用组件：

- `components/ui/motion-pressable.tsx`：RN `Animated`，`useNativeDriver: true`。减少动态时不做缩放，只瞬时改透明度。卸载时 `stopAnimation`。这是备忘录按钮反馈的默认实现，不要另写一套弹簧。
- `components/ui/app-icon-button.tsx`：已包 `MotionPressable`。列表添加、详情图钉/编辑、编辑页图钉已经用它。
- `components/ui/app-button.tsx`：支持 `loading`，内部禁用重复点击。排序弹层和 AI 主按钮可以复用，避免再写一个加载按钮。
- `components/ui/skeleton.tsx`：脉冲占位，尊重 `useReducedMotionState`。
- `components/screen-loading-shell.tsx`：加载中默认大号菊花；可传 `skeleton`。数据就绪后 300ms 淡入；减少动态或偏好未就绪时直接设为不透明。
- `components/crud/screen-empty-state.tsx`：圆底图标 + 标题 + 副文案 + 可选主按钮。备忘录空态没用可选按钮。
- `components/crud/crud-screen.tsx`：`ScreenLoadingShell` 没有把 `skeleton` 透传出去。要做列表骨架，需要给 `CrudScreen` 增加可选 `loadingSkeleton`，默认 `undefined`，其它 CRUD 页行为不变。
- `hooks/use-reduced-motion.ts`：读 `AccessibilityInfo.isReduceMotionEnabled`，并监听 `reduceMotionChanged`。`ready === false` 时不得启动循环或大幅位移动画。

`components/recipe/recipe-motion-pressable.tsx` 是食谱模块自己的按压件，备忘录不要复用，避免带入食谱视觉。

### 1.8 必须守住的业务行为

以下函数和分支在改造中只许被调用，不许改语义：

1. 搜索、清空、标签筛选、跳转标签管理。
2. `sortMemos` 的三种模式和置顶优先。
3. `buildTimelineRows` 的分组规则：`updated` 用 `updated_at`，`created` 用 `created_at`，`title` 不插入日期分组。
4. 点击进详情；长按菜单四项；左滑四项及转换成功后的 `Alert` 文案与跳转。
5. 下拉刷新走现有 `usePagePullRefresh`，不额外 `forceRefresh` 打页面 REST。
6. AI：空内容拦截、未配置密钥拦截、服务器优先、失败回退、`pendingAnalysisIds`、弹层「开始分析 / 重新生成」。
7. 详情展示标题、时间、标签、富文本、AI 评价和建议。
8. 新建 `createMemo`、更新 `updateMemo`、标签 id、置顶、`startMemoAiReviewInBackground`、`forgetUnusedMemoUploads`。
9. 标题 120 字截断、正文 512KB 超限禁用保存。
10. 保存失败 toast，不返回；成功 toast 后 `router.back()`。

单独记录、本次不修、等批准后再动的缺陷：

- 编辑页 `useFocusEffect` 每次聚焦都整页 `reload()` 并用库内数据覆盖草稿。从标签管理返回会丢失未保存的标题、正文和标签选择。动效改造不得依赖「返回后仍是草稿」之外的新假设，也不得顺手改这段加载。若以后要修，应单独做「仅首次加载实体，聚焦只刷新标签列表」并加回归。

### 1.9 能力缺口与替代

| 需求 | 现况 | 决定 |
| --- | --- | --- |
| 按钮弹簧反馈 | `MotionPressable` 已够用 | 复用，不引入新库 |
| 列表插入/删除位移动画 | 未使用。Reanimated layout animation 与 `Swipeable` 叠在同一行上容易抢手势 | 不用 Reanimated layout。位置变化用 iOS `LayoutAnimation`，且只包数据更新，不包手势进行中 |
| 共享元素（卡片展开成详情） | 导航是原生 Stack，没有共享元素依赖 | 不做。使用现有从右推入 |
| 左滑跟手 | `Swipeable` 已经跟手，松手按阈值与速度决定 | 保留，不并行第二套手势 |
| 长按菜单 | 系统 `Alert` | 保留。只在菜单出现前加一次轻触感 |
| 格式工具栏选中态 | WebView 没有把 `queryCommandState` 回传 | 不做持久选中态。只保留按下透明度 |
| 减少动态 | 备忘录页面都没读这个 hook | 新动效全部走 `useReducedMotionState` |

## 2. 当前问题与设计目标

### 2.1 已从代码确认的问题

1. 列表、详情、编辑的视觉各自硬编码，字重普遍 800，和 `Typography` 的 400/600/700 不一致。三页都像同一块白底加细边，置顶、标签色、AI 状态没有稳定的层级。
2. 列表交互反馈几乎只有 `pressed` 时把整卡透明度降到 0.92。搜索聚焦、清除、标签选中、排序选中都是瞬间换色。卡片没有入场、筛选后没有位置过渡，删除和置顶是数据一变就跳到新位置。
3. 时间线竖线按卡片裁切，卡片之间 10pt 空隙里线是断的。分组标题和卡片的间距靠 `paddingTop: 20` 堆出来，层次靠字距放大写「今天」，而不是靠时间线结构。
4. 空态和加载态是通用壳：居中大菊花 + 「加载备忘…」，或一个圆图标加两行字。搜索无结果和真正的空列表共用同一组件，只改了文案。
5. 详情每次聚焦都整页进入 loading，从列表推入后用户先看到菊花再看到正文。正文段落默认 600 字重、块间距偏紧，长文阅读比「手账」更像压缩过的卡片副本。
6. 编辑页新建和编辑只有顶栏标题不同。保存中有菊花，但按钮宽度和颜色跳变；超限只改一行 11pt 红字。工具栏是 1px 实线盒子，按下透明度从 1 到 0.65，和顶栏图标按钮的 0.98 缩放不是同一套反馈。
7. 两个业务弹层都是 `Modal` 的 `fade`，遮罩和面板一起淡入，没有面板自身的短位移。AI 重新生成时用菊花替换整段评价，高度塌掉再涨回来。
8. 减少动态效果在备忘录路径上未接入。顶栏图标按钮因为走了 `MotionPressable`，已经会在减少动态时取消缩放；列表卡片、弹层、未来的列表动画都还没有这条分支。

### 2.2 需要在实现时再验证的问题

这些不是已经证伪的功能缺陷，实现前在 iOS 模拟器上看一次即可：

- 左滑四个 68pt 按钮在小屏上是否把卡片完全推出可视区，以及和系统返回手势是否冲突。代码里返回手势在屏幕左缘，右滑操作在卡片右侧，理论上分区不同，但仍要实机确认快速斜滑。
- `KeyboardAvoidingView` 与 WebView 聚焦时，工具栏和标题是否被顶出视口。本次不改 offset，避免引入新的跳动。
- 长列表（建议准备 80 条以上本地数据）在 `FlatList` 回收 cell 时，如果入场动画绑在 `renderItem` 上会重播。方案因此禁止给每一行挂常驻 entering。
- 深色模式下标签色 `` `${color}22` `` 是否发灰。`ProjectTagPickerField` 已在深色改用实色底，列表和详情还没有。这是视觉问题，不是数据问题。

### 2.3 设计目标

做成「轻的数字手账」：纸色背景、表面色笔记、连续时间线、标签色作识别而不是大色块。交互像 iOS：按下有轻微反馈，列表变化短而可预期，转场继续用系统推入。

明确不做：

- 不删标题、预览两行、时间、标签、置顶钉、AI 入口、左滑四键。
- 不把卡片间距和圆角加大到一屏少看一条以上。当前卡片垂直内边距 14、卡片间距 10，改造后垂直内边距保持 12–14，卡片间距保持 8–10。
- 不给每张卡同一套 `Shadows.card`。
- 不做共享元素。
- 不替换 `Swipeable`，不升级 Expo / Reanimated / Gesture Handler。

## 3. 整体视觉规范

新增 `selfApp/constants/memo-ui.ts`，只服务备忘录。全局 `design-tokens.ts` 的现有数值不改。需要跨页面一致的备忘录颜色和圆角从这里读，禁止在三个页面里再写散落的 `rgba(...)` 和 `fontWeight: '800'`。

### 3.1 色彩

全部从 `useAppTheme().colors` 来，深浅色自动切换。

| 用途 | 令牌 | 用法 |
| --- | --- | --- |
| 页面背景 | `colors.background` | 三页根背景，已是略暖的 `#faf8ff` / 深色 `#0f172a` |
| 普通笔记底 | `colors.surface` | 列表卡片、弹层 |
| 置顶笔记底 | `colors.surfaceSubtle` | 与普通卡区分，不加厚阴影 |
| 搜索与输入 | `colors.input` | 搜索框、编辑器底 |
| 分组与次要信息 | `colors.textSecondary` / `colors.textMuted` | 日期、时间、空态副文案 |
| 正文 | `colors.text` | 标题与正文 |
| 主操作 | `colors.primary` | 添加、保存、AI 图标、选中排序 |
| 置顶 | `colors.tertiary` | 图钉、置顶圆点、置顶卡片左边 2pt 线 |
| AI 已完成 | `colors.secondary` | 建议文字、列表 AI 摘要 |
| AI 进行中 | `colors.primary` | 小菊花，文案用 `textMuted` |
| 删除 | `colors.danger` | 左滑删除、超限文案 |
| 分隔 | `colors.outline` | 细线。去掉列表里 `isDark ? 'rgba(148,163,184,0.22)' : colors.outlineStrong` 这套页面私有线色 |
| 遮罩 | `colors.overlay` | 替换弹层里写死的 `rgba(0,0,0,0.35)` |
| 标签 | 标签自身的 `tag.color` | 浅色：底 `${color}18`、字 `tag.color`、1px hairline `${color}55`。深色：底色用标签色、字 `#ffffff`，与 `ProjectTagPickerField` 深色策略一致 |

不新增大面积渐变。不把主按钮改成渐变。

### 3.2 文字

| 角色 | 使用 | 替换掉的现状 |
| --- | --- | --- |
| 详情 / 编辑标题 | `Typography.h2`（22/700，行高 28） | 详情 26/800、编辑 24/800。略收一号，仍是页面里最大的字 |
| 列表卡片标题 | `Typography.title`（16/600） | 16/800 |
| 列表预览、详情正文段落 | `Typography.body` 为基础，详情正文改为 16 / 400 / 行高 24 | 预览 13/500；正文 16/600、行高 1.5 |
| 时间、分组 | `Typography.caption`、`Typography.label` | 分组现在把 label 再加字距 1.2 并 `uppercase`，中文不需要全大写，去掉 `textTransform` |
| 顶栏 | 继续 `ScreenHeader` 的 `Typography.title` | 不改公共顶栏 |
| 保存 | `Typography.bodyStrong`，主色 | 16/800 |

列表预览保持最多 2 行。详情标题不限制行数。

### 3.3 卡片、时间线、标签

列表一行的结构保持：时间线列 + 卡片 + 卡片内 AI 图标。

- 卡片圆角 `Radius.lg`（14），与现在一致。
- 内边距水平 14、垂直 12。卡片之间 `paddingBottom: 8`。
- 普通卡：`surface` + `outline` hairline，无阴影。
- 置顶卡：`surfaceSubtle` + 左侧 2pt `tertiary`。图钉 14pt 留在标题前。
- 时间线列宽 16。圆点 8。置顶圆点用 `tertiary`，其余用 `primary`。竖线宽 hairline、色 `outline`。竖线用负的 `marginBottom` 延伸过卡片间距，使同一天内的线连上。每个日期分组的最后一条，以及标题排序模式下的每一条，不画向下的线。分组标题本身不画圆点，避免和卡片圆点抢层级。
- 标签：高 22 左右，圆角 `Radius.xs`（8），字 `Typography.label` 但字重 600。列表仍最多 4 个。详情展示全部，允许换行。
- AI 摘要：卡片底部一条，左边 2pt `secondary` 细线，文字单行截断。分析中同一位置换成 12pt 菊花 + 「AI 分析中…」，不要换成整卡骨架。
- AI 图标按钮：热区至少 44，图标仍是 `auto-awesome` 18。

详情：

- 标题下 meta 拆成两行视觉，仍是纯文本，不新增字段：第一行「更新于 …」，第二行仅在创建时间不同或已置顶时显示。字用 `caption`，颜色 `textMuted`。
- 正文容器顶部保留 hairline，`marginTop` 用 `Spacing['5xl']`（20）。段落 `marginBottom` 改为 10。标题块用 22/19/17 的现有级别，字重改为 700，不再 800。引用和代码块保留，圆角改用 `Radius.sm`。
- AI 区块用 `surfaceSubtle` 底、圆角 `Radius.lg`、内边距 14，不再只靠一条顶部分割线。评价和建议仍分两段，中间间距 12。

编辑：

- 新建与编辑的区分只做顶栏标题（已有）加标题输入上方一行 `caption`：「新笔记」或「编辑笔记」。不增加步骤条。
- 标题输入保留底边细线，聚焦时底边改为主色。这是颜色切换，时长见第 4 节，不能在聚焦时改字号或 padding，否则光标会跳。
- 工具栏容器改为 hairline + `Radius.md`，背景 `surfaceSubtle`。按钮 44×40 的可视区域可以小于 44，但 `hitSlop` 补到 44 的触控。按下背景 `primaryMuted`，透明度不低于 0.85。
- 超限：工具栏下方文案使用 `colors.danger`，输入容器边框同时改为 `danger`。未超限边框保持 `outline`。不要再弹一层错误动画挡住键盘。

### 3.4 间距与圆角汇总

页面水平边距继续 `Spacing['5xl']`（20）。模块间距 12 或 16，不引入新的间距刻度。弹层圆角 `Radius.xl`（16），与现在接近；遮罩使用 `colors.overlay`。

### 3.5 状态样式

| 状态 | 表现 |
| --- | --- |
| 搜索聚焦 | 边框从 `outline` 过渡到 `primary`，宽度仍是 hairline |
| 搜索有内容 | 清除按钮出现 |
| 标签选中 | 边框和文字改为该标签色，底色为浅色洗。未选中保持 `surface` |
| 排序当前项 | 文字主色 + `check` 图标。不移动列表项 |
| 保存可点 | 主色「保存」 |
| 保存禁用 / 超限 | 文字 `textMuted`，`disabled` |
| 保存中 | 主色小菊花，按钮仍占原宽度，`disabled` |
| 空列表 | 空态图标 + 文案 + 「写一条」按钮，按钮调用现有 `openNewMemo` |
| 搜索无结果 | 同一空态组件，文案改为无匹配，不显示「写一条」，避免用户以为搜索词会被写成新笔记 |

## 4. 动效规范

数值对齐现有 `Motion`，不另起一套「高级弹簧」。实现介质是 RN `Animated`（`useNativeDriver: true` 仅用于 opacity / transform）和系统 `LayoutAnimation`。不把备忘录列表迁到 Reanimated。

`useReducedMotionState()`：`ready === false` 或 `enabled === true` 时，下面所有位移动画、错峰、弹层位移、布局动画全部跳过，状态直接落到终值。按压只保留 `MotionPressable` 已实现的瞬时透明度。

### 4.1 时长与缓动

| 名称 | 值 | 来源 |
| --- | --- | --- |
| 按下 | 90ms，`Animated.timing` | `Motion.pressInMs` |
| 抬起 | `Animated.spring`，`speed: 24`，`bounciness: 3` | `Motion.pressOutSpring` |
| 进入 / 颜色 | 220ms，`Easing.out(Easing.cubic)` | `Motion.enterMs`；颜色不能走 native driver，用 180ms JS 驱动即可，或直接依赖按下样式 |
| 列表错峰 | 每条延迟 40ms，最多 6 条，单条 opacity 0→1 加 `translateY` 8→0，时长 220ms | 新约定，仅首进 |
| 布局变化 | `LayoutAnimation.Presets.easeInEaseOut`（系统约 300ms） | RN 内置 |
| 弹层面板 | 遮罩 opacity 180ms；面板 `translateY` 16→0 与 opacity 并行 220ms | 新约定 |
| 高亮新笔记 | 背景从 `primaryMuted` 回到卡片底色，600ms | 新约定 |
| 加载壳淡入 | 保持 `ScreenLoadingShell` 的 300ms | 已有，不改公共时长 |

禁止弹簧 `bounciness` 大于 `Motion.pressOutSpring.bounciness`。禁止循环动画，除了「AI 分析中」和保存中的系统 `ActivityIndicator`，以及骨架的现有脉冲。这些循环必须在状态结束或卸载时停。

### 4.2 按压

| 控件 | 实现 | 参数 |
| --- | --- | --- |
| 顶栏返回、添加、图钉、编辑 | 已是 `AppIconButton` | 不改 |
| 列表卡片 | 换成 `MotionPressable` | `pressScale={Motion.pressScaleCard}`，`pressOpacity={1}` |
| 标签芯片、排序按钮、清除搜索、弹层选项 | `MotionPressable` | 默认按钮参数。芯片不要用卡片那套更小的缩放，否则选中色和缩放叠在一起看不清 |
| AI 图标 | `MotionPressable`，热区 44 | 默认按钮参数。`onPress` 仍调用 `openAiModal` |
| 左滑操作 | 保持 `Pressable` 的透明度按下 | 不把 `Swipeable` 的子按钮换成会抢手势的动画 Pressable。只保留现有 `opacity: pressed ? 0.9 : 1` |
| 格式工具栏 | 保持现有 `Pressable` + `onPressIn` | 不包 `MotionPressable`。按下时背景 `primaryMuted` |
| 删除确认 | 系统 `Alert` 出现前 `Haptics.impactAsync(Light)` | 不动画化确认框 |
| 长按菜单 | `Haptics.impactAsync(Medium)` 后调用现有 `Alert.alert` | 菜单仍是系统样式 |
| 置顶成功 | 数据更新同时跑布局动画；图钉颜色即时切换 | 不额外弹跳图标 |

`MotionPressable` 会在调用方 `onPressIn` 之前启动自己的动画，然后同步调用传入的 `onPressIn`。工具栏依赖「按下瞬间执行格式」，所以不能套这层。

### 4.3 列表出现与布局

用一个 `listMotionModeRef` 区分原因，避免每次 `setItems` 都重播入场：

- `enter`：本页签首次 `loading` 从 true 变为 false，且列表非空。只播一次。
- `layout`：标签筛选、排序、置顶、删除、转待办/转项目移除。
- `none`：搜索每个字符、下拉刷新、聚焦重载、AI 字段原地更新。

首进：

- 只给视口内前 6 张卡片做 opacity + 8pt 上移。第 7 条及以后直接终态。
- 分组标题不参与错峰。
- 动画值放在行内一次 `useEffect`，依赖「是否已经播过」而不是 `item` 的每次渲染。
- cell 回收：行组件收到 `skipEnter` 后不得再从 0 开始。用模块级 `Set` 记录已经播过的 memo id，页面卸载时清空。

布局：

- 在 `setItems` / `setTagFilter` / `setSortMode` 之前调用 `LayoutAnimation.configureNext`。
- Android 上 RN 0.86 的 `LayoutAnimation` 可直接用；不要调用已废弃的 `UIManager.setLayoutAnimationEnabledExperimental`，除非实机确认 Android 完全不播。若 Android 不播，接受瞬间换位，不为此加 Reanimated。
- 搜索输入不调用 `LayoutAnimation`。
- 下拉刷新和聚焦重载不调用。
- 减少动态时不调用。

新建返回：

- 列表聚焦重载会替换 `items`。在 `setItems` 前比较 id 集合，若有新 id，记入 `highlightId`。
- 该卡片背景 600ms 从 `primaryMuted` 过渡到正常底色。
- 若新卡片不在当前滚动可见区，并且当前排序下它位于列表前 3 个 memo 内，则 `scrollToOffset({ offset: 0, animated: true })`。否则只高亮，不强制滚动，避免把用户从中间拽走。
- 高亮不改变排序。

删除：

- 用户在 `Alert` 里确认之后、`deleteMemo` 成功之后，再 `LayoutAnimation` + `setItems`。失败不播离开动画。
- 先 `swipeableRefs.current[id]?.close()`，再更新数据。
- 时间线是布局的一部分，随行高一起动，不单独做路径动画。

### 4.4 弹层

排序和 AI 继续用 RN `Modal`，`animationType` 改为 `"none"`，自己做遮罩和面板，这样关闭时机仍由 `visible` 控制，不会和 `onPress` 抢两套动画。

- 打开：`visible` 变 true 后 `requestAnimationFrame` 里启动 4.1 的遮罩 + 面板动画。
- 关闭：先播反向 160ms，再 `setSortMenuVisible(false)` / `setAiModalId(null)`。点遮罩、点选项、Android 返回键都走这一个 `requestClose`。
- 点选项时：先写入 `sortMode` 或触发重新生成，再关闭。排序选项在关闭动画开始前就 `setSortMode`，避免动画结束才排序造成「点了没反应」。
- AI 重新生成：不要卸载评价文本。在文本上方或按钮内显示加载，按钮沿用 `AppButton` 的 `loading`。文本区保持最后一次成功内容，失败仍 `toast.error`。首次没有内容时，保留「尚未生成」文案，旁边显示加载，避免高度塌缩。
- `onRequestClose` 必须接到 `requestClose`，否则 Android 返回会把 Modal 直接卸掉，动画状态残留。

`ProjectTagPickerField` 的 Modal 是任务和备忘录共用的。本次不改它的 `animationType`，避免任务页一起变。备忘录侧只保证外层选择条有按下透明度（组件里已经有）。

### 4.5 页面转场

在 `app/_layout.tsx` 里只给三个备忘录屏幕加选项，不动 `screenOptions` 默认值：

```tsx
<Stack.Screen name="memo-list" options={{ animation: 'slide_from_right' }} />
<Stack.Screen name="memo-view/[id]" options={{ animation: 'slide_from_right' }} />
<Stack.Screen name="memo-edit/[id]" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
```

这是把默认行为写明确，不是新转场。编辑页保存中：`gestureEnabled` 在 `saving` 时应为 false，返回按钮现有逻辑已经是 `onBack={saving ? undefined : ...}`。手势开关要用 `<Stack.Screen options={{ gestureEnabled: !saving }} />` 写在编辑页里（该文件已能使用 expo-router 的话需确认是否引入 `Stack`；若页面内声明会覆盖根上同名屏幕选项，实现时只改 `gestureEnabled`，不要把 `animation` 设没）。减少动态时不改原生转场，系统自己会减弱。

不做共享元素的原因：卡片在 `Swipeable` 内，详情是另一个原生屏幕，自建进度条会和返回手势冲突，而且没有现成组件。收益不值得动导航结构。

### 4.6 异步状态

| 状态 | 动画 | 与数据的关系 |
| --- | --- | --- |
| 列表首屏加载 | `CrudScreen` 增加可选骨架，3 条静态笔记占位，骨架用现有 `Skeleton` | `loading === true` 时显示，false 时交给 `ScreenLoadingShell` 淡入。不提前展示空数据 |
| 下拉刷新 | 保持系统菊花 | `refreshing` 结束即停，不额外闪列表 |
| AI 列表分析中 | 现有 `ActivityIndicator`，跟 `pendingAnalysisIds` | 监听结束必须不再转。不要再加一条无限 shimmer |
| AI 完成 | 摘要文本直接替换「分析中」。若该行在屏内，只做 180ms opacity | 文本来自 `addMemoAiReviewSavedListener` 的真实字段 |
| AI 弹层生成中 | 按钮 `loading`，正文保留上一份 | `aiModalLoading` |
| 详情已有内容时再次聚焦 | `loading` 仅在 `row == null` 时为 true | 见步骤 9。这是加载表现，不改变 `getMemo` |
| 保存中 | 按钮 loading + `saving` 早退 | `createMemo` / `updateMemo` 仍在同一函数里 |
| 保存成功 | 不插入成功动画再返回 | 现有 toast + `router.back()` 保持立刻执行 |
| 空态出现 | 不播插画动画 | 直接渲染 `ScreenEmptyState` |

### 4.7 性能与卸载

- 列表行的 opacity / translate 使用 `useNativeDriver: true`。边框颜色动画不要绑在滚动中的每一帧。
- 搜索 `onChangeText` 只 `setSearch`，不创建 `Animated.Value`。
- 错峰最多 6 个 `Animated.timing`。屏幕外行不启动。
- 禁止在 `onScroll` 里 `setState`。
- 每个动画在 `useEffect` 清理函数里 `stop()`。弹层关闭和页面 `blur` 时把面板进度设回 0。
- `highlightId` 定时器在卸载时 `clearTimeout`。
- WebView 正文区域不包 `Animated.View` 做持续动画。

## 5. 分步骤实施计划

每步都应该能单独提交、单独回滚。不要把下面多步合成一个大改动。业务函数的调用参数保持不变。

### 步骤 1：备忘录视觉令牌

目标：把备忘录要用的颜色、圆角、字号角色集中到一个文件，三个页面先改为引用，外观允许有像素级对齐，但不做动画。

文件：

- 新增 `selfApp/constants/memo-ui.ts`。
- 修改 `memo-list.tsx`、`memo-view/[id].tsx`、`memo-edit/[id].tsx` 里的颜色和字号常量引用。此步可以只改列表，详情和编辑留到步骤 9、10，但令牌文件一次写完。

实现：

- 导出 `memoTagStyle(color, isDark)`、`memoCardSurface(colors, pinned)`、`memoTimelineColor(colors, pinned)`。
- 不修改 `PaletteLight` / `PaletteDark` / `Motion` 的现有值。

业务影响：无，只换样式来源。

风险：深色标签改成实心底后，自定义标签若本身是深色，白字对比度可能不够。验收时用一条深色标签看一眼；若对比不足，深色模式改为「深底 + 标签色左边线 + `colors.text`」，不要用半透明叠色。

验收：

- 三页仍能打开。搜索、筛选、进详情、保存的行为与改前一致。
- 代码里备忘录页面不再新增 `rgba(148,163,184,...)` 和 `fontWeight: '800'`。

测试：列表加载、打开详情、新建一条再返回。深色模式切换后卡片和标签仍可读。

回滚：删掉 `memo-ui.ts` 并还原三个页面的样式引用。

### 步骤 2：按压反馈接到现有 MotionPressable

目标：列表里尚未使用公共按压件的控件，按下有 90ms 缩放或透明度，抬起回到弹簧。顶栏已经具备的不重复包一层。

文件：

- `selfApp/app/(profile)/memo-list.tsx`
- 不改 `motion-pressable.tsx`，除非发现它吞掉 `onLongPress`。当前实现会把 `onLongPress` 传给 `AnimatedPressable`，步骤开始时先在模拟器长按一张卡，确认系统菜单仍出现。若被吞，只在卡片上继续用 RN `Pressable`，并把按下样式限制为 `opacity: 0.96`，同时在文档实施笔记里记一笔。不要为了卡片去改公共 `MotionPressable`。

实现：

- 卡片、芯片、排序按钮、清除按钮、AI 图标、排序选项按第 4.2 节的参数替换。
- 左滑按钮和格式工具栏不替换。
- `delayLongPress={360}` 原样保留。

业务影响：无。`onPress` / `onLongPress` 仍指向原回调。

风险：`MotionPressable` 的缩放发生在包裹层上，`Swipeable` 的子视图如果整体缩放，滑动时可能露边。卡片按下缩放目标是 0.985，幅度很小。若滑动中误触发缩放，把卡片的 `pressScale` 改为 `1`，只留按下时不透明度不变、用背景色微变（`surfaceMuted`）代替。

验收：

- 轻点卡片仍进详情。长按仍出系统菜单，菜单项仍是置顶、AI 分析、编辑、删除、取消。
- 点 AI 图标仍出评价弹层，不进详情。
- 减少动态开启后，这些控件不再缩放。

测试：连续点 10 张卡进出详情；按住卡片移动应视为滚动而不是按下卡住。

### 步骤 3：列表静态视觉

目标：在不减少信息的前提下，做出笔记层次和时间线连续性。此步不加进入动画。

文件：`memo-list.tsx` 的 JSX 结构与 `styles`。可把行渲染抽到同目录 `selfApp/components/memo/memo-list-row.tsx`，props 只传展示数据和回调，回调仍由页面传入 `togglePin`、`openAiModal` 等。不要把删除和 AI 请求搬进子组件。

实现：

- 按第 3.3 节改卡片、置顶、标签、AI 行、时间线。
- 分组标题去掉 `uppercase`。
- 搜索框边框使用 `outline`，高度保持约 42，不改成大搜索条。
- 排序按钮热区补到 44，图标仍是 `sort`。
- 空列表给 `ScreenEmptyState` 加 `actionLabel="写一条"` 和 `onAction={openNewMemo}`。无匹配结果不加这个按钮。
- 不改 `renderItem` 的数据分支和 `keyExtractor`。

业务影响：空列表多一个入口，调用的是已有 `openNewMemo`。筛选无结果没有这个按钮。

风险：时间线负 margin 可能盖住下一张卡的圆点。实现时用「线在圆点之下、圆点 zIndex 更高」检查分组内第一条到最后一条。标题排序模式不画连接线。

验收：

- 同一天内竖线视觉连续，下一天分组从新的标题开始，线不穿过标题。
- 置顶卡能在不看图钉的情况下和普通卡区分，同时图钉仍在。
- 一屏可见的备忘条数与改前相差不超过 1 条（用同一数据集目测）。
- 预览仍是 2 行，标签仍最多 4 个，AI 摘要仍 1 行。

测试：全部 / 无标签 / 某个标签 / 标题排序 / 置顶一条 / 取消置顶。空库与搜索无结果各看一次。

### 步骤 4：列表加载骨架与刷新衔接

目标：第一次进列表时用笔记形骨架代替居中大菊花；刷新和返回列表时不要把内容换成骨架。

文件：

- `selfApp/components/crud/crud-screen.tsx`：新增可选 `loadingSkeleton?: React.ReactNode`，传给 `ScreenLoadingShell` 的 `skeleton`。不传时行为与现在完全一致。
- `selfApp/components/memo/memo-list-skeleton.tsx`：新建，仅备忘录使用。3 行占位，结构对齐卡片，使用 `Skeleton`。
- `memo-list.tsx`：只在首次 `loading` 时传入骨架。

实现：

- `ScreenLoadingShell` 已在 `loading` 变 false 时淡入，不要再包一层。
- `reload` 里除了初始 `loading === true`，不要在聚焦刷新和下拉时 `setLoading(true)`。当前列表已经是这样，保持。
- 骨架行数固定 3，不跟真实条数。

业务影响：无。加载失败仍走现有 `error` 和重试。

风险：`CrudScreen` 是共用壳。只加可选 prop，不改默认分支。回归一个其它 CRUD 页（例如食谱列表或心愿单，任选一个使用 `CrudListScreen` 的页面）确认加载仍是菊花。

验收：

- 冷启动进入备忘录看到骨架，数据到了骨架消失、列表出现，没有先闪空态。
- 下拉时列表留在原地，只有系统刷新指示。
- 从详情返回，列表不重新出现整页菊花。

测试：断网或让 `listMemos` 抛错（可临时在开发里拒绝，测完还原）时仍显示错误条和重试，而不是骨架卡死。

### 步骤 5：首次入场，以及筛选 / 排序的布局动画

目标：第一次看到列表时前 6 张卡短促出现；之后筛选和排序换位平滑；搜索打字不播动画。

文件：`memo-list.tsx` 与步骤 3 抽出的行组件。可新增 `selfApp/components/memo/use-memo-list-motion.ts` 放模式判断，不放业务请求。

实现：按第 4.3 节。

- `hasPlayedInitialEnterRef` 在首次内容淡入后置 true。
- 筛选和排序在 `setState` 前 `configureNext`。
- 搜索不调用。
- 减少动态：跳过错峰和 `LayoutAnimation`。

业务影响：无。过滤和排序算法不变。

风险：`LayoutAnimation` 和 `Swipeable` 同时发生会让展开的操作区高度动画异常。调用布局动画前，关闭所有 `swipeableRefs`。若仍冲突，只对筛选和排序保留布局动画，滑动展开期间直接禁止切换排序（现有弹层本来就会挡住列表）。

验收：

- 杀掉页面再进，前几张卡有一次出现动画，滑到下面的卡不再逐个飞入。
- 切换标签和排序时行位置变化，分组标题跟着走，时间线不错位。
- 在搜索框连续输入，列表立即过滤，没有整表重播，输入不丢字。
- 再次从详情返回，不重播入场。

测试：快速连点三个标签；排序三种各切一次；搜索后清空。开启减少动态重复一遍，应变为瞬间切换。

### 步骤 6：置顶、删除、新建回列表

目标：这三类数据变化有可识别的过渡，并在失败时不动布局。

文件：`memo-list.tsx`。不改 `setMemoPinned`、`deleteMemo`、`createMemo`。

实现：

- 置顶 / 取消置顶：请求成功并得到 `updated` 后，再 `LayoutAnimation` + `setItems`。失败只 toast。
- 删除：确认框之后、`deleteMemo` resolve 之后再移除。`catch` 不移除。
- 转待办、转项目成功移除时同样布局动画。转换中的 `ActivityIndicator` 和禁用保持。
- 新建高亮和可选滚到顶部按第 4.3 节。比较 id 的时机是聚焦重载 `setItems` 之前，用 ref 保存上一份 id 集合。第一次加载没有「上一份」，不高亮全部。

业务影响：视觉延迟不超过一帧的 `configureNext`，请求仍是原来的 await。不要在动画回调里才发请求。

风险：聚焦重载和本地表监听可能连续 `setItems` 两次，把高亮冲掉。高亮 id 独立于 items，600ms 内即使再次 setItems 仍作用在同一个 id 上。若该 id 被删掉，清掉高亮。

验收：

- 置顶后该条移到当前排序规则下的置顶区，移动过程连续，失败时位置不变。
- 删除确认前列表不变；确认且成功后该行让出空间；取消删除不变化。
- 新建保存返回后，新行若出现在顶部附近，能看出高亮，高亮结束后与普通卡一致。
- 置顶优先规则仍在：非置顶不会插到置顶前面。

测试：置顶、取消置顶、删除失败（可断网或删掉不存在 id，以现有 toast 为准）、新建、编辑旧条目返回（旧条目不应被当成新高亮，除非 id 是新的）。

### 步骤 7：左滑与长按

目标：保留现有手势和系统菜单，只补触感和按下透明度。

文件：`memo-list.tsx`。

实现：

- 不修改 `Swipeable` 的 `renderRightActions`、阈值和 `overshootRight`。
- 长按回调第一行调用 `Haptics.impactAsync(ImpactFeedbackStyle.Medium)`，用 `.catch(() => {})`，然后执行原来的 `Alert.alert`。
- 删除的破坏性确认前调用 `Light`。置顶这种可逆操作不加成功触感，避免和长按叠两次。
- 打开一行时关闭其它行：在 `onSwipeableWillOpen` 里 `close()` 其它 ref。这是现有缺口的小补强，不改变四个动作。若与动画步骤冲突，可以留在这一步单独做。

业务影响：多一次触感；同时只展开一行。四个动作的回调不变。

风险：触感在模拟器上可能没有震动，以真机为准；模拟器至少不能抛未捕获异常。`onSwipeableWillOpen` 若在某些 RNGH 版本不存在，改用 `onSwipeableOpen`，不要升级库。

验收：

- 跟手展开、松手不足阈值回弹、超过阈值展开，与改前一致。
- 四个按钮仍是置顶、待办、项目、删除，颜色语义仍是 tertiary / primary / secondary / danger。
- 长按仍是系统 Alert，不是自定义浮层。
- 展开 A 行再滑 B 行，A 关闭。

测试：快速左右甩、滑到一半点卡片、滑开后点删除再取消、转换待办成功后该行消失且 Alert 文案不变。

### 步骤 8：排序弹层与 AI 弹层

目标：打开和关闭有遮罩与短位移；AI 加载不把正文卸掉；点击和返回键仍能关闭。

文件：`memo-list.tsx`。可抽 `selfApp/components/memo/memo-center-sheet.tsx`，只接收 `visible`、`onClose`、`children`。不要做成全局 Bottom Sheet，避免影响财务和任务的弹层。

实现：按第 4.4 节。AI 主按钮改用 `AppButton` 的 `loading` 与 `disabled`，文案仍是「开始分析」或「重新生成」。

业务影响：无。`runAiForMemo`、排序枚举、点遮罩关闭保持。

风险：关闭动画期间用户连点选项会切换多次排序。`requestClose` 里用 ref 忽略动画中的第二次关闭，但第一次 `setSortMode` 必须发生。AI 按钮在 `aiModalLoading` 时保持 disabled。

验收：

- 弹层从略低的位置和透明一起出现，关闭时反向，结束后 Modal 不再挡触摸。
- 点遮罩、点关闭图标、Android 返回键都能关。
- 点排序项后列表按该项重排，置顶仍在最前。
- 重新生成时旧评价还在，按钮转圈；成功后文字换成新结果；失败 toast，旧文字还在，转圈停止。
- 分析过程中不能点第二次重新生成。

测试：打开排序后立刻返回；打开 AI 后点遮罩；无内容备忘仍提示「内容为空」而不打开弹层；未配置密钥仍提示配置。

### 步骤 9：详情页阅读与返回不再整页菊花

目标：提高阅读层级；从列表进入和从编辑返回时，已有正文不要被 loading 换掉。

文件：

- `selfApp/app/(profile)/memo-view/[id].tsx`
- `selfApp/components/memo/memo-formatted-body.tsx` 只改 `StyleSheet` 和标题字重。不改 `parseMemoBody` 和 block 类型分支。

实现：

- 字号、标签、AI 区块按第 3.3 节。
- `useFocusEffect` 里：若 `row` 已存在且 id 相同，不要 `setLoading(true)`。首次无数据、id 变化、用户点错误重试时仍 `setLoading(true)`。
- `getMemo` 和 `getTagsByEntity` 仍每次聚焦调用。新数据到达后直接替换，AI 区块若从无到有，外层 opacity 180ms。减少动态则直接显示。
- 正文 `ScrollView` 不要加进入位移动画。
- 图钉请求中的 `disabled` 和颜色切换保持。按下反馈已由 `AppIconButton` 提供。

业务影响：返回详情时用户能继续看到上一次内容，直到新数据写入。若备忘已在别处删除，加载结束后仍进现有 `missing` 态。这不改变删除语义。

风险：旧正文在新数据返回前多停留几百毫秒。若不能接受，只对「从子页面返回」跳过 loading，第一次从列表进入仍可骨架。默认采用「已有 row 就不整页 loading」，因为列表推入本身已经有原生转场，再加菊花会盖住转场结果。

验收：

- 长正文滚动不掉帧到明显卡顿（目测连续滑动）。
- 标题、更新时间、创建时间、置顶文案、全部标签、富文本各块、AI 评价和建议都在。
- 从编辑保存返回，详情更新为新标题，中间不出现全屏「加载备忘…」。
- 下拉刷新仍可用。
- 图片、引用、代码、待办块仍渲染。

测试：无 AI 的备忘、有 AI 的备忘、空正文、仅标题。错误重试仍出现错误条。

### 步骤 10：编辑页视觉与保存状态

目标：分清新建/编辑，收紧保存按钮状态，超限可见；不碰 WebView 选区和键盘偏移。

文件：

- `memo-edit/[id].tsx`
- `memo-format-toolbar.tsx`：仅按下背景色，保留 `onPressIn`。

实现：

- 标题上方一行 caption：「新笔记」或「编辑笔记」。
- 标题输入 `onFocus` / `onBlur` 只切换底边颜色，用 state `titleFocused`，不要动画化高度。
- 保存按钮固定 `minWidth: 64`，三种外观：可保存（主色文字）、不可保存（`textMuted`）、保存中（菊花，宽度不变）。
- `onSave` 开头增加 `if (saving) return`。`disabled` 条件保持 `saving || loading || overLimit`。不要在成功后 `setTimeout` 再 `router.back()`。
- 超限时正文容器 `borderColor = colors.danger`，文案保持现有 KB 计算。
- 不修改 `KeyboardAvoidingView` 的 offset。不监听键盘事件。
- 不修改 `ProjectTagPickerField`。标签条继续用该组件，确认多选后芯片仍出现在字段里。
- 格式按钮不增加“已加粗”锁定态。

业务影响：仅多一道 `saving` 早退，避免第一次 setState 前的双提交。保存参数、截断、后台 AI、返回时机不变。

风险：`if (saving) return` 若误放在校验 toast 之前，逻辑仍正确，因为 saving 为 true 时本来就不应再进。不要用按钮动画的 `onAnimationEnd` 触发保存。

工具栏风险：若按下背景导致 WebView 失焦，撤销背景，只保留现有透明度。这是此步的停止条件。

验收：

- 新建页看到「新笔记」，编辑页看到「编辑笔记」，保存后的数据与改前一致。
- 连续快点保存只产生一条备忘。
- 超限时保存不可点，边框和文案为危险色；删减到限额内后恢复。
- 加粗、列表、图片仍作用在选区上，光标不丢。
- 键盘弹出时仍能滚到正文，工具栏仍能点。此步不要求重做键盘动画。

测试：新建保存、编辑保存、保存失败（断网或让 `updateMemo` 返回 false）、只写正文不写标题、只写标题、插入图片、从标签弹层确认两个标签再保存。标题超过 120 被截断的行为仍在。

### 步骤 11：导航转场写明

目标：列表、详情、编辑使用一致的从右推入，保存中不能侧滑返回导致中途离开。

文件：

- `selfApp/app/_layout.tsx` 三个 `Stack.Screen` 的 `options`。
- `memo-edit/[id].tsx` 在保存中关闭返回手势。需要在页面里渲染 `<Stack.Screen options={{ gestureEnabled: !saving }} />`。先确认 expo-router 57 支持页面内 `Stack.Screen`；本项目其它页面已有这种用法时可照做（`edit-profile.tsx` 已使用）。只覆盖 `gestureEnabled`。

实现：`animation: 'slide_from_right'`。不设置 `animationDuration` 自定义，留给系统。

业务影响：无。路径和参数不变。

风险：页面内 `Stack.Screen` 若覆盖整个 options，可能把根上的 `animation` 冲掉。实现后看一次推入是否仍从右侧进入。若冲突，把 `gestureEnabled` 留在根布局做不到跟 `saving` 联动，则改用编辑页 `navigation.setOptions`，仍只改手势。

验收：

- 个人页 → 列表 → 详情 → 编辑，每次从右进入；返回从左回到上一页。
- 保存请求未完成时，边缘滑动不能离开编辑页；完成后返回列表。
- 系统减少动态打开时，转场仍能完成，不卡在半透明页。

测试：编辑页未保存直接返回（现有行为就是直接返回，没有脏检查，保持）。保存中断网，按钮恢复可点，手势恢复。

### 步骤 12：减少动态、卸载与回归

目标：把前面各步的开关对一遍，清掉泄漏的动画。

文件：前面各步涉及的备忘录文件。此步原则上只补 `if (reduceMotion)` 和 cleanup，不再改布局。

实现：

- 列一张内部检查：入场、LayoutAnimation、弹层、高亮、详情 AI 淡入、搜索边框。
- `ready === false` 的第一帧按减少动态处理。
- 离开列表时清空「已播过入场」的 id 集合和 highlight 定时器。
- 弹层卸载时 `stop()`。

业务影响：无。

风险：把 `ready === false` 当成永久减少动态，会导致正常设备永远没有动画。必须在 `ready` 变 true 且 `enabled === false` 后允许下一次交互使用动画。首进动画如果在 ready 之前就结束加载，则这次不补播，避免加载完成后再闪一次。

验收：

- iOS 设置 → 辅助功能 → 动态效果 → 减弱动态效果：备忘录无错峰、无弹层位移、无布局动画，功能仍可用。
- 关闭该设置后，下一次进入列表能看到首进动画。
- 快速进出页面 10 次，无「在已卸载组件上 setState」警告。

测试：见第 6 节全表。

## 6. 测试清单

项目没有备忘录 UI 自动化测试。`npm run test:memo-richdoc` 只覆盖富文本模型。UI 改造后跑一遍该命令，确认没有误改 `lib/memo-richdoc`。其余在 iOS 模拟器或实机手测。

数据准备：0 条、1 条、约 20 条（含置顶、多标签、有 AI、无正文）、80 条以上长列表。

| 场景 | 操作 | 通过标准 |
| --- | --- | --- |
| 首进列表 | 从个人页进入 | 骨架后出现列表；仅一次入场；条数密度无明显下降 |
| 长列表滚动 | 快速滑动 80 条 | 无逐行重播动画；滚动不因动画掉帧到无法跟随手指 |
| 搜索 | 输入、继续输入、点清除 | 结果即时变化；光标保持；无整表入场 |
| 标签 | 全部、无标签、某一标签、管理标签跳转后返回列表 | 筛选正确；从标签管理回列表不丢已保存数据 |
| 排序 | 三种模式 | 置顶仍在最前；标题模式无日期分组；日期模式分组正确 |
| 进详情 | 点卡片 | 原生从右推入；正文可读；返回后列表不重播入场、不整页菊花 |
| 长按 | 长按卡片 | 系统菜单四项 + 取消；触感失败也不影响菜单 |
| 左滑 | 短滑、长滑、打开后点四项 | 跟手；待办/项目/删除/置顶结果与改前一致 |
| 手势冲突 | 列表左缘返回、卡片右侧滑动、斜向滚动 | 返回和左滑不互相卡住；纵向滚动优先于按下 |
| 下拉 | 列表、详情、编辑各拉一次 | 指示器出现并结束；失败有现有错误提示；内容不闪空 |
| AI | 开始分析、重新生成、空内容、无密钥、后台 pending | 加载跟真实请求结束；失败有 toast；不重复提交 |
| 编辑输入 | 中文、换行、工具栏、图片 | 无光标丢失、无文字跳动、键盘不自己收起 |
| 超限 | 构造超过 512KB 的正文（或在开发中临时把比较值调低，测完还原） | 保存禁用；恢复后可保存 |
| 保存 | 慢网络连点保存 | 只创建/更新一次；成功后返回；失败停留在编辑页且可再试 |
| 新建识别 | 保存新备忘 | 回列表能看到新项；旧项不被高亮 |
| 空态 | 无数据、搜索无结果 | 文案不同；只有真的空列表提供「写一条」 |
| 减少动态 | 系统开关开/关 | 开：无位移动画；关：下一轮进入可再看首进 |
| 深色 | 系统深色 | 卡片、标签、弹层对比度可读 |
| 卸载 | 动画未完时返回 | 无卸载后 setState 警告 |

富文本回归命令（在 `selfApp` 目录）：

```bash
npm run test:memo-richdoc
```

此命令失败时，先确认有没有误改 `lib/memo-richdoc` 或 `lib/memos.ts`。UI 步骤不应该碰到它们。

## 7. 文件改动预估

### 7.1 预计新增

| 文件 | 作用 |
| --- | --- |
| `selfApp/constants/memo-ui.ts` | 备忘录颜色与样式函数 |
| `selfApp/components/memo/memo-list-row.tsx` | 列表行展示，可选，步骤 3 |
| `selfApp/components/memo/memo-list-skeleton.tsx` | 三行骨架 |
| `selfApp/components/memo/memo-center-sheet.tsx` | 排序与 AI 共用的居中面板动画 |
| `selfApp/components/memo/use-memo-list-motion.ts` | 入场/布局/不高亮的模式判断 |

### 7.2 预计修改

| 文件 | 原因 | 谨慎程度 |
| --- | --- | --- |
| `app/(profile)/memo-list.tsx` | 视觉、动画、弹层。文件里同时有删除、转换、AI、排序 | 高。只改渲染和动画触发点，请求函数保持在原位 |
| `app/(profile)/memo-view/[id].tsx` | 阅读样式、跳过已有数据的整页 loading | 中。不要改 `setMemoPinned` 参数 |
| `app/(profile)/memo-edit/[id].tsx` | 保存按钮、超限边框、`saving` 早退、保存中禁止手势 | 高。`onSave` 主体不动 |
| `components/memo/memo-formatted-body.tsx` | 行距与字重 | 低。只动样式 |
| `components/memo/memo-format-toolbar.tsx` | 按下背景 | 中。必须保留 `onPressIn` |
| `components/crud/crud-screen.tsx` | 可选 `loadingSkeleton` | 中。默认路径必须与现在一致 |
| `app/_layout.tsx` | 三个屏幕的 `animation` | 中。不要改其它 `Stack.Screen` |

### 7.3 明确不改

- `lib/memos.ts`、`lib/memo-richdoc/**`、`lib/memo-format.ts`、`lib/memo-ai-background.ts`、`lib/memo-to-task.ts`、`lib/memo-to-project.ts`、`lib/memo-images.ts`
- `hooks/use-page-api-sync.ts`、`hooks/use-page-focus-reload.ts`、`hooks/use-pull-to-refresh.tsx`
- `components/memo/memo-rich-body-input.tsx`
- `components/projects/ProjectTagPickerField.tsx`
- `components/ui/motion-pressable.tsx`、`design-tokens.ts` 的既有数值
- `package.json` 与锁文件

编辑页聚焦即重载草稿的缺陷留在第 1.8 节，不在这些步骤里修。

## 8. 实施顺序与优先级

依赖关系：步骤 1 → 2 → 3。步骤 4 依赖 1 和 `CrudScreen` 的可选 prop，可与步骤 2 并行开发，但不要和步骤 3 的行结构同时改同一段 JSX。步骤 5、6 依赖 3 的行组件。步骤 7 依赖列表行还在用 `Swipeable`。步骤 8 可在步骤 3 之后独立做。步骤 9、10 依赖步骤 1 的令牌，彼此独立。步骤 11 独立，建议在 9、10 之前或之后都可以，只要单独验证转场。步骤 12 最后做。

### P0：基础反馈和最明显的生硬点

可以单独交付。

- 步骤 1 令牌
- 步骤 2 按压
- 步骤 3 列表层次与时间线
- 步骤 10 里的保存早退、保存中宽度稳定、超限边框（即使编辑页其余视觉还没做，这一条也应先做，因为它防重复提交）

P0 不做列表飞入，也不做共享转场。

### P1：三页主要动效

- 步骤 4 骨架与刷新衔接
- 步骤 5 首进与筛选排序
- 步骤 6 置顶、删除、新建高亮
- 步骤 8 两个弹层
- 步骤 9 详情阅读与不再整页菊花
- 步骤 10 的其余视觉（新建/编辑 caption、标题底线、工具栏按下背景）
- 步骤 11 转场声明

### P2：有余力再打磨

- 同一天时间线在最后一项的收尾细节、深色标签对比度微调。
- AI 摘要从「分析中」到正文的 180ms 交叉淡化。若 P1 已经是直接替换且不跳动，P2 可以不做。
- 一行展开时关闭其它行（若没放进步骤 7）。
- 详情 AI 区块从无到有的淡入。

P2 明确放弃：

- 卡片到详情的共享元素。
- 用 Reanimated layout 重写列表。
- 格式工具栏的持久选中态。要做就必须改 WebView 协议，和「输入不丢光标」冲突风险高。
- 改 `ProjectTagPickerField` 的弹层动画。那是任务页共用组件。
- 保存成功后再播一段动画才返回。会改变返回时机，并增加重复点击窗口。

每个优先级做完都应能在模拟器里按第 6 节对应行验收，而不必等全部做完。

## 附录：实现时的停止条件

出现下列情况就停在当前步骤，不要继续加动画来掩盖：

- 正文输入丢光标、键盘自己收起、中文组字被打断。
- 左滑和列表滚动或返回手势互相失效。
- 保存会发出两次 `createMemo` / `updateMemo`。
- 筛选或搜索之后排序结果和 `sortMemos` 不一致。
- 减少动态仍然在跑位移动画，或动画停不下来。
- 为了接动画而把 `lib/memos.ts` 或富文本模型拆开。
