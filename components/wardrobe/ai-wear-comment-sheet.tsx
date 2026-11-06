/**
 * 穿着短评：记穿着前可选 AI 一两句备注 → wear_logs.note。
 */
import { useWardrobeTheme, wardrobeFonts, type WardrobePalette } from '@/constants/wardrobe-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { generateWardrobeWearComment } from '@/lib/zhipu-image-parse';
import React, { useEffect, useMemo, useState } from 'react';
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

export type AiWearCommentTarget =
  | { kind: 'item'; id: string; name: string; occasion?: string }
  | { kind: 'outfit'; id: string; name: string; occasion?: string };

export type AiWearCommentSheetProps = {
  visible: boolean;
  target: AiWearCommentTarget | null;
  onClose: () => void;
  /** 返回 false / 抛错时不关闭 Sheet */
  onConfirm: (payload: { note?: string }) => boolean | void | Promise<boolean | void>;
};

export function AiWearCommentSheet({
  visible,
  target,
  onClose,
  onConfirm,
}: AiWearCommentSheetProps) {
  const insets = useSafeAreaInsets();
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);

  const [userNote, setUserNote] = useState('');
  const [weather, setWeather] = useState('');
  const [comment, setComment] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setUserNote('');
      setWeather('');
      setComment('');
      setAiLoading(false);
      setSaving(false);
    }
  }, [visible]);

  const title = target?.kind === 'outfit' ? '穿这套' : '穿这件';
  const subtitle = target?.name?.trim() || '';

  const runAi = async () => {
    if (!target?.name?.trim()) {
      toast.info('缺少名称');
      return;
    }
    setAiLoading(true);
    try {
      const r = await generateWardrobeWearComment({
        subjectName: target.name,
        subjectKind: target.kind,
        occasion: target.occasion,
        weatherHint: weather.trim() || undefined,
        userNote: userNote.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.error || '生成失败');
        return;
      }
      setComment(r.comment);
    } catch (e) {
      toast.error(toUserMessage(e, '生成失败'));
    } finally {
      setAiLoading(false);
    }
  };

  const submit = async (withNote: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const note = withNote ? (comment.trim() || userNote.trim() || undefined) : undefined;
      const ok = await onConfirm({ note });
      if (ok === false) return;
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '记录失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
          <Text style={styles.hint}>可选：写一句随手记，或让 AI 润成穿着备注</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>天气一句（可选）</Text>
            <TextInput
              style={styles.input}
              value={weather}
              onChangeText={setWeather}
              placeholder="如：阴凉有风"
              placeholderTextColor={w.muted}
              maxLength={40}
            />
            <Text style={styles.label}>随手记（可选）</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={userNote}
              onChangeText={setUserNote}
              placeholder="今天挺舒服 / 袖子略长…"
              placeholderTextColor={w.muted}
              multiline
              maxLength={200}
            />
            <Pressable
              style={[styles.aiBtn, (aiLoading || saving) && styles.btnDisabled]}
              onPress={() => void runAi()}
              disabled={aiLoading || saving}>
              {aiLoading ? (
                <ActivityIndicator color={w.pine} />
              ) : (
                <Text style={styles.aiBtnText}>AI 生成短评</Text>
              )}
            </Pressable>
            {comment ? (
              <View style={styles.commentBox}>
                <Text style={styles.label}>备注预览</Text>
                <TextInput
                  style={[styles.input, styles.inputMulti]}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  maxLength={200}
                />
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              style={[styles.ghostBtn, saving && styles.btnDisabled]}
              onPress={() => void submit(false)}
              disabled={saving}>
              <Text style={styles.ghostText}>直接记录</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, saving && styles.btnDisabled]}
              onPress={() => void submit(true)}
              disabled={saving}>
              {saving ? (
                <ActivityIndicator color={w.onPine} />
              ) : (
                <Text style={styles.primaryText}>
                  {comment.trim() || userNote.trim() ? '带备注记录' : '确认记录'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(w: WardrobePalette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(20,28,26,0.42)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: w.paper,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 18,
      paddingTop: 10,
      maxHeight: '88%',
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: w.line2,
      marginBottom: 10,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    title: { fontFamily: wardrobeFonts.serif, fontSize: 22, color: w.ink },
    close: { fontFamily: wardrobeFonts.sans, fontSize: 14, color: w.muted },
    sub: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 15,
      color: w.ink,
      marginBottom: 4,
    },
    hint: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 13,
      color: w.muted,
      marginBottom: 12,
    },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12, gap: 8 },
    label: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 13,
      color: w.ink2,
      marginTop: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: w.line,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
      backgroundColor: w.card,
    },
    inputMulti: { minHeight: 72, textAlignVertical: 'top' },
    aiBtn: {
      marginTop: 6,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.paper2,
    },
    aiBtnText: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 14,
      color: w.pine,
    },
    commentBox: { gap: 6, marginTop: 4 },
    actions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 8,
    },
    ghostBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.paper2,
    },
    ghostText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink2,
    },
    primaryBtn: {
      flex: 1.2,
      alignItems: 'center',
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: w.pine,
    },
    primaryText: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 14,
      color: w.onPine,
    },
    btnDisabled: { opacity: 0.55 },
  });
}
