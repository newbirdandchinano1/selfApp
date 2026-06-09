import {
  formatReviewHeaderDate,
  isDailyReviewEditableYmd,
  isDailySkipped,
  loadReviewPeriodSnapshot,
} from '@/components/review/review-utils';
import { ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import {
  collectColumnIds,
  emptyFieldValues,
  serializeReviewBody,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { upsertDailyReviewJournal } from '@/lib/repositories/insights/daily-review-journal';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

const PAGE_API_KEY = 'daily-review-edit';

export function DailyReviewEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const params = useLocalSearchParams<{ ymd?: string | string[] }>();
  const ymd = (Array.isArray(params.ymd) ? params.ymd[0] : params.ymd)?.trim() ?? '';
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<ReviewFieldValues>({});
  const [entryLabel, setEntryLabel] = useState('');
  const [dailyTemplate, setDailyTemplate] = useState<Awaited<ReturnType<typeof loadReviewPeriodSnapshot>>['dailyTemplate']>([]);
  const [reviewCycleEndYmd, setReviewCycleEndYmd] = useState('');
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);

  const skipped = isDailySkipped(ymd, reviewCycleEndYmd, configuredDow);
  const canEdit = !skipped && isDailyReviewEditableYmd(ymd, todayYmd);
  const inputSurface = isDark ? 'rgba(15,23,42,0.55)' : colors.input;
  const inputBorder = colors.outline;

  const reload = useCallback(async () => {
    if (!ymd) return;
    setLoading(true);
    try {
      await wrapLoad(async () => {
        const snapshot = await loadReviewPeriodSnapshot(todayYmd);
        setDailyTemplate(snapshot.dailyTemplate);
        setReviewCycleEndYmd(snapshot.reviewCycleEndYmd);
        setConfiguredDow(snapshot.configuredDow);
        const entry = snapshot.dailyEntries.find(e => e.ymd === ymd);
        const colIds = collectColumnIds(snapshot.dailyTemplate);
        setFields(entry?.fields ?? emptyFieldValues(colIds));
        setEntryLabel(entry?.label ?? formatReviewHeaderDate(ymd));
      });
    } catch {
      setFields({});
    } finally {
      setLoading(false);
    }
  }, [todayYmd, wrapLoad, ymd]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setField = useCallback(
    (columnId: string, value: string) => {
      if (!canEdit) return;
      setFields(prev => ({ ...prev, [columnId]: value }));
    },
    [canEdit],
  );

  const onSave = useCallback(async () => {
    if (skipped) {
      Alert.alert('无需日复盘', '每周复盘日当天请填写周复盘内容。');
      return;
    }
    if (!canEdit) {
      Alert.alert('暂不可保存', '每日复盘不可填写未来日期；过去与今天可保存。');
      return;
    }
    setSaving(true);
    try {
      await upsertDailyReviewJournal(ymd, serializeReviewBody(fields));
      Alert.alert('已保存', `${ymd} 的每日复盘已写入本地。`);
    } catch (e) {
      console.warn('daily review save', e);
      Alert.alert('保存失败', '请稍后再试');
    } finally {
      setSaving(false);
    }
  }, [canEdit, fields, skipped, ymd]);

  const headerTitle = useMemo(() => entryLabel || formatReviewHeaderDate(ymd), [entryLabel, ymd]);

  if (!ymd) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <ScreenHeader title="每日复盘" onBack={() => router.back()} />
        <View style={styles.centered}>
          <Text style={{ color: colors.textMuted }}>无效日期</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader title={headerTitle} onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.xl) },
            ]}>
            {skipped ? (
              <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.outline }]}>
                <MaterialIcons name="event-available" size={22} color={colors.primary} />
                <Text style={[Typography.body, { color: colors.text, flex: 1, lineHeight: 21 }]}>
                  本日为已设定的每周复盘日，请前往「每周复盘」填写，无需单独做日复盘。
                </Text>
              </View>
            ) : !canEdit ? (
              <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.outline }]}>
                <MaterialIcons name="lock-outline" size={22} color={colors.textMuted} />
                <Text style={[Typography.body, { color: colors.textMuted, flex: 1, lineHeight: 21 }]}>
                  未来日期仅可查看，不可编辑与保存。
                </Text>
              </View>
            ) : null}

            {dailyTemplate.length === 0 ? (
              <Text style={[Typography.body, { color: colors.textMuted, lineHeight: 21 }]}>
                尚未配置日复盘维度，请先在「复盘设置」中管理模板。
              </Text>
            ) : (
              dailyTemplate.map(dim => (
                <View key={dim.id} style={styles.formSection}>
                  <Text style={[Typography.title, { color: colors.text }]}>{dim.title}</Text>
                  {dim.columns.map(col => (
                    <View key={col.id} style={styles.fieldBlock}>
                      <Text style={[Typography.label, { color: colors.textMuted }]}>{col.title}</Text>
                      <TextInput
                        value={fields[col.id] ?? ''}
                        onChangeText={t => setField(col.id, t)}
                        placeholder={col.placeholder || '…'}
                        placeholderTextColor={colors.textMuted}
                        multiline
                        textAlignVertical="top"
                        editable={canEdit}
                        style={[
                          styles.input,
                          {
                            backgroundColor: inputSurface,
                            borderColor: inputBorder,
                            color: colors.text,
                            opacity: canEdit ? 1 : 0.72,
                          },
                        ]}
                      />
                    </View>
                  ))}
                </View>
              ))
            )}

            {canEdit ? (
              <Pressable
                onPress={() => void onSave()}
                disabled={saving}
                style={({ pressed }) => [
                  styles.saveBtn,
                  { backgroundColor: colors.success, opacity: pressed || saving ? 0.75 : 1 },
                ]}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>保存该日</Text>}
              </Pressable>
            ) : skipped ? (
              <Pressable
                onPress={() => router.push('/weekly-review-form')}
                style={({ pressed }) => [
                  styles.saveBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
                ]}>
                <Text style={styles.saveBtnText}>去填写每周复盘</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.xl,
    gap: Spacing['3xl'],
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.lg,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing['3xl'],
  },
  formSection: { gap: Spacing.lg },
  fieldBlock: { gap: Spacing.sm },
  input: {
    minHeight: 120,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing['3xl'],
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  saveBtn: {
    borderRadius: Radius.xl,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
});
