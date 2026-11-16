/**
 * 全局助手独立聊天页（阶段五 / S9.2）。
 * FAB / 深链 / openGlobalAssistant → 本页；主路径 /api/v1/agent/chat（优先 stream）。
 * preview_* → confirmAssistantCard（Sheet / 路由）；commit_* → ChatCommitExecutor。
 */
import { ChatComposer } from '@/components/assistant/chat/chat-composer';
import { ChatMessageList } from '@/components/assistant/chat/chat-message-list';
import { ChatSessionHeader } from '@/components/assistant/chat/chat-session-header';
import { ChatSessionListModal } from '@/components/assistant/chat/chat-session-list-modal';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ActionCard } from '@/lib/assistant/action-card';
import {
  createThinkingState,
  type AgentThinkingState,
} from '@/lib/assistant/agent-thinking-status';
import { collectAllowedIdsFromBriefContext } from '@/lib/assistant/brief-context';
import { loadAssistantBriefContext } from '@/lib/assistant/brief-context-load';
import { runAgentChat, runAgentChatStream } from '@/lib/assistant/chat-api-client';
import {
  cancelChatCommit,
  confirmChatCommit,
  patchChatCommitDraft,
  resolveCommitAction,
  trackCommitCardsInMessages,
} from '@/lib/assistant/chat-commit-controller';
import {
  collectPendingOperations,
  reconcileIncomingCommitCards,
} from '@/lib/assistant/commit-reconcile';
import { isStreamUnsupportedError } from '@/lib/assistant/chat-history';
import {
  createChatMessage,
  createChatSession,
  deleteChatSession,
  ensureActiveChatSession,
  getChatSession,
  listChatSessionSummaries,
  saveChatSession,
} from '@/lib/assistant/chat-store';
import type { ChatMessage, ChatSession, ChatSessionSummary, ChatToolTrace } from '@/lib/assistant/chat-types';
import { metaFromAgentResult, partsFromAgentResult, textFromParts } from '@/lib/assistant/chat-types';
import { composeClarifyResubmitText } from '@/lib/assistant/clarify';
import { confirmAssistantCard } from '@/lib/assistant/confirm-execute';
import { takeAssistantLaunchPayload } from '@/lib/assistant/host-controller';
import {
  isMostlyToolCallLeak,
  stripAssistantToolCallLeak,
} from '@/lib/assistant/strip-tool-call-leak';
import {
  CHAT_FRIENDLY_LEN,
  isServerBusyError,
  toast,
  toUserMessage,
} from '@/lib/app-feedback';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';

const DELTA_FLUSH_MS = 48;

function firstParam(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/** 识图建菜：把本轮用户附图写入 commit_recipe 草稿，保存时才能上传成品图 */
function attachTurnImageToRecipeCards(
  cards: ActionCard[],
  imageDataUri: string | null | undefined,
): ActionCard[] {
  const img = imageDataUri?.trim();
  if (!img || !cards.length) return cards;
  return cards.map(card => {
    const action = (card.confirm_action || card.commit_action || '').trim();
    if (action !== 'commit_recipe') return card;
    if (card.intent === 'delete' || card.intent === 'update') return card;
    const draft = { ...(card.draft ?? {}) };
    if (
      draftStringish(draft.finished_image_uri) ||
      draftStringish(draft.image_uri) ||
      draftStringish(draft.recipe_id) ||
      draftStringish(draft.id)
    ) {
      return card;
    }
    // 移动分类草稿不挂图
    if (
      draftStringish(draft.from_category_name) ||
      draftStringish(draft.from_category_id) ||
      Array.isArray(draft.recipe_ids)
    ) {
      return card;
    }
    return {
      ...card,
      draft: { ...draft, finished_image_uri: img },
    };
  });
}

function draftStringish(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

export default function AssistantChatScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const params = useLocalSearchParams<{
    text?: string | string[];
    autoSubmit?: string | string[];
    new?: string | string[];
  }>();

  const [session, setSession] = React.useState<ChatSession | null>(null);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [confirmingCardId, setConfirmingCardId] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [summaries, setSummaries] = React.useState<ChatSessionSummary[]>([]);
  const [streamingMessageId, setStreamingMessageId] = React.useState<string | null>(null);
  const [thinking, setThinking] = React.useState<AgentThinkingState | null>(null);
  const [stickToBottomToken, setStickToBottomToken] = React.useState(0);
  const listRef = React.useRef<FlatList<ChatMessage> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const bootRef = React.useRef(false);
  const autoSentRef = React.useRef(false);
  const sessionRef = React.useRef<ChatSession | null>(null);
  const busyRef = React.useRef(false);
  const thinkingRef = React.useRef<AgentThinkingState | null>(null);
  /** S5：待发送附图（启动载荷 / 本轮消费后清空） */
  const pendingImageRef = React.useRef<string | null>(null);
  const [pendingImageUri, setPendingImageUri] = React.useState<string | null>(null);
  /** 本轮已发出的附图，供识图建菜草稿挂成品图 */
  const lastTurnImageDataUriRef = React.useRef<string | null>(null);

  const setThinkingState = React.useCallback((next: AgentThinkingState | null) => {
    thinkingRef.current = next;
    setThinking(next);
  }, []);

  const refreshSummaries = React.useCallback(async () => {
    setSummaries(await listChatSessionSummaries());
  }, []);

  const persist = React.useCallback(async (next: ChatSession) => {
    sessionRef.current = next;
    setSession(next);
    await saveChatSession(next);
    void refreshSummaries();
  }, [refreshSummaries]);

  const sendMessage = React.useCallback(
    async (
      rawText: string,
      opts?: { clearDraft?: boolean; imageDataUri?: string | null },
    ) => {
      const imageDataUri =
        (opts?.imageDataUri ?? pendingImageRef.current)?.trim() || null;
      // 纯附图不塞「业务草稿」默认句：后端优先业务，非业务再闲聊
      const text = rawText.trim();
      if ((!text && !imageDataUri) || busyRef.current) return;

      let current = sessionRef.current;
      if (!current) {
        current = await createChatSession({ makeActive: true });
      }

      const userMsg = createChatMessage({
        role: 'user',
        text,
        imageUri: imageDataUri || undefined,
        status: 'done',
      });
      const assistantId = createChatMessage({
        role: 'assistant',
        text: '',
        status: 'streaming',
      }).id;
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        createdAt: Date.now(),
        status: 'streaming',
      };

      const historyForApi = current.messages;
      let nextSession: ChatSession = {
        ...current,
        messages: [...current.messages, userMsg, assistantPlaceholder],
        updatedAt: Date.now(),
      };
      await persist(nextSession);
      if (opts?.clearDraft !== false) setDraft('');
      // 本轮附图消费掉，避免下一条误带；保留 lastTurn 供确认卡挂成品图
      lastTurnImageDataUriRef.current = imageDataUri;
      pendingImageRef.current = null;
      setPendingImageUri(null);
      busyRef.current = true;
      setBusy(true);
      setStreamingMessageId(assistantId);
      setThinkingState(createThinkingState('thinking'));
      setStickToBottomToken(t => t + 1);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingPatch: {
        partialText: string;
        traces: ChatToolTrace[];
        status: ChatMessage['status'];
        cards?: ActionCard[];
      } | null = null;

      const applyPatchNow = (
        partialText: string,
        traces: ChatToolTrace[],
        status: ChatMessage['status'],
        cards?: ActionCard[],
        liveCards?: ActionCard[],
      ) => {
        setSession(prev => {
          if (!prev) return prev;
          const updated: ChatSession = {
            ...prev,
            messages: prev.messages.map(m =>
              m.id === assistantId
                ? {
                    ...m,
                    parts: partsFromAgentResult({
                      reply: partialText,
                      toolTraces: traces,
                      cards: cards ?? liveCards ?? [],
                    }),
                    status,
                  }
                : m,
            ),
          };
          sessionRef.current = updated;
          return updated;
        });
      };

      try {
        const liveTraces: ChatToolTrace[] = [];
        const liveCards: ActionCard[] = [];
        let streamedText = '';
        let usedStream = false;
        let sawToolCall = false;

        const flushPending = () => {
          if (!pendingPatch) return;
          const p = pendingPatch;
          pendingPatch = null;
          applyPatchNow(p.partialText, p.traces, p.status, p.cards, liveCards);
        };

        const patchAssistant = (
          partialText: string,
          traces: ChatToolTrace[],
          status: ChatMessage['status'],
          cards?: ActionCard[],
          opts?: { immediate?: boolean },
        ) => {
          if (opts?.immediate) {
            if (flushTimer) {
              clearTimeout(flushTimer);
              flushTimer = null;
            }
            pendingPatch = null;
            applyPatchNow(partialText, traces, status, cards, liveCards);
            return;
          }
          pendingPatch = { partialText, traces, status, cards };
          if (flushTimer) return;
          flushTimer = setTimeout(() => {
            flushTimer = null;
            flushPending();
          }, DELTA_FLUSH_MS);
        };

        const enterGenerating = () => {
          if (thinkingRef.current?.phase === 'generating') return;
          setThinkingState(createThinkingState('generating'));
        };

        let result: Awaited<ReturnType<typeof runAgentChat>>;
        let streamErrorHint = '';
        // S9.6：把未确认草稿带给 Agent，便于「改成20」复用 operation_id
        const pendingOperations = collectPendingOperations(nextSession);
        try {
          result = await runAgentChatStream({
            message: text,
            sessionId: nextSession.remoteSessionId,
            historyMessages: historyForApi,
            imageDataUri,
            pendingOperations,
            signal: ac.signal,
            handlers: {
              onSession: sid => {
                setSession(prev => {
                  if (!prev) return prev;
                  const updated = { ...prev, remoteSessionId: sid };
                  sessionRef.current = updated;
                  return updated;
                });
              },
              onToolCall: ev => {
                sawToolCall = true;
                if (streamedText.trim()) return;
                setThinkingState(
                  createThinkingState('tool', { toolName: ev.name || undefined }),
                );
              },
              onToolResult: ev => {
                liveTraces.push({
                  id: ev.id,
                  name: ev.name,
                  ok: ev.ok,
                  summary: ev.summary,
                });
                if (!streamedText.trim()) {
                  setThinkingState(createThinkingState('organizing'));
                }
                patchAssistant(streamedText, [...liveTraces], 'streaming', undefined, {
                  immediate: true,
                });
              },
              onCard: card => {
                const enriched = attachTurnImageToRecipeCards(
                  [card],
                  lastTurnImageDataUriRef.current,
                )[0];
                if (!liveCards.some(c => c.id === enriched.id)) liveCards.push(enriched);
                else {
                  const idx = liveCards.findIndex(c => c.id === enriched.id);
                  if (idx >= 0) liveCards[idx] = enriched;
                }
                if (!streamedText.trim() && sawToolCall) {
                  setThinkingState(createThinkingState('organizing'));
                }
                // 显式传入 liveCards，避免流式过程中确认卡未挂到气泡 parts
                patchAssistant(streamedText, [...liveTraces], 'streaming', [...liveCards], {
                  immediate: true,
                });
              },
              onDelta: chunk => {
                usedStream = true;
                streamedText += chunk;
                enterGenerating();
                patchAssistant(streamedText, [...liveTraces], 'streaming');
              },
              onError: msg => {
                streamErrorHint = msg;
              },
            },
          });
        } catch (streamErr) {
          if ((streamErr as Error)?.name === 'AbortError') {
            flushPending();
            const stopped = streamedText.trim() || '已停止生成';
            nextSession = {
              ...nextSession,
              messages: (sessionRef.current ?? nextSession).messages.map(m =>
                m.id === assistantId
                  ? {
                      ...m,
                      parts: partsFromAgentResult({
                        reply: stopped,
                        toolTraces: liveTraces,
                        cards: liveCards,
                      }),
                      status: 'done',
                    }
                  : m,
              ),
              updatedAt: Date.now(),
            };
            await persist(nextSession);
            return;
          }
          // 仅环境不支持流式时回退聚合接口；断网/401/超时直接抛
          if (!isStreamUnsupportedError(streamErr)) {
            throw streamErr;
          }
          result = await runAgentChat({
            message: text,
            sessionId: nextSession.remoteSessionId,
            historyMessages: historyForApi,
            imageDataUri,
            pendingOperations,
            signal: ac.signal,
          });
          usedStream = false;
        }

        flushPending();

        if (streamErrorHint && !result.reply.trim()) {
          result = { ...result, reply: streamErrorHint };
        }

        // 合并 stream 累计卡与 done 卡，避免只信一侧导致确认卡丢失
        const rawFinalCards = (() => {
          const merged: ActionCard[] = [];
          const push = (c: ActionCard) => {
            const idx = merged.findIndex(x => x.id === c.id);
            if (idx >= 0) merged[idx] = c;
            else merged.push(c);
          };
          for (const c of liveCards) push(c);
          for (const c of result.cards) push(c);
          return merged;
        })();
        // S9.6：同卡改稿合并进原 operation_id；「再记一笔」保留新卡。
        // 调和时去掉「本轮助手气泡」里已流式画出的卡，避免 open 扫描命中自己，
        // 导致 merge-only 后 finalParts 无卡、确认卡闪一下消失。
        const baseSession = sessionRef.current ?? nextSession;
        const baseForReconcile: ChatSession = {
          ...baseSession,
          messages: baseSession.messages.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  parts: m.parts.filter(p => p.type !== 'action_card'),
                }
              : m,
          ),
        };
        const reconciled = reconcileIncomingCommitCards({
          session: baseForReconcile,
          incoming: attachTurnImageToRecipeCards(
            rawFinalCards,
            lastTurnImageDataUriRef.current,
          ),
          userMessage: text,
        });
        const finalCards = attachTurnImageToRecipeCards(
          reconciled.cards,
          lastTurnImageDataUriRef.current,
        );
        // 以服务端 done.reply 为准（ReplyValidator 可能已改写/剔除 tool-call 泄漏）；
        // streamedText 仅在 done 未带回正文时兜底。
        // 再剥一层：模型把 tool 写成正文时，避免最终气泡残留 recipe.xxx + JSON。
        let finalReply = (result.reply || '').trim()
          ? result.reply
          : streamedText || result.reply;
        finalReply = stripAssistantToolCallLeak(finalReply);
        const tracesForParts = result.tool_traces.length ? result.tool_traces : liveTraces;
        const toolClaimedCard = tracesForParts.some(t =>
          /确认卡/.test(String(t.summary || '')),
        );
        if (!finalReply.trim() && finalCards.length) {
          finalReply = '已为你准备好操作卡，请点击确认。';
        } else if (!finalReply.trim() && isMostlyToolCallLeak(streamedText)) {
          finalReply =
            '刚才工具调用写成了文字。请再说一次你想做什么，我会重新出确认卡。';
        } else if (toolClaimedCard && !finalCards.length) {
          // 工具摘要说有确认卡但 parts 无卡：明确告知，避免假「点卡片」
          finalReply = `${finalReply.trim() ? `${finalReply.trim()}\n\n` : ''}确认卡未能显示在当前气泡。请再发一次同样请求，或到对应页面手动操作。`;
        }
        // 流式/非流式收尾都立刻把卡写进气泡，防止只更新文字丢卡
        enterGenerating();
        patchAssistant(finalReply, tracesForParts, 'streaming', finalCards, {
          immediate: true,
        });
        const finalParts = partsFromAgentResult({
          reply: finalReply,
          toolTraces: tracesForParts,
          cards: finalCards,
        });
        // S10 P3：绑定 unofficial_advice / source_labels / answer_status
        const finalMeta = metaFromAgentResult(result.metadata);
        trackCommitCardsInMessages([{ id: assistantId, role: 'assistant', parts: finalParts, createdAt: Date.now() }]);

        nextSession = {
          ...reconciled.session,
          remoteSessionId: result.session_id ?? reconciled.session.remoteSessionId,
          messages: reconciled.session.messages.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  parts: finalParts,
                  meta: finalMeta,
                  status: 'done',
                }
              : m,
          ),
          updatedAt: Date.now(),
        };
        await persist(nextSession);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        const errText = toUserMessage(e, '助手请求失败', { maxLen: CHAT_FRIENDLY_LEN });
        setThinkingState(createThinkingState('error', { label: '请求失败' }));
        nextSession = {
          ...(sessionRef.current ?? nextSession),
          messages: (sessionRef.current ?? nextSession).messages.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  parts: [{ type: 'text', text: errText }],
                  status: 'error',
                }
              : m,
          ),
          updatedAt: Date.now(),
        };
        await persist(nextSession);
        // 瞬时繁忙已在网络层静默重试；气泡内已有错误文案，不再 Toast 打扰
        if (!isServerBusyError(e)) toast.error(errText);
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
        busyRef.current = false;
        setBusy(false);
        setStreamingMessageId(null);
        setThinkingState(null);
      }
    },
    [persist, setThinkingState],
  );

  const sendMessageRef = React.useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  React.useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;

    let cancelled = false;
    void (async () => {
      const wantNew = firstParam(params.new) === '1';
      const launch = takeAssistantLaunchPayload();
      const paramText = firstParam(params.text)?.trim() || '';
      const launchText = launch?.text?.trim() || '';
      const autoSubmit =
        launch?.autoSubmit === true || firstParam(params.autoSubmit) === '1';

      let next: ChatSession;
      if (wantNew) {
        next = await createChatSession({ makeActive: true });
      } else {
        next = await ensureActiveChatSession();
      }
      if (cancelled) return;

      sessionRef.current = next;
      setSession(next);
      await refreshSummaries();

      const seedText = launchText || paramText;
      if (seedText) setDraft(seedText);

      const launchImage = launch?.imageDataUri?.trim() || null;
      if (launchImage) {
        pendingImageRef.current = launchImage;
        setPendingImageUri(launchImage);
      }

      if (autoSubmit && (seedText || launchImage) && !autoSentRef.current) {
        autoSentRef.current = true;
        requestAnimationFrame(() => {
          void sendMessageRef.current(seedText || '', {
            clearDraft: true,
            imageDataUri: launchImage,
          });
        });
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
    // 仅首屏启动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearPendingImage = React.useCallback(() => {
    pendingImageRef.current = null;
    setPendingImageUri(null);
  }, []);

  const applyPickedImage = React.useCallback(
    (asset: { uri?: string | null; base64?: string | null; mimeType?: string | null }) => {
      const b64 = asset.base64?.trim();
      if (!b64) {
        toast.error('无法读取图片，请换一张重试');
        return;
      }
      const mime = asset.mimeType?.trim() || 'image/jpeg';
      const dataUri = `data:${mime};base64,${b64}`;
      pendingImageRef.current = dataUri;
      // 预览优先用本地 file URI，避免大图 data URI 卡顿
      setPendingImageUri(asset.uri?.trim() || dataUri);
    },
    [],
  );

  const pickChatImage = React.useCallback(async (source: 'library' | 'camera') => {
    if (busyRef.current) return;
    try {
      if (source === 'library') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          toast.info('需要相册权限才能选图');
          return;
        }
        const picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.85,
          base64: true,
        });
        const asset = picked.assets?.[0];
        if (picked.canceled || !asset) return;
        applyPickedImage(asset);
        return;
      }

      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        toast.info('需要相机权限才能拍照');
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });
      const asset = shot.assets?.[0];
      if (shot.canceled || !asset) return;
      applyPickedImage(asset);
    } catch (e) {
      toast.error(toUserMessage(e, '选图失败'));
    }
  }, [applyPickedImage]);

  const onPickImage = React.useCallback(() => {
    if (busyRef.current) return;
    Alert.alert('添加图片', undefined, [
      { text: '从相册选择', onPress: () => void pickChatImage('library') },
      { text: '拍照', onPress: () => void pickChatImage('camera') },
      { text: '取消', style: 'cancel' },
    ]);
  }, [pickChatImage]);

  const onNewChat = React.useCallback(async () => {
    if (busyRef.current) return;
    abortRef.current?.abort();
    const next = await createChatSession({ makeActive: true });
    sessionRef.current = next;
    setSession(next);
    setDraft('');
    clearPendingImage();
    setHistoryOpen(false);
    autoSentRef.current = false;
    void refreshSummaries();
  }, [clearPendingImage, refreshSummaries]);

  const onSelectSession = React.useCallback(
    async (sessionId: string) => {
      if (busyRef.current) return;
      const found = await getChatSession(sessionId);
      if (!found) {
        toast.info('对话不存在或已过期');
        return;
      }
      sessionRef.current = found;
      setSession(found);
      await saveChatSession(found);
      setHistoryOpen(false);
      setDraft('');
      clearPendingImage();
      void refreshSummaries();
    },
    [clearPendingImage, refreshSummaries],
  );

  const onDeleteSession = React.useCallback(
    async (sessionId: string) => {
      await deleteChatSession(sessionId);
      if (sessionRef.current?.id === sessionId) {
        const next = await createChatSession({ makeActive: true });
        sessionRef.current = next;
        setSession(next);
        setDraft('');
      }
      void refreshSummaries();
    },
    [refreshSummaries],
  );

  const onConfirmCard = React.useCallback(async (card: ActionCard) => {
    if (confirmingCardId) return;
    const lockId = card.operation_id || card.id;
    setConfirmingCardId(lockId);
    try {
      // S9.2：commit_* 走统一状态机 + 可插拔 Executor
      if (resolveCommitAction(card)) {
        const cur = sessionRef.current;
        if (!cur) return;
        // 兜底：确认前再挂一次本轮附图，避免流式合并丢 finished_image_uri
        const cardWithImage =
          attachTurnImageToRecipeCards([card], lastTurnImageDataUriRef.current)[0] ?? card;
        const outcome = await confirmChatCommit({ session: cur, card: cardWithImage });
        await persist(outcome.session);
        if (outcome.skipped) return;
        if (outcome.op?.status === 'succeeded') {
          toast.success(outcome.op.result?.message?.trim() || '已保存');
        } else if (outcome.op?.status === 'failed') {
          toast.error(outcome.op.error?.message || '保存失败');
        }
        return;
      }

      let allowedIds: string[] | undefined;
      let assignYmd: string | undefined;
      try {
        const brief = await loadAssistantBriefContext();
        allowedIds = collectAllowedIdsFromBriefContext(brief);
        assignYmd = brief.meta?.today_ymd;
      } catch {
        // 白名单缺失时仍允许预览类确认（sanitize 会降级）
      }
      const r = await confirmAssistantCard(card, { allowedIds, assignYmd });
      if (!r.ok) {
        if (r.plan.kind === 'clarify') toast.info(r.error);
        else toast.error(r.error);
        return;
      }
      if (r.plan.kind === 'frog_assign') {
        toast.success('已指派青蛙');
      }
    } catch (e) {
      toast.error(toUserMessage(e, '执行失败'));
    } finally {
      setConfirmingCardId(null);
    }
  }, [confirmingCardId, persist]);

  const onCancelCard = React.useCallback(
    (card: ActionCard) => {
      if (!resolveCommitAction(card)) return;
      const cur = sessionRef.current;
      if (!cur) return;
      const { session: next } = cancelChatCommit({ session: cur, card });
      void persist(next);
      toast.info('已取消');
    },
    [persist],
  );

  const onDraftFieldChange = React.useCallback(
    (card: ActionCard, key: string, value: string) => {
      if (!resolveCommitAction(card)) return;
      const cur = sessionRef.current;
      if (!cur) return;
      const { session: next } = patchChatCommitDraft({
        session: cur,
        card,
        patches: [{ key, value }],
      });
      sessionRef.current = next;
      setSession(next);
      // 输入过程不立刻落盘，避免每键写 AsyncStorage；离开/确认时 save
    },
    [],
  );

  const onClarifyChoice = React.useCallback(
    (card: ActionCard, choice: string) => {
      if (busyRef.current) return;
      const draftOrig =
        typeof card.draft?.original_message === 'string'
          ? card.draft.original_message.trim()
          : '';
      let orig = draftOrig;
      if (!orig) {
        const msgs = sessionRef.current?.messages ?? [];
        for (let i = msgs.length - 1; i >= 0; i -= 1) {
          if (msgs[i]?.role === 'user') {
            orig = textFromParts(msgs[i].parts).trim();
            break;
          }
        }
      }
      const nextText = composeClarifyResubmitText(orig, choice);
      if (!nextText.trim()) return;
      void sendMessage(nextText);
    },
    [sendMessage],
  );

  const title = session?.title && session.title !== '新对话'
    ? session.title
    : session?.messages.some(m => m.role === 'user' && textFromParts(m.parts))
      ? session.title
      : '助手';

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ChatSessionHeader
        title={title}
        onBack={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/(tabs)' as never);
        }}
        onNewChat={() => void onNewChat()}
        onOpenHistory={() => {
          void refreshSummaries();
          setHistoryOpen(true);
        }}
      />

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>
        <ChatMessageList
          messages={session?.messages ?? []}
          listRef={listRef}
          confirmingCardId={confirmingCardId}
          onConfirmCard={card => void onConfirmCard(card)}
          onCancelCard={onCancelCard}
          onDraftFieldChange={onDraftFieldChange}
          onClarifyChoice={onClarifyChoice}
          streamingMessageId={streamingMessageId}
          thinking={thinking}
          stickToBottomToken={stickToBottomToken}
        />
        <ChatComposer
          value={draft}
          onChangeText={setDraft}
          hasPendingImage={Boolean(pendingImageUri)}
          pendingImageUri={pendingImageUri}
          placeholder={
            pendingImageUri ? '可补充说明，或直接发送识别图片…' : undefined
          }
          onPickImage={onPickImage}
          onClearPendingImage={clearPendingImage}
          onSend={() => void sendMessage(draft)}
          onCancel={() => abortRef.current?.abort()}
          busy={busy}
        />
      </KeyboardAvoidingView>

      <ChatSessionListModal
        visible={historyOpen}
        sessions={summaries}
        activeSessionId={session?.id ?? null}
        onClose={() => setHistoryOpen(false)}
        onSelect={id => void onSelectSession(id)}
        onDelete={id => void onDeleteSession(id)}
        onNewChat={() => void onNewChat()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});
