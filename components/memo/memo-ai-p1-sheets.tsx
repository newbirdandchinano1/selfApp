/**
 * 备忘 P1 AI Sheet：图转草稿预览 / 改写预览 / 去重 / 本周洞察。
 */
import { useMemoCenterSheetClose } from '@/components/memo/memo-center-sheet';
import { AppButton, MotionPressable } from '@/components/ui';
import { MemoText } from '@/constants/memo-ui';
import type {
  MemoCollectionInsightsJson,
  MemoDedupeHintsJson,
  MemoDraftFromImageJson,
  MemoRewriteJson,
  MemoRewriteMode,
} from '@/lib/ai-types';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type CommonColors = { ink: string; muted: string; secondary: string; primary: string };

function SheetHead({ title, ink, muted }: { title: string; ink: string; muted: string }) {
  const requestClose = useMemoCenterSheetClose();
  return (
    <View style={styles.head}>
      <Text style={[styles.title, { color: ink }]} numberOfLines={2}>
        {title}
      </Text>
      <MotionPressable onPress={() => requestClose()} hitSlop={10} accessibilityLabel="关闭">
        <MaterialIcons name="close" size={22} color={muted} />
      </MotionPressable>
    </View>
  );
}

export function MemoAiDraftFromImageBody({
  colors,
  loading,
  error,
  draft,
  onRetry,
  onUseDraft,
}: {
  colors: CommonColors;
  loading: boolean;
  error: string | null;
  draft: MemoDraftFromImageJson | null;
  onRetry: () => void;
  onUseDraft: (d: MemoDraftFromImageJson) => void;
}) {
  const { ink, muted, secondary, primary } = colors;
  if (loading) {
    return (
      <View style={styles.centerBlock}>
        <ActivityIndicator color={primary} />
        <Text style={[styles.hint, { color: muted }]}>正在识别图片…</Text>
      </View>
    );
  }
  if (error || !draft) {
    return (
      <>
        <SheetHead title="拍照建备忘" ink={ink} muted={muted} />
        <Text style={[styles.body, { color: secondary }]}>{error || '未能识别'}</Text>
        <AppButton label="重试" onPress={onRetry} style={styles.btn} />
      </>
    );
  }
  return (
    <ScrollView style={styles.scroll}>
      <SheetHead title="图片备忘草稿" ink={ink} muted={muted} />
      <Text style={[styles.hint, { color: muted }]}>
        置信度 {(draft.confidence * 100).toFixed(0)}% · 确认后进入编辑器，保存才落库
      </Text>
      <Text style={[styles.kicker, { color: muted }]}>标题</Text>
      <Text style={[styles.body, { color: ink }]}>{draft.title}</Text>
      <Text style={[styles.kicker, { color: muted }]}>正文</Text>
      <Text style={[styles.body, { color: secondary }]}>{draft.body_plain || '（空）'}</Text>
      <AppButton label="填入编辑器" onPress={() => onUseDraft(draft)} style={styles.btn} />
    </ScrollView>
  );
}

export function MemoAiRewriteBody({
  colors,
  loading,
  error,
  mode,
  draft,
  onPickMode,
  onGenerate,
  onAccept,
}: {
  colors: CommonColors;
  loading: boolean;
  error: string | null;
  mode: MemoRewriteMode;
  draft: MemoRewriteJson | null;
  onPickMode: (m: MemoRewriteMode) => void;
  onGenerate: () => void;
  onAccept: (d: MemoRewriteJson) => void;
}) {
  const { ink, muted, secondary, primary } = colors;
  const modes: { id: MemoRewriteMode; label: string }[] = [
    { id: 'polish', label: '精炼' },
    { id: 'shorten', label: '缩短' },
    { id: 'checklist', label: '清单' },
    { id: 'fill_gaps', label: '补齐 5W' },
  ];
  return (
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
      <SheetHead title="AI 改写" ink={ink} muted={muted} />
      <Text style={[styles.hint, { color: muted }]}>改写只进编辑缓冲，需再点保存同步。</Text>
      <View style={styles.chipRow}>
        {modes.map(opt => {
          const on = mode === opt.id;
          return (
            <MotionPressable
              key={opt.id}
              onPress={() => onPickMode(opt.id)}
              style={[
                styles.chip,
                { borderColor: on ? primary : muted, backgroundColor: on ? `${primary}22` : 'transparent' },
              ]}>
              <Text style={{ color: on ? primary : ink, fontSize: 13, fontWeight: '600' }}>{opt.label}</Text>
            </MotionPressable>
          );
        })}
      </View>
      <AppButton
        label={loading ? '生成中…' : draft ? '重新生成' : '生成改写'}
        loading={loading}
        disabled={loading}
        onPress={onGenerate}
        style={styles.btn}
      />
      {error ? <Text style={[styles.body, { color: secondary }]}>{error}</Text> : null}
      {draft ? (
        <>
          {draft.change_summary ? (
            <Text style={[styles.hint, { color: muted }]}>{draft.change_summary}</Text>
          ) : null}
          {draft.title ? (
            <>
              <Text style={[styles.kicker, { color: muted }]}>标题</Text>
              <Text style={[styles.body, { color: ink }]}>{draft.title}</Text>
            </>
          ) : null}
          <Text style={[styles.kicker, { color: muted }]}>正文</Text>
          <Text style={[styles.body, { color: secondary }]}>{draft.body_plain}</Text>
          <AppButton label="应用到编辑器" onPress={() => onAccept(draft)} style={styles.btn} />
        </>
      ) : null}
    </ScrollView>
  );
}

export function MemoAiDedupeBody({
  colors,
  loading,
  error,
  data,
  titleById,
  onRetry,
  onOpenMemo,
}: {
  colors: CommonColors;
  loading: boolean;
  error: string | null;
  data: MemoDedupeHintsJson | null;
  titleById: Map<string, string>;
  onRetry: () => void;
  onOpenMemo: (id: string) => void;
}) {
  const { ink, muted, secondary, primary } = colors;
  const requestClose = useMemoCenterSheetClose();
  if (loading) {
    return (
      <View style={styles.centerBlock}>
        <ActivityIndicator color={primary} />
        <Text style={[styles.hint, { color: muted }]}>正在检测相似备忘…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <>
        <SheetHead title="相似备忘" ink={ink} muted={muted} />
        <Text style={[styles.body, { color: secondary }]}>{error}</Text>
        <AppButton label="重试" onPress={onRetry} style={styles.btn} />
      </>
    );
  }
  const similar = data?.similar ?? [];
  return (
    <ScrollView style={styles.scroll}>
      <SheetHead title="相似备忘" ink={ink} muted={muted} />
      {similar.length === 0 ? (
        <Text style={[styles.body, { color: secondary }]}>未发现明显重复，可放心保留。</Text>
      ) : (
        similar.map(s => (
          <MotionPressable
            key={s.memo_id}
            onPress={() => {
              if (!requestClose()) return;
              onOpenMemo(s.memo_id);
            }}
            style={styles.row}>
            <Text style={[styles.body, { color: ink }]}>
              {titleById.get(s.memo_id) || s.memo_id}
              {s.score > 0 ? ` · ${(s.score * 100).toFixed(0)}%` : ''}
            </Text>
            {s.reason ? <Text style={[styles.hint, { color: muted }]}>{s.reason}</Text> : null}
          </MotionPressable>
        ))
      )}
    </ScrollView>
  );
}

export function MemoAiInsightsBody({
  colors,
  loading,
  error,
  data,
  titleById,
  onRetry,
  onOpenMemo,
}: {
  colors: CommonColors;
  loading: boolean;
  error: string | null;
  data: MemoCollectionInsightsJson | null;
  titleById: Map<string, string>;
  onRetry: () => void;
  onOpenMemo: (id: string) => void;
}) {
  const { ink, muted, secondary, primary } = colors;
  const requestClose = useMemoCenterSheetClose();
  if (loading) {
    return (
      <View style={styles.centerBlock}>
        <ActivityIndicator color={primary} />
        <Text style={[styles.hint, { color: muted }]}>正在生成本周小结…</Text>
      </View>
    );
  }
  if (error || !data) {
    return (
      <>
        <SheetHead title="本周备忘小结" ink={ink} muted={muted} />
        <Text style={[styles.body, { color: secondary }]}>{error || '暂无洞察'}</Text>
        <AppButton label="重试" onPress={onRetry} style={styles.btn} />
      </>
    );
  }
  return (
    <ScrollView style={styles.scroll}>
      <SheetHead title="本周备忘小结" ink={ink} muted={muted} />
      {data.themes.length > 0 ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>主题</Text>
          <Text style={[styles.body, { color: ink }]}>{data.themes.join(' · ')}</Text>
        </>
      ) : null}
      {data.open_loops.length > 0 ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>未闭环</Text>
          {data.open_loops.map((t, i) => (
            <Text key={`${t}-${i}`} style={[styles.body, { color: secondary }]}>
              · {t}
            </Text>
          ))}
        </>
      ) : null}
      {data.tips.length > 0 ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>建议</Text>
          {data.tips.map((t, i) => (
            <Text key={`${t}-${i}`} style={[styles.body, { color: secondary }]}>
              · {t}
            </Text>
          ))}
        </>
      ) : null}
      {data.memo_ids.length > 0 ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>可转待办</Text>
          {data.memo_ids.map(id => (
            <MotionPressable
              key={id}
              onPress={() => {
                if (!requestClose()) return;
                onOpenMemo(id);
              }}
              style={styles.row}>
              <Text style={[styles.body, { color: primary }]}>{titleById.get(id) || id}</Text>
            </MotionPressable>
          ))}
        </>
      ) : null}
      {!data.themes.length && !data.open_loops.length && !data.tips.length ? (
        <Text style={[styles.body, { color: secondary }]}>本周备忘较少，暂无明显主题。</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  title: { flex: 1, ...MemoText.listTitle },
  kicker: { ...MemoText.kicker, marginTop: 12 },
  body: { ...MemoText.aiBody, marginTop: 4 },
  hint: { ...MemoText.caption, marginTop: 6, marginBottom: 4 },
  btn: { marginTop: 16 },
  centerBlock: { alignItems: 'center', paddingVertical: 28, gap: 12 },
  scroll: { maxHeight: 420 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  row: { marginTop: 10, paddingVertical: 4 },
});
