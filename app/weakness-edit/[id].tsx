import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { startWeaknessAiReviewInBackground } from '@/lib/weakness-ai-background';
import {
  createUserWeakness,
  getUserWeakness,
  updateUserWeakness,
  weaknessContextForAiReview,
  WEAKNESS_DETAIL_MAX,
  WEAKNESS_TITLE_MAX,
} from '@/lib/user-weaknesses';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function normalizeId(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  return '';
}

export default function WeaknessEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = normalizeId(idParam);
  const isNew = id === 'new';

  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';
  const bg = isDark ? theme.background : '#faf8ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#424754';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const borderSoft = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)';
  const inputBg = isDark ? 'rgba(15,23,42,0.5)' : '#ffffff';
  const headerBg = isDark ? 'rgba(17,24,39,0.98)' : 'rgba(255,255,255,0.98)';

  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (isNew || !id) return;
    setLoading(true);
    try {
      const row = await getUserWeakness(id);
      if (!row) {
        Alert.alert('未找到', '该记录可能已删除', [{ text: '确定', onPress: () => router.back() }]);
        return;
      }
      setTitle(row.title);
      setDetail(row.detail);
    } catch {
      Alert.alert('加载失败', '请返回重试', [{ text: '确定', onPress: () => router.back() }]);
    } finally {
      setLoading(false);
    }
  }, [id, isNew, router]);

  const { refreshControl } = usePullToRefresh(reload);

  useEffect(() => {
    if (isNew || !id) {
      setLoading(false);
      return;
    }
    void reload();
  }, [id, isNew, reload]);

  const onSave = useCallback(async () => {
    const t = title.trim();
    const d = detail.trim();
    if (!t && !d) {
      Alert.alert('无法保存', '请填写缺点名称或详情');
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const created = await createUserWeakness({ title, detail });
        if (weaknessContextForAiReview(created)) {
          startWeaknessAiReviewInBackground(created);
        }
      } else {
        const next = await updateUserWeakness(id, { title, detail });
        if (!next) {
          Alert.alert('保存失败', '该记录可能已删除');
          setSaving(false);
          return;
        }
        if (!next.ai_review_at?.trim() && weaknessContextForAiReview(next)) {
          startWeaknessAiReviewInBackground(next);
        }
      }
      router.back();
    } catch {
      Alert.alert('保存失败', '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [detail, id, isNew, router, title]);

  if (!id || (!isNew && id === '')) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>缺少记录 ID</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View
        style={[
          styles.topBarWrap,
          {
            paddingTop: insets.top,
            backgroundColor: headerBg,
            borderBottomColor: borderSoft,
          },
        ]}
      >
        <View style={styles.topBar}>
          <Pressable style={styles.roundIconBtn} onPress={() => router.back()} disabled={saving}>
            <MaterialIcons name="arrow-back-ios-new" size={20} color={primary} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: text }]}>{isNew ? '添加缺点' : '编辑缺点'}</Text>
          <Pressable style={styles.saveBtn} onPress={() => void onSave()} disabled={saving || loading}>
            {saving ? (
              <ActivityIndicator size="small" color={primary} />
            ) : (
              <Text style={[styles.saveBtnText, { color: primary }]}>保存</Text>
            )}
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flexOne}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 56}
        >
          <ScrollView
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.scrollInner,
              { paddingBottom: Math.max(insets.bottom, 20) + 24 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.label, { color: outline }]}>缺点名称（最多 {WEAKNESS_TITLE_MAX} 字）</Text>
            <TextInput
              value={title}
              onChangeText={x => setTitle(x.length > WEAKNESS_TITLE_MAX ? x.slice(0, WEAKNESS_TITLE_MAX) : x)}
              placeholder="例如：容易拖延、说话太直"
              placeholderTextColor={outline}
              style={[styles.inputTitle, { color: text, borderColor: borderSoft, backgroundColor: inputBg }]}
            />

            <Text style={[styles.label, { color: outline, marginTop: 18 }]}>详情（最多 {WEAKNESS_DETAIL_MAX} 字）</Text>
            <TextInput
              value={detail}
              onChangeText={x => setDetail(x.length > WEAKNESS_DETAIL_MAX ? x.slice(0, WEAKNESS_DETAIL_MAX) : x)}
              placeholder="具体表现、常见场景、带来的影响、你想如何改变…"
              placeholderTextColor={outline}
              multiline
              textAlignVertical="top"
              style={[styles.inputBody, { color: text, borderColor: borderSoft, backgroundColor: inputBg }]}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  topBarWrap: {
    borderBottomWidth: 1,
    zIndex: 10,
    elevation: 6,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    minHeight: 48,
    paddingBottom: 8,
  },
  roundIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: { fontSize: 17, fontWeight: '800' },
  saveBtn: {
    minWidth: 64,
    height: 44,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '800' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollInner: { paddingHorizontal: 18, paddingTop: 20 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginBottom: 8 },
  inputTitle: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    fontWeight: '700',
  },
  inputBody: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    minHeight: 220,
  },
});
