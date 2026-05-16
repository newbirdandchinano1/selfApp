import { GoalDimensionFormFields } from '@/components/goal-dimension/GoalDimensionFormFields';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  createGoalDimension,
  deleteGoalDimension,
  listGoalDimensions,
} from '@/lib/repositories/goal-dimensions/goal-dimension';
import {
  DEFAULT_DIMENSION_PRIORITY,
  parseGoalDimensionExtra,
  priorityValueToLabel,
  priorityValueToSortOrder,
  sortOrderToPriorityValue,
  type DimensionPriorityValue,
} from '@/lib/repositories/goal-dimensions/goal-dimension-extra';
import type { GoalDimensionRow } from '@/lib/repositories/goal-dimensions/goal-dimension.types';
import {
  deleteVision,
  getVisionRowById,
  listVisions,
  parseVisionExtra,
  serializeVisionExtra,
  updateVision,
} from '@/lib/repositories/visions/vision';
import { visionRowToWallCard } from '@/lib/repositories/visions/vision-present';
import type { VisionWallCardModel } from '@/lib/visions-registry';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

type WallEntry = { id: string; card: VisionWallCardModel; dimensionId: string | null; dimensionName: string | null };

type WallSection = {
  key: string;
  title: string;
  entries: WallEntry[];
  dimRow?: GoalDimensionRow;
};

function formatStoredAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(Number(n.toFixed(6)));
}

const VisionCard = ({
  card,
  visionId,
  onOpenDetail,
  onAdjustAmount,
}: {
  card: VisionWallCardModel;
  visionId: string;
  onOpenDetail: () => void;
  onAdjustAmount: (visionId: string, deltaSign: -1 | 1, step: number) => void;
}) => {
  const showProgressAdjust = card.kind === 'progress' && card.wallAdjust;
  const showCountAdjust = card.kind === 'count' && card.wallAdjust;
  const showTargetAdjust = card.kind === 'target' && card.wallAdjust && !card.taskProgressOnly;

  return (
    <View style={styles.card}>
      <Image source={card.imageSource} style={styles.cardBgImg} contentFit="cover" transition={120} />

      {/* 用半透明遮罩模拟 HTML 里的渐变背景（避免再引入 LinearGradient 依赖） */}
      <View style={styles.cardOverlay} />

      <View style={styles.cardContent} pointerEvents="box-none">
        <Pressable onPress={onOpenDetail} style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
          {card.kind === 'progress' && (
            <>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <View style={styles.countRow}>
                <View style={{ gap: 4 }}>
                  <Text style={styles.countKicker}>{card.leftKicker}</Text>
                  <Text style={styles.countValue}>{card.leftValue}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.countKicker}>{card.rightKicker}</Text>
                  <Text style={styles.countValue}>{card.rightValue}</Text>
                </View>
              </View>
            </>
          )}

          {card.kind === 'count' && (
            <>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <View style={styles.countRow}>
                <View style={{ gap: 4 }}>
                  <Text style={styles.countKicker}>{card.leftKicker}</Text>
                  <Text style={styles.countValue}>{card.leftValue}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.countKicker}>{card.rightKicker}</Text>
                  <Text style={styles.countValue}>{card.rightValue}</Text>
                </View>
              </View>
            </>
          )}

          {card.kind === 'target' && (
            <>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <View style={{ gap: 10 }}>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.cardPercentText}>{card.percentText}</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.round(card.percent * 100)}%` },
                    ]}
                  />
                </View>
              </View>
            </>
          )}

          {card.kind === 'countdown' && (
            <>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <View style={styles.countRow}>
                <View style={{ gap: 4 }}>
                  <Text style={styles.countKicker}>
                    {card.countdownKind === 'countup' ? '记录日期' : '截止日期'}
                  </Text>
                  <Text style={styles.countValue}>{card.dateText}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {card.countdownKind === 'countup' ? null : (
                    <Text style={styles.countKicker}>剩余时间</Text>
                  )}
                  <Text style={styles.remainValue}>{card.remainText}</Text>
                </View>
              </View>
            </>
          )}
        </Pressable>

        {showProgressAdjust && card.wallAdjust ? (
          <View style={styles.adjustRow}>
            <Pressable
              onPress={() => onAdjustAmount(visionId, -1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, pressed && { opacity: 0.85 }]}
              accessibilityLabel="减少进度量"
            >
              <MaterialIcons name="remove" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.adjustHint}>步长 {card.wallAdjust.step}</Text>
            <Pressable
              onPress={() => onAdjustAmount(visionId, 1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, styles.adjustBtnPrimary, pressed && { opacity: 0.9 }]}
              accessibilityLabel="增加进度量"
            >
              <MaterialIcons name="add" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {showCountAdjust && card.wallAdjust ? (
          <View style={styles.adjustRow}>
            <Pressable
              onPress={() => onAdjustAmount(visionId, -1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, pressed && { opacity: 0.85 }]}
              accessibilityLabel="减少累计"
            >
              <MaterialIcons name="remove" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.adjustHint}>每次 {card.wallAdjust.step}</Text>
            <Pressable
              onPress={() => onAdjustAmount(visionId, 1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, styles.adjustBtnPrimary, pressed && { opacity: 0.9 }]}
              accessibilityLabel="增加累计"
            >
              <MaterialIcons name="add" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {showTargetAdjust && card.wallAdjust ? (
          <View style={styles.adjustRow}>
            <Pressable
              onPress={() => onAdjustAmount(visionId, -1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, pressed && { opacity: 0.85 }]}
              accessibilityLabel="减少当前量"
            >
              <MaterialIcons name="remove" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.adjustHint}>步长 {card.wallAdjust.step}</Text>
            <Pressable
              onPress={() => onAdjustAmount(visionId, 1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, styles.adjustBtnPrimary, pressed && { opacity: 0.9 }]}
              accessibilityLabel="增加当前量"
            >
              <MaterialIcons name="add" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
};

export default function VisionWallScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const [wallEntries, setWallEntries] = useState<WallEntry[]>([]);
  const [goalDimensions, setGoalDimensions] = useState<GoalDimensionRow[]>([]);
  const [newDimModalVisible, setNewDimModalVisible] = useState(false);
  const [newDimTitle, setNewDimTitle] = useState('');
  const [newDimPriority, setNewDimPriority] = useState<DimensionPriorityValue>(DEFAULT_DIMENSION_PRIORITY);
  const [newDimNote, setNewDimNote] = useState('');
  const [newDimBusy, setNewDimBusy] = useState(false);

  const resetNewDimForm = useCallback(() => {
    setNewDimTitle('');
    setNewDimPriority(DEFAULT_DIMENSION_PRIORITY);
    setNewDimNote('');
  }, []);

  const loadWallEntries = useCallback(async () => {
    try {
      const [rows, dims] = await Promise.all([listVisions(), listGoalDimensions()]);
      setGoalDimensions(dims);
      const dbEntries: WallEntry[] = await Promise.all(
        rows.map(async r => {
          const ex = parseVisionExtra(r.extra_data);
          const dimensionId =
            typeof ex?.dimensionId === 'string' && ex.dimensionId.trim() ? ex.dimensionId.trim() : null;
          const dimensionName =
            typeof ex?.dimensionName === 'string' && ex.dimensionName.trim() ? ex.dimensionName.trim() : null;
          return {
            id: r.id,
            card: await visionRowToWallCard(r),
            dimensionId,
            dimensionName,
          };
        }),
      );
      setWallEntries(dbEntries);
    } catch {
      setWallEntries([]);
      setGoalDimensions([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadWallEntries();
    }, [loadWallEntries]),
  );

  const onAdjustVisionAmount = useCallback(
    async (visionId: string, deltaSign: -1 | 1, step: number) => {
      const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
      try {
        const row = await getVisionRowById(visionId);
        if (!row) return;
        const extra = parseVisionExtra(row.extra_data) ?? {};
        const cur = Number(extra.currentAmount ?? 0);
        const next = Math.max(0, cur + deltaSign * safeStep);
        extra.currentAmount = formatStoredAmount(next);
        await updateVision(visionId, { extra_data: serializeVisionExtra(extra) });
        await loadWallEntries();
      } catch {
        Alert.alert('更新失败', '无法保存累计值，请重试。');
      }
    },
    [loadWallEntries],
  );

  const requestDeleteVision = useCallback((entry: WallEntry) => {
    Alert.alert('删除总目标', '确定删除这条总目标吗？删除后将从总目标墙与我的页移除；在同步或恢复功能前可能无法找回。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteVision(entry.id);
              setWallEntries(prev => prev.filter(e => e.id !== entry.id));
            } catch {
              Alert.alert('删除失败', '无法删除本地数据，请稍后重试。');
            }
          })();
        },
      },
    ]);
  }, []);

  const requestDeleteDimension = useCallback((dimensionId: string, title: string) => {
    Alert.alert(
      '删除维度',
      `确定删除维度「${title}」吗？该维度下的总目标不会删除，将显示在「其他维度」分组中。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteGoalDimension(dimensionId);
                await loadWallEntries();
              } catch {
                Alert.alert('删除失败', '无法删除该维度，请稍后重试。');
              }
            })();
          },
        },
      ],
    );
  }, [loadWallEntries]);

  const wallSections = useMemo(() => {
    const byDim = new Map<string, WallEntry[]>();
    const unassigned: WallEntry[] = [];
    for (const e of wallEntries) {
      if (e.dimensionId) {
        const arr = byDim.get(e.dimensionId) ?? [];
        arr.push(e);
        byDim.set(e.dimensionId, arr);
      } else {
        unassigned.push(e);
      }
    }
    const out: WallSection[] = [];
    const consumed = new Set<string>();
    for (const d of goalDimensions) {
      out.push({ key: d.id, title: d.title, entries: byDim.get(d.id) ?? [], dimRow: d });
      consumed.add(d.id);
    }
    for (const [kid, entries] of byDim) {
      if (consumed.has(kid)) continue;
      const title = entries[0]?.dimensionName?.trim() || '其他维度';
      out.push({ key: kid, title, entries });
    }
    if (unassigned.length > 0) {
      out.push({ key: '_ungrouped', title: '未归类（旧数据）', entries: unassigned });
    }
    return out;
  }, [wallEntries, goalDimensions]);

  const confirmCreateDimension = useCallback(async () => {
    const t = newDimTitle.trim();
    if (!t) {
      Alert.alert('提示', '请填写维度名称');
      return;
    }
    const noteTrim = newDimNote.trim();
    setNewDimBusy(true);
    try {
      const id = `gd_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
      await createGoalDimension({
        id,
        title: t,
        sort_order: priorityValueToSortOrder(newDimPriority),
        extra: noteTrim ? { note: noteTrim } : null,
      });
      await loadWallEntries();
      setNewDimModalVisible(false);
      resetNewDimForm();
    } catch {
      Alert.alert('保存失败', '无法创建维度，请稍后重试。');
    } finally {
      setNewDimBusy(false);
    }
  }, [loadWallEntries, newDimNote, newDimPriority, newDimTitle, resetNewDimForm]);

  return (
    <>
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? 'rgba(15,23,42,0.95)' : theme.background }]}>
        <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.85)' }]}>
          <View style={styles.headerTitleWrap} pointerEvents="none">
            <Text
              style={[styles.headerTitle, { color: isDark ? 'rgba(248,250,252,0.95)' : 'rgba(15,23,42,0.95)' }]}
              numberOfLines={1}
            >
              总目标墙
            </Text>
          </View>
          <View style={styles.headerBar}>
            <View style={styles.headerLeading}>
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
              >
                <MaterialIcons
                  name="arrow-back"
                  size={22}
                  color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'}
                />
              </Pressable>
            </View>
            <View style={styles.headerSpacer} />
            <View style={styles.headerTrailing} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={{ marginTop: 8, marginBottom: 16 }}>
            <Text style={[styles.kicker, { color: isDark ? 'rgba(148,163,184,0.95)' : 'rgba(114,119,133,0.95)' }]}>
              Life Manifesto
            </Text>
            <Text style={[styles.heroTitle, { color: theme.text }]}>未来的数字索引</Text>
            <Text style={[styles.heroDesc, { color: theme.text }]}>
              先建立维度（如财富、健康、事业、技能），再在维度下创建可量化的总目标，追踪通向终点的每一步。
            </Text>
          </View>

          <Pressable
            onPress={() => {
              resetNewDimForm();
              setNewDimModalVisible(true);
            }}
            style={({ pressed }) => [styles.newDimRowBtn, pressed && { opacity: 0.88 }]}
          >
            <MaterialIcons name="folder-special" size={20} color="#0058be" />
            <Text style={styles.newDimRowBtnText}>新建维度</Text>
            <MaterialIcons name="chevron-right" size={20} color="rgba(114,119,133,0.55)" style={{ marginLeft: 'auto' }} />
          </Pressable>

          <View style={styles.dimensionList}>
            {goalDimensions.length === 0 && wallEntries.length === 0 ? (
              <View style={{ paddingVertical: 28, paddingHorizontal: 12, alignItems: 'center' }}>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '600',
                    color: isDark ? 'rgba(148,163,184,0.9)' : 'rgba(114,119,133,0.9)',
                    textAlign: 'center',
                    lineHeight: 22,
                  }}
                >
                  暂无维度与总目标。请先点「新建维度」创建财富、健康等分类，再在各维度下添加总目标。
                </Text>
              </View>
            ) : (
              wallSections.map(section => {
                const isLegacy = section.key === '_ungrouped';
                const count = section.entries.length;
                const dimNote = section.dimRow
                  ? parseGoalDimensionExtra(section.dimRow.extra_data)?.note?.trim() ?? ''
                  : '';
                const priorityLabel = section.dimRow
                  ? priorityValueToLabel(sortOrderToPriorityValue(section.dimRow.sort_order))
                  : null;
                const panelBorder = isLegacy
                  ? isDark
                    ? 'rgba(251,191,36,0.32)'
                    : 'rgba(245,158,11,0.42)'
                  : isDark
                    ? 'rgba(148,163,184,0.18)'
                    : 'rgba(15,23,42,0.08)';
                const panelBg = isDark ? 'rgba(30,41,59,0.78)' : 'rgba(255,255,255,0.98)';
                const iosShadow =
                  Platform.OS === 'ios'
                    ? {
                        shadowColor: '#0f172a',
                        shadowOffset: { width: 0, height: 10 },
                        shadowOpacity: isDark ? 0.45 : 0.08,
                        shadowRadius: isDark ? 16 : 20,
                      }
                    : {};
                const androidElev = Platform.OS === 'android' ? (isDark ? 4 : 5) : 0;
                const isDeletableDimension = goalDimensions.some(d => d.id === section.key);

                const dimensionPanelView = (
                  <View
                    style={[
                      styles.dimensionPanel,
                      { backgroundColor: panelBg, borderColor: panelBorder },
                      iosShadow,
                      androidElev > 0 ? { elevation: androidElev } : null,
                    ]}
                  >
                    <View style={styles.dimensionHeader}>
                      <View style={styles.dimensionHeaderTop}>
                        <View style={styles.dimensionAccentBar} />
                        <View style={styles.dimensionHeaderTextCol}>
                          <View style={styles.dimensionTitleRow}>
                            <Text
                              style={[
                                styles.dimensionSectionTitle,
                                { color: isDark ? 'rgba(248,250,252,0.96)' : 'rgba(15,23,42,0.94)' },
                              ]}
                              numberOfLines={1}
                            >
                              {section.title}
                            </Text>
                            {isLegacy ? (
                              <View
                                style={[
                                  styles.legacyTag,
                                  {
                                    borderColor: isDark ? 'rgba(251,191,36,0.45)' : 'rgba(245,158,11,0.55)',
                                    backgroundColor: isDark ? 'rgba(251,191,36,0.12)' : 'rgba(245,158,11,0.12)',
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.legacyTagText,
                                    { color: isDark ? 'rgba(253,230,138,0.95)' : 'rgba(180,83,9,0.95)' },
                                  ]}
                                >
                                  旧数据
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <View style={styles.dimensionMetaRow}>
                            {priorityLabel ? (
                              <View
                                style={[
                                  styles.dimensionPriorityBadge,
                                  {
                                    borderColor: isDark ? 'rgba(96,165,250,0.45)' : 'rgba(0,88,190,0.35)',
                                    backgroundColor: isDark ? 'rgba(96,165,250,0.14)' : 'rgba(0,88,190,0.08)',
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.dimensionPriorityBadgeText,
                                    { color: isDark ? '#93c5fd' : '#0058be' },
                                  ]}
                                >
                                  {priorityLabel}
                                </Text>
                              </View>
                            ) : null}
                            <Text
                              style={[
                                styles.dimensionSubtitle,
                                {
                                  color: isDark ? 'rgba(148,163,184,0.88)' : 'rgba(114,119,133,0.88)',
                                },
                              ]}
                            >
                              {count > 0 ? `共 ${count} 个总目标` : '该维度下还没有总目标'}
                            </Text>
                          </View>
                          {dimNote ? (
                            <Text
                              style={[
                                styles.dimensionNote,
                                { color: isDark ? 'rgba(148,163,184,0.78)' : 'rgba(114,119,133,0.82)' },
                              ]}
                              numberOfLines={2}
                            >
                              {dimNote}
                            </Text>
                          ) : null}
                        </View>
                        <Pressable
                          onPress={() => {
                            if (section.key === '_ungrouped') {
                              router.push('/vision-create');
                            } else {
                              router.push({ pathname: '/vision-create', params: { dimensionId: section.key } });
                            }
                          }}
                          style={({ pressed }) => [styles.sectionAddBtn, pressed && { opacity: 0.85 }]}
                        >
                          <MaterialIcons name="add" size={17} color="#0058be" />
                          <Text style={styles.sectionAddBtnText}>添加</Text>
                        </Pressable>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.dimensionDivider,
                        {
                          backgroundColor: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.06)',
                        },
                      ]}
                    />

                    <View style={styles.dimensionBody}>
                      {count === 0 ? (
                        <View
                          style={[
                            styles.dimensionEmptyPlate,
                            {
                              borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(114,119,133,0.22)',
                              backgroundColor: isDark ? 'rgba(15,23,42,0.35)' : 'rgba(248,250,252,0.65)',
                            },
                          ]}
                        >
                          <MaterialIcons
                            name="track-changes"
                            size={24}
                            color={isDark ? 'rgba(148,163,184,0.55)' : 'rgba(114,119,133,0.5)'}
                          />
                          <Text
                            style={[
                              styles.dimensionEmptyText,
                              { color: isDark ? 'rgba(148,163,184,0.82)' : 'rgba(114,119,133,0.82)' },
                            ]}
                          >
                            点击右侧「添加」，创建该维度下的第一条总目标
                          </Text>
                        </View>
                      ) : (
                        section.entries.map(entry => (
                          <Swipeable
                            key={entry.id}
                            overshootRight={false}
                            rightThreshold={48}
                            renderRightActions={() => (
                              <Pressable
                                onPress={() => requestDeleteVision(entry)}
                                style={({ pressed }) => [styles.swipeDeleteAction, pressed && { opacity: 0.92 }]}
                                accessibilityRole="button"
                                accessibilityLabel={`删除总目标 ${entry.card.title}`}
                              >
                                <MaterialIcons name="delete-outline" size={24} color="#fff" />
                                <Text style={styles.swipeDeleteText}>删除</Text>
                              </Pressable>
                            )}
                          >
                            <VisionCard
                              card={entry.card}
                              visionId={entry.id}
                              onOpenDetail={() =>
                                router.push({ pathname: '/vision-detail/[id]', params: { id: entry.id } })
                              }
                              onAdjustAmount={onAdjustVisionAmount}
                            />
                          </Swipeable>
                        ))
                      )}
                    </View>
                  </View>
                );

                return isDeletableDimension ? (
                  <View key={section.key} style={styles.dimensionSwipeWrap}>
                    <Swipeable
                      overshootRight={false}
                      friction={2}
                      rightThreshold={40}
                      containerStyle={styles.dimensionSwipeContainer}
                      renderRightActions={() => (
                        <View style={styles.swipeDimensionTrack}>
                          <Pressable
                            onPress={() =>
                              router.push({ pathname: '/edit-goal-dimension/[id]', params: { id: section.key } })
                            }
                            style={({ pressed }) => [
                              styles.swipeDimensionEdit,
                              pressed && { opacity: 0.92 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`编辑维度 ${section.title}`}
                          >
                            <MaterialIcons name="edit" size={22} color="#fff" />
                            <Text style={styles.swipeDeleteText}>编辑</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => requestDeleteDimension(section.key, section.title)}
                            style={({ pressed }) => [
                              styles.swipeDimensionDelete,
                              pressed && { opacity: 0.92 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`删除维度 ${section.title}`}
                          >
                            <MaterialIcons name="delete-outline" size={22} color="#fff" />
                            <Text style={styles.swipeDeleteText}>删除</Text>
                          </Pressable>
                        </View>
                      )}
                    >
                      {dimensionPanelView}
                    </Swipeable>
                  </View>
                ) : (
                  <View key={section.key}>{dimensionPanelView}</View>
                );
              })
            )}
          </View>

          <Text style={[styles.footerText, { color: isDark ? 'rgba(226,232,240,0.45)' : 'rgba(114,119,133,0.45)' }]}>
            The Quantified Life • © 2024
          </Text>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={newDimModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => !newDimBusy && setNewDimModalVisible(false)}
      >
        <View style={styles.dimModalRoot}>
          <Pressable style={styles.dimModalBackdrop} onPress={() => !newDimBusy && setNewDimModalVisible(false)} />
          <View
            style={[
              styles.dimModalCard,
              {
                backgroundColor: isDark ? 'rgba(30,41,59,0.98)' : '#fff',
                borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.5)',
              },
            ]}
          >
            <Text style={[styles.dimModalTitle, { color: theme.text }]}>新建维度</Text>
            <ScrollView
              style={styles.dimModalScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <GoalDimensionFormFields
                compact
                title={newDimTitle}
                onTitleChange={setNewDimTitle}
                priority={newDimPriority}
                onPriorityChange={setNewDimPriority}
                note={newDimNote}
                onNoteChange={setNewDimNote}
                disabled={newDimBusy}
                textColor={theme.text}
                outlineColor={isDark ? 'rgba(148,163,184,0.9)' : 'rgba(114,119,133,0.88)'}
                primaryColor="#0058be"
                borderSoft={isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.45)'}
                inputBg={isDark ? 'rgba(15,23,42,0.55)' : 'rgba(234,237,255,0.9)'}
                isDark={isDark}
              />
            </ScrollView>
            <View style={styles.dimModalActions}>
              <Pressable
                onPress={() => !newDimBusy && setNewDimModalVisible(false)}
                style={[
                  styles.dimModalBtnGhost,
                  { borderColor: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(194,198,214,0.65)' },
                ]}
              >
                <Text style={[styles.dimModalBtnGhostText, { color: isDark ? 'rgba(148,163,184,0.95)' : 'rgba(114,119,133,0.9)' }]}>
                  取消
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void confirmCreateDimension()}
                disabled={newDimBusy}
                style={[styles.dimModalBtnPrimary, { opacity: newDimBusy ? 0.65 : 1 }]}
              >
                {newDimBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.dimModalBtnPrimaryText}>创建</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    paddingHorizontal: 12,
    position: 'relative',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.15)',
  },
  headerTitleWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 56,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
  },
  headerLeading: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSpacer: {
    flex: 1,
  },
  headerTrailing: {
    width: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },

  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 30,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  heroDesc: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.75,
    lineHeight: 20,
  },

  newDimRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(0,88,190,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,88,190,0.18)',
  },
  newDimRowBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0058be',
    letterSpacing: -0.2,
  },

  dimensionList: {
    gap: 20,
    marginTop: 12,
  },
  dimensionSwipeWrap: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  dimensionSwipeContainer: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  dimensionPanel: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dimensionHeader: {
    paddingTop: 4,
  },
  dimensionHeaderTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    gap: 12,
  },
  dimensionAccentBar: {
    width: 4,
    marginTop: 5,
    minHeight: 36,
    borderRadius: 2,
    backgroundColor: '#0058be',
  },
  dimensionHeaderTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  dimensionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  dimensionSectionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.35,
  },
  legacyTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  legacyTagText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  dimensionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  dimensionPriorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  dimensionPriorityBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  dimensionSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  dimensionNote: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 4,
  },
  dimensionDivider: {
    height: StyleSheet.hairlineWidth * 2,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
  },
  dimensionBody: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 14,
  },
  dimensionEmptyPlate: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  dimensionEmptyText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 19,
  },

  sectionAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(0,88,190,0.1)',
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  sectionAddBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0058be',
  },

  dimModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  dimModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  dimModalCard: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '88%',
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
  },
  dimModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
  },
  dimModalScroll: {
    maxHeight: 420,
  },
  dimModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
    paddingTop: 4,
  },
  dimModalBtnGhost: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  dimModalBtnGhostText: {
    fontSize: 14,
    fontWeight: '700',
  },
  dimModalBtnPrimary: {
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#0058be',
  },
  dimModalBtnPrimaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },

  card: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    aspectRatio: 16 / 10,
    position: 'relative',
  },
  cardBgImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  cardOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(19,27,46,0.55)',
  },
  cardContent: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
    gap: 10,
  },
  adjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  adjustBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  adjustBtnPrimary: {
    backgroundColor: '#0058be',
    borderColor: 'rgba(255,255,255,0.25)',
  },
  adjustHint: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 6,
  },
  cardRowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardMeta: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '700',
  },
  cardPercentText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  progressTrack: {
    height: 6,
    width: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#0058be',
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  countKicker: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  countValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  remainValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.2,
  },

  footerText: {
    marginTop: 22,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.95,
    letterSpacing: 0.4,
  },

  swipeDeleteAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    borderRadius: 20,
    marginLeft: 10,
    marginVertical: 2,
    gap: 4,
  },
  /** 维度左滑：固定宽度操作条，贴右侧露出，避免把卡片顶出屏幕 */
  swipeDimensionTrack: {
    width: 148,
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'stretch',
  },
  swipeDimensionEdit: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0058be',
    gap: 4,
  },
  swipeDimensionDelete: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    gap: 4,
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
});

