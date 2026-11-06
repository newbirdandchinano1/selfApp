/**
 * 备忘 P0 AI 预览 Sheet：转草稿 / 建议标签 / 一句话起草。
 * 确认后由页面调用现有落库函数；Agent 不写库。
 */
import { AppButton, MotionPressable } from '@/components/ui';
import { MemoText } from '@/constants/memo-ui';
import { useMemoCenterSheetClose } from '@/components/memo/memo-center-sheet';
import type {
  MemoConvertDraftJson,
  MemoConvertTodoDraft,
  MemoDraftFromTextJson,
  MemoDraftStyle,
  MemoSuggestTagsJson,
} from '@/lib/ai-types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type CommonColors = { ink: string; muted: string; secondary: string; primary: string };

function SheetHead({
  title,
  ink,
  muted,
}: {
  title: string;
  ink: string;
  muted: string;
}) {
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

export function MemoAiConvertDraftBody({
  colors,
  loading,
  error,
  draft,
  onRetry,
  onConfirmTodo,
  onConfirmProject,
  onConfirmSplit,
}: {
  colors: CommonColors;
  loading: boolean;
  error: string | null;
  draft: MemoConvertDraftJson | null;
  onRetry: () => void;
  onConfirmTodo: (todo: MemoConvertTodoDraft) => void;
  onConfirmProject: (project: { name: string; note: string }) => void;
  onConfirmSplit: (todos: MemoConvertTodoDraft[]) => void;
}) {
  const { ink, muted, secondary, primary } = colors;
  const [todoTitle, setTodoTitle] = useState('');
  const [todoNote, setTodoNote] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectNote, setProjectNote] = useState('');

  useEffect(() => {
    if (!draft) return;
    if (draft.todo) {
      setTodoTitle(draft.todo.title);
      setTodoNote(draft.todo.note ?? '');
    }
    if (draft.project) {
      setProjectName(draft.project.name);
      setProjectNote(draft.project.note ?? '');
    }
  }, [draft]);

  if (loading) {
    return (
      <View style={styles.centerBlock}>
        <ActivityIndicator color={primary} />
        <Text style={[styles.hint, { color: muted }]}>正在生成转换草稿…</Text>
      </View>
    );
  }

  if (error || !draft) {
    return (
      <>
        <SheetHead title="智能拆分" ink={ink} muted={muted} />
        <Text style={[styles.body, { color: secondary }]}>{error || '未生成草稿'}</Text>
        <AppButton label="重试" onPress={onRetry} style={styles.btn} />
      </>
    );
  }

  return (
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
      <SheetHead title="智能拆分预览" ink={ink} muted={muted} />
      {draft.rationale ? (
        <Text style={[styles.hint, { color: muted }]}>{draft.rationale}</Text>
      ) : null}

      {draft.mode === 'todo' && draft.todo ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>待办标题</Text>
          <TextInput
            value={todoTitle}
            onChangeText={setTodoTitle}
            style={[styles.input, { color: ink, borderColor: muted }]}
            maxLength={50}
          />
          <Text style={[styles.kicker, { color: muted }]}>备注</Text>
          <TextInput
            value={todoNote}
            onChangeText={setTodoNote}
            style={[styles.inputMulti, { color: ink, borderColor: muted }]}
            multiline
          />
          {draft.todo.due_hint ? (
            <Text style={[styles.hint, { color: muted }]}>时限提示：{draft.todo.due_hint}</Text>
          ) : null}
          <AppButton
            label="确认为待办并删除备忘"
            onPress={() =>
              onConfirmTodo({
                title: todoTitle,
                note: todoNote,
                priority: draft.todo?.priority ?? 0,
                ...(draft.todo?.due_hint ? { due_hint: draft.todo.due_hint } : {}),
              })
            }
            style={styles.btn}
          />
        </>
      ) : null}

      {draft.mode === 'project' && draft.project ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>项目名称</Text>
          <TextInput
            value={projectName}
            onChangeText={setProjectName}
            style={[styles.input, { color: ink, borderColor: muted }]}
            maxLength={80}
          />
          <Text style={[styles.kicker, { color: muted }]}>备注</Text>
          <TextInput
            value={projectNote}
            onChangeText={setProjectNote}
            style={[styles.inputMulti, { color: ink, borderColor: muted }]}
            multiline
          />
          <AppButton
            label="确认为项目并删除备忘"
            onPress={() => onConfirmProject({ name: projectName, note: projectNote })}
            style={styles.btn}
          />
        </>
      ) : null}

      {draft.mode === 'split_todos' && draft.split_todos?.length ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>将拆成 {draft.split_todos.length} 条待办</Text>
          {draft.split_todos.map((t, i) => (
            <View key={`${t.title}-${i}`} style={styles.splitRow}>
              <Text style={[styles.body, { color: ink }]}>{i + 1}. {t.title}</Text>
              {t.note ? (
                <Text style={[styles.hint, { color: muted }]} numberOfLines={3}>
                  {t.note}
                </Text>
              ) : null}
            </View>
          ))}
          <AppButton
            label="确认拆分并删除备忘"
            onPress={() => onConfirmSplit(draft.split_todos!)}
            style={styles.btn}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

export function MemoAiSuggestTagsBody({
  colors,
  loading,
  error,
  catalog,
  suggestion,
  selectedIds,
  selectedNewNames,
  onToggleId,
  onToggleNewName,
  onRetry,
  onConfirm,
}: {
  colors: CommonColors;
  loading: boolean;
  error: string | null;
  catalog: { id: string; name: string }[];
  suggestion: MemoSuggestTagsJson | null;
  selectedIds: string[];
  selectedNewNames: string[];
  onToggleId: (id: string) => void;
  onToggleNewName: (name: string) => void;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const { ink, muted, secondary, primary } = colors;
  const byId = useMemo(() => new Map(catalog.map(t => [t.id, t.name])), [catalog]);

  if (loading) {
    return (
      <View style={styles.centerBlock}>
        <ActivityIndicator color={primary} />
        <Text style={[styles.hint, { color: muted }]}>正在建议标签…</Text>
      </View>
    );
  }

  if (error || !suggestion) {
    return (
      <>
        <SheetHead title="建议标签" ink={ink} muted={muted} />
        <Text style={[styles.body, { color: secondary }]}>{error || '暂无建议'}</Text>
        <AppButton label="重试" onPress={onRetry} style={styles.btn} />
      </>
    );
  }

  const ids = suggestion.tag_ids.filter(id => byId.has(id));
  const news = suggestion.new_tag_names;

  return (
    <>
      <SheetHead title="建议标签" ink={ink} muted={muted} />
      {ids.length === 0 && news.length === 0 ? (
        <Text style={[styles.body, { color: secondary }]}>模型未给出可用标签，可稍后重试。</Text>
      ) : null}
      {ids.length > 0 ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>库内标签</Text>
          <View style={styles.chipRow}>
            {ids.map(id => {
              const on = selectedIds.includes(id);
              return (
                <MotionPressable
                  key={id}
                  onPress={() => onToggleId(id)}
                  style={[
                    styles.chip,
                    { borderColor: on ? primary : muted, backgroundColor: on ? `${primary}22` : 'transparent' },
                  ]}>
                  <Text style={{ color: on ? primary : ink, fontSize: 13, fontWeight: '600' }}>
                    {byId.get(id) ?? id}
                  </Text>
                </MotionPressable>
              );
            })}
          </View>
        </>
      ) : null}
      {news.length > 0 ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>建议新建</Text>
          <View style={styles.chipRow}>
            {news.map(name => {
              const on = selectedNewNames.includes(name);
              return (
                <MotionPressable
                  key={name}
                  onPress={() => onToggleNewName(name)}
                  style={[
                    styles.chip,
                    { borderColor: on ? primary : muted, backgroundColor: on ? `${primary}22` : 'transparent' },
                  ]}>
                  <Text style={{ color: on ? primary : ink, fontSize: 13, fontWeight: '600' }}>+ {name}</Text>
                </MotionPressable>
              );
            })}
          </View>
        </>
      ) : null}
      <AppButton
        label="确认挂上"
        onPress={onConfirm}
        disabled={selectedIds.length === 0 && selectedNewNames.length === 0}
        style={styles.btn}
      />
    </>
  );
}

export function MemoAiDraftFromTextBody({
  colors,
  loading,
  error,
  draft,
  input,
  style,
  onChangeInput,
  onChangeStyle,
  onGenerate,
  onUseDraft,
}: {
  colors: CommonColors;
  loading: boolean;
  error: string | null;
  draft: MemoDraftFromTextJson | null;
  input: string;
  style: MemoDraftStyle;
  onChangeInput: (v: string) => void;
  onChangeStyle: (s: MemoDraftStyle) => void;
  onGenerate: () => void;
  onUseDraft: (d: MemoDraftFromTextJson) => void;
}) {
  const { ink, muted, secondary, primary } = colors;
  const stylesOpts: { id: MemoDraftStyle; label: string }[] = [
    { id: 'brief', label: '简洁' },
    { id: 'checklist', label: '清单' },
    { id: 'meeting', label: '纪要' },
  ];

  return (
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
      <SheetHead title="AI 起草备忘" ink={ink} muted={muted} />
      <Text style={[styles.hint, { color: muted }]}>
        输入一句话、碎片或语音转写文本，生成可编辑草稿；保存后才落库。
      </Text>
      <TextInput
        value={input}
        onChangeText={onChangeInput}
        placeholder="例如：下周要交年报，先对齐指标（也可粘贴转写稿）"
        placeholderTextColor={muted}
        style={[styles.inputMulti, { color: ink, borderColor: muted }]}
        multiline
      />
      <View style={styles.chipRow}>
        {stylesOpts.map(opt => {
          const on = style === opt.id;
          return (
            <MotionPressable
              key={opt.id}
              onPress={() => onChangeStyle(opt.id)}
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
        label={loading ? '生成中…' : draft ? '重新生成' : '生成草稿'}
        loading={loading}
        disabled={loading || !input.trim()}
        onPress={onGenerate}
        style={styles.btn}
      />
      {error ? <Text style={[styles.body, { color: secondary }]}>{error}</Text> : null}
      {draft ? (
        <>
          <Text style={[styles.kicker, { color: muted }]}>标题</Text>
          <Text style={[styles.body, { color: ink }]}>{draft.title}</Text>
          <Text style={[styles.kicker, { color: muted }]}>正文</Text>
          <Text style={[styles.body, { color: secondary }]}>{draft.body_plain || '（空）'}</Text>
          {draft.tag_name_hints.length > 0 ? (
            <Text style={[styles.hint, { color: muted }]}>
              标签提示：{draft.tag_name_hints.join('、')}
            </Text>
          ) : null}
          <AppButton label="填入编辑器" onPress={() => onUseDraft(draft)} style={styles.btn} />
        </>
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
  input: {
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  inputMulti: {
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  splitRow: { marginTop: 8 },
});
