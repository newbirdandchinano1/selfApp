import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { formatWriteError } from '@/lib/format-write-error';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { pushLocalChangesToApi } from '@/lib/api-write-sync';
import {
  createMemoTag,
  createProjectTag,
  deleteProjectTag,
  getMemoTags,
  getProjectTags,
  isMemoTagNameDuplicate,
  isProjectTagNameDuplicate,
  updateProjectTag,
} from '@/lib/repositories/projects/project-tag';
import type { ProjectTagRow, TagDomain } from '@/lib/repositories/projects/project-tag.types';
import {
  DEFAULT_PROJECT_TAG_COLOR,
  PROJECT_TAG_COLOR_PRESETS,
} from '@/lib/repositories/projects/project-tag.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function buildTagId() {
  return makeTimestampEntityId('ptag_', 8);
}

function resolveDomain(raw: string | string[] | undefined): TagDomain {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'memo' ? 'memo' : 'task';
}

export default function ProjectTagsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ domain?: string }>();
  const domain = resolveDomain(params.domain);
  const isMemoDomain = domain === 'memo';

  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [tags, setTags] = React.useState<ProjectTagRow[]>([]);
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState<string>(DEFAULT_PROJECT_TAG_COLOR);
  const [description, setDescription] = React.useState('');
  const [weightText, setWeightText] = React.useState('0');

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? 'rgba(30, 41, 59, 0.7)' : '#ffffff';
  const outline = isDark ? 'rgba(148,163,184,0.6)' : '#727785';
  const border = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.55)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const soft = isDark ? 'rgba(15,23,42,0.55)' : '#f1f5f9';
  const error = isDark ? '#f87171' : '#dc2626';

  const titleText = isMemoDomain ? '备忘录标签' : '任务标签';
  const hintText = isMemoDomain
    ? '仅用于备忘录分类；与任务侧标签相互独立。权重越大在列表中越靠前。'
    : '仅用于项目、习惯与独立待办；与备忘录标签相互独立。权重越大在列表中越靠前。';
  const deleteScopeHint = isMemoDomain
    ? '已贴到备忘录上的关联会一并移除。'
    : '已贴到项目、习惯、待办上的关联会一并移除。';

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setTags(isMemoDomain ? await getMemoTags() : await getProjectTags());
    } catch (err) {
      console.warn(isMemoDomain ? '加载备忘录标签失败' : '加载任务标签失败', err);
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [isMemoDomain]);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load]),
  );

  const { refreshControl } = usePullToRefresh(load);

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setColor(DEFAULT_PROJECT_TAG_COLOR);
    setDescription('');
    setWeightText('0');
    setEditorVisible(true);
  };

  const openEdit = (tag: ProjectTagRow) => {
    setEditingId(tag.id);
    setName(tag.name);
    setColor(tag.color || DEFAULT_PROJECT_TAG_COLOR);
    setDescription(tag.description ?? '');
    setWeightText(String(tag.weight ?? 0));
    setEditorVisible(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorVisible(false);
  };

  const saveTag = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('无法保存', '请输入标签名称。');
      return;
    }
    const weight = Number.parseInt(weightText.trim() || '0', 10);
    if (!Number.isFinite(weight)) {
      Alert.alert('无法保存', '权重请输入整数。');
      return;
    }
    const dup = isMemoDomain
      ? await isMemoTagNameDuplicate(trimmed, editingId ?? undefined)
      : await isProjectTagNameDuplicate(trimmed, editingId ?? undefined);
    if (dup) {
      Alert.alert('无法保存', '同域内标签名称不能重复。');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateProjectTag(editingId, {
          name: trimmed,
          color,
          description: description.trim() || null,
          weight,
          domain,
        });
      } else if (isMemoDomain) {
        await createMemoTag({
          id: buildTagId(),
          name: trimmed,
          color,
          description: description.trim() || null,
          weight,
        });
      } else {
        await createProjectTag({
          id: buildTagId(),
          name: trimmed,
          color,
          description: description.trim() || null,
          weight,
        });
      }
      setEditorVisible(false);
      await load();
      try {
        await markPendingTablesDirty(['tags', 'tag_links']);
        await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
      } catch (syncErr) {
        console.warn('标签保存后同步失败', syncErr);
      }
    } catch (err) {
      console.warn('保存标签失败', err);
      Alert.alert('保存失败', formatWriteError(err, '标签保存失败，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (tag: ProjectTagRow) => {
    Alert.alert('删除标签', `确认删除「${tag.name}」？${deleteScopeHint}`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteProjectTag(tag.id);
            await load();
            try {
              await markPendingTablesDirty(['tags', 'tag_links']);
              await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
            } catch (syncErr) {
              console.warn('标签删除后同步失败', syncErr);
            }
          } catch (err) {
            console.warn('删除标签失败', err);
            Alert.alert('删除失败', formatWriteError(err, '标签删除失败，请稍后重试。'));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            borderBottomColor: border,
            backgroundColor: isDark ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.8)',
          },
        ]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>
        <Text style={[styles.title, { color: primary }]}>{titleText}</Text>
        <Pressable onPress={openCreate} style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}>
          <Text style={[styles.doneText, { color: primary }]}>新建</Text>
        </Pressable>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <Text style={[styles.hint, { color: outline }]}>{hintText}</Text>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={primary} />
          </View>
        ) : tags.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: surface, borderColor: border }]}>
            <MaterialIcons name="local-offer" size={28} color={outline} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>还没有标签</Text>
            <Text style={[styles.emptyDesc, { color: outline }]}>点击右上角「新建」创建第一个标签</Text>
          </View>
        ) : (
          tags.map((tag) => (
            <View key={tag.id} style={[styles.item, { backgroundColor: surface, borderColor: border }]}>
              <View style={[styles.colorDot, { backgroundColor: tag.color }]} />
              <View style={styles.itemBody}>
                <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
                  {tag.name}
                </Text>
                <Text style={[styles.itemMeta, { color: outline }]} numberOfLines={2}>
                  权重 {tag.weight}
                  {tag.description?.trim() ? ` · ${tag.description.trim()}` : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => openEdit(tag)}
                hitSlop={8}
                style={({ pressed }) => [styles.itemAction, pressed && { opacity: 0.7 }]}>
                <MaterialIcons name="edit" size={20} color={primary} />
              </Pressable>
              <Pressable
                onPress={() => confirmDelete(tag)}
                hitSlop={8}
                style={({ pressed }) => [styles.itemAction, pressed && { opacity: 0.7 }]}>
                <MaterialIcons name="delete-outline" size={20} color={error} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={editorVisible} transparent animationType="fade" onRequestClose={closeEditor}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeEditor} />
          <View style={[styles.editorCard, { backgroundColor: surface, borderColor: border }]}>
            <Text style={[styles.editorTitle, { color: theme.text }]}>
              {editingId ? '编辑标签' : '新建标签'}
            </Text>

            <Text style={[styles.fieldLabel, { color: outline }]}>名称</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={isMemoDomain ? '例如：灵感 / 待查' : '例如：重要客户'}
              placeholderTextColor={outline}
              maxLength={40}
              style={[styles.input, { color: theme.text, backgroundColor: soft, borderColor: border }]}
            />

            <Text style={[styles.fieldLabel, { color: outline }]}>颜色</Text>
            <View style={styles.colorRow}>
              {PROJECT_TAG_COLOR_PRESETS.map((c) => {
                const selected = color.toUpperCase() === c.toUpperCase();
                return (
                  <Pressable
                    key={c}
                    onPress={() => setColor(c)}
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: c, borderColor: selected ? theme.text : 'transparent' },
                    ]}
                  />
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: outline }]}>简介（可选）</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="一句话说明这个标签"
              placeholderTextColor={outline}
              maxLength={120}
              multiline
              style={[
                styles.input,
                styles.descInput,
                { color: theme.text, backgroundColor: soft, borderColor: border },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: outline }]}>权重</Text>
            <TextInput
              value={weightText}
              onChangeText={setWeightText}
              placeholder="0"
              placeholderTextColor={outline}
              keyboardType="number-pad"
              style={[styles.input, { color: theme.text, backgroundColor: soft, borderColor: border }]}
            />
            <Text style={[styles.weightHint, { color: outline }]}>数值越大越靠前；可为负数</Text>

            <View style={styles.editorActions}>
              <Pressable
                onPress={closeEditor}
                disabled={saving}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.8 }]}>
                <Text style={[styles.ghostText, { color: outline }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveTag()}
                disabled={saving}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: primary, opacity: saving ? 0.6 : pressed ? 0.9 : 1 },
                ]}>
                <Text style={styles.primaryText}>{saving ? '保存中' : '确认'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  doneBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  doneText: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  loadingWrap: { paddingVertical: 40, alignItems: 'center' },
  emptyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyDesc: { fontSize: 13, textAlign: 'center' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  itemBody: { flex: 1, gap: 2 },
  itemName: { fontSize: 15, fontWeight: '600' },
  itemMeta: { fontSize: 12 },
  itemAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  modalRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  editorCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  editorTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginTop: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  descInput: { minHeight: 64, textAlignVertical: 'top' },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 4 },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2 },
  weightHint: { fontSize: 12, marginTop: -2 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12 },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  ghostText: { fontSize: 15 },
  primaryBtn: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
