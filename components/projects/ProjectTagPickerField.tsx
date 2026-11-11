import {
  FoldBottomSheet,
  useFoldBottomSheetRequestClose,
} from '@/components/ui/fold-bottom-sheet';
import type { ProjectTagRow, TagDomain } from '@/lib/repositories/projects/project-tag.types';
import { filterTagsByDomain, normalizeTagDomain } from '@/lib/repositories/tags/tag';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type ProjectTagPickerFieldProps = {
  selectedIds: string[];
  allTags: ProjectTagRow[];
  loading?: boolean;
  disabled?: boolean;
  /** 只读展示（如继承项目标签），不可打开选择器 */
  locked?: boolean;
  /** locked 时主文案前缀，默认「与项目一致」 */
  lockedHint?: string;
  /** 标签式紧凑展示：芯片行 + 轻触发，无大框摘要 */
  compact?: boolean;
  /** 标签域：任务侧 / 备忘录互斥；决定可选列表与「管理标签」跳转 */
  tagDomain?: TagDomain;
  onChange: (ids: string[]) => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
  isDark: boolean;
};

export function ProjectTagPickerField({
  selectedIds,
  allTags,
  loading = false,
  disabled = false,
  locked = false,
  lockedHint = '与项目一致',
  /** 默认芯片态；需要旧大框时显式传 compact={false} */
  compact = true,
  tagDomain = 'task',
  onChange,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
  isDark,
}: ProjectTagPickerFieldProps) {
  const router = useRouter();
  const [modalVisible, setModalVisible] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  const domain = normalizeTagDomain(tagDomain);

  // 选择列表严格按域隔离；已选跨域历史项仅用于展示摘要，不出现在可选列表
  const selectableTags = useMemo(
    () => filterTagsByDomain(allTags, domain),
    [allTags, domain],
  );

  const tagById = useMemo(() => new Map(allTags.map((t) => [t.id, t])), [allTags]);
  const selectableIdSet = useMemo(
    () => new Set(selectableTags.map((t) => t.id)),
    [selectableTags],
  );

  const selectedTags = useMemo(
    () =>
      selectedIds
        .map((id) => tagById.get(id))
        .filter((t): t is ProjectTagRow => !!t)
        .filter((t) => normalizeTagDomain(t.domain) === domain),
    [domain, selectedIds, tagById],
  );

  const selectedSummary = useMemo(() => {
    if (selectedTags.length === 0) return locked ? `${lockedHint}：未贴标签` : '未贴标签';
    const names =
      selectedTags.length <= 3
        ? selectedTags.map((t) => t.name).join('、')
        : `${selectedTags
            .slice(0, 2)
            .map((t) => t.name)
            .join('、')} 等 ${selectedTags.length} 个`;
    return locked ? `${lockedHint}：${names}` : names;
  }, [locked, lockedHint, selectedTags]);

  const openModal = useCallback(() => {
    if (disabled || locked) return;
    // 打开时丢掉跨域 id，避免确认时把备忘录标签写回任务侧
    setDraftIds(selectedIds.filter((id) => selectableIdSet.has(id)));
    setModalVisible(true);
  }, [disabled, locked, selectableIdSet, selectedIds]);

  const handleSheetClose = useCallback(() => {
    setModalVisible(false);
    setDraftIds([]);
  }, []);

  const toggleDraft = useCallback((tagId: string) => {
    setDraftIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }, []);

  const removeSelected = useCallback(
    (tagId: string) => {
      if (disabled || loading || locked) return;
      onChange(selectedIds.filter((id) => id !== tagId));
    },
    [disabled, loading, locked, onChange, selectedIds],
  );

  // 夜间模式强制实色底，避免调用方传入的半透明 surface 叠在深色背景上发虚
  const fieldBg = isDark ? '#161d2b' : surfaceLow;
  const manageBg = isDark ? '#243044' : `${primary}10`;

  const renderTagChip = (tag: ProjectTagRow, removable: boolean) => (
    <View
      key={tag.id}
      style={[
        styles.miniChip,
        isDark
          ? { backgroundColor: tag.color, borderColor: tag.color }
          : { backgroundColor: `${tag.color}22`, borderColor: `${tag.color}55` },
      ]}>
      {!isDark ? <View style={[styles.miniDot, { backgroundColor: tag.color }]} /> : null}
      <Text style={[styles.miniChipText, { color: isDark ? '#ffffff' : tag.color }]} numberOfLines={1}>
        {tag.name}
      </Text>
      {removable ? (
        <Pressable onPress={() => removeSelected(tag.id)} hitSlop={8} accessibilityLabel={`移除 ${tag.name}`}>
          <MaterialIcons name="close" size={13} color={isDark ? '#ffffff' : tag.color} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <>
      {compact ? (
        <View style={styles.compactWrap}>
          <View style={styles.chipRow}>
            {loading ? (
              <Text style={[styles.compactEmpty, { color: outline }]}>加载标签…</Text>
            ) : selectedTags.length === 0 ? (
              <Text style={[styles.compactEmpty, { color: outline }]}>
                {locked ? `${lockedHint}：未贴标签` : '未贴标签'}
              </Text>
            ) : (
              selectedTags.map((tag) => renderTagChip(tag, !locked && !disabled))
            )}
          </View>
          {!locked ? (
            <Pressable
              onPress={openModal}
              disabled={disabled || loading}
              style={({ pressed }) => [
                styles.compactAdd,
                {
                  borderColor: placeholderColor,
                  backgroundColor: fieldBg,
                  opacity: disabled || loading ? 0.55 : pressed ? 0.8 : 1,
                },
              ]}>
              {loading ? (
                <ActivityIndicator size="small" color={primary} />
              ) : (
                <>
                  <MaterialIcons name="add" size={15} color={primary} />
                  <Text style={[styles.compactAddText, { color: primary }]}>
                    {selectedTags.length > 0 ? '调整标签' : '添加标签'}
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Pressable
          onPress={openModal}
          disabled={disabled || loading || locked}
          style={({ pressed }) => [
            styles.select,
            { backgroundColor: fieldBg, borderColor: placeholderColor },
            (disabled || loading || locked) && { opacity: locked ? 1 : 0.65 },
            pressed && !disabled && !loading && !locked && { opacity: 0.8 },
          ]}>
          <View style={styles.selectLeft}>
            <MaterialIcons name="local-offer" size={18} color={primary} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.selectValue, { color: textColor }]} numberOfLines={2}>
                {loading ? '加载标签…' : selectedSummary}
              </Text>
              {selectedTags.length > 0 ? (
                <View style={styles.chipRow}>
                  {selectedTags.slice(0, 4).map((tag) => renderTagChip(tag, false))}
                </View>
              ) : locked ? null : (
                <Text style={[styles.selectHint, { color: outline }]}>可选多个标签；可在标签管理中新建</Text>
              )}
            </View>
          </View>
          {loading ? (
            <ActivityIndicator size="small" color={primary} />
          ) : locked ? null : (
            <MaterialIcons name="expand-more" size={20} color={outline} />
          )}
        </Pressable>
      )}

      <FoldBottomSheet
        visible={modalVisible}
        onClose={handleSheetClose}
        accessibilityLabel="关闭标签选择">
        <TagPickerSheetBody
          domain={domain}
          textColor={textColor}
          outline={outline}
          primary={primary}
          manageBg={manageBg}
          isDark={isDark}
          selectableTags={selectableTags}
          draftIds={draftIds}
          toggleDraft={toggleDraft}
          onChange={onChange}
          selectableIdSet={selectableIdSet}
          routerPushManage={() => {
            router.push({ pathname: '/project-tags', params: { domain } });
          }}
        />
      </FoldBottomSheet>
    </>
  );
}

function TagPickerSheetBody({
  domain,
  textColor,
  outline,
  primary,
  manageBg,
  isDark,
  selectableTags,
  draftIds,
  toggleDraft,
  onChange,
  selectableIdSet,
  routerPushManage,
}: {
  domain: TagDomain;
  textColor: string;
  outline: string;
  primary: string;
  manageBg: string;
  isDark: boolean;
  selectableTags: ProjectTagRow[];
  draftIds: string[];
  toggleDraft: (id: string) => void;
  onChange: (ids: string[]) => void;
  selectableIdSet: Set<string>;
  routerPushManage: () => void;
}) {
  const requestClose = useFoldBottomSheetRequestClose();

  const confirm = useCallback(() => {
    onChange(draftIds.filter((id) => selectableIdSet.has(id)));
    requestClose();
  }, [draftIds, onChange, requestClose, selectableIdSet]);

  const openManage = useCallback(() => {
    requestClose();
    // 等弹层退场后再跳转，避免叠层闪烁
    setTimeout(routerPushManage, 280);
  }, [requestClose, routerPushManage]);

  return (
    <View style={styles.sheetBody}>
      <View style={styles.modalHeader}>
        <Text style={[styles.modalTitle, { color: textColor }]}>选择标签</Text>
        <Pressable onPress={requestClose} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
          <MaterialIcons name="close" size={22} color={outline} />
        </Pressable>
      </View>
      <Text style={[styles.modalDesc, { color: outline }]}>
        {domain === 'memo'
          ? '仅备忘录标签；与项目/待办标签相互独立。可贴多个，权重高的优先展示。'
          : '仅项目/习惯/待办标签；与备忘录标签相互独立。可贴多个，权重高的优先展示。'}
      </Text>

      <Pressable
        onPress={openManage}
        style={({ pressed }) => [
          styles.manageBtn,
          isDark
            ? { borderColor: primary, backgroundColor: manageBg, opacity: pressed ? 0.85 : 1 }
            : { borderColor: `${primary}33`, backgroundColor: manageBg, opacity: pressed ? 0.85 : 1 },
        ]}>
        <MaterialIcons name="settings" size={16} color={primary} />
        <Text style={[styles.manageBtnText, { color: primary }]}>管理标签（新建 / 删除 / 权重）</Text>
      </Pressable>

      {selectableTags.length === 0 ? (
        <Text style={[styles.modalEmpty, { color: outline }]}>暂无标签，请先去管理页新建</Text>
      ) : (
        <>
          <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {selectableTags.map((tag) => {
              const picked = draftIds.includes(tag.id);
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => toggleDraft(tag.id)}
                  style={({ pressed }) => [
                    styles.modalRow,
                    {
                      borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)',
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}>
                  <View style={[styles.colorDot, { backgroundColor: tag.color }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.modalRowTitle, { color: textColor }]} numberOfLines={1}>
                      {tag.name}
                    </Text>
                    <Text style={[styles.modalRowSub, { color: outline }]} numberOfLines={1}>
                      权重 {tag.weight}
                      {tag.description?.trim() ? ` · ${tag.description.trim()}` : ''}
                    </Text>
                  </View>
                  {picked ? (
                    <MaterialIcons name="check-circle" size={22} color={primary} />
                  ) : (
                    <MaterialIcons name="radio-button-unchecked" size={22} color={outline} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={confirm}
            style={({ pressed }) => [styles.confirmBtn, { backgroundColor: primary, opacity: pressed ? 0.9 : 1 }]}>
            <Text style={styles.confirmBtnText}>
              确定{draftIds.length > 0 ? `（已选 ${draftIds.length} 个）` : ''}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  compactWrap: { gap: 8 },
  compactEmpty: { fontSize: 12, fontWeight: '600' },
  compactAdd: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  compactAddText: { fontSize: 12, fontWeight: '700' },
  select: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  selectLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1 },
  selectValue: { fontSize: 14, fontWeight: '700' },
  selectHint: { fontSize: 11, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  miniChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 140,
  },
  miniDot: { width: 6, height: 6, borderRadius: 3 },
  miniChipText: { fontSize: 11, fontWeight: '700', maxWidth: 100 },
  sheetBody: { gap: 8, paddingBottom: 4 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalDesc: { fontSize: 12, fontWeight: '600', lineHeight: 18, marginBottom: 2 },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  manageBtnText: { fontSize: 12, fontWeight: '700' },
  modalEmpty: { fontSize: 13, fontWeight: '600', paddingVertical: 24, textAlign: 'center' },
  modalList: { maxHeight: 360 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  modalRowTitle: { fontSize: 14, fontWeight: '700' },
  modalRowSub: { fontSize: 11, fontWeight: '600' },
  confirmBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
