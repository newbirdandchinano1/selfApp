import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { MotionPressable } from '@/components/ui';
import { Layout, Motion, Spacing } from '@/constants/design-tokens';
import { MemoText, memoTagStyle } from '@/constants/memo-ui';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { memoListPreviewTitle, type MemoItem } from '@/lib/memos';
import { plainTextFromBody } from '@/lib/memo-richdoc/plain-text';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { MaterialIcons } from '@expo/vector-icons';

import {
  MEMO_INK,
  MEMO_INK_SOFT,
  MEMO_WASH,
  Thumbtack,
  shiftPaper,
} from './memo-paper';
import { hasMemoExpanded, markMemoExpanded } from './use-memo-list-motion';

const INK = MEMO_INK;
const INK_SOFT = MEMO_INK_SOFT;
/** 卷起时只露出轴的厚度，文字不缩放。 */
const ROLL_CLOSED = 18;

type Props = {
  item: MemoItem;
  tags: TagRow[];
  timeLabel: string;
  /** 大于 0 时参与本轮展开；同一 token 内每条只播一次 */
  expandToken: number;
  /** 错峰序号，只影响延迟 */
  staggerIndex: number;
  /** 新建高亮 */
  highlighted: boolean;
  /** 正在转为待办或项目 */
  converting?: boolean;
  /** 当天只有一张时占满整列 */
  wide?: boolean;
  aiPending: boolean;
  onPress: (item: MemoItem) => void;
  onLongPress: (item: MemoItem) => void;
  onAiPress: (item: MemoItem) => void;
};

function stickyPreview(item: MemoItem, wide: boolean): string {
  const text = plainTextFromBody(item.body).replace(/\n{2,}/g, '\n').trim();
  if (!text) return '（无正文）';
  const limit = wide ? 280 : 140;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * 单条备忘便利贴。
 * 只负责展示与入场/高亮动画；删除、AI 请求等业务回调由页面传入。
 */
export function MemoListRow({
  item,
  tags,
  timeLabel,
  expandToken,
  staggerIndex,
  highlighted,
  converting = false,
  wide = false,
  aiPending,
  onPress,
  onLongPress,
  onAiPress,
}: Props) {
  const pinned = Boolean(item.is_pinned);
  const paper = '#FBF8F1';
  const edge = shiftPaper(paper, -14);
  // The memo surface now follows the shared paper/card language used by the
  // other profile modules. Keep the stable paper color for detail continuity,
  // but remove the per-card rotation so text remains calm and scannable.
  const tilt = 0;
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const playExpand = expandToken > 0 && !hasMemoExpanded(expandToken, item.id);
  const [contentHeight, setContentHeight] = useState(0);
  const [unrolled, setUnrolled] = useState(() => !playExpand);
  /** 纸高只记第一次。卷开过程中的裁切高度不能再写回，否则会重新开启动画。 */
  const measuredRef = useRef(0);
  const runningTokenRef = useRef(0);

  const reveal = useRef(new Animated.Value(playExpand ? 0 : 1)).current;
  const highlight = useRef(new Animated.Value(highlighted ? 1 : 0)).current;

  const onBodyLayout = (event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.height);
    if (next < 48 || measuredRef.current > 0) return;
    measuredRef.current = next;
    setContentHeight(next);
  };

  useEffect(() => {
    if (expandToken <= 0 || hasMemoExpanded(expandToken, item.id)) {
      reveal.setValue(1);
      setUnrolled(true);
      return;
    }
    if (!motionReady) return;
    if (reduceMotion) {
      markMemoExpanded(expandToken, item.id);
      reveal.setValue(1);
      setUnrolled(true);
      return;
    }
    if (contentHeight <= 0 || runningTokenRef.current === expandToken) return;
    runningTokenRef.current = expandToken;
    reveal.setValue(0);
    setUnrolled(false);
    const anim = Animated.timing(reveal, {
      toValue: 1,
      duration: 340,
      delay: Math.min(Math.max(staggerIndex, 0), 8) * 28,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (!finished || runningTokenRef.current !== expandToken) return;
      markMemoExpanded(expandToken, item.id);
      setUnrolled(true);
    });
    // 不要在清理函数里 stop。卷开会改高度，effect 若因此重跑再 stop，就会停掉又重开，形成死循环。
  }, [contentHeight, expandToken, item.id, motionReady, reduceMotion, reveal, staggerIndex]);

  useEffect(() => {
    if (!highlighted) {
      highlight.setValue(0);
      return;
    }
    highlight.setValue(1);
    const anim = Animated.timing(highlight, {
      toValue: 0,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [highlight, highlighted]);

  const lineCount = wide ? 9 : 6;
  const rolling = !unrolled;
  const openHeight = Math.max(contentHeight, ROLL_CLOSED);
  const clipHeight = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [ROLL_CLOSED, openHeight],
  });
  /** 折边跟卷开走：开头淡入，纸快摊开时先淡掉，卸掉裁切时已经看不见。 */
  const rollOpacity = reveal.interpolate({
    inputRange: [0, 0.16, 0.62, 0.88],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  });
  const rollShift = reveal.interpolate({
    inputRange: [0, 0.16, 0.62, 0.88],
    outputRange: [5, 0, 0, 4],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.noteOuter, wide ? styles.noteOuterWide : null]}>
      <Animated.View
        style={
          rolling
            ? [styles.unrollClip, { height: contentHeight > 0 ? clipHeight : ROLL_CLOSED }]
            : undefined
        }>
      <View style={styles.unrollBody} onLayout={onBodyLayout}>
      <View style={{ transform: [{ rotate: `${tilt}deg` }] }}>
        <View pointerEvents="none" style={styles.castShadow} />
        <MotionPressable
          disabled={converting}
          onPress={() => onPress(item)}
          onLongPress={() => onLongPress(item)}
          delayLongPress={360}
          pressScale={Motion.pressScaleCard}
          pressOpacity={1}
          style={[
            styles.note,
            wide ? styles.noteWide : null,
            { backgroundColor: paper, borderBottomColor: edge },
          ]}>
          <View pointerEvents="none" style={styles.sheen} />
          <View pointerEvents="none" style={styles.rules}>
            {Array.from({ length: lineCount }).map((_, index) => (
              <View key={index} style={[styles.rule, { top: (wide ? 58 : 50) + index * (wide ? 24 : 22) }]} />
            ))}
          </View>
          <Animated.View pointerEvents="none" style={[styles.highlightWash, { opacity: highlight }]} />
          <View style={styles.noteHead}>
            <MotionPressable
              onPress={() => onAiPress(item)}
              accessibilityLabel="AI 分析"
              hitSlop={6}
              style={styles.aiBtn}>
              <MaterialIcons name="auto-awesome" size={wide ? 18 : 16} color={INK_SOFT} />
            </MotionPressable>
          </View>
          <Text style={[styles.title, wide ? styles.titleWide : null]} numberOfLines={wide ? 4 : 3}>
            {memoListPreviewTitle(item)}
          </Text>
          <Text style={[styles.body, wide ? styles.bodyWide : null]} numberOfLines={lineCount}>
            {stickyPreview(item, wide)}
          </Text>
          {tags.length > 0 ? (
            <View style={styles.tagRow}>
              {tags.slice(0, wide ? 4 : 3).map(t => {
                const tagStyle = memoTagStyle(t.color, false);
                return (
                  <View key={t.id} style={[styles.miniTag, { backgroundColor: MEMO_WASH }]}>
                    <View style={[styles.tagDot, { backgroundColor: tagStyle.color }]} />
                    <Text style={styles.miniTagText} numberOfLines={1}>
                      {t.name}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          {item.ai_evaluation ? (
            <Text style={styles.aiText} numberOfLines={wide ? 3 : 2}>
              AI · {item.ai_evaluation}
            </Text>
          ) : aiPending ? (
            <View style={styles.aiPending}>
              <ActivityIndicator color={INK} size="small" style={styles.aiSpinner} />
              <Text style={styles.aiText}>AI 分析中…</Text>
            </View>
          ) : null}
          {converting ? (
            <View style={styles.aiPending}>
              <ActivityIndicator color={INK} size="small" style={styles.aiSpinner} />
              <Text style={styles.aiText}>转换中…</Text>
            </View>
          ) : (
            <Text style={[styles.time, wide ? styles.timeWide : null]} numberOfLines={1}>
              {timeLabel}
            </Text>
          )}
        </MotionPressable>
        {pinned ? <Thumbtack large={wide} /> : null}
      </View>
      </View>
      {rolling ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.rollBar, { opacity: rollOpacity, transform: [{ translateY: rollShift }] }]}>
          <View style={styles.rollShade} />
          <View style={[styles.rollLip, { backgroundColor: edge }]} />
        </Animated.View>
      ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  noteOuter: {
    width: '100%',
    marginBottom: Spacing.md,
    paddingRight: 0,
    paddingBottom: 0,
  },
  unrollClip: {
    overflow: 'hidden',
  },
  unrollBody: {
    paddingTop: 0,
  },
  rollBar: {
    display: 'none',
    position: 'absolute',
    left: 10,
    right: 14,
    bottom: 1,
    height: 12,
    justifyContent: 'flex-end',
  },
  rollShade: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 2,
    height: 5,
    borderRadius: 4,
    backgroundColor: 'rgba(48,32,18,0.14)',
  },
  rollLip: {
    height: 3,
    borderRadius: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.5)',
  },
  noteOuterWide: {
    marginBottom: Spacing['2xl'],
  },
  castShadow: {
    position: 'absolute',
    left: 10,
    right: 6,
    top: 14,
    bottom: 0,
    borderRadius: 18,
    backgroundColor: 'rgba(31,48,39,0.08)',
    transform: [{ translateX: 0 }, { translateY: 5 }],
  },
  note: {
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(33,69,58,0.14)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    paddingHorizontal: 15,
    paddingBottom: 14,
    minHeight: 124,
    overflow: 'hidden',
    shadowColor: '#1F3027',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  noteWide: {
    minHeight: 150,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  rules: {
    display: 'none',
  },
  rule: {
    position: 'absolute',
    left: 12,
    right: 18,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
  highlightWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  noteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 6,
  },
  time: { ...MemoText.time, color: INK_SOFT, marginTop: 10, paddingRight: 8 },
  timeWide: { fontSize: 13 },
  title: { ...MemoText.listTitle, color: INK, marginBottom: 6, fontWeight: '600' },
  titleWide: { fontSize: 20, lineHeight: 26 },
  body: { ...MemoText.preview, color: INK, lineHeight: 22 },
  bodyWide: { fontSize: 16, lineHeight: 24 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  miniTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 20,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 120,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  miniTagText: { ...MemoText.tag, color: INK, fontWeight: '600', flexShrink: 1 },
  aiText: { ...MemoText.caption, color: INK_SOFT, marginTop: 8 },
  aiPending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  aiSpinner: { transform: [{ scale: 0.7 }] },
  aiBtn: {
    width: Layout.minTouchTarget,
    height: Layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});


