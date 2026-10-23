/**
 * 新建 / 编辑道路赌注：对齐设计稿 13（时间桶、年份芯片、状态、名额提示）。
 */
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui/app-icon';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import {
  getLifeBetDerivedStats,
  getLifeBetProgressRatio,
  listActiveProjectsForLifeBet,
  resolveLifeBetProgressRatio,
  type LifeBetActiveProjectRef,
} from '@/lib/life-road/life-road-derived';
import {
  LIFE_BET_HORIZON_LABELS,
  LIFE_BET_STATUS_LABELS,
} from '@/lib/life-road/life-road-labels';
import {
  currentCalendarYear,
  LIFE_BET_HORIZON_VALUES,
  LIFE_BET_STATUS_VALUES,
  LIFE_BET_YEAR_ACTIVE_LIMIT,
  type LifeBetHorizon,
  type LifeBetStatus,
} from '@/lib/life-road/life-road-limits';
import {
  countActiveYearBetsLocal,
  createLifeBet,
  getLifeBetById,
  updateLifeBet,
} from '@/lib/repositories/life-road/life-bet';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
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

const PAGE_KEY = 'edit-life-bet';
const TITLE_MAX = 40;
const NOTE_MAX = 200;

function parseHorizonParam(raw: unknown): LifeBetHorizon {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (v === 'multi' || v === 'farther' || v === 'year') return v;
  return 'year';
}

function yearChipOptions(base: number): number[] {
  return [base, base + 1, base + 4, base + 9];
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  const { fold } = useFoldTheme();
  return (
    <View style={styles.fieldLabelRow}>
      <Text style={[styles.fieldLabel, { color: fold.ink2 }]}>{label}</Text>
      {hint ? <Text style={[styles.fieldHint, { color: fold.faint }]}>{hint}</Text> : null}
    </View>
  );
}

function PillOption({
  label,
  active,
  onPress,
  flex,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  flex?: number;
}) {
  const { fold } = useFoldTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.pill2,
        {
          flex: flex ?? 1,
          backgroundColor: active ? fold.pineButton : '#F7F3E9',
          borderColor: active ? fold.pineButton : fold.line,
        },
        pressed && { transform: [{ scale: 0.96 }] },
      ]}>
      <Text
        style={{
          fontSize: 12,
          fontWeight: active ? '800' : '600',
          color: active ? fold.onPineButton : fold.muted,
        }}
        numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function EditLifeBetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const { notifyAncestorsDataChanged } = usePageApiSync(PAGE_KEY);
  const params = useLocalSearchParams<{ id: string; horizon?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const isNew = id === 'new' || !id;

  const [title, setTitle] = useState('');
  const [horizon, setHorizon] = useState<LifeBetHorizon>(() => parseHorizonParam(params.horizon));
  const [year, setYear] = useState(currentCalendarYear());
  const [status, setStatus] = useState<LifeBetStatus>('on_track');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [yearActiveCount, setYearActiveCount] = useState(0);
  const [projects, setProjects] = useState<LifeBetActiveProjectRef[]>([]);
  const [projectTotal, setProjectTotal] = useState(0);
  const [progressPct, setProgressPct] = useState<number | null>(null);

  const yearNow = currentCalendarYear();
  const yearOptions = useMemo(() => yearChipOptions(yearNow), [yearNow]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const count = await countActiveYearBetsLocal(yearNow);
      if (!cancelled) setYearActiveCount(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [yearNow]);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await getLifeBetById(id, { serverFallback: true });
        if (cancelled) return;
        if (!row) {
          Alert.alert('未找到这条道路', undefined, [
            { text: '好', onPress: () => router.back() },
          ]);
          return;
        }
        setTitle(row.title);
        setHorizon(row.horizon);
        setYear(row.year != null ? row.year : yearNow);
        setStatus(row.status);
        setNote(row.note ?? '');

        const [linked, derived, taskRatio] = await Promise.all([
          listActiveProjectsForLifeBet(row.id, 4),
          getLifeBetDerivedStats(row.id, row.status),
          getLifeBetProgressRatio(row.id),
        ]);
        if (cancelled) return;
        setProjects(linked?.projects ?? []);
        setProjectTotal(linked?.total ?? 0);
        setProgressPct(
          Math.round(
            resolveLifeBetProgressRatio(row.status, taskRatio, derived.activeProjectCount) * 100,
          ),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isNew, router, yearNow]);

  const occupiesSlot =
    horizon === 'year' && (status === 'on_track' || status === 'paused');
  const remainingAfterSave = useMemo(() => {
    if (!occupiesSlot) return null;
    const nextCount = isNew ? yearActiveCount + 1 : yearActiveCount;
    return {
      before: yearActiveCount,
      after: Math.min(LIFE_BET_YEAR_ACTIVE_LIMIT, nextCount),
      left: Math.max(0, LIFE_BET_YEAR_ACTIVE_LIMIT - nextCount),
    };
  }, [isNew, occupiesSlot, yearActiveCount]);

  const headerSub = useMemo(() => {
    if (horizon !== 'year') return `${LIFE_BET_HORIZON_LABELS[horizon]} · 不占今年名额`;
    const left = Math.max(0, LIFE_BET_YEAR_ACTIVE_LIMIT - yearActiveCount);
    if (left <= 0) return '今年名额已满';
    return `今年还剩 ${left} 个名额`;
  }, [horizon, yearActiveCount]);

  const onSave = async () => {
    if (!title.trim()) {
      toast.warn('请填写标题');
      return;
    }
    const yearValue = horizon === 'year' ? year : year;
    if (horizon === 'year') {
      if ((status === 'on_track' || status === 'paused') && isNew) {
        const count = await countActiveYearBetsLocal(yearValue);
        if (count >= LIFE_BET_YEAR_ACTIVE_LIMIT) {
          toast.warn(`今年进行中的道路赌注最多 ${LIFE_BET_YEAR_ACTIVE_LIMIT} 条`);
          router.replace({ pathname: '/life-road', params: { focus: 'full' } });
          return;
        }
      }
    }

    setSaving(true);
    try {
      if (isNew) {
        await createLifeBet({
          title,
          horizon,
          year: yearValue,
          note: note.trim() || null,
          status,
        });
      } else {
        await updateLifeBet(id, {
          title,
          horizon,
          year: yearValue,
          note: note.trim() || null,
          status,
        });
      }
      notifyAncestorsDataChanged();
      toast.success('已保存');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请检查网络后重试'));
    } finally {
      setSaving(false);
    }
  };

  const bannerTone =
    remainingAfterSave == null
      ? { bg: '#EEF3EE', border: '#D3E0D4', color: '#3C614F' }
      : remainingAfterSave.left > 0
        ? { bg: '#EEF3EE', border: '#D3E0D4', color: '#3C614F' }
        : { bg: '#FBEEDC', border: '#E7CFA6', color: '#8B5A1E' };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.appBar, { paddingTop: insets.top + 4, borderBottomColor: fold.line }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="arrow-back" size={20} color={fold.ink} />
        </Pressable>
        <View style={styles.appBarTitleWrap}>
          <Text style={[styles.appTitle, { color: fold.ink }]}>
            {isNew ? '新建赌注' : '编辑赌注'}
          </Text>
          <Text style={[styles.appSub, { color: fold.muted }]} numberOfLines={1}>
            {headerSub}
          </Text>
        </View>
        <Pressable
          onPress={() => void onSave()}
          disabled={saving || loading}
          accessibilityRole="button"
          accessibilityLabel="保存"
          style={({ pressed }) => [
            styles.pillBtn,
            {
              backgroundColor: fold.pineButton,
              borderColor: fold.pineButton,
              opacity: saving || loading ? 0.55 : pressed ? 0.9 : 1,
            },
          ]}>
          <Text style={{ color: fold.onPineButton, fontWeight: '700', fontSize: 12 }}>
            {saving ? '保存中' : '保存'}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: Math.max(insets.bottom, 16) + 28 },
            ]}
            showsVerticalScrollIndicator={false}>
            <FoldRiseIn animate={motionOn} index={0} fromY={10}>
              <View style={styles.field}>
                <FieldLabel label="标题" hint="动词开头，尽量可验证" />
                <View style={[styles.inputRow, { backgroundColor: fold.card, borderColor: fold.line }]}>
                  <TextInput
                    value={title}
                    onChangeText={(t) => setTitle([...t].slice(0, TITLE_MAX).join(''))}
                    placeholder="跑完一场半程马拉松"
                    placeholderTextColor={fold.faint}
                    style={[styles.inputText, { color: fold.ink }]}
                  />
                  <AppIcon name="edit" size={14} color={fold.faint} />
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={1} fromY={10}>
              <View style={styles.field}>
                <FieldLabel label="时间桶" hint="决定它出现在哪一组" />
                <View style={styles.pillRow}>
                  {LIFE_BET_HORIZON_VALUES.map((opt) => (
                    <PillOption
                      key={opt}
                      label={LIFE_BET_HORIZON_LABELS[opt]}
                      active={horizon === opt}
                      onPress={() => {
                        setHorizon(opt);
                        if (opt === 'year') setYear(yearNow);
                      }}
                    />
                  ))}
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={2} fromY={10}>
              <View style={styles.field}>
                <FieldLabel
                  label="年份"
                  hint={horizon === 'year' ? `今年 = ${yearNow}` : '可选'}
                />
                <View style={styles.pillRowWrap}>
                  {yearOptions.map((y) => (
                    <Pressable
                      key={y}
                      onPress={() => setYear(y)}
                      style={[
                        styles.yearChip,
                        {
                          backgroundColor: year === y ? fold.pineButton : '#F7F3E9',
                          borderColor: year === y ? fold.pineButton : fold.line,
                        },
                      ]}>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: year === y ? '800' : '600',
                          color: year === y ? fold.onPineButton : fold.muted,
                        }}>
                        {y}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={3} fromY={10}>
              <View style={styles.field}>
                <FieldLabel label="状态" hint="只有「在路上 / 暂搁」占名额" />
                <View style={styles.pillRowWrap}>
                  {LIFE_BET_STATUS_VALUES.map((opt) => (
                    <Pressable
                      key={opt}
                      onPress={() => setStatus(opt)}
                      style={[
                        styles.statusChip,
                        {
                          backgroundColor: status === opt ? fold.pineButton : '#F7F3E9',
                          borderColor: status === opt ? fold.pineButton : fold.line,
                        },
                      ]}>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: status === opt ? '800' : '600',
                          color: status === opt ? fold.onPineButton : fold.muted,
                        }}>
                        {LIFE_BET_STATUS_LABELS[opt]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={4} fromY={10}>
              <View style={styles.field}>
                <FieldLabel label="说明" hint="为什么是这条，而不是别的" />
                <TextInput
                  value={note}
                  onChangeText={(t) => setNote([...t].slice(0, NOTE_MAX).join(''))}
                  multiline
                  placeholder="想在什么节点前做成，按什么节奏推进"
                  placeholderTextColor={fold.faint}
                  style={[
                    styles.textarea,
                    { color: fold.ink, borderColor: fold.line, backgroundColor: fold.card },
                  ]}
                  textAlignVertical="top"
                />
              </View>
            </FoldRiseIn>

            {!isNew ? (
              <FoldRiseIn animate={motionOn} index={5} fromY={10}>
                <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
                  <View style={styles.rowline}>
                    <Text style={[styles.cardTitle, { color: fold.ink2 }]}>关联项目</Text>
                    <Pressable
                      onPress={() => toast.warn('请在任务页项目详情中设置归属道路')}
                      hitSlop={8}>
                      <Text style={{ fontSize: 11, color: '#8B6126', fontWeight: '700' }}>
                        + 关联 ›
                      </Text>
                    </Pressable>
                  </View>
                  {projects.length === 0 ? (
                    <Text style={{ fontSize: 12, color: fold.faint, marginTop: 4 }}>
                      暂无关联项目
                    </Text>
                  ) : (
                    projects.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() =>
                          router.push({ pathname: '/edit-project', params: { id: p.id } })
                        }
                        style={styles.projectRow}>
                        <Text style={{ flex: 1, fontSize: 12, color: fold.ink2 }} numberOfLines={1}>
                          · {p.name}
                        </Text>
                        <View style={[styles.miniTag, { backgroundColor: fold.sage2 }]}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: fold.pine2 }}>
                            进行中
                          </Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                  <View style={styles.miniNote}>
                    <AppIcon name="show-chart" size={12} color={fold.faint} />
                    <Text style={{ flex: 1, fontSize: 11, color: fold.faint, lineHeight: 15 }}>
                      {progressPct != null
                        ? `进度由关联项目派生：约 ${progressPct}%${projectTotal > projects.length ? ` · 共 ${projectTotal} 个` : ''}`
                        : '进度由关联项目派生'}
                    </Text>
                  </View>
                </View>
              </FoldRiseIn>
            ) : null}

            {remainingAfterSave ? (
              <View
                style={[
                  styles.limitBanner,
                  { backgroundColor: bannerTone.bg, borderColor: bannerTone.border },
                ]}>
                <AppIcon name="gps-fixed" size={13} color={bannerTone.color} />
                <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: bannerTone.color }}>
                  {isNew
                    ? `今年 ${remainingAfterSave.before} / ${LIFE_BET_YEAR_ACTIVE_LIMIT} 条。保存后变成 ${remainingAfterSave.after} / ${LIFE_BET_YEAR_ACTIVE_LIMIT}，还剩 ${remainingAfterSave.left} 个名额。`
                    : `今年 ${remainingAfterSave.before} / ${LIFE_BET_YEAR_ACTIVE_LIMIT} 条进行中（在路上 + 暂搁）。`}
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.limitBanner,
                  { backgroundColor: '#EEF3EE', borderColor: '#D3E0D4' },
                ]}>
                <AppIcon name="gps-fixed" size={13} color="#3C614F" />
                <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: '#3C614F' }}>
                  当前状态 / 时间桶不占用今年名额。
                </Text>
              </View>
            )}

            <Pressable
              onPress={() => void onSave()}
              disabled={saving || !title.trim()}
              style={({ pressed }) => [
                styles.primary,
                {
                  backgroundColor: fold.pineButton,
                  opacity: saving || !title.trim() ? 0.55 : pressed ? 0.92 : 1,
                },
              ]}>
              <Text style={{ color: fold.onPineButton, fontWeight: '800', fontSize: 14 }}>
                {saving ? '保存中…' : '保存赌注'}
              </Text>
            </Pressable>

            <View style={styles.formFoot}>
              <View style={[styles.dot, { backgroundColor: fold.sage }]} />
              <Text style={{ fontSize: 11, color: fold.faint }}>保存后可在同桶内拖动排序</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0 },
  appTitle: { fontSize: 18, fontWeight: '800' },
  appSub: { marginTop: 2, fontSize: 11, fontWeight: '600' },
  pillBtn: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 15, paddingTop: 10, gap: 10 },
  field: { gap: 6 },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fieldLabel: { fontSize: 13, fontWeight: '800' },
  fieldHint: { fontSize: 11, flexShrink: 1, textAlign: 'right' },
  inputRow: {
    height: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputText: { flex: 1, fontSize: 14, fontWeight: '600', paddingVertical: 0 },
  pillRow: { flexDirection: 'row', gap: 6 },
  pillRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill2: {
    height: 34,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  yearChip: {
    minWidth: 70,
    height: 34,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  statusChip: {
    minWidth: '46%',
    flexGrow: 1,
    height: 34,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  textarea: {
    minHeight: 78,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 20,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 10,
    gap: 4,
  },
  rowline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: { fontSize: 13, fontWeight: '800' },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  miniTag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  miniNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 4,
  },
  limitBanner: {
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  primary: {
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
