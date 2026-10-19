import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';

import { MotionPressable } from '@/components/ui';
import { Layout, Spacing } from '@/constants/design-tokens';
import { MemoRadius, MemoText } from '@/constants/memo-ui';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import type { TagRow } from '@/lib/repositories/tags/tag.types';

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  tagFilter: string;
  filterAll: string;
  filterNone: string;
  onTagFilter: (next: string) => void;
  usedTags: TagRow[];
  onManageTags: () => void;
  onSort: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  paper: string;
  cavity: string;
  searchBg: string;
  chipBg: string;
  ink: string;
  muted: string;
  line: string;
  primary: string;
  renderList: (listProps: {
    scrollEnabled: boolean;
    onScroll: (offsetY: number) => void;
  }) => React.ReactNode;
};

const REFRESH_EXTRA = 64;
const OPEN_RATIO = 0.38;

/**
 * 页顶抽屉：在列表顶部下拉，先露出标签，再继续下拉才刷新。
 * 不响应点击展开。
 */
export function MemoFilterDrawer(props: Props) {
  const { refreshing, onRefresh, paper, cavity, line, primary, renderList } = props;
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const motionOff = reduceMotion || !motionReady;
  const pull = useSharedValue(0);
  const interior = useSharedValue(1);
  const scrollY = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const gestureStart = useSharedValue(0);
  const engaged = useSharedValue(false);
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [interiorHeight, setInteriorHeight] = useState(0);

  useEffect(() => {
    const next = Math.max(interiorHeight, 1);
    interior.value = next;
    if (pull.value > 8) pull.value = next;
  }, [interior, interiorHeight, pull]);

  const requestRefresh = useCallback(() => {
    if (refreshingRef.current) return;
    onRefresh();
  }, [onRefresh]);

  const setListScrollEnabled = useCallback((enabled: boolean) => {
    setScrollEnabled(enabled);
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e) => {
          'worklet';
          const t = e.allTouches[0];
          if (!t) return;
          touchStartX.value = t.absoluteX;
          touchStartY.value = t.absoluteY;
        })
        .onTouchesMove((e, state) => {
          'worklet';
          const t = e.allTouches[0];
          if (!t) return;
          const dx = t.absoluteX - touchStartX.value;
          const dy = t.absoluteY - touchStartY.value;
          if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) {
            state.fail();
            return;
          }
          if (scrollY.value > 6) {
            state.fail();
            return;
          }
          const open = pull.value > interior.value * 0.5;
          if (dy > 10 || (dy < -12 && open)) state.activate();
        })
        .onStart(() => {
          'worklet';
          engaged.value = true;
          gestureStart.value = pull.value;
          runOnJS(setListScrollEnabled)(false);
        })
        .onUpdate((e) => {
          'worklet';
          const ceiling = interior.value + REFRESH_EXTRA;
          let next = gestureStart.value + e.translationY;
          if (next < 0) next = 0;
          if (next > ceiling) next = ceiling + (next - ceiling) * 0.25;
          pull.value = next;
        })
        .onFinalize(() => {
          'worklet';
          if (!engaged.value) return;
          engaged.value = false;
          const interiorH = interior.value;
          const current = pull.value;
          const duration = motionOff ? 0 : 220;
          if (current >= interiorH + REFRESH_EXTRA * 0.72) {
            pull.value = withTiming(interiorH, { duration });
            runOnJS(requestRefresh)();
          } else if (current > interiorH * OPEN_RATIO) {
            pull.value = withTiming(interiorH, { duration });
          } else {
            pull.value = withTiming(0, { duration });
          }
          runOnJS(setListScrollEnabled)(true);
        }),
    [engaged, gestureStart, interior, motionOff, pull, requestRefresh, scrollY, setListScrollEnabled, touchStartX, touchStartY],
  );

  const clipStyle = useAnimatedStyle(() => ({
    height: Math.min(Math.max(pull.value, 0), interior.value),
    overflow: 'hidden' as const,
  }));

  const refreshStyle = useAnimatedStyle(() => {
    const extra = Math.max(0, pull.value - interior.value);
    return { height: extra, opacity: extra > 6 ? 1 : 0 };
  });

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.column}>
        <View style={[styles.shell, { backgroundColor: paper, borderBottomColor: line }]}>
          <DrawerFace {...props} />
          <Animated.View style={[styles.clip, clipStyle, { backgroundColor: cavity }]}>
            <View
              style={styles.interiorMeasure}
              onLayout={event => {
                const next = Math.ceil(event.nativeEvent.layout.height);
                setInteriorHeight(prev => (prev === next ? prev : next));
              }}>
              <DrawerInterior {...props} />
            </View>
          </Animated.View>
          <View pointerEvents="none" style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: line }]} />
          </View>
        </View>
        <Animated.View style={[styles.refreshSlot, refreshStyle]} pointerEvents="none">
          <ActivityIndicator color={primary} />
        </Animated.View>
        {refreshing ? (
          <View style={styles.refreshingRow}>
            <ActivityIndicator color={primary} />
          </View>
        ) : null}
        {renderList({
          scrollEnabled,
          onScroll: (offsetY) => {
            scrollY.value = offsetY;
          },
        })}
      </View>
    </GestureDetector>
  );
}

function DrawerInterior({
  tagFilter,
  filterAll,
  filterNone,
  onTagFilter,
  usedTags,
  onManageTags,
  chipBg,
  ink,
  muted,
  line,
  primary,
}: Props) {
  return (
    <View style={styles.interior}>
      <Text style={[styles.kicker, { color: muted }]}>标签</Text>
      <View style={styles.tagWrap}>
        <TagChip
          label="全部"
          active={tagFilter === filterAll}
          activeColor={primary}
          ink={ink}
          line={line}
          chipBg={chipBg}
          onPress={() => onTagFilter(filterAll)}
        />
        <TagChip
          label="无标签"
          active={tagFilter === filterNone}
          activeColor={primary}
          ink={ink}
          line={line}
          chipBg={chipBg}
          onPress={() => onTagFilter(filterNone)}
        />
        {usedTags.map(tag => (
          <TagChip
            key={tag.id}
            label={tag.name}
            dot={tag.color}
            active={tagFilter === tag.id}
            activeColor={tag.color}
            ink={ink}
            line={line}
            chipBg={chipBg}
            onPress={() => onTagFilter(tag.id)}
          />
        ))}
        <MotionPressable
          onPress={onManageTags}
          style={[styles.chip, { borderColor: line, backgroundColor: chipBg }]}>
          <MaterialIcons name="local-offer" size={14} color={primary} />
          <Text style={[styles.chipText, { color: primary }]}>管理标签</Text>
        </MotionPressable>
      </View>
    </View>
  );
}

function DrawerFace({
  search,
  onSearchChange,
  tagFilter,
  filterAll,
  filterNone,
  usedTags,
  onSort,
  paper,
  searchBg,
  ink,
  muted,
  line,
  primary,
  chipBg,
}: Props) {
  const [searchFocused, setSearchFocused] = useState(false);
  const tagLabel = useMemo(() => {
    if (tagFilter === filterAll) return '';
    if (tagFilter === filterNone) return '无标签';
    return usedTags.find(tag => tag.id === tagFilter)?.name ?? '';
  }, [filterAll, filterNone, tagFilter, usedTags]);

  return (
    <View style={[styles.face, { backgroundColor: paper }]}>
      <View style={styles.faceRow}>
        <View
          style={[
            styles.searchWrap,
            { backgroundColor: searchBg, borderColor: searchFocused ? primary : line },
          ]}>
          <MaterialIcons name="search" size={18} color={muted} />
          <TextInput
            value={search}
            onChangeText={onSearchChange}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="搜索标题或正文"
            placeholderTextColor={muted}
            style={[styles.searchInput, { color: ink }]}
            returnKeyType="search"
          />
          {search ? (
            <MotionPressable onPress={() => onSearchChange('')} hitSlop={8} accessibilityLabel="清除搜索">
              <MaterialIcons name="close" size={18} color={muted} />
            </MotionPressable>
          ) : null}
        </View>
        <MotionPressable
          onPress={onSort}
          accessibilityLabel="排序"
          hitSlop={6}
          style={[styles.sortBtn, { borderColor: line, backgroundColor: chipBg }]}>
          <MaterialIcons name="sort" size={18} color={primary} />
        </MotionPressable>
      </View>
      {tagLabel ? (
        <Text numberOfLines={1} style={[styles.tagHint, { color: primary }]}>
          {tagLabel}
        </Text>
      ) : null}
    </View>
  );
}

function TagChip({
  label,
  dot,
  active,
  activeColor,
  ink,
  line,
  chipBg,
  onPress,
}: {
  label: string;
  dot?: string;
  active: boolean;
  activeColor: string;
  ink: string;
  line: string;
  chipBg: string;
  onPress: () => void;
}) {
  return (
    <MotionPressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? activeColor : line,
          backgroundColor: active ? `${activeColor}22` : chipBg,
        },
      ]}>
      {dot ? <View style={[styles.chipDot, { backgroundColor: dot }]} /> : null}
      <Text style={[styles.chipText, { color: active ? activeColor : ink }]} numberOfLines={1}>
        {label}
      </Text>
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  shell: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  face: {
    paddingTop: Spacing.md,
    paddingBottom: 4,
  },
  faceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: Spacing['5xl'],
    paddingRight: Spacing.md,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: MemoRadius.field,
    paddingHorizontal: 12,
    minHeight: 42,
  },
  searchInput: { flex: 1, ...MemoText.preview, paddingVertical: 8 },
  sortBtn: {
    width: Layout.minTouchTarget,
    height: Layout.minTouchTarget,
    borderRadius: MemoRadius.field,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagHint: {
    ...MemoText.kicker,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: Spacing['5xl'],
  },
  clip: { overflow: 'hidden' },
  interiorMeasure: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  interior: {
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing['5xl'],
  },
  kicker: { ...MemoText.kicker, marginBottom: 8 },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: Spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 180,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: MemoText.chip,
  handleRow: { alignItems: 'center', paddingBottom: 8 },
  handle: { width: 42, height: 4, borderRadius: 2 },
  refreshSlot: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  refreshingRow: { alignItems: 'center', paddingVertical: 6 },
});
