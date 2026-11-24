/**
 * Agent 桌宠类型 — UI 与业务解耦；动画引擎可替换。
 */

export type AgentPetVisualState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'listening'
  | 'success'
  | 'error';

export type AgentPetSide = 'left' | 'right';

export type AgentPetPosition = {
  side: AgentPetSide;
  /** 相对安全区顶部的 Y（像素） */
  y: number;
};

export type AgentPetTaskProgress = {
  label: string;
  /** 0–1；未知进度可省略 */
  progress?: number;
};

export type AgentPetBubble = {
  id: string;
  text: string;
  createdAt: number;
};

export type AgentPetQuickAction = {
  id: 'chat' | 'tasks' | 'settings' | 'hide' | string;
  label: string;
  icon?: string;
};

/** 渲染引擎：native MVP；后续可换 rive / skia */
export type AgentPetRenderEngine = 'native' | 'rive';

export const AGENT_PET_SIZE = 64;
export const AGENT_PET_HIT_SLOP = 10;

export const AGENT_PET_QUICK_ACTIONS: AgentPetQuickAction[] = [
  { id: 'chat', label: '对话', icon: 'chat-bubble-outline' },
  { id: 'tasks', label: '任务', icon: 'check-circle-outline' },
  { id: 'settings', label: '设置', icon: 'settings' },
  { id: 'hide', label: '隐藏', icon: 'visibility-off' },
];

export const AGENT_PET_STATUS_LABEL: Record<AgentPetVisualState, string> = {
  idle: '待机',
  thinking: '思考中',
  working: '工作中',
  listening: '倾听中',
  success: '完成',
  error: '异常',
};
