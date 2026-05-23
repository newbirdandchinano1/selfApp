import type { CompletionReward } from '@/lib/completion-reward/completion-reward.types';
import { DEFAULT_COMPLETION_REWARD } from '@/lib/completion-reward/completion-reward.types';
import { formatCompletionRewardLabel } from '@/lib/completion-reward/completion-reward-extra';
import { listWishItems } from '@/lib/repositories/wish-list/wish-list';
import type { WishItemRow } from '@/lib/repositories/wish-list/wish-list.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type RewardMode = 'none' | 'wish' | 'custom';

type Props = {
  value: CompletionReward;
  onChange: (value: CompletionReward) => void;
  disabled?: boolean;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
  isDark: boolean;
};

function modeFromReward(reward: CompletionReward): RewardMode {
  if (reward.kind === 'wish') return 'wish';
  if (reward.kind === 'custom') return 'custom';
  return 'none';
}

export function CompletionRewardField({
  value,
  onChange,
  disabled = false,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
  isDark,
}: Props) {
  const [mode, setMode] = useState<RewardMode>(() => modeFromReward(value));
  const [customLabel, setCustomLabel] = useState(() => (value.kind === 'custom' ? value.label : ''));
  const [wishModalVisible, setWishModalVisible] = useState(false);
  const [wishItems, setWishItems] = useState<WishItemRow[]>([]);
  const [wishLoading, setWishLoading] = useState(false);

  useEffect(() => {
    setMode(modeFromReward(value));
    if (value.kind === 'custom') setCustomLabel(value.label);
  }, [value]);

  const wishNameById = useMemo(() => new Map(wishItems.map((w) => [w.id, w.name])), [wishItems]);
  const summary = formatCompletionRewardLabel(value, wishNameById) ?? '无';

  const loadWishItems = useCallback(async () => {
    setWishLoading(true);
    try {
      const rows = await listWishItems();
      setWishItems(rows);
    } catch {
      setWishItems([]);
    } finally {
      setWishLoading(false);
    }
  }, []);

  const openWishModal = useCallback(() => {
    if (disabled) return;
    void loadWishItems();
    setWishModalVisible(true);
  }, [disabled, loadWishItems]);

  const selectMode = useCallback(
    (next: RewardMode) => {
      if (disabled) return;
      setMode(next);
      if (next === 'none') {
        onChange(DEFAULT_COMPLETION_REWARD);
      } else if (next === 'custom') {
        onChange(customLabel.trim() ? { kind: 'custom', label: customLabel.trim() } : DEFAULT_COMPLETION_REWARD);
      } else if (next === 'wish' && value.kind === 'wish') {
        onChange(value);
      } else if (next === 'wish') {
        openWishModal();
      }
    },
    [customLabel, disabled, onChange, openWishModal, value],
  );

  const selectWishItem = useCallback(
    (item: WishItemRow) => {
      onChange({ kind: 'wish', wish_item_id: item.id });
      setMode('wish');
      setWishModalVisible(false);
    },
    [onChange],
  );

  const modeOptions: Array<{ key: RewardMode; label: string }> = [
    { key: 'none', label: '无' },
    { key: 'wish', label: '欲望清单' },
    { key: 'custom', label: '自定义' },
  ];

  return (
    <>
      <View style={styles.modeRow}>
        {modeOptions.map((opt) => {
          const active = mode === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => selectMode(opt.key)}
              disabled={disabled}
              style={({ pressed }) => [
                styles.modeChip,
                {
                  backgroundColor: active ? (isDark ? 'rgba(96,165,250,0.18)' : 'rgba(0,88,190,0.1)') : surfaceLow,
                  borderColor: active ? primary : placeholderColor,
                  opacity: disabled ? 0.65 : pressed ? 0.85 : 1,
                },
              ]}>
              <Text style={[styles.modeChipText, { color: active ? primary : textColor }]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {mode === 'wish' ? (
        <Pressable
          onPress={openWishModal}
          disabled={disabled}
          style={({ pressed }) => [
            styles.select,
            { backgroundColor: surfaceLow, borderColor: placeholderColor },
            disabled && { opacity: 0.65 },
            pressed && !disabled && { opacity: 0.85 },
          ]}>
          <View style={styles.selectLeft}>
            <MaterialIcons name="card-giftcard" size={18} color={primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.selectValue, { color: textColor }]} numberOfLines={2}>
                {value.kind === 'wish' ? summary : '点击选择欲望清单物品'}
              </Text>
              <Text style={[styles.selectHint, { color: outline }]}>完成时可获得对应奖励</Text>
            </View>
          </View>
          <MaterialIcons name="expand-more" size={20} color={outline} />
        </Pressable>
      ) : null}

      {mode === 'custom' ? (
        <View style={[styles.customWrap, { backgroundColor: surfaceLow, borderColor: placeholderColor }]}>
          <MaterialIcons name="edit" size={18} color={primary} style={styles.customIcon} />
          <TextInput
            value={customLabel}
            onChangeText={(t) => {
              const next = t.slice(0, 60);
              setCustomLabel(next);
              onChange(next.trim() ? { kind: 'custom', label: next.trim() } : DEFAULT_COMPLETION_REWARD);
            }}
            placeholder="例如：看一集剧、买一杯奶茶…"
            placeholderTextColor={outline}
            editable={!disabled}
            maxLength={60}
            style={[styles.customInput, { color: textColor, opacity: disabled ? 0.65 : 1 }]}
          />
        </View>
      ) : null}

      {mode === 'none' ? (
        <Text style={[styles.noneHint, { color: outline }]}>未设置完成奖励</Text>
      ) : null}

      <Modal transparent visible={wishModalVisible} animationType="fade" onRequestClose={() => setWishModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setWishModalVisible(false)}>
          <Pressable onPress={() => {}} style={[styles.modalCard, { backgroundColor: surfaceLowest, borderColor: placeholderColor }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>选择欲望清单物品</Text>
            {wishLoading ? (
              <ActivityIndicator color={primary} style={{ marginVertical: 24 }} />
            ) : wishItems.length === 0 ? (
              <Text style={[styles.emptyText, { color: outline }]}>欲望清单暂无物品，请先在欲望清单中添加。</Text>
            ) : (
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                {wishItems.map((item) => {
                  const selected = value.kind === 'wish' && value.wish_item_id === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => selectWishItem(item)}
                      style={({ pressed }) => [
                        styles.modalItem,
                        selected && { backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(0,88,190,0.08)' },
                        pressed && { opacity: 0.85 },
                      ]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.modalItemTitle, { color: textColor }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {item.category_label?.trim() ? (
                          <Text style={[styles.modalItemSub, { color: outline }]} numberOfLines={1}>
                            {item.category_label.trim()}
                          </Text>
                        ) : null}
                      </View>
                      {selected ? <MaterialIcons name="check" size={18} color={primary} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <Pressable
              onPress={() => setWishModalVisible(false)}
              style={({ pressed }) => [styles.modalCloseBtn, { borderColor: placeholderColor }, pressed && { opacity: 0.85 }]}>
              <Text style={[styles.modalCloseText, { color: textColor }]}>关闭</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  modeChipText: { fontSize: 13, fontWeight: '700' },
  select: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  selectValue: { fontSize: 14, fontWeight: '700' },
  selectHint: { fontSize: 12, fontWeight: '500' },
  customWrap: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  customIcon: { marginTop: 2 },
  customInput: { flex: 1, fontSize: 14, fontWeight: '600', padding: 0 },
  noneHint: { fontSize: 13, fontWeight: '500' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.38)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10, maxHeight: '70%' },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalScroll: { maxHeight: 360 },
  modalItem: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  modalItemTitle: { fontSize: 14, fontWeight: '700' },
  modalItemSub: { fontSize: 12, fontWeight: '500' },
  emptyText: { fontSize: 13, fontWeight: '500', paddingVertical: 16, textAlign: 'center' },
  modalCloseBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCloseText: { fontSize: 14, fontWeight: '700' },
});
