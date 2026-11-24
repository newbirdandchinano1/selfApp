/**
 * Agent Space 快捷域 / 建议句 — 对齐 prototype/agent-preview。
 * 点击后写入输入框或直接发送，不绕过后端能力路由。
 */

export type AgentSkillPrompt = {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  prompt: string;
  accent: string;
};

export type AgentSuggestionChip = {
  id: string;
  label: string;
  prompt: string;
};

export const AGENT_SKILL_PROMPTS: AgentSkillPrompt[] = [
  {
    id: 'tasks',
    icon: '◒',
    title: '任务与项目',
    subtitle: '拆解、安排、推进',
    prompt: '安排今天的任务',
    accent: '#5f8a6e',
  },
  {
    id: 'finance',
    icon: '◈',
    title: '财务记录',
    subtitle: '记账、预算、流水',
    prompt: '帮我记一笔账',
    accent: '#e0b35a',
  },
  {
    id: 'health',
    icon: '◌',
    title: '健康与饮食',
    subtitle: '饮食、菜谱、身体',
    prompt: '分析我今天吃得怎么样',
    accent: '#c47852',
  },
  {
    id: 'road',
    icon: '⌁',
    title: '道路与复盘',
    subtitle: '方向、复盘、洞察',
    prompt: '整理我的道路',
    accent: '#7fa695',
  },
];

export const AGENT_SUGGESTION_CHIPS: AgentSuggestionChip[] = [
  { id: 'focus', label: '今天的重点？', prompt: '我今天的重点是什么？' },
  { id: 'ledger', label: '记录一笔账', prompt: '记录一笔账' },
  { id: 'idea', label: '写下一个想法', prompt: '写下一个想法' },
];

export const AGENT_BRAND = {
  name: '小郑的自我修养',
  crumb: 'AGENT SPACE',
  eyebrow: 'PERSONAL OPERATING SYSTEM',
  greetingLine1: '你好，小郑。',
  greetingLine2: '今天想一起推进什么？',
  blurb:
    '我能把想法变成行动，也能替你整理生活的线索。\n从一条模糊的念头开始，就够了。',
  statusOnline: 'Agent 在线 · 已准备好陪你工作',
} as const;
