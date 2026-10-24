/**
 * 任务列表筛选条：搜索 + 快速日期/优先级/长期 + 展开组合（标签等多选）。
 */
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MotionPressable } from '@/components/ui/motion-pressable';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import {
  countActiveTaskListFilterDims,
  EMPTY_TASK_LIST_FILTER,
  isTaskListFilterActive,
  TASK_DATE_PRESET_OPTIONS,
  TASK_PRIORITY_FILTER_OPTIONS,
  toggleInList,
  type TaskDatePreset,
  type TaskListFilterState,
  type TaskLongTermFilter,
} from '@/lib/task-list-filter';

type Props = {
  value: TaskListFilterState;
  onChange: (next: TaskListFilterState) => void;
  tags: TagRow[];
  resultCount?: number;
  /** 搜索框占位 */
  searchPlaceholder?: string;
  /** 展开面板「长期」区块标题 */
  longTermSectionLabel?: string;
};

function FilterChip({
  label,
  active,
  onPress,
  dot,
  compact,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  dot?: string;
  compact?: boolean;
}) {
  const { tf, isDark } = useTaskFoldTheme();
  return (
    <MotionPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        compact && styles.chipCompact,
        {
          borderColor: active ? tf.pond : tf.line,
          backgroundColor: active
            ? isDark
              ? 'rgba(127,166,149,0.22)'
              : tf.sage2
            : isDark
              ? tf.paper3
              : 'rgba(255,252,245,0.72)',
        },
      ]}>
      {dot ? <View style={[styles.chipDot, { backgroundColor: dot }]} /> : null}
      <Text
        numberOfLines={1}
        style={[
          styles.chipText,
          compact && styles.chipTextCompact,
          { color: active ? tf.pond : tf.ink2 },
        ]}>
        {label}
      </Text>
    </MotionPressable>
  );
}

export function TaskListFilterBar({
  value,
  onChange,
  tags,
  resultCount,
  searchPlaceholder = '搜索标题或备注…',
  longTermSectionLabel = '长期任务',
}: Props) {
  const { tf, isDark } = useTaskFoldTheme();
  const [expanded, setExpanded] = React.useState(false);
  const [searchFocused, setSearchFocused] = React.useState(false);
  const active = isTaskListFilterActive(value);
  const dimCount = countActiveTaskListFilterDims(value);

  const patch = React.useCallback(
    (partial: Partial<TaskListFilterState>) => {
      onChange({ ...value, ...partial });
    },
    [onChange, value],
  );

  const setDatePreset = (key: TaskDatePreset) => {
    patch({ datePreset: value.datePreset === key ? null : key });
  };

  const setLongTerm = (next: TaskLongTermFilter) => {
    patch({ longTerm: value.longTerm === next ? 'all' : next });
  };

  const clearAll = () => {
    onChange({ ...EMPTY_TASK_LIST_FILTER });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchWrap,
            {
              backgroundColor: isDark ? tf.paper3 : 'rgba(255,252,245,0.85)',
              borderColor: searchFocused ? tf.pond : tf.line,
            },
          ]}>
          <MaterialIcons name="search" size={16} color={tf.muted} />
          <TextInput
            value={value.search}
            onChangeText={(t) => patch({ search: t })}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={searchPlaceholder}
            placeholderTextColor={tf.faint}
            style={[styles.searchInput, { color: tf.ink }]}
            returnKeyType="search"
            clearButtonMode="never"
          />
          {value.search ? (
            <Pressable
              onPress={() => patch({ search: '' })}
              hitSlop={8}
              accessibilityLabel="清除搜索">
              <MaterialIcons name="close" size={16} color={tf.muted} />
            </Pressable>
          ) : null}
        </View>
        <MotionPressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityLabel={expanded ? '收起筛选' : '展开筛选'}
          accessibilityState={{ expanded }}
          style={[
            styles.iconBtn,
            {
              borderColor: expanded || active ? tf.pond : tf.line,
              backgroundColor:
                expanded || active
                  ? isDark
                    ? 'rgba(127,166,149,0.22)'
                    : tf.sage2
                  : isDark
                    ? tf.paper3
                    : 'rgba(255,252,245,0.72)',
            },
          ]}>
          <MaterialIcons
            name="tune"
            size={16}
            color={expanded || active ? tf.pond : tf.ink2}
          />
          {dimCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: tf.pond }]}>
              <Text style={styles.badgeText}>{dimCount}</Text>
            </View>
          ) : null}
        </MotionPressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickRow}
        style={styles.quickScroll}>
        {TASK_DATE_PRESET_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.key}
            compact
            label={opt.label}
            active={value.datePreset === opt.key}
            onPress={() => setDatePreset(opt.key)}
          />
        ))}
        <FilterChip
          compact
          label="长期"
          active={value.longTerm === 'yes'}
          onPress={() => setLongTerm('yes')}
        />
        {TASK_PRIORITY_FILTER_OPTIONS.map((opt) => (
          <FilterChip
            key={opt.value}
            compact
            label={opt.short}
            active={value.priorities.includes(opt.value)}
            onPress={() => patch({ priorities: toggleInList(value.priorities, opt.value) })}
          />
        ))}
      </ScrollView>

      {expanded ? (
        <View
          style={[
            styles.panel,
            {
              backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.92)',
              borderColor: tf.line,
            },
          ]}>
          <Text style={[styles.sectionLabel, { color: tf.muted }]}>紧急程度（可多选）</Text>
          <View style={styles.wrapChips}>
            {TASK_PRIORITY_FILTER_OPTIONS.map((opt) => (
              <FilterChip
                key={opt.value}
                label={opt.label}
                active={value.priorities.includes(opt.value)}
                onPress={() =>
                  patch({ priorities: toggleInList(value.priorities, opt.value) })
                }
              />
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: tf.muted, marginTop: 10 }]}>
            {longTermSectionLabel}
          </Text>
          <View style={styles.wrapChips}>
            <FilterChip
              label="全部"
              active={value.longTerm === 'all'}
              onPress={() => patch({ longTerm: 'all' })}
            />
            <FilterChip
              label="仅长期"
              active={value.longTerm === 'yes'}
              onPress={() => patch({ longTerm: 'yes' })}
            />
            <FilterChip
              label="非长期"
              active={value.longTerm === 'no'}
              onPress={() => patch({ longTerm: 'no' })}
            />
          </View>

          <Text style={[styles.sectionLabel, { color: tf.muted, marginTop: 10 }]}>
            标签（可多选，满足其一）
          </Text>
          <View style={styles.wrapChips}>
            {tags.length === 0 ? (
              <Text style={[styles.emptyHint, { color: tf.faint }]}>暂无可用标签</Text>
            ) : (
              tags.map((tag) => (
                <FilterChip
                  key={tag.id}
                  label={tag.name}
                  dot={tag.color}
                  active={value.tagIds.includes(tag.id)}
                  onPress={() => patch({ tagIds: toggleInList(value.tagIds, tag.id) })}
                />
              ))
            )}
          </View>

          <View style={styles.panelFoot}>
            {typeof resultCount === 'number' ? (
              <Text style={[styles.resultHint, { color: tf.muted }]}>
                {active ? `匹配 ${resultCount} 项` : `共 ${resultCount} 项`}
              </Text>
            ) : (
              <View />
            )}
            {active ? (
              <MotionPressable onPress={clearAll} hitSlop={6}>
                <Text style={[styles.clearText, { color: tf.pond }]}>清除筛选</Text>
              </MotionPressable>
            ) : null}
          </View>
        </View>
      ) : active ? (
        <View style={styles.activeHintRow}>
          <Text style={[styles.resultHint, { color: tf.muted }]} numberOfLines={1}>
            {typeof resultCount === 'number' ? `已筛选 · ${resultCount} 项` : '筛选生效中'}
          </Text>
          <MotionPressable onPress={clearAll} hitSlop={6}>
            <Text style={[styles.clearText, { color: tf.pond }]}>清除</Text>
          </MotionPressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '500',
    paddingVertical: 6,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#F8F3E9', fontSize: 8, fontWeight: '800' },
  quickScroll: { marginHorizontal: -2 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    maxWidth: 160,
  },
  chipCompact: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 11, fontWeight: '600' },
  chipTextCompact: { fontSize: 10, fontWeight: '700' },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 8,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  emptyHint: { fontSize: 11 },
  panelFoot: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  resultHint: { fontSize: 10.5, fontWeight: '600' },
  clearText: { fontSize: 11, fontWeight: '700' },
});
