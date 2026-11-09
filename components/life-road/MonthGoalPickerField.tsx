/**
 * 项目「道路归属」：挂到月目标下的验收叶子（非直接挂月）。
 * 年/季分段 → 选月目标 → 选验收叶子。
 */
import {
  LIFE_ROAD_NODE_STATUS_LABELS,
  monthToQuarter,
  QUARTER_MONTHS,
  type LifeRoadNodeStatus,
} from '@/lib/life-road/life-road-node-model';
import {
  listAcceptanceLeaves,
  parseAcceptanceCriteria,
} from '@/lib/life-road/life-road-acceptance';
import {
  formatProjectRoadCaption,
  type ProjectRoadLinkSelection,
} from '@/lib/life-road/project-road-link';
import { currentCalendarYear } from '@/lib/life-road/life-road-limits';
import type { LifeRoadNodeRow } from '@/lib/repositories/life-road/life-road-node.types';
import {
  lifeRoadType,
  useLifeRoadTheme,
} from '@/constants/life-road-theme';
import { useWardrobeFonts } from '@/components/wardrobe/use-wardrobe-fonts';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

export type MonthGoalPickerFieldProps = {
  selectedMonthGoalId: string | null;
  selectedAcceptanceId: string | null;
  monthGoals: LifeRoadNodeRow[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (value: ProjectRoadLinkSelection | null) => void;
  /** 从道路「建项目」预填时展示横幅 */
  prefillBanner?: string | null;
  /**
   * @deprecated 兼容旧调用方色板
   */
  textColor?: string;
  outline?: string;
  placeholderColor?: string;
  primary?: string;
  surfaceLow?: string;
  surfaceLowest?: string;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function TreeIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3v18M12 7c-2.8 0-5 1.7-5 4.2 0 2.3 2 4 5 4s5-1.7 5-4C17 8.7 14.8 7 12 7zM12 15c-2.1 0-3.8 1.3-3.8 3.2 0 1.8 1.6 2.8 3.8 2.8s3.8-1 3.8-2.8C15.8 16.3 14.1 15 12 15z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ClearIcon({ color }: { color: string }) {
  return (
    <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 6l12 12M18 6L6 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function ChevronIcon({ color }: { color: string }) {
  return (
    <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 6l6 6-6 6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <Svg width={9} height={9} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5l4.5 4.5L19 7"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function InfoIcon({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z"
        stroke={color}
        strokeWidth={1.5}
      />
      <Path
        d="M12 10.5v5M12 7.5v.1"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function statusLabel(status: LifeRoadNodeStatus): string {
  return LIFE_ROAD_NODE_STATUS_LABELS[status] ?? status;
}

function goalBySlot(
  goals: LifeRoadNodeRow[],
  year: number,
  month: number,
): LifeRoadNodeRow | undefined {
  return goals.find(
    (g) =>
      g.calendar_year === year &&
      g.month === month &&
      (g.status === 'on_track' || g.status === 'paused' || g.status === 'arrived'),
  );
}

export function MonthGoalPickerField({
  selectedMonthGoalId,
  selectedAcceptanceId,
  monthGoals,
  loading = false,
  disabled = false,
  onChange,
  prefillBanner = null,
}: MonthGoalPickerFieldProps) {
  useWardrobeFonts();
  const { lr } = useLifeRoadTheme();
  const insets = useSafeAreaInsets();
  const [modalVisible, setModalVisible] = useState(false);
  const [draftMonthId, setDraftMonthId] = useState<string | null>(null);
  const [draftAcceptanceId, setDraftAcceptanceId] = useState<string | null>(null);
  const [pickYear, setPickYear] = useState(currentCalendarYear());
  const [pickQuarter, setPickQuarter] = useState<1 | 2 | 3 | 4>(
    monthToQuarter(new Date().getMonth() + 1),
  );

  const byId = useMemo(
    () => new Map(monthGoals.map((g) => [g.id, g])),
    [monthGoals],
  );

  const years = useMemo(() => {
    const set = new Set<number>([currentCalendarYear(), currentCalendarYear() + 1]);
    for (const g of monthGoals) {
      if (g.calendar_year != null) set.add(g.calendar_year);
    }
    return [...set].sort((a, b) => b - a);
  }, [monthGoals]);

  const selectedMonth = selectedMonthGoalId
    ? byId.get(selectedMonthGoalId) ?? null
    : null;
  const selectedLeaves = selectedMonth
    ? listAcceptanceLeaves(parseAcceptanceCriteria(selectedMonth.extra_data))
    : [];
  const selectedLeaf =
    selectedAcceptanceId != null
      ? selectedLeaves.find((l) => l.id === selectedAcceptanceId) ?? null
      : null;

  const summaryTitle = selectedMonth
    ? formatProjectRoadCaption({
        month: selectedMonth.month,
        monthTitle: selectedMonth.title,
        acceptanceText: selectedLeaf?.text ?? null,
      })
    : null;
  const summarySub = selectedMonth
    ? selectedLeaf
      ? `${selectedMonth.calendar_year} · Q${
          selectedMonth.quarter ??
          (selectedMonth.month != null ? monthToQuarter(selectedMonth.month) : '—')
        } · ${selectedMonth.title}`
      : '已选月目标，但缺少验收叶子'
    : '点此选择年 · 季 · 月 · 验收';

  const draftMonth = draftMonthId ? byId.get(draftMonthId) ?? null : null;
  const draftLeaves = draftMonth
    ? listAcceptanceLeaves(parseAcceptanceCriteria(draftMonth.extra_data))
    : [];

  const open = () => {
    if (disabled || loading) return;
    const seed = selectedMonthGoalId ? byId.get(selectedMonthGoalId) : null;
    setDraftMonthId(selectedMonthGoalId);
    setDraftAcceptanceId(selectedAcceptanceId);
    setPickYear(seed?.calendar_year ?? currentCalendarYear());
    setPickQuarter(
      (seed?.quarter as 1 | 2 | 3 | 4 | undefined) ??
        (seed?.month != null
          ? monthToQuarter(seed.month)
          : monthToQuarter(new Date().getMonth() + 1)),
    );
    setModalVisible(true);
  };

  const monthsInQuarter = QUARTER_MONTHS[pickQuarter];

  const canConfirm = Boolean(draftMonthId && draftAcceptanceId);
  const confirmLabel = useMemo(() => {
    if (!draftMonthId) return '请选择月目标';
    if (!draftAcceptanceId) return '请选择验收节点';
    const g = byId.get(draftMonthId);
    const leaf = draftLeaves.find((l) => l.id === draftAcceptanceId);
    if (!g?.month || !leaf) return '请选择验收节点';
    return `确定挂到「${leaf.text}」`;
  }, [byId, draftAcceptanceId, draftLeaves, draftMonthId]);

  return (
    <View>
      {prefillBanner ? (
        <View
          style={[
            styles.prefill,
            {
              borderColor: 'rgba(61,107,88,0.16)',
              backgroundColor: 'rgba(220,231,223,0.4)',
            },
          ]}>
          <CheckIcon color="#41604F" />
          <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: '#41604F' }}>
            {prefillBanner}
          </Text>
        </View>
      ) : null}

      <View style={styles.fieldHead}>
        <View style={styles.fieldLabel}>
          <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>03</Text>
          <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}>
            道路归属 · 验收节点
          </Text>
        </View>
        <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>可选</Text>
      </View>

      <Pressable
        onPress={open}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel="选择道路归属验收节点"
        style={({ pressed }) => [
          styles.pickerField,
          {
            borderColor: selectedLeaf ? 'rgba(61,107,88,0.28)' : lr.line,
            backgroundColor: selectedLeaf
              ? 'rgba(240,245,240,0.85)'
              : 'rgba(255,253,247,0.86)',
            opacity: disabled ? 0.55 : pressed ? 0.92 : 1,
          },
        ]}>
        {loading ? (
          <ActivityIndicator size="small" color={lr.pine} />
        ) : (
          <>
            <View
              style={[
                styles.pickerIco,
                selectedLeaf
                  ? {
                      backgroundColor: lr.sage2,
                      borderColor: 'rgba(140,173,156,0.18)',
                    }
                  : {
                      backgroundColor: 'rgba(33,69,58,0.06)',
                      borderColor: 'transparent',
                    },
              ]}>
              <TreeIcon color={selectedLeaf ? lr.pine : lr.muted} />
            </View>
            <View style={styles.pickerCopy}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: '600',
                  color: selectedLeaf ? lr.ink2 : lr.ink3,
                }}
                numberOfLines={1}>
                {summaryTitle ?? '未归属'}
              </Text>
              <Text
                style={[lifeRoadType.monoTiny, { color: lr.muted, marginTop: 3 }]}
                numberOfLines={1}>
                {summarySub}
              </Text>
            </View>
            {selectedMonthGoalId || selectedAcceptanceId ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onChange(null);
                }}
                hitSlop={8}
                accessibilityLabel="清除归属"
                style={[styles.clearBtn, { backgroundColor: 'rgba(33,69,58,0.05)' }]}>
                <ClearIcon color={lr.muted} />
              </Pressable>
            ) : null}
            <View style={styles.chevWrap}>
              <ChevronIcon color={lr.muted2} />
            </View>
          </>
        )}
      </Pressable>

      <View style={styles.pickerNote}>
        <InfoIcon color={lr.muted2} />
        <Text style={{ flex: 1, fontSize: 11, lineHeight: 17, color: lr.muted }}>
          <Text style={{ fontWeight: '600', color: lr.ink3 }}>
            项目挂在月目标的验收叶子上，不直接挂月。
          </Text>{' '}
          一条验收可挂多个项目。
        </Text>
      </View>

      {selectedMonth && selectedLeaf ? (
        <View
          style={[
            styles.pickerPreview,
            {
              borderColor: lr.line2,
              backgroundColor: 'rgba(252,249,241,0.4)',
            },
          ]}>
          <Text style={{ fontSize: 11, lineHeight: 17, color: lr.muted }}>
            挂载位置 ·{' '}
            <Text style={{ fontWeight: '600', color: lr.ink3 }}>
              {selectedMonth.calendar_year} · Q
              {selectedMonth.quarter ??
                (selectedMonth.month != null
                  ? monthToQuarter(selectedMonth.month)
                  : '—')}{' '}
              · {selectedMonth.month} 月
            </Text>
            {'\n'}
            月目标「{selectedMonth.title}」· 验收「{selectedLeaf.text}」·{' '}
            {statusLabel(selectedMonth.status)}
          </Text>
        </View>
      ) : null}

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setModalVisible(false)} />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: lr.card,
                paddingBottom: Math.max(insets.bottom, 14),
              },
            ]}>
            <View style={[styles.handle, { backgroundColor: lr.line2 }]} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[lifeRoadType.kickerTiny, { color: lr.clay }]}>
                  ATTACH · 道路归属
                </Text>
                <Text style={[lifeRoadType.serifEmpty, { color: lr.ink, marginTop: 4 }]}>
                  挂到哪条验收？
                </Text>
                <Text style={{ fontSize: 12, color: lr.muted, marginTop: 4, lineHeight: 17 }}>
                  先选月目标，再选该月下的验收叶子。
                </Text>
              </View>
              <Pressable
                onPress={() => setModalVisible(false)}
                style={[styles.sheetClose, { backgroundColor: 'rgba(33,69,58,0.06)' }]}
                accessibilityLabel="关闭">
                <ClearIcon color={lr.muted} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.sheetBody}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}>
              <View style={styles.pickerGroup}>
                <View style={styles.groupLabel}>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>YEAR</Text>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>年</Text>
                </View>
                <View
                  style={[
                    styles.segRow,
                    {
                      backgroundColor: 'rgba(33,69,58,0.055)',
                      borderColor: 'rgba(33,69,58,0.06)',
                    },
                  ]}>
                  {years.map((y) => {
                    const on = pickYear === y;
                    return (
                      <Pressable
                        key={y}
                        onPress={() => {
                          setPickYear(y);
                          setDraftMonthId(null);
                          setDraftAcceptanceId(null);
                        }}
                        style={[
                          styles.segOpt,
                          on && {
                            backgroundColor: lr.card2,
                            shadowColor: '#21453A',
                            shadowOpacity: 0.1,
                            shadowRadius: 4,
                            elevation: 1,
                          },
                        ]}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: on ? '600' : '400',
                            color: on ? lr.pine : lr.muted,
                          }}>
                          {y}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.pickerGroup}>
                <View style={styles.groupLabel}>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>QUARTER</Text>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>季</Text>
                </View>
                <View
                  style={[
                    styles.segRow,
                    {
                      backgroundColor: 'rgba(33,69,58,0.055)',
                      borderColor: 'rgba(33,69,58,0.06)',
                    },
                  ]}>
                  {([1, 2, 3, 4] as const).map((q) => {
                    const on = pickQuarter === q;
                    return (
                      <Pressable
                        key={q}
                        onPress={() => {
                          setPickQuarter(q);
                          setDraftMonthId(null);
                          setDraftAcceptanceId(null);
                        }}
                        style={[
                          styles.segOpt,
                          on && {
                            backgroundColor: lr.card2,
                            shadowColor: '#21453A',
                            shadowOpacity: 0.1,
                            shadowRadius: 4,
                            elevation: 1,
                          },
                        ]}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: on ? '600' : '400',
                            color: on ? lr.pine : lr.muted,
                          }}>
                          Q{q}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.pickerGroup}>
                <View style={styles.groupLabel}>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>MONTH GOAL</Text>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>月目标</Text>
                </View>
                <View style={styles.monthList}>
                  {monthsInQuarter.map((month) => {
                    const goal = goalBySlot(monthGoals, pickYear, month);
                    const selectable = Boolean(
                      goal &&
                        (goal.status === 'on_track' ||
                          goal.status === 'paused' ||
                          goal.status === 'arrived' ||
                          (selectedMonthGoalId != null && goal.id === selectedMonthGoalId)),
                    );
                    const selectedRow = draftMonthId != null && goal?.id === draftMonthId;
                    const leafCount = goal
                      ? listAcceptanceLeaves(parseAcceptanceCriteria(goal.extra_data)).length
                      : 0;
                    return (
                      <Pressable
                        key={month}
                        disabled={!selectable}
                        onPress={() => {
                          if (!goal) return;
                          setDraftMonthId(goal.id);
                          setDraftAcceptanceId(null);
                        }}
                        style={[
                          styles.monthRow,
                          {
                            borderColor: selectedRow
                              ? 'rgba(61,107,88,0.38)'
                              : lr.line,
                            backgroundColor: selectedRow
                              ? 'rgba(220,231,223,0.55)'
                              : 'rgba(255,255,255,0.35)',
                            opacity: selectable ? 1 : 0.42,
                          },
                        ]}>
                        <View
                          style={[
                            styles.monthIco,
                            selectedRow
                              ? { backgroundColor: lr.pine }
                              : { backgroundColor: 'rgba(33,69,58,0.055)' },
                          ]}>
                          <Text
                            style={[
                              lifeRoadType.monoTiny,
                              {
                                color: selectedRow ? lr.onRoad : lr.ink3,
                                fontWeight: '700',
                              },
                            ]}>
                            {pad2(month)}
                          </Text>
                        </View>
                        <View style={styles.monthCopy}>
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: '600',
                              color: lr.ink2,
                            }}
                            numberOfLines={1}>
                            {month} 月 · {goal?.title ?? '未写目标'}
                          </Text>
                          <Text
                            style={{ fontSize: 11, color: lr.muted, marginTop: 2 }}
                            numberOfLines={1}>
                            {goal
                              ? `${pickYear} · Q${pickQuarter} · 验收叶子 ${leafCount}`
                              : '该月还没有月目标，暂不可选'}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.monthCheck,
                            selectedRow
                              ? { backgroundColor: lr.pine, borderColor: lr.pine }
                              : { borderColor: lr.line2 },
                          ]}>
                          {selectedRow ? <CheckIcon color={lr.onRoad} /> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {draftMonth ? (
                <View style={styles.pickerGroup}>
                  <View style={styles.groupLabel}>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted }]}>
                      ACCEPTANCE
                    </Text>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                      验收叶子
                    </Text>
                  </View>
                  {draftLeaves.length === 0 ? (
                    <Text style={{ color: lr.muted, paddingVertical: 8, fontSize: 13 }}>
                      该月还没有验收叶子。请先在「我的道路」为月目标写验收（叶子节点）。
                    </Text>
                  ) : (
                    <View style={styles.monthList}>
                      {draftLeaves.map((leaf) => {
                        const on = draftAcceptanceId === leaf.id;
                        return (
                          <Pressable
                            key={leaf.id}
                            onPress={() => setDraftAcceptanceId(leaf.id)}
                            style={[
                              styles.monthRow,
                              {
                                borderColor: on
                                  ? 'rgba(61,107,88,0.38)'
                                  : lr.line,
                                backgroundColor: on
                                  ? 'rgba(220,231,223,0.55)'
                                  : 'rgba(255,255,255,0.35)',
                              },
                            ]}>
                            <View style={styles.monthCopy}>
                              <Text
                                style={{
                                  fontSize: 13,
                                  fontWeight: '600',
                                  color: lr.ink2,
                                }}
                                numberOfLines={2}>
                                {leaf.text}
                              </Text>
                              {leaf.done ? (
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: lr.muted,
                                    marginTop: 2,
                                  }}>
                                  已勾选
                                </Text>
                              ) : null}
                            </View>
                            <View
                              style={[
                                styles.monthCheck,
                                on
                                  ? { backgroundColor: lr.pine, borderColor: lr.pine }
                                  : { borderColor: lr.line2 },
                              ]}>
                              {on ? <CheckIcon color={lr.onRoad} /> : null}
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : null}

              <View
                style={[
                  styles.sheetNote,
                  {
                    backgroundColor: 'rgba(243,227,199,0.28)',
                    borderColor: 'rgba(211,154,85,0.14)',
                  },
                ]}>
                <Text style={{ fontSize: 11, lineHeight: 17, color: '#7C6342' }}>
                  只能挂到已有月目标下的验收叶子。跨月请手改归属。
                </Text>
              </View>
            </ScrollView>

            <View style={styles.sheetFoot}>
              <Pressable
                onPress={() => {
                  onChange(null);
                  setModalVisible(false);
                }}
                style={[
                  styles.sheetClear,
                  { borderColor: lr.line, backgroundColor: 'rgba(255,255,255,0.4)' },
                ]}>
                <Text style={{ fontSize: 12, color: lr.muted }}>清除归属</Text>
              </Pressable>
              <Pressable
                disabled={!canConfirm}
                onPress={() => {
                  if (!draftMonthId || !draftAcceptanceId) return;
                  onChange({
                    monthGoalId: draftMonthId,
                    acceptanceId: draftAcceptanceId,
                  });
                  setModalVisible(false);
                }}
                style={[
                  styles.sheetConfirm,
                  {
                    backgroundColor: lr.pine,
                    opacity: canConfirm ? 1 : 0.35,
                  },
                ]}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    letterSpacing: 0.5,
                    color: lr.onRoad,
                  }}>
                  {confirmLabel}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  prefill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  fieldLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pickerIco: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  pickerCopy: { flex: 1, minWidth: 0 },
  clearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevWrap: { marginLeft: 2 },
  pickerNote: {
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  pickerPreview: {
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,32,26,0.32)',
  },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.75)',
    borderBottomWidth: 0,
  },
  handle: {
    width: 34,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 8,
    opacity: 0.65,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
  },
  sheetClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: {
    paddingHorizontal: 18,
  },
  pickerGroup: { marginTop: 9 },
  groupLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  segRow: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segOpt: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 999,
    alignItems: 'center',
  },
  monthList: { gap: 4, marginTop: 2 },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  monthIco: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCopy: { flex: 1, minWidth: 0 },
  monthCheck: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetNote: {
    marginTop: 9,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sheetFoot: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 18,
    paddingTop: 9,
  },
  sheetClear: {
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetConfirm: {
    flex: 1,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
