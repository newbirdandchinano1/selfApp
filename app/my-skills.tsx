import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getDefaultUser } from '@/lib/repositories/users/user';
import {
  countSkillsInSnapshot,
  createEmptyUserSkillsSnapshot,
  createSkillDimension,
  createSkillItem,
  loadUserSkills,
  saveUserSkills,
  type UserSkillDimension,
  type UserSkillItem,
  type UserSkillsSnapshot,
} from '@/lib/user-skills';
import {
  analyzeUserSkillsPortfolioFromText,
  getActiveAiLlmApiKey,
  type UserSkillAiPortfolioPayload,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function applyAiToSnapshot(snapshot: UserSkillsSnapshot, data: UserSkillAiPortfolioPayload): UserSkillsSnapshot {
  const map = new Map(data.per_skill.map(p => [p.skill_id.trim(), p]));
  return {
    ...snapshot,
    dimensions: snapshot.dimensions.map(d => ({
      ...d,
      skills: d.skills.map(s => {
        const row = map.get(s.id.trim());
        if (!row) return s;
        return { ...s, last_evaluation: row.evaluation, last_suggestions: row.suggestions };
      }),
    })),
    last_ai_at: new Date().toISOString(),
    last_overall_suggestions: data.overall_suggestions,
    last_profile_analysis: data.profile_analysis,
  };
}

export default function MySkillsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? theme.surface : '#ffffff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.85)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.4)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';

  const inputSurface = isDark ? 'rgba(15,23,42,0.55)' : '#f4f6ff';
  const inputBorder = outlineVariant;

  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<UserSkillsSnapshot>(createEmptyUserSkillsSnapshot());
  const [displayName, setDisplayName] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [skills, user] = await Promise.all([loadUserSkills(), getDefaultUser()]);
      setSnapshot(skills);
      setDisplayName(user?.name?.trim() || '默认用户');
    } catch {
      setSnapshot(createEmptyUserSkillsSnapshot());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persistSoon = useCallback((next: UserSkillsSnapshot) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveUserSkills(next);
    }, 450);
  }, []);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const updateDimensions = useCallback(
    (fn: (prev: UserSkillDimension[]) => UserSkillDimension[]) => {
      setSnapshot(prev => {
        const next = { ...prev, dimensions: fn(prev.dimensions) };
        persistSoon(next);
        return next;
      });
    },
    [persistSoon],
  );

  const onAddDimension = () => {
    updateDimensions(d => [...d, createSkillDimension()]);
  };

  const onRemoveDimension = (id: string) => {
    Alert.alert('删除维度', '将同时删除该维度下的全部技能与本地缓存的 AI 结果。确定？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => updateDimensions(d => d.filter(x => x.id !== id)),
      },
    ]);
  };

  const onSetDimensionTitle = (id: string, title: string) => {
    updateDimensions(d => d.map(dim => (dim.id === id ? { ...dim, title } : dim)));
  };

  const onAddSkill = (dimensionId: string) => {
    updateDimensions(d =>
      d.map(dim => (dim.id === dimensionId ? { ...dim, skills: [...dim.skills, createSkillItem()] } : dim)),
    );
  };

  const onRemoveSkill = (dimensionId: string, skillId: string) => {
    updateDimensions(d =>
      d.map(dim =>
        dim.id === dimensionId ? { ...dim, skills: dim.skills.filter(s => s.id !== skillId) } : dim,
      ),
    );
  };

  const onPatchSkill = (dimensionId: string, skillId: string, patch: Partial<UserSkillItem>) => {
    updateDimensions(d =>
      d.map(dim =>
        dim.id === dimensionId
          ? {
              ...dim,
              skills: dim.skills.map(s => (s.id === skillId ? { ...s, ...patch } : s)),
            }
          : dim,
      ),
    );
  };

  const linesForAi = useMemo(() => {
    const out: { skill_id: string; dimension: string; name: string; description: string }[] = [];
    for (const dim of snapshot.dimensions) {
      const dtitle = dim.title.trim() || '未命名维度';
      for (const s of dim.skills) {
        const name = s.name.trim();
        const desc = s.description.trim();
        if (name && desc) {
          out.push({ skill_id: s.id, dimension: dtitle, name, description: desc });
        }
      }
    }
    return out;
  }, [snapshot.dimensions]);

  const runnableCount = linesForAi.length;

  const onRunAi = async () => {
    const key = getActiveAiLlmApiKey().trim();
    if (!key) {
      Alert.alert('无法调用 AI', '请配置智谱 API 密钥（环境变量 EXPO_PUBLIC_ZHIPU_API_KEY 或应用内置渠道）。');
      return;
    }
    if (runnableCount === 0) {
      Alert.alert('暂无可评估内容', '请至少为一条技能填写「名称」和「自我描述」后再试。');
      return;
    }
    setAiBusy(true);
    try {
      const r = await analyzeUserSkillsPortfolioFromText({
        apiKey: key,
        userDisplayName: displayName,
        lines: linesForAi,
        maxAttempts: 6,
        retryDelayMs: 900,
      });
      if (!r.ok) {
        Alert.alert('生成失败', r.error || '请稍后重试');
        return;
      }
      setSnapshot(prev => {
        const next = applyAiToSnapshot(prev, r.data);
        void saveUserSkills(next);
        return next;
      });
    } catch (e) {
      Alert.alert('生成失败', e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const skillTotal = countSkillsInSnapshot(snapshot);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 8}>
        <View style={[styles.topBar, { borderBottomColor: outlineVariant, paddingTop: Math.max(insets.top, 12) }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
            <MaterialIcons name="arrow-back" size={24} color={primary} />
          </Pressable>
          <Text style={[styles.topTitle, { color: text }]}>我的技能</Text>
          <View style={{ width: 28 }} />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={primary} />
          </View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.scroll, { paddingBottom: 32 + insets.bottom }]}>
            <Text style={[styles.intro, { color: outline }]}>
              自定义「维度」（如编程、沟通、健康习惯等），在每个维度下添加技能并写下自我描述。保存后点击「请求 AI
              评估」：将逐条给出评估与建议，并在底部输出综合建议与总体能力分析（基于智谱 GLM，与记账等功能共用密钥配置）。
            </Text>

            <View style={[styles.statRow, { borderColor: outlineVariant }]}>
              <Text style={[styles.statText, { color: text }]}>
                {snapshot.dimensions.length} 个维度 · {skillTotal} 条技能 · 可评估 {runnableCount} 条
              </Text>
            </View>

            <Pressable
              onPress={onAddDimension}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: primary, opacity: pressed ? 0.88 : 1 },
              ]}>
              <MaterialIcons name="add" size={22} color="#fff" />
              <Text style={styles.primaryBtnText}>添加维度</Text>
            </Pressable>

            {snapshot.dimensions.length === 0 ? (
              <View style={[styles.emptyCard, { borderColor: outlineVariant, backgroundColor: surface }]}>
                <MaterialIcons name="category" size={40} color={outline} />
                <Text style={[styles.emptyTitle, { color: text }]}>从这里开始</Text>
                <Text style={[styles.emptyHint, { color: outline }]}>
                  先添加一个维度，再在该维度下添加具体技能与描述。
                </Text>
              </View>
            ) : null}

            {snapshot.dimensions.map(dim => (
              <View
                key={dim.id}
                style={[styles.dimCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
                <View style={styles.dimHead}>
                  <TextInput
                    value={dim.title}
                    onChangeText={t => onSetDimensionTitle(dim.id, t)}
                    placeholder="维度名称"
                    placeholderTextColor={outline}
                    style={[styles.dimTitleInput, { color: text, borderColor: outlineVariant, backgroundColor: inputSurface }]}
                  />
                  <Pressable
                    onPress={() => onRemoveDimension(dim.id)}
                    hitSlop={8}
                    style={({ pressed }) => [{ opacity: pressed ? 0.65 : 1, padding: 6 }]}>
                    <MaterialIcons name="delete-outline" size={22} color={outline} />
                  </Pressable>
                </View>

                <Pressable
                  onPress={() => onAddSkill(dim.id)}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    { borderColor: `${primary}55`, opacity: pressed ? 0.85 : 1 },
                  ]}>
                  <MaterialIcons name="post-add" size={20} color={primary} />
                  <Text style={[styles.secondaryBtnText, { color: primary }]}>在此维度下添加技能</Text>
                </Pressable>

                {dim.skills.length === 0 ? (
                  <Text style={[styles.muted, { color: outline }]}>该维度下还没有技能。</Text>
                ) : null}

                {dim.skills.map(skill => (
                  <View
                    key={skill.id}
                    style={[styles.skillBlock, { borderTopColor: outlineVariant, borderTopWidth: StyleSheet.hairlineWidth }]}>
                    <View style={styles.skillHead}>
                      <Text style={[styles.skillLabel, { color: outline }]}>技能名称</Text>
                      <Pressable onPress={() => onRemoveSkill(dim.id, skill.id)} hitSlop={8}>
                        <MaterialIcons name="close" size={20} color={outline} />
                      </Pressable>
                    </View>
                    <TextInput
                      value={skill.name}
                      onChangeText={t => onPatchSkill(dim.id, skill.id, { name: t })}
                      placeholder="例如：TypeScript / 公开演讲"
                      placeholderTextColor={outline}
                      style={[styles.input, { color: text, borderColor: inputBorder, backgroundColor: inputSurface }]}
                    />
                    <Text style={[styles.skillLabel, { color: outline, marginTop: 10 }]}>自我描述</Text>
                    <TextInput
                      value={skill.description}
                      onChangeText={t => onPatchSkill(dim.id, skill.id, { description: t })}
                      placeholder="你目前掌握到什么程度？做过哪些相关实践？希望达到什么目标？"
                      placeholderTextColor={outline}
                      multiline
                      textAlignVertical="top"
                      style={[
                        styles.input,
                        styles.textArea,
                        { color: text, borderColor: inputBorder, backgroundColor: inputSurface },
                      ]}
                    />

                    {skill.last_evaluation?.trim() || skill.last_suggestions?.trim() ? (
                      <View style={[styles.aiSkillBox, { backgroundColor: isDark ? 'rgba(15,23,42,0.4)' : '#f0f4ff' }]}>
                        {skill.last_evaluation?.trim() ? (
                          <View style={{ marginBottom: 10 }}>
                            <Text style={[styles.aiSub, { color: primary }]}>AI 评估</Text>
                            <Text style={[styles.aiBody, { color: text }]}>{skill.last_evaluation.trim()}</Text>
                          </View>
                        ) : null}
                        {skill.last_suggestions?.trim() ? (
                          <View>
                            <Text style={[styles.aiSub, { color: secondary }]}>提升建议</Text>
                            <Text style={[styles.aiBody, { color: text }]}>{skill.last_suggestions.trim()}</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}

            <Pressable
              onPress={() => void onRunAi()}
              disabled={aiBusy || runnableCount === 0}
              style={({ pressed }) => [
                styles.aiMainBtn,
                {
                  backgroundColor: runnableCount === 0 ? outline : primary,
                  opacity: pressed ? 0.88 : aiBusy ? 0.65 : 1,
                },
              ]}>
              {aiBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="auto-awesome" size={22} color="#fff" />
                  <Text style={styles.primaryBtnText}>请求 AI 评估（{runnableCount} 条）</Text>
                </>
              )}
            </Pressable>

            {snapshot.last_overall_suggestions?.trim() ? (
              <View style={[styles.bottomCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
                <Text style={[styles.bottomTitle, { color: primary }]}>综合建议</Text>
                <Text style={[styles.bottomBody, { color: text }]}>{snapshot.last_overall_suggestions.trim()}</Text>
              </View>
            ) : null}

            {snapshot.last_profile_analysis?.trim() ? (
              <View style={[styles.bottomCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
                <Text style={[styles.bottomTitle, { color: secondary }]}>总体能力分析</Text>
                <Text style={[styles.bottomBody, { color: text }]}>{snapshot.last_profile_analysis.trim()}</Text>
              </View>
            ) : null}

            {snapshot.last_ai_at ? (
              <Text style={[styles.footerMeta, { color: outline }]}>
                最近评估时间：{new Date(snapshot.last_ai_at).toLocaleString('zh-CN')}
              </Text>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topTitle: { fontSize: 18, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingTop: 16, gap: 14 },
  intro: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  statRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  statText: { fontSize: 14, fontWeight: '700' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '800' },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800' },
  emptyHint: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  dimCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  dimHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dimTitleInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '800',
  },
  skillBlock: { paddingTop: 12 },
  skillHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  skillLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
  },
  textArea: { minHeight: 96, paddingTop: 12 },
  muted: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  aiSkillBox: { marginTop: 12, borderRadius: 12, padding: 12 },
  aiSub: { fontSize: 12, fontWeight: '900', marginBottom: 4 },
  aiBody: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  aiMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 4,
  },
  bottomCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  bottomTitle: { fontSize: 16, fontWeight: '900' },
  bottomBody: { fontSize: 15, lineHeight: 24, fontWeight: '600' },
  footerMeta: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 4 },
});
