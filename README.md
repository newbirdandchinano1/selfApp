# 小郑的自我修养

Expo Router + React Native 自我管理应用（健康 / 任务 / 财务 / 复盘 / 我的）。

## 开发

```bash
npm install
npx expo start
```

自定义原生模块需使用 development build（`expo-dev-client`），不可依赖 Expo Go。

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
