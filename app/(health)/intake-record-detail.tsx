import { HealthIntakeDeleteConfirmSheet } from '@/components/health/health-intake-delete-confirm-sheet';
import { HealthPopIn, HealthRiseIn, useHealthMotionGate } from '@/components/health/health-motion';
import { StoredImage } from '@/components/stored-image';
import { useHealthHomeTheme } from '@/constants/health-home-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { formatStoredDatetimeHm } from '@/lib/api-mysql-datetime';
import { compareDatetimeDesc } from '@/lib/api-read-helpers';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { formatYmd, parseYmd } from '@/lib/date';
import {
  createQuickAddItemMap,
  loadAllQuickAddItems,
  type QuickAddCardItem,
} from '@/lib/quick-add-cards';
import {
  DEFAULT_HEALTH_METRIC_POINTS_SETTINGS,
  isIntakeMetricRewardEligible,
  loadHealthMetricPointsSettings,
  type HealthMetricPointsSettings,
} from '@/lib/health-metric-points-settings';
import {
  deleteHealthRecord,
  getHealthRecordById,
  getHealthRecordsForUserOnDate,
} from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type IntakeMetric = 'hydration' | 'protein' | 'carbohydrate' | 'calories';

const HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY = 'ai_text_intake';
const PAGE_API_KEY = 'intake-record-detail';
const METRIC_ORDER: IntakeMetric[] = ['hydration', 'protein', 'carbohydrate', 'calories'];

function formatIntakeAmount(value: number, unit: 'ml' | 'g' | 'kcal'): string {
  const formatted = Number(value.toFixed(2)).toString();
  return `${formatted}${unit}`;
}

function formatLocaleNum(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

function getAmount(row: HealthRecordRow, metric: IntakeMetric): number {
  if (metric === 'hydration') return row.hydration;
  if (metric === 'protein') return row.protein;
  if (metric === 'carbohydrate') return row.carbohydrate;
  return row.calories;
}

function getTarget(row: HealthRecordRow, metric: IntakeMetric): number {
  if (metric === 'hydration') return row.target_hydration;
  if (metric === 'protein') return row.target_protein;
  if (metric === 'carbohydrate') return row.target_carbohydrate;
  return row.target_calories;
}

function parseMetricParam(raw: string | string[] | undefined): IntakeMetric | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'hydration' || v === 'protein' || v === 'carbohydrate' || v === 'calories') return v;
  if (v === 'sodium') return 'calories';
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
  return Math.round((current / target) * 100);
}

function sourceLabel(row: HealthRecordRow, catalog: QuickAddCardItem[]): string {
  if (row.source_image_uri?.trim()) return 'AI 拍照';
  if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) return 'AI 文本';
  if (!row.quick_add_key) {
    const hasMulti =
      [row.hydration > 0, row.protein > 0, row.carbohydrate > 0, row.calories > 0].filter(Boolean).length > 1;
    if (hasMulti && row.hydration === 0) return '拍照 / 合并';
    return '手动';
  }
  const map = createQuickAddItemMap(catalog);
  return map.get(row.quick_add_key)?.label ?? '快捷卡';
}

function sourceDetail(row: HealthRecordRow, catalog: QuickAddCardItem[]): string {
  const base = sourceLabel(row, catalog);
  if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) return `${base} · 原文已保留`;
  if (row.source_image_uri?.trim()) return `${base} · 来源图已保存`;
  if (row.intake_display_title?.trim()) return `${base} · 标题已保留`;
  return base;
}

function heroTitle(row: HealthRecordRow, catalog: QuickAddCardItem[]): string {
  const t = row.intake_display_title?.trim();
  if (t) return t;
  if (row.source_image_uri?.trim()) return 'AI 拍照识别';
  if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) return 'AI 文本记录';
  if (row.quick_add_key) {
    const map = createQuickAddItemMap(catalog);
    return map.get(row.quick_add_key)?.label ?? '摄入记录';
  }
  return '摄入记录';
}

function heroSubtitle(row: HealthRecordRow): string {
  const parts: string[] = [];
  if (row.protein > 0) parts.push(`蛋白 ${formatIntakeAmount(row.protein, 'g')}`);
  if (row.carbohydrate > 0) parts.push(`碳水 ${formatIntakeAmount(row.carbohydrate, 'g')}`);
  if (row.hydration > 0) parts.push(`水分 ${formatIntakeAmount(row.hydration, 'ml')}`);
  if (row.calories > 0) parts.push(`热量 ${formatIntakeAmount(row.calories, 'kcal')}`);
  return parts.join(' · ') || '暂无营养明细';
}

function heroKicker(row: HealthRecordRow): string {
  const kinds = [row.hydration > 0, row.protein > 0, row.carbohydrate > 0, row.calories > 0].filter(Boolean).length;
  if (row.source_image_uri?.trim()) return kinds > 1 ? `AI 拍照识别 · 合并 ${kinds} 项` : 'AI 拍照识别';
  if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) {
    return kinds > 1 ? `AI 文本记录 · 合并 ${kinds} 项` : 'AI 文本记录';
  }
  if (kinds > 1) return `摄入记录 · 合并 ${kinds} 项`;
  return '摄入记录';
}

function formatRecordDateTime(createdAt: string, recordDate: string): string {
  const ymd = recordDate.slice(0, 10);
  const d = parseYmd(ymd);
  const hm = formatStoredDatetimeHm(createdAt);
  if (!d) return `${ymd} ${hm}`;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day} ${hm}`;
}

function syncBadge(status: string | undefined): { label: string; tone: 'ok' | 'warn' } {
  const s = (status ?? '').toLowerCase();
  if (s === 'synced' || s === '') return { label: '已同步', tone: 'ok' };
  if (s.includes('pending')) return { label: '待同步', tone: 'warn' };
  return { label: status || '本地', tone: 'warn' };
}

function otherRecordPrimary(
  row: HealthRecordRow,
  nutrients: { hydration: string; protein: string; carbohydrate: string; calories: string },
): {
  title: string;
  meta: string;
  amount: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
} {
  const title = row.intake_display_title?.trim() || (row.source_image_uri?.trim() ? '拍照记录' : '摄入记录');
  const time = formatStoredDatetimeHm(row.created_at);
  if (row.hydration > 0 && row.protein <= 0 && row.carbohydrate <= 0 && row.calories <= 0) {
    return {
      title,
      meta: `${time} · 水分 ${formatIntakeAmount(row.hydration, 'ml')}`,
      amount: formatIntakeAmount(row.hydration, 'ml'),
      icon: 'water-drop',
      color: nutrients.hydration,
    };
  }
  if (row.protein > 0 && row.hydration <= 0 && row.carbohydrate <= 0 && row.calories <= 0) {
    return {
      title,
      meta: `${time} · 蛋白 ${formatIntakeAmount(row.protein, 'g')}`,
      amount: formatIntakeAmount(row.protein, 'g'),
      icon: 'restaurant',
      color: nutrients.protein,
    };
  }
  if (row.calories > 0) {
    return {
      title,
      meta: `${time} · 热量 ${Math.round(row.calories)} kcal`,
      amount: `${Math.round(row.calories)} kcal`,
      icon: 'local-fire-department',
      color: nutrients.calories,
    };
  }
  if (row.carbohydrate > 0) {
    return {
      title,
      meta: `${time} · 碳水 ${formatIntakeAmount(row.carbohydrate, 'g')}`,
      amount: formatIntakeAmount(row.carbohydrate, 'g'),
      icon: 'rice-bowl',
      color: nutrients.carbohydrate,
    };
  }
  return {
    title,
    meta: time,
    amount: '—',
    icon: 'restaurant',
    color: nutrients.protein,
  };
}

function estimatePointImpact(
  row: HealthRecordRow,
  settings: HealthMetricPointsSettings,
): { text: string; pointsLabel: string } | null {
  if (!settings.enabled || settings.rewardPoints === 0) {
    return { text: '积分规则未启用', pointsLabel: '0 分' };
  }
  const hits: string[] = [];
  let points = 0;
  for (const metric of ['hydration', 'protein', 'carbohydrate'] as const) {
    const pct = percentOfTarget(getAmount(row, metric), getTarget(row, metric));
    if (getAmount(row, metric) <= 0) continue;
    if (isIntakeMetricRewardEligible(pct, settings)) {
      const label = metric === 'hydration' ? '水分' : metric === 'protein' ? '蛋白' : '碳水';
      hits.push(`${label}达到 ${settings.thresholdPercent}% 阈值`);
      points += settings.rewardPoints;
    }
  }
  if (hits.length === 0) {
    return { text: '本条未触发达标加分', pointsLabel: '0 分' };
  }
  return {
    text: hits.slice(0, 2).join(' · '),
    pointsLabel: `+${points} 分`,
  };
}

export default function IntakeRecordDetailScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hh, nutrients, isDark } = useHealthHomeTheme();
  const { animate: entranceOn } = useHealthMotionGate();
  const { recordId: recordIdParam, date: dateParam, metric: metricParam } = useLocalSearchParams<{
    recordId?: string;
    date?: string;
    metric?: string;
  }>();

  const recordId = Array.isArray(recordIdParam) ? recordIdParam[0] : recordIdParam;
  const dateYmd = Array.isArray(dateParam) ? dateParam[0] : dateParam;

  const [loading, setLoading] = React.useState(true);
  const [row, setRow] = React.useState<HealthRecordRow | null>(null);
  const [sameDayRows, setSameDayRows] = React.useState<HealthRecordRow[]>([]);
  const [forbidden, setForbidden] = React.useState(false);
  const [catalog, setCatalog] = React.useState<QuickAddCardItem[]>([]);
  const [pointsSettings, setPointsSettings] = React.useState<HealthMetricPointsSettings>(
    DEFAULT_HEALTH_METRIC_POINTS_SETTINGS,
  );
  const [deleting, setDeleting] = React.useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = React.useState(false);
  const [imageLoadError, setImageLoadError] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [contentReady, setContentReady] = React.useState(false);
  const enterKeyRef = React.useRef<string | null>(null);

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      if (!recordId?.trim()) {
        setRow(null);
        setForbidden(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        await wrapLoad(async () => {
          const [user, items, rec, settings] = await Promise.all([
            getDefaultUser(),
            loadAllQuickAddItems(),
            getHealthRecordById(recordId.trim()),
            loadHealthMetricPointsSettings(),
          ]);
          setCatalog(items);
          setPointsSettings(settings);
          if (!rec || !user?.id || rec.user_id !== user.id) {
            setRow(null);
            setSameDayRows([]);
            setForbidden(Boolean(rec && user?.id && rec.user_id !== user.id));
            return;
          }
          setRow(rec);
          setImageLoadError(false);
          const ymd = dateYmd?.slice(0, 10) || rec.record_date.slice(0, 10);
          const dayRows = await getHealthRecordsForUserOnDate(user.id, ymd);
          setSameDayRows(
            dayRows
              .filter((r) => r.id !== rec.id)
              .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at)),
          );
          if (enterKeyRef.current !== rec.id) {
            enterKeyRef.current = rec.id;
            setContentReady(false);
            requestAnimationFrame(() => setContentReady(true));
          } else {
            setContentReady(true);
          }
        }, forceRefresh);
      } catch {
        setRow(null);
        setForbidden(false);
        setSameDayRows([]);
        setContentReady(false);
      } finally {
        setLoading(false);
      }
    },
    [recordId, dateYmd, wrapLoad],
  );

  const detailEnterOn = entranceOn && contentReady && Boolean(row);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const focusMetric = row ? resolveFocusMetric(row, parseMetricParam(metricParam)) : 'hydration';
  void focusMetric;

  const intakePhotoUri = row?.source_image_uri?.trim() ?? '';
  const pointImpact = row ? estimatePointImpact(row, pointsSettings) : null;
  const sync = syncBadge(row?.sync_status);

  const metricCells = React.useMemo(() => {
    if (!row) return [];
    return [
      {
        key: 'hydration' as const,
        label: '水分',
        value: `${formatLocaleNum(row.hydration)} ml`,
        color: nutrients.hydration,
      },
      {
        key: 'protein' as const,
        label: '蛋白',
        value: `${formatLocaleNum(row.protein)} g`,
        color: nutrients.protein,
      },
      {
        key: 'carbohydrate' as const,
        label: '碳水',
        value: `${formatLocaleNum(row.carbohydrate)} g`,
        color: nutrients.carbohydrate,
      },
      {
        key: 'calories' as const,
        label: '热量',
        value: `${formatLocaleNum(row.calories)} kcal`,
        color: nutrients.calories,
      },
    ];
  }, [row, nutrients]);

  const targetSnapshot = React.useMemo(() => {
    if (!row) return '';
    return [
      `${formatLocaleNum(row.target_hydration)} ml`,
      `${formatLocaleNum(row.target_protein)} g`,
      `${formatLocaleNum(row.target_carbohydrate)} g`,
      `${formatLocaleNum(row.target_calories)} kcal`,
    ].join(' · ');
  }, [row]);

  const openDeleteSheet = () => {
    if (!recordId || deleting || !row) return;
    setMenuOpen(false);
    setDeleteSheetOpen(true);
  };

  const performDelete = async () => {
    if (!recordId || deleting) return;
    setDeleting(true);
    try {
      await deleteHealthRecord(recordId.trim());
      setDeleteSheetOpen(false);
      toast.success('已删除');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '删除失败，请稍后重试'));
    } finally {
      setDeleting(false);
    }
  };

  const onEdit = () => {
    Alert.alert('编辑记录', '暂不支持直接改数值。可删除本条后重新添加，或在首页用快捷卡微调。', [
      { text: '知道了', style: 'cancel' },
      { text: '去删除', style: 'destructive', onPress: openDeleteSheet },
    ]);
  };

  const deletePreview = React.useMemo(() => {
    if (!row) return null;
    const labels: string[] = [];
    if (row.hydration > 0) labels.push('水分');
    if (row.protein > 0) labels.push('蛋白');
    if (row.carbohydrate > 0) labels.push('碳水');
    if (row.calories > 0) labels.push('热量');
    const merge =
      labels.length >= 2 ? `合并${labels.join(' / ')}` : labels.length === 1 ? labels[0]! : '摄入';
    const timeHm = formatStoredDatetimeHm(row.created_at);
    const custom = row.intake_display_title?.trim();
    const title = custom || (row.source_image_uri?.trim() ? 'AI 拍照识别' : '这条记录');
    const pointsDelta =
      pointsSettings.enabled && pointsSettings.rewardPoints > 0
        ? -Math.abs(pointsSettings.rewardPoints)
        : null;
    return {
      title,
      detail: timeHm ? `${timeHm} · ${merge}` : merge,
      icon: (row.source_image_uri?.trim() ? 'photo-camera' : 'restaurant') as keyof typeof MaterialIcons.glyphMap,
      iconColor: nutrients.protein,
      pointsDelta,
    };
  }, [row, pointsSettings.enabled, pointsSettings.rewardPoints, nutrients.protein]);

  const recordTimeHm = row ? formatStoredDatetimeHm(row.created_at) : '';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: hh.paper }]} edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: insets.top + 4, borderBottomColor: hh.line }]}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()} hitSlop={10} accessibilityLabel="返回">
          <MaterialIcons name="arrow-back" size={22} color={hh.ink} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: hh.ink }]}>摄入详情</Text>
          <Text style={[styles.headerSub, { color: hh.muted }]}>
            RECORD · {recordTimeHm || '—'}
          </Text>
        </View>
        <Pressable
          style={styles.headerBtn}
          onPress={() => setMenuOpen((v) => !v)}
          hitSlop={10}
          accessibilityLabel="更多">
          <MaterialIcons name="more-horiz" size={22} color={hh.ink} />
        </Pressable>
      </View>

      {menuOpen && row ? (
        <View style={[styles.menuPop, { backgroundColor: hh.card, borderColor: hh.line, shadowColor: hh.shadow }]}>
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onEdit();
            }}
            style={styles.menuItem}>
            <Text style={[styles.menuItemText, { color: hh.ink }]}>编辑</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              openDeleteSheet();
            }}
            style={styles.menuItem}>
            <Text style={[styles.menuItemText, { color: '#C45C4A' }]}>删除</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={hh.pine} />
        </View>
      ) : !row ? (
        <View style={styles.centered}>
          <MaterialIcons name="search-off" size={48} color={hh.faint} />
          <Text style={[styles.emptyTitle, { color: hh.ink }]}>
            {forbidden ? '无权查看该记录' : '记录不存在或已删除'}
          </Text>
          <Text style={[styles.emptySub, { color: hh.muted }]}>请返回上一页刷新列表</Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.ghostBtn,
              { borderColor: hh.pine, opacity: pressed ? 0.85 : 1 },
            ]}>
            <Text style={[styles.ghostBtnText, { color: hh.pine }]}>返回</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[styles.scroll, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => setMenuOpen(false)}>
          <HealthRiseIn animate={detailEnterOn} duration={420} fromY={14}>
            <View style={[styles.hero, { backgroundColor: hh.pine, shadowColor: hh.shadow }]}>
              <Text style={[styles.heroKicker, { color: hh.sage }]}>{heroKicker(row)}</Text>
              <Text style={[styles.heroTitle, { color: hh.onPine }]} numberOfLines={2}>
                {heroTitle(row, catalog)}
              </Text>
              <Text style={[styles.heroSub, { color: 'rgba(247,245,236,0.72)' }]} numberOfLines={3}>
                {heroSubtitle(row)}
              </Text>
              <View style={styles.metricGrid}>
                {metricCells.map((cell, cellIndex) => (
                  <HealthPopIn
                    key={cell.key}
                    animate={detailEnterOn}
                    index={cellIndex}
                    staggerMs={40}
                    delayMs={120}
                    duration={380}
                    style={styles.metricCellWrap}
                  >
                    <View
                      style={[
                        styles.metricCell,
                        { backgroundColor: isDark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.18)' },
                      ]}>
                      <Text style={[styles.metricLabel, { color: 'rgba(247,245,236,0.65)' }]}>{cell.label}</Text>
                      <Text style={[styles.metricValue, { color: hh.onPine }]}>{cell.value}</Text>
                    </View>
                  </HealthPopIn>
                ))}
              </View>
            </View>
          </HealthRiseIn>

          <HealthRiseIn animate={detailEnterOn} index={1} staggerMs={70} delayMs={180} duration={360}>
            <View style={[styles.aiStrip, { backgroundColor: hh.sageSoft, borderLeftColor: hh.sage }]}>
              <MaterialIcons name="eco" size={16} color={hh.pine} style={{ marginTop: 2 }} />
              <Text style={[styles.aiStripText, { color: hh.inkSoft }]}>
                AI 评价：
                {row.intake_ai_comment?.trim() ||
                  '暂无点评。模型未返回评价或旧版记录无此字段。'}
              </Text>
            </View>
          </HealthRiseIn>

          {intakePhotoUri ? (
            <View style={[styles.photoCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
              {!imageLoadError ? (
                <StoredImage
                  uri={intakePhotoUri}
                  style={styles.photoImage}
                  contentFit="cover"
                  onError={() => setImageLoadError(true)}
                />
              ) : (
                <View style={styles.photoFail}>
                  <MaterialIcons name="error-outline" size={28} color={hh.faint} />
                  <Text style={[styles.photoFailText, { color: hh.muted }]}>图片无法加载</Text>
                </View>
              )}
            </View>
          ) : null}

          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: hh.ink }]}>记录信息</Text>
            <Text style={[styles.sectionHint, { color: hh.faint }]}>本地 SQLite</Text>
          </View>

          <View style={[styles.infoCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
            <InfoRow
              icon="schedule"
              iconBg={hh.sageSoft}
              iconColor={hh.pine}
              title="记录时间"
              value={formatRecordDateTime(row.created_at, row.record_date)}
              badge={sync.label}
              badgeTone={sync.tone}
              hh={hh}
              divider
            />
            <InfoRow
              icon="auto-awesome"
              iconBg={`${nutrients.protein}22`}
              iconColor={nutrients.protein}
              title="来源"
              value={sourceDetail(row, catalog)}
              badge={row.intake_display_title?.trim() ? '原文' : sourceLabel(row, catalog)}
              badgeTone="ok"
              hh={hh}
              divider
            />
            <InfoRow
              icon="track-changes"
              iconBg={`${nutrients.hydration}22`}
              iconColor={nutrients.hydration}
              title="目标快照"
              value={targetSnapshot}
              badge="已锁定"
              badgeTone="ok"
              hh={hh}
              divider
            />
            <InfoRow
              icon="stars"
              iconBg={`${nutrients.carbohydrate}22`}
              iconColor={nutrients.carbohydrate}
              title="积分影响"
              value={pointImpact?.text ?? '—'}
              badge={pointImpact?.pointsLabel ?? '0 分'}
              badgeTone="points"
              hh={hh}
            />
          </View>

          <View style={styles.actionRow}>
            <Pressable
              onPress={onEdit}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  backgroundColor: hh.card,
                  borderColor: hh.line,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <MaterialIcons name="edit" size={18} color={hh.inkSoft} />
              <Text style={[styles.actionBtnText, { color: hh.inkSoft }]}>编辑</Text>
            </Pressable>
            <Pressable
              onPress={openDeleteSheet}
              disabled={deleting}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  backgroundColor: isDark ? 'rgba(196,92,74,0.16)' : 'rgba(196,92,74,0.1)',
                  borderColor: isDark ? 'rgba(196,92,74,0.35)' : 'rgba(196,92,74,0.28)',
                  opacity: deleting || pressed ? 0.75 : 1,
                },
              ]}>
              <MaterialIcons name="delete-outline" size={18} color="#C45C4A" />
              <Text style={[styles.actionBtnText, { color: '#C45C4A' }]}>
                {deleting ? '删除中…' : '删除'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: hh.ink }]}>同一天的其他记录</Text>
            <Text style={[styles.sectionHint, { color: hh.faint }]}>{sameDayRows.length} 条</Text>
          </View>

          {sameDayRows.length === 0 ? (
            <View style={[styles.emptyDay, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
              <Text style={[styles.emptyDayText, { color: hh.muted }]}>当天暂无其他记录</Text>
            </View>
          ) : (
            <View style={styles.sameDayList}>
              {sameDayRows.map((other) => {
                const item = otherRecordPrimary(other, nutrients);
                return (
                  <Pressable
                    key={other.id}
                    onPress={() =>
                      router.push({
                        pathname: '/intake-record-detail',
                        params: {
                          recordId: other.id,
                          date: other.record_date.slice(0, 10),
                        },
                      })
                    }
                    style={({ pressed }) => [
                      styles.sameDayRow,
                      {
                        backgroundColor: hh.card,
                        borderColor: hh.line,
                        opacity: pressed ? 0.9 : 1,
                      },
                    ]}>
                    <View style={[styles.sameDayIcon, { backgroundColor: `${item.color}22` }]}>
                      <MaterialIcons name={item.icon} size={18} color={item.color} />
                    </View>
                    <View style={styles.sameDayBody}>
                      <Text style={[styles.sameDayTitle, { color: hh.ink }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={[styles.sameDayMeta, { color: hh.muted }]} numberOfLines={1}>
                        {item.meta}
                      </Text>
                    </View>
                    <Text style={[styles.sameDayAmount, { color: hh.ink }]}>{item.amount}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.footerNote}>
            <MaterialIcons name="schedule" size={13} color={hh.faint} />
            <Text style={[styles.footerNoteText, { color: hh.faint }]}>
              历史百分比始终使用记录写入时的目标快照：修改全局目标不会回改这一天。
            </Text>
          </View>
        </ScrollView>
      )}

      <HealthIntakeDeleteConfirmSheet
        visible={deleteSheetOpen}
        preview={deletePreview}
        confirming={deleting}
        onClose={() => {
          if (deleting) return;
          setDeleteSheetOpen(false);
        }}
        onConfirm={() => {
          void performDelete();
        }}
      />
    </SafeAreaView>
  );
}

function InfoRow({
  icon,
  iconBg,
  iconColor,
  title,
  value,
  badge,
  badgeTone,
  hh,
  divider,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  iconBg: string;
  iconColor: string;
  title: string;
  value: string;
  badge: string;
  badgeTone: 'ok' | 'warn' | 'points';
  hh: ReturnType<typeof useHealthHomeTheme>['hh'];
  divider?: boolean;
}) {
  const badgeBg =
    badgeTone === 'points'
      ? 'rgba(196,120,82,0.18)'
      : badgeTone === 'warn'
        ? 'rgba(196,160,74,0.18)'
        : hh.sageSoft;
  const badgeFg =
    badgeTone === 'points' ? '#C47852' : badgeTone === 'warn' ? '#A8842E' : hh.pine;

  return (
    <View style={[styles.infoRow, divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: hh.line }]}>
      <View style={[styles.infoIcon, { backgroundColor: iconBg }]}>
        <MaterialIcons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.infoMid}>
        <Text style={[styles.infoTitle, { color: hh.muted }]}>{title}</Text>
        <Text style={[styles.infoValue, { color: hh.ink }]} numberOfLines={2}>
          {value}
        </Text>
      </View>
      <View style={[styles.badge, { backgroundColor: badgeBg }]}>
        <Text style={[styles.badgeText, { color: badgeFg }]}>{badge}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerSub: { marginTop: 2, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  menuPop: {
    position: 'absolute',
    right: 16,
    top: 88,
    zIndex: 20,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 6,
    minWidth: 120,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  menuItem: { paddingHorizontal: 16, paddingVertical: 12 },
  menuItemText: { fontSize: 14, fontWeight: '700' },
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
  scroll: { paddingHorizontal: 16, paddingTop: 16 },
  hero: {
    borderRadius: 22,
    padding: 18,
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  heroKicker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginBottom: 8 },
  heroTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4, lineHeight: 32 },
  heroSub: { marginTop: 8, fontSize: 13, fontWeight: '500', lineHeight: 20 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  metricCellWrap: { width: '48%', flexGrow: 1 },
  metricCell: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  metricLabel: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  metricValue: { fontSize: 15, fontWeight: '800' },
  aiStrip: {
    marginTop: 12,
    borderRadius: 14,
    borderLeftWidth: 3,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  aiStripText: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 20 },
  photoCard: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  photoImage: { width: '100%', height: 180 },
  photoFail: { height: 120, alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoFailText: { fontSize: 13, fontWeight: '600' },
  sectionHead: {
    marginTop: 22,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  sectionHint: { fontSize: 11, fontWeight: '600' },
  infoCard: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoMid: { flex: 1, minWidth: 0 },
  infoTitle: { fontSize: 11, fontWeight: '700', marginBottom: 3 },
  infoValue: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
  },
  actionBtnText: { fontSize: 15, fontWeight: '800' },
  emptyDay: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyDayText: { fontSize: 13, fontWeight: '600' },
  sameDayList: { gap: 8 },
  sameDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sameDayIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sameDayBody: { flex: 1, minWidth: 0 },
  sameDayTitle: { fontSize: 14, fontWeight: '800' },
  sameDayMeta: { marginTop: 2, fontSize: 11, fontWeight: '500' },
  sameDayAmount: { fontSize: 13, fontWeight: '800' },
  footerNote: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 2,
  },
  footerNoteText: { flex: 1, fontSize: 11, fontWeight: '500', lineHeight: 16 },
});
