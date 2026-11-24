/**
 * 桌宠业务编排：视觉状态、气泡、快捷菜单；不直接画 UI。
 */
import type {
  AgentPetBubble,
  AgentPetTaskProgress,
  AgentPetVisualState,
} from '@/components/agent-pet/types/agentPet.types';
import {
  canShowAgentPetBubble,
  loadAgentPetVisible,
  markAgentPetBubbleShown,
  setAgentPetVisible,
  subscribeAgentPetVisible,
} from '@/lib/assistant/agent-pet-prefs';
import {
  createThinkingState,
  type AgentThinkingState,
} from '@/lib/assistant/agent-thinking-status';
import React from 'react';

function thinkingToVisual(t: AgentThinkingState | null): AgentPetVisualState {
  if (!t) return 'idle';
  switch (t.phase) {
    case 'tool':
    case 'generating':
    case 'organizing':
      return 'working';
    case 'thinking':
      return 'thinking';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

export function useAgentPet() {
  const [visible, setVisible] = React.useState(true);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [visualOverride, setVisualOverride] = React.useState<AgentPetVisualState | null>(
    null,
  );
  const [thinking, setThinking] = React.useState<AgentThinkingState | null>(null);
  const [bubble, setBubble] = React.useState<AgentPetBubble | null>(null);
  const [taskProgress, setTaskProgress] = React.useState<AgentPetTaskProgress | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);
  const successTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadAgentPetVisible().then(v => {
      if (!cancelled) setVisible(v);
    });
    return subscribeAgentPetVisible(v => setVisible(v));
  }, []);

  React.useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    };
  }, []);

  const visualState: AgentPetVisualState = React.useMemo(() => {
    if (visualOverride) return visualOverride;
    if (busy) {
      const fromThinking = thinkingToVisual(thinking);
      return fromThinking === 'idle' ? 'thinking' : fromThinking;
    }
    return thinkingToVisual(thinking);
  }, [busy, thinking, visualOverride]);

  const openMenu = React.useCallback(() => {
    setMenuOpen(true);
  }, []);

  const closeMenu = React.useCallback(() => {
    setMenuOpen(false);
  }, []);

  const hidePet = React.useCallback(() => {
    setMenuOpen(false);
    void setAgentPetVisible(false);
  }, []);

  const showPet = React.useCallback(() => {
    void setAgentPetVisible(true);
  }, []);

  const flashSuccess = React.useCallback(() => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setVisualOverride('success');
    successTimerRef.current = setTimeout(() => {
      setVisualOverride(null);
      successTimerRef.current = null;
    }, 1100);
  }, []);

  const flashError = React.useCallback(() => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setVisualOverride('error');
    setThinking(createThinkingState('error'));
    successTimerRef.current = setTimeout(() => {
      setVisualOverride(null);
      setThinking(null);
      successTimerRef.current = null;
    }, 1600);
  }, []);

  const showBubble = React.useCallback((text: string, force = false) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!force && !canShowAgentPetBubble()) return;
    markAgentPetBubbleShown();
    const next: AgentPetBubble = {
      id: `b_${Date.now().toString(36)}`,
      text: trimmed.slice(0, 48),
      createdAt: Date.now(),
    };
    setBubble(next);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => {
      setBubble(cur => (cur?.id === next.id ? null : cur));
      bubbleTimerRef.current = null;
    }, 4200);
  }, []);

  const dismissBubble = React.useCallback(() => {
    setBubble(null);
  }, []);

  return {
    visible,
    menuOpen,
    visualState,
    thinking,
    setThinking,
    bubble,
    taskProgress,
    setTaskProgress,
    busy,
    setBusy,
    openMenu,
    closeMenu,
    hidePet,
    showPet,
    flashSuccess,
    flashError,
    showBubble,
    dismissBubble,
  };
}

export type AgentPetController = ReturnType<typeof useAgentPet>;
