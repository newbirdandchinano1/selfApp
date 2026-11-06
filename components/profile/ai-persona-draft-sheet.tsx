/**
 * 编辑资料「AI 写画像 / 润色」：预填画像输入框，确认后由用户自行保存。
 */
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import type { ProfilePersonaDraftJson, ProfilePersonaDraftMode } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { draftProfilePersona } from '@/lib/zhipu-image-parse';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MODES: { key: ProfilePersonaDraftMode; label: string }[] = [
  { key: 'write', label: '写新画像' },
  { key: 'polish', label: '润色' },
  { key: 'shorten', label: '缩短' },
];

export type AiPersonaDraftSheetProps = {
  visible: boolean;
  onClose: () => void;
  currentPersona: string;
  gender?: string;
  lifestyle?: string;
  goal?: string;
  dietarySummary?: string;
  /** 将草稿写入画像输入框（不自动保存） */
  onApply: (portrait: string, keywordHints: string[]) => void;
};

export function AiPersonaDraftSheet({
  visible,
  onClose,
  currentPersona,
  gender,
  lifestyle,
  goal,
  dietarySummary,
  onApply,
}: AiPersonaDraftSheetProps) {
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const styles = useMemo(() => createStyles(fold.pine), [fold.pine]);

  const [mode, setMode] = useState<ProfilePersonaDraftMode>('write');
  const [seed, setSeed] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProfilePersonaDraftJson | null>(null);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setLoading(false);
      setSeed('');
      setMode(currentPersona.trim() ? 'polish' : 'write');
    }
  }, [visible, currentPersona]);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const r = await draftProfilePersona({
        text: seed.trim() || undefined,
        currentPersona: currentPersona.trim() || undefined,
        mode,
        gender,
        lifestyle,
        goal,
        dietarySummary,
      });
      if (!r.ok) {
        toast.error(r.error || '画像生成失败');
        return;
      }
      setData(r.data);
    } catch (e) {
      toast.error(toUserMessage(e, '画像生成失败'));
    } finally {
      setLoading(false);
    }
  }, [currentPersona, dietarySummary, gender, goal, lifestyle, mode, seed]);

  const handleApply = () => {
    if (!data?.persona_portrait.trim()) return;
    onApply(data.persona_portrait, data.keyword_hints ?? []);
    toast.success('已填入画像，记得保存');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[styles.title, { fontFamily: foldFonts.serif }]}>AI 写画像</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>预填输入框 · 确认后仍需点保存</Text>

          <View style={styles.modeRow}>
            {MODES.map(m => {
              const on = mode === m.key;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => setMode(m.key)}
                  style={[styles.modeChip, on && styles.modeChipOn]}>
                  <Text style={[styles.modeText, on && styles.modeTextOn]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={seed}
            onChangeText={setSeed}
            placeholder={
              mode === 'write'
                ? '一句话线索：久坐加班、想稳定作息…'
                : '可选补充想强调的点'
            }
            placeholderTextColor="#A8B0A6"
            multiline
            style={styles.input}
          />

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={fold.pine} />
                <Text style={styles.loadingText}>正在生成…</Text>
              </View>
            ) : null}
            {!loading && data ? (
              <View style={styles.card}>
                <Text style={styles.cardBody}>{data.persona_portrait}</Text>
                {data.keyword_hints?.length ? (
                  <Text style={styles.hints}>关键词 · {data.keyword_hints.join(' / ')}</Text>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.ghostBtn} disabled={loading} onPress={() => void run()}>
              <Text style={styles.ghostText}>{data ? '重新生成' : '生成'}</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (loading || !data) && styles.btnDisabled]}
              disabled={loading || !data}
              onPress={handleApply}>
              <Text style={styles.primaryText}>填入画像</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(20,28,22,0.38)',
    },
    sheet: {
      maxHeight: '88%',
      backgroundColor: '#FFFCF5',
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: '#D8CDBB',
      marginBottom: 10,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    title: { fontSize: 20, fontWeight: '800', color: '#2F3B32' },
    close: { fontSize: 14, color: '#7C897E', fontWeight: '600' },
    sub: { fontSize: 12, color: '#8A968C', marginBottom: 10 },
    modeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    modeChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#D8CDBB',
      backgroundColor: '#FFF',
    },
    modeChipOn: { borderColor: accent, backgroundColor: '#EAF3EC' },
    modeText: { fontSize: 12, fontWeight: '700', color: '#6F856B' },
    modeTextOn: { color: accent },
    input: {
      minHeight: 64,
      maxHeight: 100,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: '#2F3B32',
      textAlignVertical: 'top',
      marginBottom: 10,
    },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12, gap: 10 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    card: {
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
      gap: 8,
    },
    cardBody: { fontSize: 14, color: '#2F3B32', lineHeight: 22 },
    hints: { fontSize: 12, color: '#6F856B' },
    footer: { flexDirection: 'row', gap: 10, paddingTop: 8 },
    ghostBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#C9D0C6',
      alignItems: 'center',
    },
    ghostText: { fontSize: 14, fontWeight: '700', color: '#536155' },
    primaryBtn: {
      flex: 1.2,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: accent,
      alignItems: 'center',
    },
    primaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    btnDisabled: { opacity: 0.55 },
  });
}
