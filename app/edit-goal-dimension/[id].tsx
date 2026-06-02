import { GoalDimensionFormFields } from '@/components/goal-dimension/GoalDimensionFormFields';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { getGoalDimensionById, updateGoalDimension } from '@/lib/repositories/goal-dimensions/goal-dimension';
import {
  parseGoalDimensionExtra,
  priorityValueToSortOrder,
  sortOrderToPriorityValue,
  type DimensionPriorityValue,
} from '@/lib/repositories/goal-dimensions/goal-dimension-extra';
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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function normalizeId(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  return '';
}

export default function EditGoalDimensionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const dimensionId = normalizeId(idParam);

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
  const [priority, setPriority] = useState<DimensionPriorityValue>(3);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!dimensionId) {
      setLoading(false);
      return;
    }
    try {
      const row = await getGoalDimensionById(dimensionId);
      if (!row) {
        Alert.alert('未找到', '该维度可能已删除', [{ text: '确定', onPress: () => router.back() }]);
        return;
      }
      setTitle(row.title);
      setPriority(sortOrderToPriorityValue(row.sort_order));
      setNote(parseGoalDimensionExtra(row.extra_data)?.note ?? '');
    } catch {
      Alert.alert('加载失败', '请返回重试', [{ text: '确定', onPress: () => router.back() }]);
    } finally {
      setLoading(false);
    }
  }, [dimensionId, router]);

  const { refreshControl } = usePullToRefresh(reload);

  useEffect(() => {
    if (!dimensionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void reload();
  }, [dimensionId, reload]);

  const onSave = useCallback(async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert('无法保存', '请填写维度名称');
      return;
    }
    if (!dimensionId) return;
    const noteTrim = note.trim();
    setSaving(true);
    try {
      const ok = await updateGoalDimension(dimensionId, {
        title: t,
        sort_order: priorityValueToSortOrder(priority),
        extra: noteTrim ? { note: noteTrim } : null,
      });
      if (!ok) {
        Alert.alert('保存失败', '该维度可能已删除');
        setSaving(false);
        return;
      }
      router.back();
    } catch {
      Alert.alert('保存失败', '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [dimensionId, note, priority, router, title]);

  if (!dimensionId) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>缺少维度 ID</Text>
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
          <Text style={[styles.topBarTitle, { color: text }]}>编辑维度</Text>
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
            contentContainerStyle={[styles.scrollInner, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.intro, { color: outline }]}>
              维度用于归类总目标。可设置优先级与备注，便于在总目标墙中管理。
            </Text>
            <GoalDimensionFormFields
              title={title}
              onTitleChange={setTitle}
              priority={priority}
              onPriorityChange={setPriority}
              note={note}
              onNoteChange={setNote}
              disabled={saving}
              textColor={text}
              outlineColor={outline}
              primaryColor={primary}
              borderSoft={borderSoft}
              inputBg={inputBg}
              isDark={isDark}
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
  intro: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 20,
  },
});
