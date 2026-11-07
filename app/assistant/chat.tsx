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
import { partsFromAgentResult, textFromParts } from '@/lib/assistant/chat-types';
import { confirmAssistantCard } from '@/lib/assistant/confirm-execute';
import { takeAssistantLaunchPayload } from '@/lib/assistant/host-controller';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
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

export default function AssistantChatScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const params = useLocalSearchParams<{
    text?: string | string[];
    autoSubmit?: string | string[];
    new?: string | string[];
    focusBrief?: string | string[];
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
      const text =
        rawText.trim() ||
        (imageDataUri ? '请识别这张图，并按合适的业务草稿帮我处理' : '');
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
      // 本轮附图消费掉，避免下一条误带
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
                if (!liveCards.some(c => c.id === card.id)) liveCards.push(card);
                if (!streamedText.trim() && sawToolCall) {
                  setThinkingState(createThinkingState('organizing'));
                }
                patchAssistant(streamedText, [...liveTraces], 'streaming', undefined, {
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

        const rawFinalCards = result.cards.length ? result.cards : liveCards;
        // S9.6：同卡改稿合并进原 operation_id；「再记一笔」保留新卡
        const baseForReconcile = sessionRef.current ?? nextSession;
        const reconciled = reconcileIncomingCommitCards({
          session: baseForReconcile,
          incoming: rawFinalCards,
          userMessage: text,
        });
        const finalCards = reconciled.cards;
        // 非流式回退：一次性展示全文（禁止假打字机）
        if (!usedStream) {
          enterGenerating();
          patchAssistant(result.reply, result.tool_traces, 'streaming', finalCards, {
            immediate: true,
          });
        }

        const finalParts = partsFromAgentResult({
          reply: usedStream ? streamedText || result.reply : result.reply,
          toolTraces: result.tool_traces.length ? result.tool_traces : liveTraces,
          cards: finalCards,
        });
        trackCommitCardsInMessages([{ id: assistantId, role: 'assistant', parts: finalParts, createdAt: Date.now() }]);

        nextSession = {
          ...reconciled.session,
          remoteSessionId: result.session_id ?? reconciled.session.remoteSessionId,
          messages: reconciled.session.messages.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  parts: finalParts,
                  status: 'done',
                }
              : m,
          ),
          updatedAt: Date.now(),
        };
        await persist(nextSession);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        const errText = toUserMessage(e, '助手请求失败');
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
        toast.error(errText);
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
      const focusBrief = launch?.focusBrief || firstParam(params.focusBrief) === '1';
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

      if (focusBrief && !seedText && !launchImage) {
        const hint = createChatMessage({
          role: 'assistant',
          text: '今日任务与习惯简报在任务页顶部，可下拉刷新查看建议卡。需要的话也可以直接问我今天该优先做什么。',
          status: 'done',
        });
        const withHint: ChatSession = {
          ...next,
          messages: [...next.messages, hint],
          updatedAt: Date.now(),
        };
        await persist(withHint);
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

  const onNewChat = React.useCallback(async () => {
    if (busyRef.current) return;
    abortRef.current?.abort();
    const next = await createChatSession({ makeActive: true });
    sessionRef.current = next;
    setSession(next);
    setDraft('');
    setHistoryOpen(false);
    autoSentRef.current = false;
    void refreshSummaries();
  }, [refreshSummaries]);

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
      void refreshSummaries();
    },
    [refreshSummaries],
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
        const outcome = await confirmChatCommit({ session: cur, card });
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
          streamingMessageId={streamingMessageId}
          thinking={thinking}
          stickToBottomToken={stickToBottomToken}
        />
        <ChatComposer
          value={draft}
          onChangeText={setDraft}
          hasPendingImage={Boolean(pendingImageUri)}
          placeholder={
            pendingImageUri ? '可补充说明，或直接发送识别图片…' : undefined
          }
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
