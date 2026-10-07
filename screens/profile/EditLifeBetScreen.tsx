/**
 * 新建 / 编辑道路赌注。字段仅：标题、时间桶、年份、状态、说明。
 */
import { AppButton, AppInput, AppScreen, ScreenHeader } from '@/components/ui';
import { AppText } from '@/components/ui/app-text';
import {
  getTaskUiColors,
  Radius,
  Spacing,
} from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import {
  LIFE_BET_HORIZON_LABELS,
  LIFE_BET_STATUS_LABELS,
  lifeBetStatusTone,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

const PAGE_KEY = 'edit-life-bet';

function parseHorizonParam(raw: unknown): LifeBetHorizon {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (v === 'multi' || v === 'farther' || v === 'year') return v;
  return 'year';
}

export default function EditLifeBetScreen() {
  const router = useRouter();
  const { colors, isDark, shadows } = useAppTheme();
  const taskUi = getTaskUiColors(isDark);
  const { notifyAncestorsDataChanged } = usePageApiSync(PAGE_KEY);
  const params = useLocalSearchParams<{ id: string; horizon?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const isNew = id === 'new' || !id;

  const [title, setTitle] = useState('');
  const [horizon, setHorizon] = useState<LifeBetHorizon>(() => parseHorizonParam(params.horizon));
  const [yearText, setYearText] = useState(String(currentCalendarYear()));
  const [status, setStatus] = useState<LifeBetStatus>('on_track');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

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
        setYearText(row.year != null ? String(row.year) : String(currentCalendarYear()));
        setStatus(row.status);
        setNote(row.note ?? '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isNew, router]);

  const headerTitle = isNew ? '添加道路' : '编辑道路';
  const yearRequired = horizon === 'year';
  const statusOptions = useMemo(() => LIFE_BET_STATUS_VALUES, []);
  const horizonOptions = useMemo(() => LIFE_BET_HORIZON_VALUES, []);

  const onSave = async () => {
    if (!title.trim()) {
      Alert.alert('请填写标题');
      return;
    }
    let year: number | null = null;
    if (yearRequired) {
      const n = Number(yearText.trim());
      if (!Number.isInteger(n) || n < 1970 || n > 2100) {
        Alert.alert('请填写有效的公历年');
        return;
      }
      year = n;
      if ((status === 'on_track' || status === 'paused') && isNew) {
        const count = await countActiveYearBetsLocal(year);
        if (count >= LIFE_BET_YEAR_ACTIVE_LIMIT) {
          Alert.alert(
            '今年已满',
            `今年进行中的道路赌注最多 ${LIFE_BET_YEAR_ACTIVE_LIMIT} 条（在路上/暂搁）。`,
          );
          return;
        }
      }
    } else if (yearText.trim()) {
      const n = Number(yearText.trim());
      if (Number.isInteger(n) && n >= 1970 && n <= 2100) year = n;
    }

    setSaving(true);
    try {
      if (isNew) {
        await createLifeBet({
          title,
          horizon,
          year,
          note: note.trim() || null,
          status,
        });
      } else {
        await updateLifeBet(id, {
          title,
          horizon,
          year,
          note: note.trim() || null,
          status,
        });
      }
      notifyAncestorsDataChanged();
      router.back();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请检查网络后重试');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppScreen header={<ScreenHeader title={headerTitle} onBack={() => router.back()} />}>
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      header={<ScreenHeader title={headerTitle} onBack={() => router.back()} />}
      contentContainerStyle={styles.content}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.outline },
        ]}>
        <AppInput
          label="标题"
          value={title}
          onChangeText={setTitle}
          maxLength={40}
          placeholder="今年真正押的一件事"
        />
        <AppText variant="caption" chrome style={{ color: colors.textSecondary, marginTop: -4 }}>
          1–40 字 · 不要写成任务清单
        </AppText>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.outline },
        ]}>
        <AppText variant="label" chrome style={{ color: colors.textSecondary }}>
          时间桶
        </AppText>
        <View style={[styles.segmented, { backgroundColor: colors.capsule }]}>
          {horizonOptions.map((option) => {
            const active = horizon === option;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  setHorizon(option);
                  if (option === 'year' && !yearText.trim()) {
                    setYearText(String(currentCalendarYear()));
                  }
                }}
                style={({ pressed }) => [
                  styles.segmentItem,
                  active && [{ backgroundColor: colors.surface }, shadows.card],
                  pressed && { opacity: 0.88 },
                ]}>
                <AppText
                  variant="bodyStrong"
                  chrome
                  style={{
                    fontSize: 13,
                    color: active ? colors.primary : colors.textSecondary,
                  }}
                  numberOfLines={1}>
                  {LIFE_BET_HORIZON_LABELS[option]}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <AppInput
          label={yearRequired ? '归属公历年' : '归属公历年（可选）'}
          value={yearText}
          onChangeText={setYearText}
          keyboardType="number-pad"
          maxLength={4}
          placeholder={String(currentCalendarYear())}
        />
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.outline },
        ]}>
        <AppText variant="label" chrome style={{ color: colors.textSecondary }}>
          状态
        </AppText>
        <View style={styles.statusGrid}>
          {statusOptions.map((option) => {
            const active = status === option;
            const tone = lifeBetStatusTone(option, taskUi, colors);
            return (
              <Pressable
                key={option}
                onPress={() => setStatus(option)}
                style={({ pressed }) => [
                  styles.statusTile,
                  {
                    backgroundColor: active ? tone.bg : colors.surfaceSubtle,
                    borderColor: active ? tone.border : colors.outline,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: active ? tone.text : colors.textSecondary },
                  ]}
                />
                <AppText
                  variant="bodyStrong"
                  chrome
                  style={{
                    fontSize: 13,
                    color: active ? tone.text : colors.textSecondary,
                  }}
                  numberOfLines={1}>
                  {LIFE_BET_STATUS_LABELS[option]}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.outline },
        ]}>
        <AppInput
          label="做成了长什么样（可选）"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={200}
          inputStyle={{ minHeight: 96, textAlignVertical: 'top' }}
          placeholder="一两句结果样子，不是步骤"
        />
      </View>

      <AppButton label="保存" fullWidth loading={saving} onPress={() => void onSave()} />
      <AppText
        variant="caption"
        chrome
        style={{ color: colors.textSecondary, textAlign: 'center' }}>
        保存需联网；失败不会留下本地假数据
      </AppText>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing['5xl'],
    paddingBottom: Spacing['6xl'],
    gap: Spacing['3xl'],
  },
  card: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing.lg,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  statusTile: {
    width: '48%',
    flexGrow: 1,
    minWidth: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
