/**
 * 全局助手入口：Agent 液态桌宠。
 * 点击进入完整聊天页；深链 / 分享带载荷仍走 openGlobalAssistant。
 */
import { AgentPet } from '@/components/agent-pet';

const PET_IMAGE = require('@/components/agent-pet/assets/9d439f56-784a-41a9-a057-cecad0adb85b.png');

export function GlobalAssistantHost() {
  return <AgentPet engine="native" imageSource={PET_IMAGE} />;
}
