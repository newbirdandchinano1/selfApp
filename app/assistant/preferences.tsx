/**
 * Agent 偏好管理：自然语言条目 CRUD，真相源在 Agent 端文件。
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Radius, Spacing } from '@/constants/design-tokens';
import { appFonts } from '@/constants/app-fonts';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  AGENT_PREFS_USER_ID,
  createAgentPreference,
  deleteAgentPreference,
  formatPrefsUpdatedAt,
  listAgentPreferences,
  updateAgentPreference,
  type AgentPrefItem,
  type AgentPrefSnapshot,
} from '@/lib/assistant/agent-prefs-api';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function sourceLabel(source: AgentPrefItem['source']): string {
  if (source === 'chat') return '对话记住';
  if (source === 'system') return '系统';
  return '手动添加';
}

function sourceIcon(source: AgentPrefItem['source']): keyof typeof MaterialIcons.glyphMap {
  if (source === 'chat') return 'chat-bubble-outline';
  if (source === 'system') return 'settings';
  return 'edit';
}

export default function AgentPreferencesScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  const [snap, setSnap] = useState<AgentPrefSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AgentPrefItem | null>(null);
  const [draft, setDraft] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listAgentPreferences(AGENT_PREFS_USER_ID);
      setSnap(next);
    } catch (e) {
      toast.error(toUserMessage(e, '加载偏好失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Modal 内 KeyboardAvoidingView 在 Android 常失效；用键盘高度顶起底栏
  useEffect(() => {
    if (!editorOpen) {
      setKeyboardHeight(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvent, e => {
      setKeyboardHeight(Math.max(0, e.endCoordinates?.height ?? 0));
    });
    const onHide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [editorOpen]);

  const closeEditor = useCallback(() => {
    Keyboard.dismiss();
    setEditorOpen(false);
    setKeyboardHeight(0);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDraft('');
    setEditorOpen(true);
  };

  const openEdit = (item: AgentPrefItem) => {
    setEditing(item);
    setDraft(item.content);
    setEditorOpen(true);
  };

  const onSave = async () => {
    const text = draft.trim();
    if (!text) {
      toast.error('请输入偏好内容');
      return;
    }
    setSaving(true);
    try {
      const next = editing
        ? await updateAgentPreference(editing.id, text)
        : await createAgentPreference(text);
      setSnap(next);
      closeEditor();
      toast.success(editing ? '已更新' : '已添加');
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (item: AgentPrefItem) => {
    Alert.alert('删除偏好', `确定删除这条？\n「${item.content}」`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const next = await deleteAgentPreference(item.id);
              setSnap(next);
              toast.success('已删除');
            } catch (e) {
              toast.error(toUserMessage(e, '删除失败'));
            }
          })();
        },
      },
    ]);
  };

  const count = snap?.items.length ?? 0;
  const sheetBottomPad =
    keyboardHeight > 0
      ? Math.max(12, keyboardHeight - (Platform.OS === 'ios' ? insets.bottom : 0) + 8)
      : Math.max(insets.bottom, 16);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.headWrap,
          {
            paddingTop: insets.top,
            backgroundColor: colors.headerScrim,
            borderBottomColor: colors.outline,
          },
        ]}>
        <View style={styles.head}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/assistant/chat' as never);
            }}
            accessibilityLabel="返回"
            hitSlop={8}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: colors.surface,
                borderColor: colors.outline,
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <Text style={[styles.backGlyph, { color: colors.primary }]}>‹</Text>
          </Pressable>

          <View style={styles.headCopy}>
            <Text style={[styles.title, { color: colors.text }]}>偏好管理</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
              Agent 据此组织回答
            </Text>
          </View>

          <Pressable
            onPress={openCreate}
            accessibilityLabel="添加偏好"
            hitSlop={8}
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.88 : 1,
              },
            ]}>
            <MaterialIcons name="add" size={18} color={colors.onPrimary} />
            <Text style={[styles.addBtnText, { color: colors.onPrimary }]}>添加</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.metaBlock}>
        <View
          style={[
            styles.metaCard,
            { backgroundColor: colors.primaryMuted, borderColor: colors.outline },
          ]}>
          <View style={styles.metaTop}>
            <View style={[styles.metaMark, { backgroundColor: colors.primary }]}>
              <Text style={[styles.metaMarkGlyph, { color: colors.onPrimary }]}>◎</Text>
            </View>
            <View style={styles.metaCopy}>
              <Text style={[styles.metaTitle, { color: colors.text }]}>
                {count > 0 ? `${count} 条偏好` : '暂无偏好'}
              </Text>
              <Text style={[styles.metaSync, { color: colors.textMuted }]}>
                上次同步 · v{snap?.version ?? 0} · {formatPrefsUpdatedAt(snap?.updated_at || '')}
              </Text>
            </View>
          </View>
          <Text style={[styles.metaHint, { color: colors.textSecondary }]}>
            用自然语言写下你希望 Agent 长期遵守的习惯。对话里说「记住…」也会写到这里。
          </Text>
        </View>
      </View>

      {loading && !snap ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={snap?.items ?? []}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.list,
            count === 0 ? styles.listEmpty : null,
            { paddingBottom: Math.max(insets.bottom, 24) + 24 },
          ]}
          refreshing={loading}
          onRefresh={() => void reload()}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
                <MaterialIcons name="psychology" size={28} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>还没有偏好</Text>
              <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
                点右上角添加，或在对话里说「记住回答尽量简洁」。
              </Text>
              <Pressable
                onPress={openCreate}
                style={({ pressed }) => [
                  styles.emptyCta,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}>
                <Text style={[styles.emptyCtaText, { color: colors.onPrimary }]}>写第一条偏好</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openEdit(item)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.outline,
                  opacity: pressed ? 0.92 : 1,
                },
              ]}>
              <Text style={[styles.rowBody, { color: colors.text }]}>{item.content}</Text>
              <View style={styles.rowMeta}>
                <View style={[styles.tag, { backgroundColor: colors.primaryMuted }]}>
                  <MaterialIcons
                    name={sourceIcon(item.source)}
                    size={12}
                    color={colors.secondary}
                  />
                  <Text style={[styles.tagText, { color: colors.secondary }]}>
                    {sourceLabel(item.source)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => onDelete(item)}
                  hitSlop={10}
                  accessibilityLabel="删除偏好"
                  style={({ pressed }) => [
                    styles.deleteBtn,
                    {
                      borderColor: colors.outline,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}>
                  <MaterialIcons name="delete-outline" size={16} color={colors.danger} />
                </Pressable>
              </View>
            </Pressable>
          )}
        />
      )}

      <Modal
        visible={editorOpen}
        animationType="fade"
        transparent
        onRequestClose={closeEditor}
        statusBarTranslucent>
        <View style={[styles.modalRoot, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeEditor} />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.background,
                paddingBottom: sheetBottomPad,
                borderColor: colors.outline,
              },
            ]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.outline }]} />
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {editing ? '编辑偏好' : '添加偏好'}
              </Text>
              <Text style={[styles.sheetSub, { color: colors.textMuted }]}>
                一句话即可，Agent 会在回答时参考
              </Text>
            </View>

            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="例如：回答尽量简洁；周末不做高强度建议"
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus
              maxLength={500}
              textAlignVertical="top"
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.outlineStrong ?? colors.outline,
                  backgroundColor: colors.surface,
                },
              ]}
            />
            <Text style={[styles.counter, { color: colors.textMuted }]}>
              {draft.trim().length}/500
            </Text>

            <View style={styles.sheetActions}>
              <Pressable
                onPress={closeEditor}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.sheetBtnGhost,
                  {
                    borderColor: colors.outline,
                    backgroundColor: colors.surface,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={[styles.sheetBtnGhostText, { color: colors.textSecondary }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void onSave()}
                disabled={saving || !draft.trim()}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.sheetBtnPrimary,
                  {
                    backgroundColor: colors.primary,
                    opacity: saving || !draft.trim() ? 0.45 : pressed ? 0.9 : 1,
                  },
                ]}>
                <Text style={[styles.sheetBtnPrimaryText, { color: colors.onPrimary }]}>
                  {saving ? '保存中…' : '保存'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  head: {
    minHeight: 54,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: {
    fontSize: 28,
    lineHeight: 30,
    marginTop: -2,
    fontWeight: '400',
  },
  headCopy: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontFamily: appFonts.mono,
    fontSize: 10,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  addBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  addBtnText: { fontSize: 13, fontWeight: '700' },
  metaBlock: {
    paddingHorizontal: Spacing['3xl'],
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  metaCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: 10,
  },
  metaTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaMark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaMarkGlyph: { fontSize: 15, fontWeight: '700' },
  metaCopy: { flex: 1, minWidth: 0 },
  metaTitle: { fontSize: 15, fontWeight: '700' },
  metaSync: { fontSize: 11, marginTop: 2 },
  metaHint: { fontSize: 12, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: {
    paddingHorizontal: Spacing['3xl'],
    paddingTop: Spacing.sm,
  },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: Spacing['3xl'],
    gap: 10,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptyBody: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
  },
  emptyCta: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
  emptyCtaText: { fontSize: 14, fontWeight: '700' },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: 12,
  },
  rowBody: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  rowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: { fontSize: 11, fontWeight: '600' },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['3xl'],
    paddingTop: 10,
    gap: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  sheetHead: { gap: 4 },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  sheetSub: { fontSize: 12, lineHeight: 17 },
  input: {
    minHeight: 120,
    maxHeight: 200,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 15,
    lineHeight: 22,
  },
  counter: {
    alignSelf: 'flex-end',
    fontSize: 11,
    marginTop: -4,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  sheetBtnGhost: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBtnGhostText: { fontSize: 15, fontWeight: '700' },
  sheetBtnPrimary: {
    flex: 1.2,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBtnPrimaryText: { fontSize: 15, fontWeight: '700' },
});
