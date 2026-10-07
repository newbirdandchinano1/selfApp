/**
 * 项目表单「属于哪条道路」：单选可清除；选项为进行中赌注，按时间桶分组。
 * 当前已挂到「已抵达」时保留该项并标注；与「长期项目」开关互不影响。
 */
import {
  LIFE_BET_HORIZON_LABELS,
  LIFE_BET_STATUS_LABELS,
} from '@/lib/life-road/life-road-labels';
import type { LifeBetHorizon } from '@/lib/life-road/life-road-limits';
import type { LifeBetRow } from '@/lib/repositories/life-road/life-bet.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const HORIZON_ORDER: LifeBetHorizon[] = ['year', 'multi', 'farther'];

export type LifeBetPickerFieldProps = {
  selectedId: string | null;
  allBets: LifeBetRow[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (id: string | null) => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
  isDark: boolean;
};

type SelectableBet = LifeBetRow & { arrivedOnly?: boolean };

/**
 * 选择器候选：默认 on_track|paused；若当前已挂 arrived/dropped，则额外保留该项。
 */
function buildSelectableBets(allBets: LifeBetRow[], selectedId: string | null): SelectableBet[] {
  const active = allBets.filter((b) => b.status === 'on_track' || b.status === 'paused');
  const byId = new Map(active.map((b) => [b.id, b as SelectableBet]));
  if (selectedId) {
    const current = allBets.find((b) => b.id === selectedId);
    if (current && !byId.has(current.id)) {
      byId.set(current.id, {
        ...current,
        arrivedOnly: current.status === 'arrived' || current.status === 'dropped',
      });
    }
  }
  return [...byId.values()].sort((a, b) => {
    const hi = HORIZON_ORDER.indexOf(a.horizon) - HORIZON_ORDER.indexOf(b.horizon);
    if (hi !== 0) return hi;
    if ((a.year ?? 0) !== (b.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0);
    return a.sort_order - b.sort_order;
  });
}

export function LifeBetPickerField({
  selectedId,
  allBets,
  loading = false,
  disabled = false,
  onChange,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
  isDark,
}: LifeBetPickerFieldProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);

  const selectable = useMemo(
    () => buildSelectableBets(allBets, selectedId),
    [allBets, selectedId],
  );

  const nameById = useMemo(() => new Map(allBets.map((b) => [b.id, b])), [allBets]);

  const selectedSummary = useMemo(() => {
    if (!selectedId) return '未归属';
    const bet = nameById.get(selectedId);
    if (!bet) return '未知道路';
    const horizon = LIFE_BET_HORIZON_LABELS[bet.horizon];
    if (bet.status === 'arrived') return `${bet.title}（已抵达）`;
    if (bet.status === 'dropped') return `${bet.title}（已放弃）`;
    return `${bet.title} · ${horizon}`;
  }, [nameById, selectedId]);

  const grouped = useMemo(() => {
    const map: Record<LifeBetHorizon, SelectableBet[]> = {
      year: [],
      multi: [],
      farther: [],
    };
    for (const bet of selectable) {
      map[bet.horizon].push(bet);
    }
    return map;
  }, [selectable]);

  const openModal = useCallback(() => {
    if (disabled) return;
    setDraftId(selectedId);
    setModalVisible(true);
  }, [disabled, selectedId]);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setDraftId(null);
  }, []);

  const confirmModal = useCallback(() => {
    onChange(draftId);
    closeModal();
  }, [closeModal, draftId, onChange]);

  return (
    <>
      <Pressable
        onPress={openModal}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel="属于哪条道路"
        style={({ pressed }) => [
          styles.select,
          { backgroundColor: surfaceLow, borderColor: placeholderColor },
          (disabled || loading) && { opacity: 0.65 },
          pressed && !disabled && !loading && { opacity: 0.8 },
        ]}>
        <View style={styles.selectLeft}>
          <MaterialIcons name="explore" size={18} color={primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.selectValue, { color: textColor }]} numberOfLines={2}>
              {loading ? '加载道路列表…' : selectedSummary}
            </Text>
            <Text style={[styles.selectHint, { color: outline }]} numberOfLines={2}>
              可选。用来在「我的」里看到这件事属于哪条方向。
            </Text>
          </View>
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={primary} />
        ) : (
          <MaterialIcons name="expand-more" size={20} color={outline} />
        )}
      </Pressable>

      <Modal transparent visible={modalVisible} animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.modalOverlay} onPress={closeModal}>
          <Pressable
            onPress={() => {}}
            style={[styles.modalCard, { backgroundColor: surfaceLowest, borderColor: placeholderColor }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: textColor }]}>属于哪条道路</Text>
              <Pressable onPress={closeModal} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                <MaterialIcons name="close" size={22} color={outline} />
              </Pressable>
            </View>
            <Text style={[styles.modalDesc, { color: outline }]}>
              一条项目最多挂一条道路；不选也可保存。摘除后「我的」上该条可能显示空窗。
            </Text>

            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Pressable
                onPress={() => setDraftId(null)}
                style={({ pressed }) => [
                  styles.modalRow,
                  {
                    borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)',
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}>
                <MaterialIcons name="remove-circle-outline" size={22} color={outline} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.modalRowTitle, { color: textColor }]}>不归属道路</Text>
                  <Text style={[styles.modalRowSub, { color: outline }]}>收集箱、杂事可不挂</Text>
                </View>
                {draftId == null ? (
                  <MaterialIcons name="check-circle" size={22} color={primary} />
                ) : (
                  <MaterialIcons name="radio-button-unchecked" size={22} color={outline} />
                )}
              </Pressable>

              {selectable.length === 0 ? (
                <Text style={[styles.modalEmpty, { color: outline }]}>
                  暂无进行中的道路。可先在「我的 → 道路」添加赌注。
                </Text>
              ) : (
                HORIZON_ORDER.map((horizon) => {
                  const list = grouped[horizon];
                  if (list.length === 0) return null;
                  return (
                    <View key={horizon}>
                      <Text style={[styles.groupLabel, { color: outline }]}>
                        {LIFE_BET_HORIZON_LABELS[horizon]}
                      </Text>
                      {list.map((bet) => {
                        const picked = draftId === bet.id;
                        const statusExtra =
                          bet.arrivedOnly || bet.status === 'arrived'
                            ? '已抵达'
                            : bet.status === 'dropped'
                              ? '已放弃'
                              : bet.status === 'paused'
                                ? LIFE_BET_STATUS_LABELS.paused
                                : null;
                        return (
                          <Pressable
                            key={bet.id}
                            onPress={() => setDraftId(bet.id)}
                            style={({ pressed }) => [
                              styles.modalRow,
                              {
                                borderBottomColor: isDark
                                  ? 'rgba(148,163,184,0.18)'
                                  : 'rgba(194,198,214,0.35)',
                                opacity: pressed ? 0.88 : 1,
                              },
                            ]}>
                            <MaterialIcons name="flag" size={22} color={primary} />
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={[styles.modalRowTitle, { color: textColor }]} numberOfLines={2}>
                                {bet.title}
                              </Text>
                              {statusExtra ? (
                                <Text style={[styles.modalRowSub, { color: outline }]}>{statusExtra}</Text>
                              ) : bet.year != null && bet.horizon === 'year' ? (
                                <Text style={[styles.modalRowSub, { color: outline }]}>{bet.year}</Text>
                              ) : null}
                            </View>
                            {picked ? (
                              <MaterialIcons name="check-circle" size={22} color={primary} />
                            ) : (
                              <MaterialIcons name="radio-button-unchecked" size={22} color={outline} />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })
              )}
            </ScrollView>

            <Pressable
              onPress={confirmModal}
              style={({ pressed }) => [styles.confirmBtn, { backgroundColor: primary, opacity: pressed ? 0.9 : 1 }]}>
              <Text style={styles.confirmBtnText}>确定</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  select: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  selectLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1 },
  selectValue: { fontSize: 14, fontWeight: '700' },
  selectHint: { fontSize: 11, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.38)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: { borderWidth: 1, borderRadius: 16, padding: 14, maxHeight: '78%', gap: 8 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalDesc: { fontSize: 12, fontWeight: '600', lineHeight: 18, marginBottom: 4 },
  modalEmpty: { fontSize: 13, fontWeight: '600', paddingVertical: 24, textAlign: 'center' },
  modalList: { maxHeight: 360 },
  groupLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 2,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRowTitle: { fontSize: 14, fontWeight: '700' },
  modalRowSub: { fontSize: 11, fontWeight: '600' },
  confirmBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
