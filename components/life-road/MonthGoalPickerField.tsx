/**
 * 项目「道路归属 · 月目标」：对齐 `我的道路-UI重构.html`
 * picker-field + 年/季分段 + 月目标底栏 Sheet。
 */
import {
  LIFE_ROAD_NODE_STATUS_LABELS,
  monthToQuarter,
  QUARTER_MONTHS,
  type LifeRoadNodeStatus,
} from '@/lib/life-road/life-road-node-model';
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
  selectedId: string | null;
  monthGoals: LifeRoadNodeRow[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (id: string | null) => void;
  /** 从道路「从此月建项目」预填时展示横幅 */
  prefillBanner?: string | null;
  /**
   * 兼容旧调用方色板；未传时走 life-road 令牌。
   * @deprecated 优先使用内置 ATELIER 色
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

function summarizeGoal(g: LifeRoadNodeRow): { title: string; sub: string; preview: string } {
  const month = g.month ?? 0;
  const year = g.calendar_year ?? currentCalendarYear();
  const q = g.quarter ?? (month ? monthToQuarter(month) : 1);
  const title = `${month} 月 · ${g.title}`;
  const sub = `${year} · Q${q} / ${statusLabel(g.status)}`;
  const preview = `挂载位置 · ${year} · Q${q} · ${month} 月\n月目标「${g.title}」 · ${statusLabel(g.status)}`;
  return { title, sub, preview };
}

export function MonthGoalPickerField({
  selectedId,
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
  const [draftId, setDraftId] = useState<string | null>(null);
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

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const summary = selected ? summarizeGoal(selected) : null;

  const open = () => {
    if (disabled || loading) return;
    const seed = selectedId ? byId.get(selectedId) : null;
    setDraftId(selectedId);
    setPickYear(seed?.calendar_year ?? currentCalendarYear());
    setPickQuarter(
      (seed?.quarter as 1 | 2 | 3 | 4 | undefined) ??
        (seed?.month != null ? monthToQuarter(seed.month) : monthToQuarter(new Date().getMonth() + 1)),
    );
    setModalVisible(true);
  };

  const monthsInQuarter = QUARTER_MONTHS[pickQuarter];

  const confirmLabel = useMemo(() => {
    if (!draftId) return '请选择月目标';
    const g = byId.get(draftId);
    if (!g?.month) return '请选择月目标';
    return `确定挂到 ${g.month} 月`;
  }, [byId, draftId]);

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
            道路归属 · 月目标
          </Text>
        </View>
        <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>可选</Text>
      </View>

      <Pressable
        onPress={open}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel="选择月目标"
        style={({ pressed }) => [
          styles.pickerField,
          {
            borderColor: selected ? 'rgba(61,107,88,0.28)' : lr.line,
            backgroundColor: selected
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
                selected
                  ? {
                      backgroundColor: lr.sage2,
                      borderColor: 'rgba(140,173,156,0.18)',
                    }
                  : {
                      backgroundColor: 'rgba(33,69,58,0.06)',
                      borderColor: 'transparent',
                    },
              ]}>
              <TreeIcon color={selected ? lr.pine : lr.muted} />
            </View>
            <View style={styles.pickerCopy}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: '600',
                  color: selected ? lr.ink2 : lr.ink3,
                }}
                numberOfLines={1}>
                {summary?.title ?? '未归属'}
              </Text>
              <Text
                style={[lifeRoadType.monoTiny, { color: lr.muted, marginTop: 3 }]}
                numberOfLines={1}>
                {summary?.sub ?? '点此选择年 · 季 · 月目标'}
              </Text>
            </View>
            {selectedId ? (
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
            一个月可以挂多个项目；项目跨月请直接手改归属。
          </Text>{' '}
          项目只挂在月目标下。
        </Text>
      </View>

      {summary ? (
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
              {selected?.calendar_year} · Q{selected?.quarter ?? (selected?.month != null ? monthToQuarter(selected.month) : '—')} ·{' '}
              {selected?.month} 月
            </Text>
            {'\n'}
            月目标「{selected?.title}」 · {selected ? statusLabel(selected.status) : ''}
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
                  挂到哪个月？
                </Text>
                <Text style={{ fontSize: 12, color: lr.muted, marginTop: 4, lineHeight: 17 }}>
                  按年 · 季 · 月选择月目标，一个项目只挂一个月。
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
                          setDraftId(null);
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
                          setDraftId(null);
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
                    /** 在路上 / 暂搁 / 已抵达可选；已放弃仅保留当前选中回显 */
                    const selectable = Boolean(
                      goal &&
                        (goal.status === 'on_track' ||
                          goal.status === 'paused' ||
                          goal.status === 'arrived' ||
                          (selectedId != null && goal.id === selectedId)),
                    );
                    const selectedRow = draftId != null && goal?.id === draftId;
                    return (
                      <Pressable
                        key={month}
                        disabled={!selectable}
                        onPress={() => {
                          if (goal) setDraftId(goal.id);
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
                              ? `${pickYear} · Q${pickQuarter} · ${statusLabel(goal.status)}`
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

              <View
                style={[
                  styles.sheetNote,
                  {
                    backgroundColor: 'rgba(243,227,199,0.28)',
                    borderColor: 'rgba(211,154,85,0.14)',
                  },
                ]}>
                <Text style={{ fontSize: 11, lineHeight: 17, color: '#7C6342' }}>
                  只可选择已有月目标的月份。若项目跨月，请分别在两个项目里手改归属。
                </Text>
              </View>

              {monthGoals.filter((g) => g.status === 'on_track' || g.status === 'paused')
                .length === 0 ? (
                <Text style={{ color: lr.muted, paddingVertical: 10, fontSize: 13 }}>
                  还没有月目标。请先在「我的道路」写下某月焦点。
                </Text>
              ) : null}
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
                disabled={!draftId}
                onPress={() => {
                  if (!draftId) return;
                  onChange(draftId);
                  setModalVisible(false);
                }}
                style={[
                  styles.sheetConfirm,
                  {
                    backgroundColor: lr.pine,
                    opacity: draftId ? 1 : 0.35,
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
    maxHeight: '74%',
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
