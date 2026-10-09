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
