/**
 * 复盘 P1：单栏改写 / 写前提纲 Modal 内容。
 */
import { useFoldTheme } from '@/constants/review-fold-theme';
import type {
  ReviewOutlineItem,
  ReviewOutlineResult,
  ReviewRewriteDimensionMode,
  ReviewRewriteDimensionResult,
} from '@/lib/ai-api-client';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const REWRITE_MODES: { id: ReviewRewriteDimensionMode; label: string }[] = [
  { id: 'tighten', label: '精炼' },
  { id: 'clarify', label: '理清' },
  { id: 'gentle', label: '温和' },
];

export function ReviewRewriteSheet({
  visible,
  loading,
  error,
  mode,
  draft,
  onClose,
  onPickMode,
  onGenerate,
  onAccept,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  mode: ReviewRewriteDimensionMode;
  draft: ReviewRewriteDimensionResult | null;
  onClose: () => void;
  onPickMode: (m: ReviewRewriteDimensionMode) => void;
  onGenerate: () => void;
  onAccept: (d: ReviewRewriteDimensionResult) => void;
}) {
  const { fold } = useFoldTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: fold.card,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
            AI 改写
          </Text>
          <Text style={[styles.sub, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
            改写只进编辑缓冲，需再点保存同步。不新增事实。
          </Text>
          <View style={styles.chipRow}>
            {REWRITE_MODES.map(opt => {
              const on = mode === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => onPickMode(opt.id)}
                  style={[
                    styles.chip,
                    {
                      borderColor: on ? fold.pine : fold.line,
                      backgroundColor: on ? fold.sage2 : 'transparent',
                    },
                  ]}>
                  <Text style={{ color: on ? fold.pine : fold.ink2, fontSize: 13, fontWeight: '600' }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={onGenerate}
            disabled={loading}
            style={[
              styles.primaryBtn,
              { backgroundColor: fold.pineButton, opacity: loading ? 0.7 : 1 },
            ]}>
            {loading ? (
              <ActivityIndicator color={fold.onPineButton} />
            ) : (
              <Text style={[styles.primaryBtnText, { color: fold.onPineButton }]}>
                {draft ? '重新生成' : '生成改写'}
              </Text>
            )}
          </Pressable>
          {error ? (
            <Text style={[styles.body, { color: fold.amber }]} maxFontSizeMultiplier={1.3}>
              {error}
            </Text>
          ) : null}
          {draft ? (
            <ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}>
              {draft.change_summary ? (
                <Text style={[styles.hint, { color: fold.muted }]}>{draft.change_summary}</Text>
              ) : null}
              <Text style={[styles.body, { color: fold.inkSoft }]}>{draft.text}</Text>
              <Pressable
                onPress={() => onAccept(draft)}
                style={[styles.primaryBtn, { backgroundColor: fold.sage, marginTop: 12 }]}>
                <Text style={[styles.primaryBtnText, { color: fold.pine }]}>应用到编辑器</Text>
              </Pressable>
            </ScrollView>
          ) : null}
          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { borderColor: fold.line }]}
            accessibilityRole="button"
            accessibilityLabel="关闭">
            <Text style={{ color: fold.ink2, fontWeight: '600' }}>关闭</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ReviewOutlineSheet({
  visible,
  loading,
  error,
  data,
  onClose,
  onRetry,
  onOpenDimension,
  onFillEmpty,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  data: ReviewOutlineResult | null;
  onClose: () => void;
  onRetry: () => void;
  onOpenDimension: (item: ReviewOutlineItem) => void;
  onFillEmpty?: () => void;
}) {
  const { fold } = useFoldTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: fold.card,
              paddingBottom: Math.max(insets.bottom, 16),
              maxHeight: '82%',
            },
          ]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
            写前提纲
          </Text>
          <Text style={[styles.sub, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
            点某维带问句进入编辑；不会自动覆盖已写内容。
          </Text>

          {loading ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator color={fold.pine} />
              <Text style={[styles.hint, { color: fold.muted }]}>正在生成提纲…</Text>
            </View>
          ) : error || !data ? (
            <>
              <Text style={[styles.body, { color: fold.amber }]}>{error || '暂无提纲'}</Text>
              <Pressable
                onPress={onRetry}
                style={[styles.primaryBtn, { backgroundColor: fold.pineButton }]}>
                <Text style={[styles.primaryBtnText, { color: fold.onPineButton }]}>重试</Text>
              </Pressable>
            </>
          ) : (
            <ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}>
              {data.headline ? (
                <Text style={[styles.headline, { color: fold.pine }]} maxFontSizeMultiplier={1.3}>
                  {data.headline}
                </Text>
              ) : null}
              {data.outline.map((item, index) => (
                <Pressable
                  key={`${item.dimension_title}-${index}`}
                  onPress={() => onOpenDimension(item)}
                  style={({ pressed }) => [
                    styles.outlineRow,
                    {
                      borderColor: fold.line,
                      backgroundColor: pressed ? fold.paper2 : fold.paper,
                    },
                  ]}>
                  <View style={styles.outlineHead}>
                    <Text style={[styles.outlineTitle, { color: fold.ink }]} numberOfLines={1}>
                      {item.dimension_title}
                    </Text>
                    <MaterialIcons name="chevron-right" size={18} color={fold.faint} />
                  </View>
                  {item.prompts.map((p, i) => (
                    <Text
                      key={`${p}-${i}`}
                      style={[styles.outlinePrompt, { color: fold.muted }]}
                      maxFontSizeMultiplier={1.3}>
                      · {p}
                    </Text>
                  ))}
                </Pressable>
              ))}
              {onFillEmpty ? (
                <Pressable
                  onPress={onFillEmpty}
                  style={[styles.primaryBtn, { backgroundColor: fold.sage2, marginTop: 8 }]}>
                  <Text style={[styles.primaryBtnText, { color: fold.pine }]}>一键写入空栏问句</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          )}

          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { borderColor: fold.line }]}
            accessibilityRole="button"
            accessibilityLabel="关闭">
            <Text style={{ color: fold.ink2, fontWeight: '600' }}>关闭</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 24, 18, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sub: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  primaryBtn: {
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 6,
  },
  headline: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 8,
  },
  previewScroll: {
    maxHeight: 320,
  },
  centerBlock: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  outlineRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  outlineHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  outlineTitle: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  outlinePrompt: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  closeBtn: {
    marginTop: 4,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
