/**
 * 项目标签 / 备忘标签 — 对齐设计稿 shot 20
 * 共用页面标题随域名 · 权重条补间 · 行内删除确认 · 同域重名即时提示
 */
import { FoldRiseIn, FOLD_MOTION_EASE, useFoldMotionGate } from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { toast } from '@/lib/app-feedback';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { formatWriteError } from '@/lib/format-write-error';
import { hasPageLoadedFromServer } from '@/lib/page-api-session';
import { fetchProfileMemoList } from '@/lib/profile-page-api';
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
import { requestPush } from '@/lib/sync-manager';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'project-tags';

function buildTagId() {
  return makeTimestampEntityId('ptag_', 8);
}

function resolveDomain(raw: string | string[] | undefined): TagDomain {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'memo' ? 'memo' : 'task';
}

function TagWeightBar({
  color,
  weight,
  maxWeight,
  animate,
}: {
  color: string;
  weight: number;
  maxWeight: number;
  animate: boolean;
}) {
  const { tf } = useTaskFoldTheme();
  const progress = React.useRef(new Animated.Value(0)).current;
  const ratio = maxWeight > 0 ? Math.max(0, Math.min(1, weight / maxWeight)) : 0;

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(ratio);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: ratio,
      duration: TaskFoldMotion.tagWeightBar,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, progress, ratio]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.tagweight, { backgroundColor: tf.track }]}>
      <Animated.View style={[styles.tagweightFill, { backgroundColor: color || tf.sage, width }]} />
    </View>
  );
}

function TagRowCard({
  tag,
  maxWeight,
  confirmingDelete,
  onEdit,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
  animate,
  holdHidden,
  index,
}: {
  tag: ProjectTagRow;
  maxWeight: number;
  confirmingDelete: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  animate: boolean;
  holdHidden: boolean;
  index: number;
}) {
  const { tf, isDark } = useTaskFoldTheme();
  const color = tag.color || DEFAULT_PROJECT_TAG_COLOR;
  const metaBits = [
    tag.description?.trim() || null,
    `权重 ${tag.weight}`,
  ].filter(Boolean);

  return (
    <FoldRiseIn
      animate={animate}
      index={index}
      duration={480}
      staggerMs={36}
      fromY={8}
      holdHidden={holdHidden}>
      <View
        style={[
          styles.tagrow,
          {
            backgroundColor: isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.8)',
            borderColor: tf.line2,
          },
        ]}>
        <View style={[styles.tagcol, { backgroundColor: color }]} />
        <View style={styles.tgc}>
          <Text style={[styles.tgcTitle, { color: tf.ink2 }]} numberOfLines={1}>
            {tag.name}
          </Text>
          <Text style={[styles.tgcMeta, { color: tf.faint }]} numberOfLines={1}>
            {metaBits.join(' · ')}
          </Text>
        </View>
        <TagWeightBar color={color} weight={tag.weight} maxWeight={maxWeight} animate={animate} />
        {confirmingDelete ? (
          <View style={styles.delRow}>
            <Pressable
              onPress={onConfirmDelete}
              style={({ pressed }) => [
                styles.tagdel,
                { backgroundColor: isDark ? tf.rose2 : '#F7E6DE', opacity: pressed ? 0.85 : 1 },
              ]}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#B06A50' }}>删除?</Text>
            </Pressable>
            <Pressable
              onPress={onCancelDelete}
              style={({ pressed }) => [
                styles.tagdel,
                { backgroundColor: isDark ? tf.paper2 : '#EFEBDF', opacity: pressed ? 0.85 : 1 },
              ]}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: tf.muted }}>取消</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.rowActions}>
            <Pressable onPress={onEdit} hitSlop={6} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
              <Text style={{ fontSize: 11, color: tf.faint, fontWeight: '600' }}>编辑</Text>
            </Pressable>
            <Pressable onPress={onAskDelete} hitSlop={6} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
              <MaterialIcons name="delete-outline" size={16} color={tf.clay} />
            </Pressable>
          </View>
        )}
      </View>
    </FoldRiseIn>
  );
}

export default function ProjectTagsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ domain?: string }>();
  const domain = resolveDomain(params.domain);
  const isMemoDomain = domain === 'memo';
  const insets = useSafeAreaInsets();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate, motionReduced, motionReady } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [tags, setTags] = React.useState<ProjectTagRow[]>([]);
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState<string>(DEFAULT_PROJECT_TAG_COLOR);
  const [description, setDescription] = React.useState('');
  const [weightText, setWeightText] = React.useState('0');
  const [nameDup, setNameDup] = React.useState(false);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);

  const foldCardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.86)';
  const foldCardBorder = tf.line2;
  const enterReady = motionReady && !loading;
  const showContent = enterReady || (motionReady && motionReduced);
  const enterAnimate = foldAnimate && enterReady;
  const holdEntrance = !motionReduced;

  const titleText = isMemoDomain ? '备忘标签' : '项目标签';
  const subtitleText = isMemoDomain
    ? '同一标签也用于备忘 · 名称不可重复'
    : '同一标签也用于备忘 · 名称不可重复';
  const hintText = isMemoDomain
    ? '仅用于备忘录分类；与任务侧标签相互独立。权重越大在列表中越靠前。'
    : '用于项目、习惯与独立待办；与备忘录标签相互独立。权重越大在列表中越靠前。';
  const deleteScopeHint = isMemoDomain
    ? '删除标签只移除此标签，不删除备忘；已贴关联会一并移除。'
    : '删除标签只移除此标签，不删除项目与备忘；已贴关联会一并移除。';

  const maxWeight = React.useMemo(
    () => Math.max(1, ...tags.map((t) => (typeof t.weight === 'number' ? t.weight : 0)), 1),
    [tags],
  );

  const topWeightTag = React.useMemo(() => {
    if (tags.length === 0) return null;
    return tags.reduce((best, t) => ((t.weight ?? 0) > (best.weight ?? 0) ? t : best), tags[0]);
  }, [tags]);

  const load = React.useCallback(
    async (forceRefresh = false) => {
      const hitApi = forceRefresh || !hasPageLoadedFromServer(PAGE_API_KEY);
      try {
        await wrapLoad(async () => {
          await fetchProfileMemoList({ forceRefresh: hitApi });
          setTags(isMemoDomain ? await getMemoTags() : await getProjectTags());
        }, hitApi);
      } catch (err) {
        console.warn(isMemoDomain ? '加载备忘录标签失败' : '加载任务标签失败', err);
        setTags([]);
      } finally {
        setLoading(false);
      }
    },
    [isMemoDomain, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, load);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load]),
  );

  React.useEffect(() => {
    let cancelled = false;
    const trimmed = name.trim();
    if (!trimmed || !editorVisible) {
      setNameDup(false);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        const dup = isMemoDomain
          ? await isMemoTagNameDuplicate(trimmed, editingId ?? undefined)
          : await isProjectTagNameDuplicate(trimmed, editingId ?? undefined);
        if (!cancelled) setNameDup(dup);
      })();
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [editingId, editorVisible, isMemoDomain, name]);

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setColor(DEFAULT_PROJECT_TAG_COLOR);
    setDescription('');
    setWeightText('0');
    setNameDup(false);
    setPendingDeleteId(null);
    setEditorVisible(true);
  };

  const openEdit = (tag: ProjectTagRow) => {
    setEditingId(tag.id);
    setName(tag.name);
    setColor(tag.color || DEFAULT_PROJECT_TAG_COLOR);
    setDescription(tag.description ?? '');
    setWeightText(String(tag.weight ?? 0));
    setNameDup(false);
    setPendingDeleteId(null);
    setEditorVisible(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorVisible(false);
  };

  const saveTag = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.warn('请输入标签名称');
      return;
    }
    const weight = Number.parseInt(weightText.trim() || '0', 10);
    if (!Number.isFinite(weight)) {
      toast.warn('权重请输入整数');
      return;
    }
    const dup = isMemoDomain
      ? await isMemoTagNameDuplicate(trimmed, editingId ?? undefined)
      : await isProjectTagNameDuplicate(trimmed, editingId ?? undefined);
    if (dup) {
      setNameDup(true);
      toast.warn('同域内标签名称不能重复');
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
      toast.success('已保存');
      try {
        const tagSyncTables = ['tags', 'tag_links'];
        await markPendingTablesDirty(tagSyncTables);
        await requestPush({
          awaitSync: true,
          rethrow: true,
          quiet: true,
          onlyTables: tagSyncTables,
        });
      } catch (syncErr) {
        console.warn('标签保存后同步失败', syncErr);
      }
    } catch (err) {
      console.warn('保存标签失败', err);
      toast.error(formatWriteError(err, '标签保存失败，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  };

  const runDelete = async (tag: ProjectTagRow) => {
    try {
      await deleteProjectTag(tag.id);
      setPendingDeleteId(null);
      await load();
      toast.success('已删除');
      try {
        const tagSyncTables = ['tags', 'tag_links'];
        await markPendingTablesDirty(tagSyncTables);
        await requestPush({
          awaitSync: true,
          rethrow: true,
          quiet: true,
          onlyTables: tagSyncTables,
        });
      } catch (syncErr) {
        console.warn('标签删除后同步失败', syncErr);
      }
    } catch (err) {
      console.warn('删除标签失败', err);
      toast.error(formatWriteError(err, '标签删除失败，请稍后重试。'));
    }
  };

  const footPad = Math.max(insets.bottom, 12);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <View style={[styles.appbar, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconbtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={20} color={tf.ink2} />
        </Pressable>
        <View style={styles.appbarCenter}>
          <Text style={[styles.appbarTitle, { color: tf.ink }]}>{titleText}</Text>
          <Text style={[styles.appbarSub, { color: tf.muted }]} numberOfLines={1}>
            {subtitleText}
          </Text>
        </View>
        <Pressable
          onPress={openCreate}
          style={({ pressed }) => [
            styles.pillbtn,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.66)',
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>＋ 新建</Text>
        </Pressable>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[styles.content, { paddingBottom: 28 + footPad }]}
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}>
        {!showContent ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={tf.frog} />
          </View>
        ) : (
          <>
            <FoldRiseIn
              animate={enterAnimate}
              index={0}
              duration={460}
              staggerMs={36}
              fromY={8}
              holdHidden={holdEntrance}>
              <Text style={[styles.hint, { color: tf.muted }]}>{hintText}</Text>
            </FoldRiseIn>

            {tags.length === 0 ? (
              <FoldRiseIn
                animate={enterAnimate}
                index={1}
                duration={460}
                staggerMs={36}
                fromY={10}
                holdHidden={holdEntrance}>
                <View style={[styles.emptyCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                  <MaterialIcons name="local-offer" size={28} color={tf.faint} />
                  <Text style={[styles.emptyTitle, { color: tf.ink }]}>还没有标签</Text>
                  <Text style={[styles.emptyDesc, { color: tf.muted }]}>点击右上角「＋ 新建」创建第一个标签</Text>
                </View>
              </FoldRiseIn>
            ) : (
              tags.map((tag, index) => (
                <TagRowCard
                  key={tag.id}
                  tag={tag}
                  maxWeight={maxWeight}
                  confirmingDelete={pendingDeleteId === tag.id}
                  onEdit={() => openEdit(tag)}
                  onAskDelete={() => setPendingDeleteId(tag.id)}
                  onConfirmDelete={() => void runDelete(tag)}
                  onCancelDelete={() => setPendingDeleteId(null)}
                  animate={enterAnimate}
                  holdHidden={holdEntrance}
                  index={index + 1}
                />
              ))
            )}

            {tags.length > 0 ? (
              <FoldRiseIn
                animate={enterAnimate}
                index={tags.length + 2}
                duration={460}
                staggerMs={36}
                fromY={8}
                holdHidden={holdEntrance}>
                <View style={[styles.distCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                  <View style={styles.distHead}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: tf.ink2 }}>标签权重</Text>
                    <Text style={{ fontSize: 10, color: tf.faint }}>自动分组与建议排序</Text>
                  </View>
                  {topWeightTag ? (
                    <View style={styles.distRow}>
                      <Text style={{ fontFamily: fonts.mono, fontSize: 16, fontWeight: '700', color: '#4F7450' }}>
                        {topWeightTag.weight}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <TagWeightBar
                          color={topWeightTag.color || tf.sage}
                          weight={topWeightTag.weight}
                          maxWeight={maxWeight}
                          animate={enterAnimate}
                        />
                      </View>
                      <Text style={{ flex: 1.2, fontSize: 10, color: tf.faint }} numberOfLines={2}>
                        {topWeightTag.name} 优先级最高
                      </Text>
                    </View>
                  ) : null}
                </View>
              </FoldRiseIn>
            ) : null}

            <FoldRiseIn
              animate={enterAnimate}
              index={tags.length + 3}
              duration={460}
              staggerMs={36}
              fromY={8}
              holdHidden={holdEntrance}>
              <Pressable
                onPress={openCreate}
                style={({ pressed }) => [
                  styles.tagadd,
                  { borderColor: tf.line2, opacity: pressed ? 0.85 : 1 },
                ]}>
                <MaterialIcons name="add" size={14} color={tf.muted} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: tf.muted }}>新建标签</Text>
              </Pressable>
            </FoldRiseIn>

            <FoldRiseIn
              animate={enterAnimate}
              index={tags.length + 4}
              duration={460}
              staggerMs={36}
              fromY={6}
              holdHidden={holdEntrance}>
              <View style={styles.hintline}>
                <MaterialIcons name="lightbulb-outline" size={14} color={tf.faint} />
                <Text style={{ flex: 1, fontSize: 11, color: tf.faint, lineHeight: 16 }}>{deleteScopeHint}</Text>
              </View>
            </FoldRiseIn>
          </>
        )}
      </ScrollView>

      <Modal visible={editorVisible} transparent animationType="fade" onRequestClose={closeEditor}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeEditor} />
          <View style={[styles.editorCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
            <Text style={[styles.editorTitle, { color: tf.ink }]}>
              {editingId ? '编辑标签' : '新建标签'}
            </Text>

            <Text style={[styles.fieldLabel, { color: tf.muted }]}>名称</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={isMemoDomain ? '例如：灵感 / 待查' : '例如：品牌 / 网站'}
              placeholderTextColor={tf.faint}
              maxLength={40}
              style={[
                styles.input,
                {
                  color: tf.ink,
                  backgroundColor: isDark ? tf.paper2 : '#F1EDE1',
                  borderColor: nameDup ? tf.clay : tf.line,
                },
              ]}
            />
            {nameDup ? (
              <Text style={{ fontSize: 11, color: tf.clay, marginTop: -2 }}>同域内名称已存在</Text>
            ) : null}

            <Text style={[styles.fieldLabel, { color: tf.muted }]}>颜色</Text>
            <View style={styles.colorRow}>
              {PROJECT_TAG_COLOR_PRESETS.map((c) => {
                const selected = color.toUpperCase() === c.toUpperCase();
                return (
                  <Pressable
                    key={c}
                    onPress={() => setColor(c)}
                    style={[
                      styles.colorSwatch,
                      {
                        backgroundColor: c,
                        borderColor: selected ? tf.ink : 'transparent',
                      },
                    ]}
                  />
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: tf.muted }]}>简介（可选）</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="一句话说明这个标签"
              placeholderTextColor={tf.faint}
              maxLength={120}
              multiline
              style={[
                styles.input,
                styles.descInput,
                { color: tf.ink, backgroundColor: isDark ? tf.paper2 : '#F1EDE1', borderColor: tf.line },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: tf.muted }]}>权重</Text>
            <TextInput
              value={weightText}
              onChangeText={setWeightText}
              placeholder="0"
              placeholderTextColor={tf.faint}
              keyboardType="number-pad"
              style={[
                styles.input,
                { color: tf.ink, backgroundColor: isDark ? tf.paper2 : '#F1EDE1', borderColor: tf.line },
              ]}
            />
            <Text style={{ fontSize: 11, color: tf.faint }}>数值越大越靠前；可为负数</Text>

            <View style={styles.editorActions}>
              <Pressable onPress={closeEditor} disabled={saving} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
                <Text style={{ fontSize: 14, color: tf.muted }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveTag()}
                disabled={saving || nameDup}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: tf.pond,
                    opacity: saving || nameDup ? 0.55 : pressed ? 0.9 : 1,
                  },
                ]}>
                <Text style={{ color: tf.onPond, fontSize: 14, fontWeight: '700' }}>
                  {saving ? '保存中' : '确认'}
                </Text>
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
  appbar: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconbtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appbarCenter: { flex: 1, minWidth: 0 },
  appbarTitle: { fontSize: 15, fontWeight: '700' },
  appbarSub: { fontSize: 10, marginTop: 2 },
  pillbtn: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 14, paddingTop: 4, gap: 4 },
  hint: { fontSize: 12, lineHeight: 18, marginBottom: 6 },
  loadingWrap: { paddingVertical: 40, alignItems: 'center' },
  emptyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyDesc: { fontSize: 12, textAlign: 'center' },
  tagrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  tagcol: { width: 4, alignSelf: 'stretch', borderRadius: 2, minHeight: 28 },
  tgc: { flex: 1, minWidth: 0 },
  tgcTitle: { fontSize: 13, fontWeight: '700' },
  tgcMeta: { fontSize: 10, marginTop: 2 },
  tagweight: {
    width: 42,
    height: 4,
    borderRadius: 3,
    overflow: 'hidden',
  },
  tagweightFill: { height: '100%', borderRadius: 3 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  delRow: { flexDirection: 'row', gap: 4 },
  tagdel: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  distCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginTop: 6,
  },
  distHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tagadd: {
    height: 36,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 6,
  },
  hintline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  modalRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(25,34,28,0.42)',
  },
  editorCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  editorTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginTop: 4 },
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
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 14,
    marginTop: 10,
  },
  primaryBtn: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
});
