export { AgentPet } from '@/components/agent-pet/components/AgentPet';
export { PetRenderer } from '@/components/agent-pet/components/PetRenderer';
export { useAgentPet } from '@/components/agent-pet/hooks/useAgentPet';
export { useAgentPetAnimation } from '@/components/agent-pet/hooks/useAgentPetAnimation';
export { useAgentPetPosition } from '@/components/agent-pet/hooks/useAgentPetPosition';
export {
  emitAgentPetEvent,
  notifyAgentPetMessage,
  subscribeAgentPetEvents,
} from '@/lib/assistant/agent-pet-events';
export type {
  AgentPetBubble,
  AgentPetPosition,
  AgentPetQuickAction,
  AgentPetRenderEngine,
  AgentPetSide,
  AgentPetTaskProgress,
  AgentPetVisualState,
} from '@/components/agent-pet/types/agentPet.types';
