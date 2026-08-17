import { AppCard, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  createReviewColumn,
  createReviewColumnId,
  createReviewDimension,
  createReviewDimensionId,
  deleteReviewColumn,
  deleteReviewDimension,
  listReviewTemplate,
  updateReviewColumn,
  updateReviewDimension,
} from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate, ReviewTemplateScope } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { useFocusEffect } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import type { KeyboardEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type ScopeTab = ReviewTemplateScope;

function normalizeScope(raw: string | string[] | undefined): ScopeTab {
  const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
  if (s === 'weekly' || s === 'monthly') return s;
  return 'daily';
}

type EditorMode = 'dimension' | 'column';

type EditorState = {
  mode: EditorMode;
  dimensionId?: string;
  columnId?: string;
  title: string;
  placeholder: string;
};

const PAGE_API_KEY = 'review-template-settings';

const SCOPE_LABEL: Record<ScopeTab, string> = {
  daily: '日复盘',
  weekly: '周复盘',
  monthly: '月复盘',
};

export default function ReviewTemplateSettingsScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, shadows } = useAppTheme();
  const { scope: scopeParam } = useLocalSearchParams<{ scope?: string }>();
  const [scope, setScope] = useState<ScopeTab>(normalizeScope(scopeParam));

  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [expandedDimId, setExpandedDimId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalKeyboardInset, setModalKeyboardInset] = useState(0);

  useEffect(() => {
    if (editor == null) {
      setModalKeyboardInset(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => setModalKeyboardInset(Math.max(0, Math.round(e.endCoordinates.height)));
    const onHide = () => setModalKeyboardInset(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [editor]);

  const reload = useCallback(async (forceApi = false) => {
    setLoading(true);
    try {
      await wrapLoad(async () => {
        const rows = await listReviewTemplate(scope);
        setTemplate(rows);
        setExpandedDimId(prev => {
          if (prev && rows.some(d => d.id === prev)) return prev;
          return rows.length > 0 ? rows[0].id : null;
        });
      }, forceApi);
    } catch {
      Alert.alert('加载失败', '请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [scope, wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const openAddDimension = () => {
    setEditor({ mode: 'dimension', title: '', placeholder: '' });
  };

  const openEditDimension = (dim: ReviewDimensionTemplate) => {
    setEditor({ mode: 'dimension', dimensionId: dim.id, title: dim.title, placeholder: '' });
  };

  const openAddColumn = (dimensionId: string) => {
    setEditor({ mode: 'column', dimensionId, title: '', placeholder: '' });
  };

  const openEditColumn = (dimensionId: string, col: { id: string; title: string; placeholder: string }) => {
    setEditor({
      mode: 'column',
      dimensionId,
      columnId: col.id,
      title: col.title,
      placeholder: col.placeholder,
    });
  };

  const onDeleteDimension = (dim: ReviewDimensionTemplate) => {
    Alert.alert('删除维度', `确定删除「${dim.title}」及其下全部栏目？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteReviewDimension(dim.id);
              if (expandedDimId === dim.id) setExpandedDimId(null);
              await reload();
            } catch {
              Alert.alert('删除失败', '请稍后重试');
            }
          })();
        },
      },
    ]);
  };

  const onDeleteColumn = (colTitle: string, columnId: string) => {
    Alert.alert('删除栏目', `确定删除「${colTitle}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteReviewColumn(columnId);
              await reload();
            } catch {
              Alert.alert('删除失败', '请稍后重试');
            }
          })();
        },
      },
    ]);
  };

  const onSaveEditor = async () => {
    if (!editor) return;
    const title = editor.title.trim();
    if (!title) {
      Alert.alert('无法保存', '请填写名称');
      return;
    }
    setSaving(true);
    try {
      if (editor.mode === 'dimension') {
        if (editor.dimensionId) {
          await updateReviewDimension(editor.dimensionId, { title });
        } else {
          const maxSort = template.reduce((m, d) => Math.max(m, d.sortOrder), 0);
          await createReviewDimension({
            id: createReviewDimensionId(),
            scope,
            title,
            sort_order: maxSort + 10,
          });
        }
      } else if (editor.dimensionId) {
        const dim = template.find(d => d.id === editor.dimensionId);
        const maxSort = dim?.columns.reduce((m, c) => Math.max(m, c.sortOrder), 0) ?? 0;
        if (editor.columnId) {
          await updateReviewColumn(editor.columnId, {
            title,
            placeholder: editor.placeholder.trim() || null,
          });
        } else {
          await createReviewColumn({
            id: createReviewColumnId(),
            dimension_id: editor.dimensionId,
            title,
            placeholder: editor.placeholder.trim() || null,
            sort_order: maxSort + 10,
          });
        }
      }
      setEditor(null);
      await reload();
    } catch {
      Alert.alert('保存失败', '请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const scopeLabel =
    scope === 'daily' ? '每日复盘' : scope === 'weekly' ? '每周复盘' : '每月复盘';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 8}>
        <ScreenHeader title="复盘模板" onBack={() => router.back()} />

        <View style={styles.scopeWrap}>
          <View style={[styles.scopeTrack, { backgroundColor: colors.capsule }]}>
            {(['daily', 'weekly', 'monthly'] as const).map(s => {
              const active = scope === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => {
                    setScope(s);
                    setExpandedDimId(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={SCOPE_LABEL[s]}
                  style={({ pressed }) => [
                    styles.scopeItem,
                    active && [
                      styles.scopeItemActive,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.outline,
                      },
                    ],
                    pressed && { opacity: 0.88 },
                  ]}>
                  <Text
                    style={[
                      Typography.caption,
                      {
                        color: active ? colors.primary : colors.textMuted,
                        fontWeight: active ? '800' : '600',
                      },
                    ]}>
                    {SCOPE_LABEL[s]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: Spacing['6xl'] + insets.bottom },
            ]}>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              管理{scopeLabel}的维度与栏目。修改后填写页会即时生效；已保存的历史内容仍按栏目 ID 对应，删除栏目后其旧内容不再显示。
            </Text>

            {template.map((dim, dimIdx) => {
              const open = expandedDimId === dim.id;
              return (
                <AppCard key={dim.id} padded={false} style={[shadows.card, styles.dimCard]}>
                  <Pressable
                    onPress={() => setExpandedDimId(open ? null : dim.id)}
                    style={({ pressed }) => [styles.dimHead, { opacity: pressed ? 0.9 : 1 }]}>
                    <Text style={[styles.dimIndex, { color: colors.textMuted }]}>{dimIdx + 1}</Text>
                    <Text style={[styles.dimTitle, { color: colors.text }]} numberOfLines={2}>
                      {dim.title}
                    </Text>
                    <Text style={[styles.colCount, { color: colors.textMuted }]}>{dim.columns.length} 个栏目</Text>
                    <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={24} color={colors.primary} />
                  </Pressable>
                  {open ? (
                    <View style={[styles.dimBody, { borderTopColor: colors.outline }]}>
                      <View style={styles.dimActions}>
                        <Pressable onPress={() => openEditDimension(dim)} style={styles.iconBtn}>
                          <MaterialIcons name="edit" size={20} color={colors.primary} />
                          <Text style={[styles.iconBtnText, { color: colors.primary }]}>改维度</Text>
                        </Pressable>
                        <Pressable onPress={() => openAddColumn(dim.id)} style={styles.iconBtn}>
                          <MaterialIcons name="add" size={20} color={colors.primary} />
                          <Text style={[styles.iconBtnText, { color: colors.primary }]}>加栏目</Text>
                        </Pressable>
                        <Pressable onPress={() => onDeleteDimension(dim)} style={styles.iconBtn}>
                          <MaterialIcons name="delete-outline" size={20} color={colors.danger} />
                          <Text style={[styles.iconBtnText, { color: colors.danger }]}>删维度</Text>
                        </Pressable>
                      </View>
                      {dim.columns.length === 0 ? (
                        <Text style={[styles.emptyCol, { color: colors.textMuted }]}>暂无栏目，请添加</Text>
                      ) : (
                        dim.columns.map(col => (
                          <View key={col.id} style={[styles.colRow, { borderColor: colors.outline, backgroundColor: colors.surfaceMuted }]}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.colTitle, { color: colors.text }]}>{col.title}</Text>
                              {col.placeholder ? (
                                <Text style={[styles.colPlaceholder, { color: colors.textMuted }]} numberOfLines={2}>
                                  提示：{col.placeholder}
                                </Text>
                              ) : null}
                            </View>
                            <Pressable onPress={() => openEditColumn(dim.id, col)} hitSlop={8}>
                              <MaterialIcons name="edit" size={20} color={colors.primary} />
                            </Pressable>
                            <Pressable onPress={() => onDeleteColumn(col.title, col.id)} hitSlop={8} style={{ marginLeft: 8 }}>
                              <MaterialIcons name="delete-outline" size={20} color={colors.danger} />
                            </Pressable>
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}
                </AppCard>
              );
            })}

            <Pressable
              onPress={openAddDimension}
              style={({ pressed }) => [
                styles.addDimBtn,
                { borderColor: colors.primary, opacity: pressed ? 0.88 : 1 },
              ]}>
              <MaterialIcons name="add-circle-outline" size={22} color={colors.primary} />
              <Text style={[styles.addDimText, { color: colors.primary }]}>添加维度</Text>
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <Modal visible={editor != null} transparent animationType="fade" onRequestClose={() => setEditor(null)}>
        <KeyboardAvoidingView
          style={[styles.modalRoot, { backgroundColor: colors.overlay }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setEditor(null)} />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.outline,
                paddingBottom: insets.bottom + 16,
                marginBottom: Platform.OS === 'android' ? modalKeyboardInset : 0,
              },
            ]}>
            <ScrollView keyboardShouldPersistTaps="handled" bounces={false} showsVerticalScrollIndicator={false}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {editor?.mode === 'dimension'
                  ? editor.dimensionId
                    ? '编辑维度'
                    : '新建维度'
                  : editor?.columnId
                    ? '编辑栏目'
                    : '新建栏目'}
              </Text>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>名称</Text>
              <TextInput
                value={editor?.title ?? ''}
                onChangeText={t => setEditor(prev => (prev ? { ...prev, title: t } : prev))}
                placeholder={editor?.mode === 'dimension' ? '例如：今日总结' : '例如：完成任务'}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.outline, color: colors.text }]}
              />
              {editor?.mode === 'column' ? (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>填写提示（可选）</Text>
                  <TextInput
                    value={editor.placeholder}
                    onChangeText={t => setEditor(prev => (prev ? { ...prev, placeholder: t } : prev))}
                    placeholder="输入框占位说明"
                    placeholderTextColor={colors.textMuted}
                    multiline
                    style={[
                      styles.input,
                      styles.inputMulti,
                      { backgroundColor: colors.input, borderColor: colors.outline, color: colors.text },
                    ]}
                  />
                </>
              ) : null}
              <View style={styles.modalBtns}>
                <Pressable
                  onPress={() => setEditor(null)}
                  style={[styles.modalBtn, { borderColor: colors.outline }]}>
                  <Text style={{ color: colors.textMuted, fontWeight: '700' }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={() => void onSaveEditor()}
                  disabled={saving}
                  style={[styles.modalBtn, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: saving ? 0.7 : 1 }]}>
                  {saving ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={{ color: colors.onPrimary, fontWeight: '800' }}>保存</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scopeWrap: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    width: '100%',
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
  },
  scopeTrack: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    padding: 4,
    gap: 4,
  },
  scopeItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  scopeItemActive: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.lg,
    gap: Spacing.lg,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  hint: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  dimCard: {
    overflow: 'hidden',
  },
  dimHead: { flexDirection: 'row', alignItems: 'center', padding: Spacing['3xl'], gap: 8 },
  dimIndex: { fontSize: 13, fontWeight: '800', width: 20 },
  dimTitle: { flex: 1, fontSize: 15, fontWeight: '800' },
  colCount: { fontSize: 12 },
  dimBody: {
    paddingHorizontal: Spacing['3xl'],
    paddingBottom: Spacing['3xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  dimActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 10, paddingBottom: 4 },
  iconBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtnText: { fontSize: 13, fontWeight: '700' },
  emptyCol: { fontSize: 13, paddingVertical: 8 },
  colRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 8,
  },
  colTitle: { fontSize: 14, fontWeight: '700' },
  colPlaceholder: { fontSize: 12, marginTop: 2 },
  addDimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: Radius['2xl'],
    borderWidth: 1.5,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addDimText: { fontSize: 15, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderWidth: 1,
    padding: Spacing['4xl'],
    gap: 8,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
});
