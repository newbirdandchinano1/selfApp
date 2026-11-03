/**
 * 项目表单「挂到哪个月目标」：单选可清除；按年 · 季 · 月分组。
 */
import {
  LIFE_ROAD_NODE_STATUS_LABELS,
  monthLabel,
  quarterLabel,
} from '@/lib/life-road/life-road-node-model';
import type { LifeRoadNodeRow } from '@/lib/repositories/life-road/life-road-node.types';
import { MaterialIcons } from '@expo/vector-icons';
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

export type MonthGoalPickerFieldProps = {
  selectedId: string | null;
  monthGoals: LifeRoadNodeRow[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (id: string | null) => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
};

type Selectable = LifeRoadNodeRow & { arrivedOnly?: boolean };

function buildSelectable(
  goals: LifeRoadNodeRow[],
  selectedId: string | null,
): Selectable[] {
  const active = goals.filter((g) => g.status === 'on_track' || g.status === 'paused');
  const byId = new Map(active.map((g) => [g.id, g as Selectable]));
  if (selectedId) {
    const current = goals.find((g) => g.id === selectedId);
    if (current && !byId.has(current.id)) {
      byId.set(current.id, {
        ...current,
        arrivedOnly: current.status === 'arrived' || current.status === 'dropped',
      });
    }
  }
  return [...byId.values()].sort((a, b) => {
    if ((a.calendar_year ?? 0) !== (b.calendar_year ?? 0)) {
      return (b.calendar_year ?? 0) - (a.calendar_year ?? 0);
    }
    return (a.month ?? 0) - (b.month ?? 0);
  });
}

function goalCaption(g: LifeRoadNodeRow): string {
  const y = g.calendar_year ?? '';
  const m = g.month != null ? monthLabel(g.month) : '';
  const q = g.quarter != null ? quarterLabel(g.quarter) : '';
  return `${y} ${q} · ${m}`.trim();
}

export function MonthGoalPickerField({
  selectedId,
  monthGoals,
  loading = false,
  disabled = false,
  onChange,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
}: MonthGoalPickerFieldProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);

  const selectable = useMemo(
    () => buildSelectable(monthGoals, selectedId),
    [monthGoals, selectedId],
  );

  const nameById = useMemo(
    () => new Map(monthGoals.map((g) => [g.id, g])),
    [monthGoals],
  );

  const selectedSummary = useMemo(() => {
    if (!selectedId) return '未归属';
    const g = nameById.get(selectedId);
    if (!g) return '未知月目标';
    if (g.status === 'arrived') return `${g.title}（已抵达）`;
    if (g.status === 'dropped') return `${g.title}（已放弃）`;
    return `${g.title} · ${goalCaption(g)}`;
  }, [nameById, selectedId]);

  const grouped = useMemo(() => {
    const map = new Map<string, Selectable[]>();
    for (const g of selectable) {
      const key = String(g.calendar_year ?? '—');
      const list = map.get(key) ?? [];
      list.push(g);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
  }, [selectable]);

  const open = () => {
    if (disabled || loading) return;
    setDraftId(selectedId);
    setModalVisible(true);
  };

  return (
    <>
      <Pressable
        onPress={open}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel="选择月目标"
        style={[styles.field, { borderColor: outline, backgroundColor: surfaceLowest }]}>
        {loading ? (
          <ActivityIndicator size="small" color={primary} />
        ) : (
          <>
            <Text
              style={[
                styles.fieldTxt,
                { color: selectedId ? textColor : placeholderColor },
              ]}
              numberOfLines={1}>
              {selectedSummary}
            </Text>
            <MaterialIcons name="expand-more" size={18} color={placeholderColor} />
          </>
        )}
      </Pressable>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModalVisible(false)} />
        <View style={[styles.sheet, { backgroundColor: surfaceLowest }]}>
          <Text style={[styles.sheetTitle, { color: textColor }]}>挂到月目标</Text>
          <Text style={[styles.sheetHint, { color: placeholderColor }]}>
            一条月目标可挂多个项目；跨月请改挂到当前推进月
          </Text>
          <ScrollView style={styles.list}>
            <Pressable
              onPress={() => setDraftId(null)}
              style={[
                styles.row,
                {
                  backgroundColor: draftId == null ? surfaceLow : 'transparent',
                  borderColor: outline,
                },
              ]}>
              <Text style={{ color: textColor, fontWeight: '600' }}>不归属</Text>
            </Pressable>
            {grouped.map(([year, items]) => (
              <View key={year} style={styles.group}>
                <Text style={[styles.groupLab, { color: placeholderColor }]}>{year} 年</Text>
                {items.map((g) => {
                  const selected = draftId === g.id;
                  return (
                    <Pressable
                      key={g.id}
                      onPress={() => setDraftId(g.id)}
                      style={[
                        styles.row,
                        {
                          backgroundColor: selected ? surfaceLow : 'transparent',
                          borderColor: outline,
                        },
                      ]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: textColor, fontWeight: '700' }} numberOfLines={1}>
                          {g.title}
                        </Text>
                        <Text style={{ color: placeholderColor, fontSize: 11, marginTop: 2 }}>
                          {goalCaption(g)}
                          {g.arrivedOnly
                            ? ` · ${LIFE_ROAD_NODE_STATUS_LABELS[g.status]}`
                            : ''}
                        </Text>
                      </View>
                      {selected ? (
                        <MaterialIcons name="check" size={18} color={primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {selectable.length === 0 ? (
              <Text style={{ color: placeholderColor, padding: 12, fontSize: 13 }}>
                还没有月目标。请先在「我的道路」写下某月焦点。
              </Text>
            ) : null}
          </ScrollView>
          <View style={styles.sheetActs}>
            <Pressable
              onPress={() => setModalVisible(false)}
              style={[styles.actBtn, { borderColor: outline }]}>
              <Text style={{ color: textColor }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onChange(draftId);
                setModalVisible(false);
              }}
              style={[styles.actBtn, { backgroundColor: primary, borderColor: primary }]}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>确定</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldTxt: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 14,
    paddingBottom: 18,
    paddingHorizontal: 14,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  sheetHint: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 10,
  },
  list: {
    maxHeight: 360,
  },
  group: {
    marginBottom: 10,
  },
  groupLab: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 4,
    marginTop: 4,
  },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetActs: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  actBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
