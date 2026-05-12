import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createQuickAddItemMap, loadAllQuickAddItems, type QuickAddCardItem } from '@/lib/quick-add-cards';
import { deleteHealthRecord, getHealthRecordById } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type IntakeMetric = 'hydration' | 'protein' | 'carbohydrate' | 'sodium';

const HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY = 'ai_text_intake';

const METRIC_ORDER: IntakeMetric[] = ['hydration', 'protein', 'carbohydrate', 'sodium'];

const METRIC_META: Record<
  IntakeMetric,
  {
    label: string;
    unit: 'ml' | 'g' | 'mg';
    icon: keyof typeof MaterialIcons.glyphMap;
    color: string;
    bgLight: string;
    bgDark: string;
  }
> = {
  hydration: {
    label: '水分',
    unit: 'ml',
    icon: 'water-drop',
    color: '#10b981',
    bgLight: 'rgba(16,185,129,0.12)',
    bgDark: 'rgba(6,78,59,0.32)',
  },
  protein: {
    label: '蛋白质',
    unit: 'g',
    icon: 'restaurant',
    color: '#f59e0b',
    bgLight: 'rgba(245,158,11,0.14)',
    bgDark: 'rgba(120,53,15,0.32)',
  },
  carbohydrate: {
    label: '碳水',
    unit: 'g',
    icon: 'rice-bowl',
    color: '#eab308',
    bgLight: 'rgba(234,179,8,0.14)',
    bgDark: 'rgba(113,63,18,0.32)',
  },
  sodium: {
    label: '钠',
    unit: 'mg',
    icon: 'science',
    color: '#a855f7',
    bgLight: 'rgba(168,85,247,0.14)',
    bgDark: 'rgba(88,28,135,0.32)',
  },
};

function formatIntakeAmount(value: number, unit: 'ml' | 'g' | 'mg'): string {
  const formatted = Number(value.toFixed(2)).toString();
  return `${formatted}${unit}`;
}

function formatRecordTime(createdAt: string): string {
  const normalized = createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatYmdChinese(ymd: string): string {
  const [y, m, day] = ymd.split('-').map((x) => Number(x));
  if (!y || !m || !day) return ymd;
  return `${y}年${m}月${day}日`;
}

function getAmount(row: HealthRecordRow, metric: IntakeMetric): number {
  if (metric === 'hydration') return row.hydration;
  if (metric === 'protein') return row.protein;
  if (metric === 'carbohydrate') return row.carbohydrate;
  return row.sodium;
}

function getTarget(row: HealthRecordRow, metric: IntakeMetric): number {
  if (metric === 'hydration') return row.target_hydration;
  if (metric === 'protein') return row.target_protein;
  if (metric === 'carbohydrate') return row.target_carbohydrate;
  return row.target_sodium;
}

function parseMetricParam(raw: string | string[] | undefined): IntakeMetric | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'hydration' || v === 'protein' || v === 'carbohydrate' || v === 'sodium') return v;
  return null;
}

function resolveFocusMetric(row: HealthRecordRow, requested: IntakeMetric | null): IntakeMetric {
  if (requested && getAmount(row, requested) > 0) return requested;
  for (const m of METRIC_ORDER) {
    if (getAmount(row, m) > 0) return m;
  }
  return 'hydration';
}

function percentOfTarget(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function sourceLabel(row: HealthRecordRow, catalog: QuickAddCardItem[]): string {
  const img = row.source_image_uri?.trim();
  if (img) return 'AI 拍照识别';
  if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) return 'AI 文字记录';
  if (!row.quick_add_key) {
    const hasMulti =
      [row.hydration > 0, row.protein > 0, row.carbohydrate > 0, row.sodium > 0].filter(Boolean).length > 1;
    if (hasMulti && row.hydration === 0) return '拍照 / 合并记录';
    return '手动或其它方式';
  }
  const map = createQuickAddItemMap(catalog);
  return map.get(row.quick_add_key)?.label ?? `快捷项 ${row.quick_add_key}`;
}

export default function IntakeRecordDetailScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { recordId: recordIdParam, date: dateParam, metric: metricParam } = useLocalSearchParams<{
    recordId?: string;
    date?: string;
    metric?: string;
  }>();

  const recordId = Array.isArray(recordIdParam) ? recordIdParam[0] : recordIdParam;
  const dateYmd = Array.isArray(dateParam) ? dateParam[0] : dateParam;

  const [loading, setLoading] = React.useState(true);
  const [row, setRow] = React.useState<HealthRecordRow | null>(null);
  const [forbidden, setForbidden] = React.useState(false);
  const [catalog, setCatalog] = React.useState<QuickAddCardItem[]>([]);
  const [focusMetric, setFocusMetric] = React.useState<IntakeMetric>('hydration');
  const [deleting, setDeleting] = React.useState(false);
  const [imageLoadError, setImageLoadError] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!recordId?.trim()) {
      setRow(null);
      setForbidden(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [user, items, rec] = await Promise.all([
        getDefaultUser(),
        loadAllQuickAddItems(),
        getHealthRecordById(recordId.trim()),
      ]);
      setCatalog(items);
      if (!rec || !user?.id || rec.user_id !== user.id) {
        setRow(null);
        setForbidden(Boolean(rec && user?.id && rec.user_id !== user.id));
        setLoading(false);
        return;
      }
      if (dateYmd && rec.record_date !== dateYmd) {
        /* 仍展示记录，仅日期 param 用于返回上下文 */
      }
      setRow(rec);
      setFocusMetric(resolveFocusMetric(rec, parseMetricParam(metricParam)));
      setImageLoadError(false);
    } catch {
      setRow(null);
      setForbidden(false);
    } finally {
      setLoading(false);
    }
  }, [recordId, dateYmd, metricParam]);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load])
  );

  const meta = METRIC_META[focusMetric];
  const focusCurrent = row ? getAmount(row, focusMetric) : 0;
  const focusTarget = row ? getTarget(row, focusMetric) : 0;
  const focusPct = percentOfTarget(focusCurrent, focusTarget);
  const intakePhotoUri = row?.source_image_uri?.trim() ?? '';

  const otherMetrics = React.useMemo(() => {
    if (!row) return [] as { metric: IntakeMetric; amount: number }[];
    const out: { metric: IntakeMetric; amount: number }[] = [];
    for (const m of METRIC_ORDER) {
      if (m === focusMetric) continue;
      const a = getAmount(row, m);
      if (a > 0) out.push({ metric: m, amount: a });
    }
    return out;
  }, [row, focusMetric]);

  const onDelete = () => {
    if (!recordId || deleting) return;
    Alert.alert('删除记录', '确定删除整条摄入记录吗？同一条中的水分、蛋白质等会一并删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteHealthRecord(recordId.trim());
            router.back();
          } catch {
            Alert.alert('删除失败', '请稍后重试');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const border = isDark ? 'rgba(148,163,184,0.14)' : '#e2e8f0';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(248, 250, 252, 0.92)',
            borderBottomColor: border,
          },
        ]}
      >
        <Pressable style={styles.headerIcon} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>摄入详情</Text>
        <View style={styles.headerIcon} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : !row ? (
        <View style={styles.centered}>
          <MaterialIcons name="search-off" size={48} color={theme.textSecondary} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>
            {forbidden ? '无权查看该记录' : '记录不存在或已删除'}
          </Text>
          <Text style={[styles.emptySub, { color: theme.textSecondary }]}>请返回上一页刷新列表</Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.ghostBtn, { borderColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={[styles.ghostBtnText, { color: theme.primary }]}>返回</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>摄入附图</Text>
            <View style={[styles.photoCard, { backgroundColor: theme.surface, borderColor: border }]}>
              {intakePhotoUri && !imageLoadError ? (
                <Image
                  source={{ uri: intakePhotoUri }}
                  style={styles.photoImage}
                  contentFit="cover"
                  transition={200}
                  onError={() => setImageLoadError(true)}
                />
              ) : (
                <View
                  style={[
                    styles.photoPlaceholder,
                    {
                      backgroundColor: isDark ? 'rgba(30,41,59,0.5)' : '#f1f5f9',
                      borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.35)',
                    },
                  ]}
                >
                  <MaterialIcons
                    name={intakePhotoUri && imageLoadError ? 'error-outline' : 'photo-camera'}
                    size={40}
                    color={theme.textSecondary}
                  />
                  <Text style={[styles.photoPlaceholderTitle, { color: theme.text }]}>
                    {intakePhotoUri && imageLoadError ? '图片无法加载' : '暂无照片'}
                  </Text>
                  <Text style={[styles.photoPlaceholderSub, { color: theme.textSecondary }]}>
                    {intakePhotoUri && imageLoadError
                      ? '文件可能已移动或损坏，可删除本条后重新拍照记录'
                      : 'AI 拍照识别保存的记录会在此展示食物照片；手动与快捷添加通常无附图'}
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View style={[styles.hero, { backgroundColor: theme.surface, borderColor: border }]}>
            <View style={[styles.heroAccent, { backgroundColor: meta.color }]} />
            <View style={styles.heroTop}>
              <View style={[styles.heroIcon, { backgroundColor: isDark ? meta.bgDark : meta.bgLight }]}>
                <MaterialIcons name={meta.icon} size={28} color={meta.color} />
              </View>
              <View style={styles.heroTitles}>
                <Text style={[styles.heroLabel, { color: theme.textSecondary }]}>当前查看</Text>
                <Text style={[styles.heroName, { color: theme.text }]}>{meta.label}</Text>
              </View>
            </View>
            <Text style={[styles.heroAmount, { color: theme.text }]}>{formatIntakeAmount(focusCurrent, meta.unit)}</Text>
            <View style={styles.heroTargetRow}>
              <Text style={[styles.heroTargetText, { color: theme.textSecondary }]}>
                当日目标参考 {formatIntakeAmount(focusTarget, meta.unit)}
              </Text>
              <View style={[styles.pctPill, { backgroundColor: `${meta.color}18` }]}>
                <Text style={[styles.pctPillText, { color: meta.color }]}>{focusPct}%</Text>
              </View>
            </View>
            <View style={[styles.track, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.2)' }]}>
              <View style={[styles.trackFill, { width: `${focusPct}%`, backgroundColor: meta.color }]} />
            </View>
          </View>

          {otherMetrics.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>同条记录 · 其它维度</Text>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: border }]}>
                {otherMetrics.map(({ metric, amount }, index) => {
                  const m = METRIC_META[metric];
                  const t = getTarget(row, metric);
                  const pct = percentOfTarget(amount, t);
                  return (
                    <Pressable
                      key={metric}
                      onPress={() => setFocusMetric(metric)}
                      style={({ pressed }) => [
                        styles.otherRow,
                        pressed && { opacity: 0.88 },
                        index < otherMetrics.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: border,
                        },
                      ]}
                    >
                      <View style={[styles.otherIcon, { backgroundColor: isDark ? m.bgDark : m.bgLight }]}>
                        <MaterialIcons name={m.icon} size={20} color={m.color} />
                      </View>
                      <View style={styles.otherMid}>
                        <Text style={[styles.otherLabel, { color: theme.text }]}>{m.label}</Text>
                        <Text style={[styles.otherSub, { color: theme.textSecondary }]}>
                          目标 {formatIntakeAmount(t, m.unit)} · 约 {pct}%
                        </Text>
                      </View>
                      <Text style={[styles.otherAmount, { color: theme.text }]}>{formatIntakeAmount(amount, m.unit)}</Text>
                      <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.hint, { color: theme.textSecondary }]}>点击一行可切换上方主展示维度</Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>记录信息</Text>
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: border }]}>
              {row.intake_display_title?.trim() ? (
                <View style={styles.kvRow}>
                  <Text style={[styles.kvKey, { color: theme.textSecondary }]}>记录名称</Text>
                  <Text style={[styles.kvVal, { color: theme.text, flex: 1, textAlign: 'right' }]} numberOfLines={4}>
                    {row.intake_display_title.trim()}
                  </Text>
                </View>
              ) : null}
              {row.intake_display_title?.trim() ? (
                <View style={[styles.kvRow, styles.kvDivider, { borderTopColor: border }]}>
                  <Text style={[styles.kvKey, { color: theme.textSecondary }]}>记录日期</Text>
                  <Text style={[styles.kvVal, { color: theme.text }]}>{formatYmdChinese(row.record_date)}</Text>
                </View>
              ) : (
                <View style={styles.kvRow}>
                  <Text style={[styles.kvKey, { color: theme.textSecondary }]}>记录日期</Text>
                  <Text style={[styles.kvVal, { color: theme.text }]}>{formatYmdChinese(row.record_date)}</Text>
                </View>
              )}
              <View style={[styles.kvRow, styles.kvDivider, { borderTopColor: border }]}>
                <Text style={[styles.kvKey, { color: theme.textSecondary }]}>记录时间</Text>
                <Text style={[styles.kvVal, { color: theme.text }]}>{formatRecordTime(row.created_at)}</Text>
              </View>
              <View style={[styles.kvRow, styles.kvDivider, { borderTopColor: border }]}>
                <Text style={[styles.kvKey, { color: theme.textSecondary }]}>来源</Text>
                <Text style={[styles.kvVal, { color: theme.text, flex: 1, textAlign: 'right' }]} numberOfLines={2}>
                  {sourceLabel(row, catalog)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>备注与评价</Text>
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: border, paddingVertical: 14, paddingHorizontal: 16 }]}>
              <Text style={[styles.noteBody, { color: theme.textSecondary }]}>备注：暂无备注</Text>
              <Text style={[styles.noteLabel, { color: theme.text, marginTop: 12 }]}>AI 评价</Text>
              <Text style={[styles.noteBody, { color: row.intake_ai_comment?.trim() ? theme.text : theme.textSecondary, marginTop: 6 }]}>
                {row.intake_ai_comment?.trim() || '暂无，模型未返回点评或旧版记录无此字段。'}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={onDelete}
            disabled={deleting}
            style={({ pressed }) => [
              styles.deleteBtn,
              {
                borderColor: 'rgba(239,68,68,0.45)',
                opacity: deleting || pressed ? 0.72 : 1,
              },
            ]}
          >
            <MaterialIcons name="delete-outline" size={22} color="#ef4444" />
            <Text style={styles.deleteText}>{deleting ? '删除中…' : '删除整条记录'}</Text>
          </Pressable>

          <View style={{ height: 28 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  emptySub: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
  ghostBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  ghostBtnText: { fontSize: 15, fontWeight: '800' },
  scroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12 },
  photoCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    minHeight: 200,
  },
  photoImage: { width: '100%', height: 220 },
  photoPlaceholder: {
    minHeight: 200,
    paddingHorizontal: 22,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 18,
    margin: 10,
    gap: 8,
  },
  photoPlaceholderTitle: { fontSize: 16, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  photoPlaceholderSub: { fontSize: 13, fontWeight: '500', lineHeight: 20, textAlign: 'center' },
  hero: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    overflow: 'hidden',
    marginBottom: 22,
  },
  heroAccent: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 4,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitles: { flex: 1 },
  heroLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  heroName: { fontSize: 20, fontWeight: '800' },
  heroAmount: { fontSize: 40, fontWeight: '900', letterSpacing: -1.2, marginBottom: 10 },
  heroTargetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  heroTargetText: { fontSize: 13, fontWeight: '600', flex: 1 },
  pctPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pctPillText: { fontSize: 12, fontWeight: '800' },
  track: { height: 8, borderRadius: 999, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 999 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginLeft: 2 },
  card: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  otherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  otherIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otherMid: { flex: 1, minWidth: 0 },
  otherLabel: { fontSize: 15, fontWeight: '700' },
  otherSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  otherAmount: { fontSize: 15, fontWeight: '800' },
  hint: { fontSize: 12, fontWeight: '500', marginTop: 8, marginLeft: 2, lineHeight: 18 },
  kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  kvDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  kvKey: { fontSize: 14, fontWeight: '600' },
  kvVal: { fontSize: 14, fontWeight: '700' },
  noteBody: { fontSize: 14, fontWeight: '500', lineHeight: 22 },
  noteLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  deleteBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    backgroundColor: 'rgba(239,68,68,0.06)',
  },
  deleteText: { fontSize: 16, fontWeight: '800', color: '#ef4444' },
});
