/**
 * 全局助手入口：悬浮钮 + 万能输入 Sheet + ActionCard 确认。
 * P0～P2：route / turn / compose / 澄清。
 * P3：外部 openGlobalAssistant、剪贴板「用助手处理」、会话本地缓存。
 */
import { glassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import type { ActionCard } from '@/lib/assistant/action-card';
import { composeClarifyResubmitText } from '@/lib/assistant/clarify';
import { readClipboardForAssistant } from '@/lib/assistant/clipboard';
import { runAssistantCompose } from '@/lib/assistant/compose-client';
import { looksLikeComposeGoal } from '@/lib/assistant/compose-intent';
import { confirmAssistantCard } from '@/lib/assistant/confirm-execute';
import { collectAllowedIdsFromBriefContext } from '@/lib/assistant/brief-context';
import {
  subscribeGlobalAssistant,
  type OpenGlobalAssistantOpts,
} from '@/lib/assistant/host-controller';
import { runAssistantRoute } from '@/lib/assistant/route-client';
import {
  clearAssistantSession,
  loadAssistantSession,
  saveAssistantSession,
} from '@/lib/assistant/session-store';
import { runAssistantTurn } from '@/lib/assistant/turn-client';
import { splitImageBase64AndMime } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const C = {
  paper: '#FFFCF5',
  ink: '#2F3B32',
  muted: '#7C897E',
  line: '#E0D6C4',
  pine: '#3D6B4F',
  onPine: '#F4FBF4',
  card: '#FFFFFF',
  danger: '#B42318',
};

export function GlobalAssistantHost() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [imageDataUri, setImageDataUri] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [reply, setReply] = React.useState<string | null>(null);
  const [cards, setCards] = React.useState<ActionCard[]>([]);
  const [allowedIds, setAllowedIds] = React.useState<string[]>([]);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [briefHint, setBriefHint] = React.useState(false);
  const [sessionReady, setSessionReady] = React.useState(false);
  const submitRef = React.useRef<
    (textOverride?: string, clearImage?: boolean, imageOverride?: string | null) => Promise<void>
  >(async () => {});

  const close = React.useCallback(() => {
    setOpen(false);
  }, []);

  const resetSession = React.useCallback(() => {
    setText('');
    setImageDataUri(null);
    setReply(null);
    setCards([]);
    setAllowedIds([]);
    setConfirmingId(null);
    setSessionId(null);
    setBriefHint(false);
    void clearAssistantSession();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void loadAssistantSession().then(snap => {
      if (cancelled) return;
      if (snap) {
        setSessionId(snap.session_id);
        setReply(snap.reply);
        setCards(snap.cards);
        if (snap.text_draft) setText(snap.text_draft);
      }
      setSessionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!sessionReady) return;
    void saveAssistantSession({
      session_id: sessionId,
      reply,
      cards,
      text_draft: text.trim() || undefined,
    });
  }, [sessionReady, sessionId, reply, cards, text]);

  const pickImage = React.useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.warn('需要相册权限才能附带图片');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      base64: true,
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const mime = a.mimeType || 'image/jpeg';
    if (a.base64) {
      setImageDataUri(`data:${mime};base64,${a.base64}`);
      return;
    }
    toast.warn('无法读取图片数据');
  }, []);

  const pasteFromClipboard = React.useCallback(async () => {
    const payload = await readClipboardForAssistant();
    if (!payload) {
      toast.info('剪贴板没有可用的文字或图片');
      return;
    }
    if (payload.text) setText(payload.text);
    if (payload.imageDataUri) setImageDataUri(payload.imageDataUri);
    setOpen(true);
    toast.success(payload.imageDataUri ? '已附上剪贴板图片' : '已粘贴剪贴板文字');
  }, []);

  /**
   * 提交：首轮/附图 → route；跨域编排句 → compose；已有未确认卡且纯文本 → turn。
   */
  const submit = React.useCallback(
    async (textOverride?: string, clearImage = false, imageOverride?: string | null) => {
      const nextText = (textOverride ?? text).trim();
      const useImage = clearImage
        ? null
        : imageOverride !== undefined
          ? imageOverride
          : imageDataUri;
      const pending = cards;
      if (textOverride != null) {
        setText(textOverride);
      }
      if (clearImage) {
        setImageDataUri(null);
      } else if (imageOverride !== undefined) {
        setImageDataUri(imageOverride);
      }
      if (!nextText && !useImage) {
        toast.info('请输入一句话或附一张图');
        return;
      }
      setBusy(true);
      setReply(null);
      setBriefHint(false);
      try {
        const useTurn = Boolean(pending.length && nextText && !useImage);
        if (useTurn) {
          const r = await runAssistantTurn({
            session_id: sessionId ?? undefined,
            message: nextText,
            pending_cards: pending,
          });
          if (r.session_id) setSessionId(r.session_id);
          setReply(r.reply_text ?? null);
          setCards(r.cards);
          setAllowedIds(collectAllowedIdsFromBriefContext(r.brief_context));
          setText('');
          if (!r.cards.length) {
            toast.info(r.reply_text || '没有可执行建议');
          }
        } else if (!useImage && nextText && looksLikeComposeGoal(nextText)) {
          setCards([]);
          const r = await runAssistantCompose({ goal: nextText });
          setReply(r.reply_text ?? null);
          setCards(r.cards);
          setAllowedIds(collectAllowedIdsFromBriefContext(r.brief_context));
          if (!r.cards.length) {
            toast.info(r.reply_text || '没有可执行建议');
          }
        } else {
          setCards([]);
          let image_base64: string | undefined;
          let image_mime_type: string | undefined;
          if (useImage) {
            const split = splitImageBase64AndMime(useImage);
            image_base64 = split.image_base64;
            image_mime_type = split.image_mime_type;
          }
          const r = await runAssistantRoute({
            text: nextText || undefined,
            image_base64,
            image_mime_type,
          });
          setReply(r.reply_text ?? null);
          setCards(r.cards);
          setAllowedIds(collectAllowedIdsFromBriefContext(r.brief_context));
          if (!r.cards.length) {
            toast.info(r.reply_text || '没有可执行建议');
          }
        }
      } catch (e) {
        toast.error(toUserMessage(e, '助手请求失败'));
      } finally {
        setBusy(false);
      }
    },
    [cards, imageDataUri, sessionId, text],
  );

  submitRef.current = submit;

  React.useEffect(() => {
    return subscribeGlobalAssistant((opts: OpenGlobalAssistantOpts) => {
      setOpen(true);
      if (opts.focusBrief) {
        setBriefHint(true);
        setReply('今日简报在首页「今日」模块，可下拉刷新查看建议卡。');
      }
      if (opts.openOnly && !opts.text && !opts.imageDataUri && !opts.autoSubmit) {
        return;
      }
      if (opts.text != null) setText(opts.text);
      if (opts.imageDataUri !== undefined) {
        setImageDataUri(opts.imageDataUri || null);
      }
      if (opts.autoSubmit) {
        requestAnimationFrame(() => {
          void submitRef.current(
            opts.text ?? '',
            false,
            opts.imageDataUri !== undefined ? opts.imageDataUri || null : undefined,
          );
        });
      }
    });
  }, []);

  /**
   * 澄清选项：拼文案后走 turn/route（有 pending 时走 turn）。
   * @param choice 卡上选项
   */
  const onClarifyChoice = React.useCallback(
    (choice: string) => {
      const next = composeClarifyResubmitText(text, choice);
      void submit(next, true);
    },
    [submit, text],
  );

  const onConfirmCard = React.useCallback(
    async (card: ActionCard) => {
      setConfirmingId(card.id);
      try {
        const r = await confirmAssistantCard(card, { allowedIds });
        if (!r.ok) {
          if (r.plan.kind === 'clarify') {
            toast.info(r.error);
          } else {
            toast.error(r.error);
          }
          return;
        }
        // 打开预览 Sheet 后收起助手，避免双层 Modal 抢焦点
        if (
          r.plan.kind === 'preview_finance_txn' ||
          r.plan.kind === 'preview_food_intake' ||
          r.plan.kind === 'preview_task' ||
          r.plan.kind === 'preview_habit' ||
          r.plan.kind === 'preview_memo' ||
          r.plan.kind === 'preview_wardrobe_item' ||
          r.plan.kind === 'preview_wish' ||
          r.plan.kind === 'preview_recipe' ||
          r.plan.kind === 'preview_profile' ||
          r.plan.kind === 'open_route' ||
          r.plan.kind === 'review_quick_create' ||
          r.plan.kind === 'frog_assign'
        ) {
          setOpen(false);
          setCards(prev => prev.filter(c => c.id !== card.id));
          if (r.plan.kind === 'frog_assign') {
            toast.success('已指派青蛙');
          }
        }
      } catch (e) {
        toast.error(toUserMessage(e, '确认失败'));
      } finally {
        setConfirmingId(null);
      }
    },
    [allowedIds],
  );

  const fabBottom = glassTabBarContentInset(insets.bottom) + 72;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="打开全局助手"
        onPress={() => {
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.fab,
          { bottom: fabBottom, opacity: pressed ? 0.88 : 1 },
        ]}>
        <MaterialIcons name="auto-awesome" size={22} color={C.onPine} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.handle} />
            <View style={styles.head}>
              <Text style={styles.title}>助手</Text>
              <View style={styles.headActions}>
                <Pressable
                  onPress={() => {
                    resetSession();
                  }}
                  hitSlop={10}>
                  <Text style={styles.link}>清空</Text>
                </Pressable>
                <Pressable onPress={close} hitSlop={10}>
                  <Text style={styles.link}>关闭</Text>
                </Pressable>
              </View>
            </View>
            <Text style={styles.hint}>
              一句话记账 / 饮食 / 待办；剪贴板可「用助手处理」；可改草稿如「改成支付宝」
            </Text>
            {briefHint ? (
              <Text style={styles.briefHint}>Widget / 深链已打开：请到首页查看「今日」简报。</Text>
            ) : null}

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {reply ? <Text style={styles.reply}>{reply}</Text> : null}

              {cards.map(card => (
                <View key={card.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{card.title}</Text>
                  {card.summary ? <Text style={styles.cardSummary}>{card.summary}</Text> : null}
                  {card.intent === 'clarify' && card.clarify_question ? (
                    <Text style={styles.cardSummary}>{card.clarify_question}</Text>
                  ) : null}
                  {card.clarify_choices?.length ? (
                    <View style={styles.choiceRow}>
                      {card.clarify_choices.map(ch => (
                        <Pressable
                          key={ch}
                          style={[styles.choiceChip, busy && styles.btnDisabled]}
                          disabled={busy}
                          onPress={() => onClarifyChoice(ch)}>
                          <Text style={styles.choiceText}>{ch}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {card.intent !== 'clarify' ? (
                    <Pressable
                      style={[styles.confirmBtn, confirmingId === card.id && styles.btnDisabled]}
                      disabled={busy || confirmingId === card.id}
                      onPress={() => void onConfirmCard(card)}>
                      {confirmingId === card.id ? (
                        <ActivityIndicator color={C.onPine} />
                      ) : (
                        <Text style={styles.confirmText}>
                          {card.confirm_action === 'open_route' && !card.needs_confirm
                            ? '打开页面'
                            : card.needs_confirm
                              ? '确认并打开'
                              : '打开'}
                        </Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>

            {imageDataUri ? (
              <View style={styles.attachRow}>
                <Text style={styles.attachLabel} numberOfLines={1}>
                  已附图片
                </Text>
                <Pressable onPress={() => setImageDataUri(null)}>
                  <Text style={styles.link}>移除</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.composer}>
              <Pressable
                style={styles.iconBtn}
                onPress={() => void pasteFromClipboard()}
                disabled={busy}
                accessibilityLabel="用助手处理剪贴板">
                <MaterialIcons name="content-paste" size={22} color={C.pine} />
              </Pressable>
              <Pressable style={styles.iconBtn} onPress={() => void pickImage()} disabled={busy}>
                <MaterialIcons name="image" size={22} color={C.pine} />
              </Pressable>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={
                  cards.length
                    ? '改成支付宝 / 截止改周五…'
                    : '咖啡 18 微信 / 记备忘 / 今天穿什么…'
                }
                placeholderTextColor={C.muted}
                multiline
                maxLength={500}
                editable={!busy}
              />
              <Pressable
                style={[styles.sendBtn, busy && styles.btnDisabled]}
                disabled={busy}
                onPress={() => void submit()}>
                {busy ? (
                  <ActivityIndicator color={C.onPine} />
                ) : (
                  <MaterialIcons name="send" size={20} color={C.onPine} />
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    zIndex: 40,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.pine,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#1A2A1E',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(20,28,22,0.38)',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: C.paper,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  briefHint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: C.pine,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D8CDBB',
    marginBottom: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headActions: { flexDirection: 'row', gap: 14 },
  title: { fontSize: 20, fontWeight: '800', color: C.ink },
  link: { fontSize: 14, color: C.muted, fontWeight: '600' },
  hint: { fontSize: 12, color: C.muted, marginBottom: 10 },
  body: { flexGrow: 0, maxHeight: 320 },
  bodyContent: { paddingBottom: 12, gap: 10 },
  reply: { fontSize: 14, fontWeight: '700', color: C.pine, lineHeight: 20 },
  card: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    backgroundColor: C.card,
    gap: 6,
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: C.ink },
  cardSummary: { fontSize: 13, color: '#536155', lineHeight: 19 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  choiceChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F4F8F2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.pine,
  },
  choiceText: { fontSize: 13, fontWeight: '600', color: C.pine },
  confirmBtn: {
    marginTop: 6,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.pine,
  },
  confirmText: { fontSize: 14, fontWeight: '700', color: C.onPine },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  attachLabel: { fontSize: 12, color: C.muted, flex: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
    paddingTop: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F8F2',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: C.ink,
    backgroundColor: C.card,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.pine,
  },
  btnDisabled: { opacity: 0.55 },
});
