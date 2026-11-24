# 如何更换桌宠外观

## 方式一：直接换一张图（最快）

1. 把图片放到：`components/agent-pet/assets/`  
   例如：`pet.png` / `pet.webp`（建议透明底，约 128–256px）
2. 打开 `components/assistant/global-assistant-host.tsx`：

```tsx
const PET_IMAGE = require('@/components/agent-pet/assets/pet.png');

export function GlobalAssistantHost() {
  return <AgentPet imageSource={PET_IMAGE} />;
}
```

传入 `imageSource` 后会替代默认液态精灵，仍保留上下浮动和呼吸缩放。

## 方式二：改默认液态精灵

编辑 `components/agent-pet/components/PetRenderer.tsx` 里的颜色、粒子、光晕即可。  
不传 `imageSource` 时走这套程序化绘制。

## 方式三：接入 Rive（复杂动画）

1. 安装 `rive-react-native`
2. 将 `.riv` 放到本目录
3. 在 `PetRenderer` 的 `engine === 'rive'` 分支实现状态机：  
   `idle` / `thinking` / `working` / `listening` / `success` / `error`
4. 挂载处改为：`<AgentPet engine="rive" />`

未提供可用 `.riv` 前，`engine="rive"` 会回退到 native 绘制。
