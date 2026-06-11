import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getDefaultUser } from '@/lib/repositories/users/user';
import {
  countSkillsInSnapshot,
  createDesiredSkillItem,
  createEmptyUserSkillsSnapshot,
  createSkillItem,
  ensureUserSkillsSnapshot,
  loadUserSkills,
  saveUserSkills,
  type DesiredSkillItem,
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
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
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
import { MySkillsWeaknessSection } from '@/components/my-skills/weakness-section';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const AI_SKILL_DIMENSION = '现有技能';

function applyAiToSnapshot(snapshot: UserSkillsSnapshot, data: UserSkillAiPortfolioPayload): UserSkillsSnapshot {
  const safe = ensureUserSkillsSnapshot(snapshot);
  const map = new Map(data.per_skill.map(p => [p.skill_id.trim(), p]));
  return {
    ...safe,
    skills: safe.skills.map(s => {
      const row = map.get(s.id.trim());
      if (!row) return s;
      return { ...s, last_evaluation: row.evaluation, last_suggestions: row.suggestions };
    }),
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
  const [weaknessRefreshSignal, setWeaknessRefreshSignal] = useState(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [skills, user] = await Promise.all([loadUserSkills(), getDefaultUser()]);
      setSnapshot(ensureUserSkillsSnapshot(skills));
      setDisplayName(user?.name?.trim() || '默认用户');
      setWeaknessRefreshSignal(s => s + 1);
    } catch {
      setSnapshot(createEmptyUserSkillsSnapshot());
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const { refreshControl } = usePullToRefresh(() => load(true));

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSnapshot(prev => {
      const safe = ensureUserSkillsSnapshot(prev);
      if (safe !== prev) {
        void saveUserSkills(safe);
        return safe;
      }
      return prev;
    });
  }, []);

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

  const updateSkills = useCallback(
    (fn: (prev: UserSkillItem[]) => UserSkillItem[]) => {
      setSnapshot(prev => {
        const safe = ensureUserSkillsSnapshot(prev);
        const next = { ...safe, skills: fn(safe.skills) };
        persistSoon(next);
        return next;
      });
    },
    [persistSoon],
  );

  const updateDesiredSkills = useCallback(
    (fn: (prev: DesiredSkillItem[]) => DesiredSkillItem[]) => {
      setSnapshot(prev => {
        const safe = ensureUserSkillsSnapshot(prev);
        const next = { ...safe, desired_skills: fn(safe.desired_skills) };
        persistSoon(next);
        return next;
      });
    },
    [persistSoon],
  );

  const skills = snapshot.skills ?? [];
  const desiredSkills = snapshot.desired_skills ?? [];

  const onAddSkill = () => {
    updateSkills(list => [...list, createSkillItem()]);
  };

  const onRemoveSkill = (skillId: string) => {
    updateSkills(list => list.filter(s => s.id !== skillId));
  };

  const onPatchSkill = (skillId: string, patch: Partial<UserSkillItem>) => {
    updateSkills(list => list.map(s => (s.id === skillId ? { ...s, ...patch } : s)));
  };

  const onAddDesiredSkill = () => {
    updateDesiredSkills(list => [...list, createDesiredSkillItem()]);
  };

  const onRemoveDesiredSkill = (id: string) => {
    updateDesiredSkills(list => list.filter(s => s.id !== id));
  };

  const onPatchDesiredSkill = (id: string, patch: Partial<DesiredSkillItem>) => {
    updateDesiredSkills(list => list.map(s => (s.id === id ? { ...s, ...patch } : s)));
  };

  const linesForAi = useMemo(() => {
    const out: { skill_id: string; dimension: string; name: string; description: string }[] = [];
    for (const s of skills) {
      const name = s.name.trim();
      const desc = s.description.trim();
      if (name && desc) {
        out.push({ skill_id: s.id, dimension: AI_SKILL_DIMENSION, name, description: desc });
      }
    }
    return out;
  }, [skills]);

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
  const desiredTotal = desiredSkills.length;

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
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.scroll, { paddingBottom: 32 + insets.bottom }]}>
            <Text style={[styles.intro, { color: outline }]}>
              记录现有技能、学习目标与待改进缺点。技能填写名称与自我描述后，可点击「请求 AI
              评估」逐条评估并生成综合建议；缺点保存后会自动生成 AI 分析与改进建议（基于智谱 GLM，与记账等功能共用密钥配置）。
            </Text>

            <View style={[styles.statRow, { borderColor: outlineVariant }]}>
              <Text style={[styles.statText, { color: text }]}>
                {skillTotal} 条现有技能 · 可评估 {runnableCount} 条 · {desiredTotal} 项想学
              </Text>
            </View>

            <View style={styles.sectionHeaderText}>
              <Text style={[styles.sectionTitle, { color: text }]}>现有技能</Text>
            </View>

            <Pressable
              onPress={onAddSkill}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: primary, opacity: pressed ? 0.88 : 1 },
              ]}>
              <MaterialIcons name="add" size={22} color="#fff" />
              <Text style={styles.primaryBtnText}>添加技能</Text>
            </Pressable>

            {skills.length === 0 ? (
              <View style={[styles.emptyCard, { borderColor: outlineVariant, backgroundColor: surface }]}>
                <MaterialIcons name="psychology" size={40} color={outline} />
                <Text style={[styles.emptyTitle, { color: text }]}>从这里开始</Text>
                <Text style={[styles.emptyHint, { color: outline }]}>
                  点击上方按钮，添加你已有的技能与自我描述。
                </Text>
              </View>
            ) : null}

            {skills.map(skill => (
              <View
                key={skill.id}
                style={[styles.skillCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
                <View style={styles.skillHead}>
                  <Text style={[styles.skillLabel, { color: outline }]}>技能名称</Text>
                  <Pressable onPress={() => onRemoveSkill(skill.id)} hitSlop={8}>
                    <MaterialIcons name="close" size={20} color={outline} />
                  </Pressable>
                </View>
                <TextInput
                  value={skill.name}
                  onChangeText={t => onPatchSkill(skill.id, { name: t })}
                  placeholder="例如：TypeScript / 公开演讲"
                  placeholderTextColor={outline}
                  style={[styles.input, { color: text, borderColor: inputBorder, backgroundColor: inputSurface }]}
                />
                <Text style={[styles.skillLabel, { color: outline, marginTop: 10 }]}>自我描述</Text>
                <TextInput
                  value={skill.description}
                  onChangeText={t => onPatchSkill(skill.id, { description: t })}
                  placeholder="你目前掌握到什么程度？做过哪些相关实践？"
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

            <View style={[styles.sectionHeader, { borderTopColor: outlineVariant }]}>
              <View style={styles.sectionHeaderText}>
                <Text style={[styles.sectionTitle, { color: text }]}>我想要的技能</Text>
                <Text style={[styles.sectionHint, { color: outline }]}>
                  记录你想学习的技能，以及期望达到的水平。
                </Text>
              </View>
            </View>

            <Pressable
              onPress={onAddDesiredSkill}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { borderColor: `${secondary}55`, opacity: pressed ? 0.85 : 1 },
              ]}>
              <MaterialIcons name="add-circle-outline" size={20} color={secondary} />
              <Text style={[styles.secondaryBtnText, { color: secondary }]}>添加想学的技能</Text>
            </Pressable>

            {desiredSkills.length === 0 ? (
              <View style={[styles.emptyCard, { borderColor: outlineVariant, backgroundColor: surface }]}>
                <MaterialIcons name="flag" size={36} color={outline} />
                <Text style={[styles.emptyTitle, { color: text }]}>还没有学习目标</Text>
                <Text style={[styles.emptyHint, { color: outline }]}>
                  点击上方按钮，添加你想掌握的技能与目标水平。
                </Text>
              </View>
            ) : null}

            {desiredSkills.map(item => (
              <View
                key={item.id}
                style={[styles.skillCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
                <View style={styles.skillHead}>
                  <Text style={[styles.skillLabel, { color: outline }]}>技能名称</Text>
                  <Pressable onPress={() => onRemoveDesiredSkill(item.id)} hitSlop={8}>
                    <MaterialIcons name="close" size={20} color={outline} />
                  </Pressable>
                </View>
                <TextInput
                  value={item.name}
                  onChangeText={t => onPatchDesiredSkill(item.id, { name: t })}
                  placeholder="例如：Rust / 数据分析 / 钢琴"
                  placeholderTextColor={outline}
                  style={[styles.input, { color: text, borderColor: inputBorder, backgroundColor: inputSurface }]}
                />
                <Text style={[styles.skillLabel, { color: outline, marginTop: 10 }]}>期望达到的水平</Text>
                <TextInput
                  value={item.target_level}
                  onChangeText={t => onPatchDesiredSkill(item.id, { target_level: t })}
                  placeholder="例如：能独立做小型项目 / 日常会话流利 / 能弹完整曲目"
                  placeholderTextColor={outline}
                  multiline
                  textAlignVertical="top"
                  style={[
                    styles.input,
                    styles.textArea,
                    { color: text, borderColor: inputBorder, backgroundColor: inputSurface },
                  ]}
                />
              </View>
            ))}

            <MySkillsWeaknessSection refreshSignal={weaknessRefreshSignal} />

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
  skillCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  sectionHeader: {
    paddingTop: 8,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sectionHeaderText: { gap: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '900' },
  sectionHint: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
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
