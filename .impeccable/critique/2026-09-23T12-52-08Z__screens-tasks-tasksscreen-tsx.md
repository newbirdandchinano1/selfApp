---
target: 任务页
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 1
target_identity: "file:F:\\project\\APP\\selfApp\\screens\\tasks\\TasksScreen.tsx"
target_fingerprint: "sha256:4909916f2657249e4eafe1bc5bdaf7b16d4eb19908cb3b05ab6c5e2db10183c6"
target_path: "F:\\project\\APP\\selfApp\\screens\\tasks\\TasksScreen.tsx"
timestamp: 2026-09-23T12-52-08Z
slug: screens-tasks-tasksscreen-tsx
---
Method: dual-agent (A: 14068bdf-9ef2-469b-b946-0875d9d13ce9 · B: 15eb3564-941b-45f0-98d6-ac2aae81d9c3)

目标：`screens/tasks/TasksScreen.tsx`（任务 Tab 首页）· 路由 `app/(tabs)/tasks.tsx`

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | 完成态/骨架/toast 较好；加载失败偏静默，无整页重试 |
| 2 | Match System / Real World | 3 | 「青蛙」「收集箱」贴合；「周课程表」隐喻偏学习场景 |
| 3 | User Control and Freedom | 3 | 撤销/取消齐全；左滑与长按难发现、易误触 |
| 4 | Consistency and Standards | 2 | 骨架≠实屏顺序；MainListViewSwitcher 未挂载却留状态 |
| 5 | Error Prevention | 3 | 高风险有 Alert；习惯「再点=撤销」易误触 |
| 6 | Recognition Rather Than Recall | 2 | 长按指派、左滑升级依赖记忆 |
| 7 | Flexibility and Efficiency | 3 | 快捷输入等偏高手；新手无捷径引导 |
| 8 | Aesthetic and Minimalist Design | 1 | IA 过载，多模块同权堆叠 |
| 9 | Error Recovery | 2 | toast/Alert 有；无持久错误区与一键重试 |
| 10 | Help and Documentation | 1 | 仅碎片 hint，无「今日怎么用」 |
| **Total** | | **23/40** | **Acceptable** |

#### Design Specificity Verdict

**LLM assessment**：概念层有特异性——今日青蛙、周课表格子指派、积分→心愿板、戒除/养成习惯与收集箱，不是通用 Todo 壳。构图层仍偏品类可互换：同构 `sectionCard`、分区标题同权、bgOrb 装饰光斑。Header 中心是日期而非今日意图；完成热力图偏 GitHub 仪表盘，打断「先吃青蛙」叙事。青蛙是角色，但被课表/热力图/多入口抢走主角光。

**Deterministic scan**：`impeccable.cmd detect --json` 对 `TasksScreen.tsx`、`screens/tasks`、`components/tasks`、`app/(tabs)/tasks.tsx` 均为 exit 0、findings `[]`。检测器对 RN/TSX 静默通过，**不能**解读为「无设计问题」。无检测器独有命中；无假阳性可标。

**Visual overlays**：无可靠用户可见 overlay。原因：目标为 Expo/RN 原生表面；会话无浏览器 MCP；无可用 Expo Web 任务页 URL；未执行 live-server / detect.js 注入。

#### Overall Impression

产品叙事（吃青蛙）清晰，但首页被周课表、热力图、习惯、待办、项目叠成功能展示墙。最大机会：把首屏收成「今日作战台」——青蛙英雄 + 一条次要捷径，其余下沉。

#### What's Working

1. **今日青蛙空态与卡片叙事** — 明确下一步（添加/长按指派），徽章区分项目蛙/长期/已删除快照。
2. **待办捷径分流清楚** — 「快速记一条…」+「详细新建」+空态副文案，意图明确。
3. **工程向关怀进 UI** — 骨架、触控最小值、reduced motion、大量中文 a11y 标签、过期/搁置态分化。

#### Priority Issues

**[P0] 首页缺少单一「今日主任务」焦点**
- **Why**：周课表+热力图+习惯+待办+项目同权；违背「先吃青蛙」承诺，首屏过载。
- **Fix**：默认折叠/下沉课表与热力图；首屏仅意图句 + 今日青蛙 + 一个次要入口。
- **Suggested command**：`/impeccable distill` 或 `/impeccable layout`

**[P0] 创建/完成路径选项过多且手势隐藏**
- **Why**：添加待办多条路；青蛙靠长按；升级/删除靠左滑——Jordan/Casey 完不成或误操作。
- **Fix**：显式「指派为青蛙」；行内「⋯」备份左滑；创建收敛为 1 主 1 次。
- **Suggested command**：`/impeccable clarify` 或 `/impeccable onboard`

**[P1] 加载骨架与真实 IA 不一致**
- **Why**：骨架无周课表、待办在习惯前；实屏相反；骨架有 viewSwitcher，实屏无——打断信任与空间记忆。
- **Fix**：骨架与 ListHeader 同序同模块；删或真正启用「本周列表」。
- **Suggested command**：`/impeccable harden`

**[P2] 项目分类与分类菜单选择过载**
- **Why**：SegmentTabs 常 >4；长按菜单 5 项并列，超过工作记忆上限。
- **Fix**：默认 3–4 可见分类 +「更多」；危险操作二次确认并移出主菜单。
- **Suggested command**：`/impeccable quieter`

**[P3] Header 品牌/意图缺失**
- **Why**：仅「M月D日 周X」不传达今日故事，弱化峰终记忆。
- **Fix**：副标题意图（如「先吃这只青蛙」）或今日完成计数。
- **Suggested command**：`/impeccable typeset` 或 `/impeccable bolder`

#### Persona Red Flags

**Jordan（首次）**：先进周课表不知与待办关系；长按指派难验证；待办总览/详细新建/快捷输入三选一困惑；习惯无对等空态。

**Casey（分心移动）**：课表格子易误点；习惯再点=撤销无确认；左滑与勾选同区易滑错；项目头 checkbox/详情/加任务挤在一起。

**Sam（无障碍）**：热力图/课表格子偏视觉；Swipeable 对读屏发现成本高；快捷 TextInput 缺明确 a11y 标签；放大字体后 meta 截断严重。

#### Cognitive Load

清单约 **6/8 失败**（高认知负荷）：缺单一焦点、视觉层级平、一次多事、可见选项常 >4、依赖手势记忆、课表+热力图默认全开。

#### Emotional Journey

峰值在完成青蛙/打卡；谷底在首屏课表复杂度与热力图「回顾压行动」；终点落在项目树，终感「还要管很多」而非「最难一口已咽下」。

#### Minor Observations

- `tasks.tsx` 仅 re-export；青蛙 footer「状态/进行中」与徽章重复；「空项目（无子任务）」偏实现语言；积分 chip 抢注意力；`本周列表` 状态残留像认知债务。

#### Questions to Consider

1. 若只能保留一个首页英雄，选今日青蛙还是周课程表？
2. 完成热力图是否更该属于复盘 Tab？
3. 「记一件事」为何要先学会长按与左滑？
4. 从未出现的「本周列表」是遗留野心还是不敢删的债务？
