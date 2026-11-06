/**
 * 列表/详情：计数进度轨展示 + 打卡 / 设量 / 撤销。
 */
import { FoldProgressBar } from '@/components/tasks/fold-progress-bar';
import type { ProgressCountersEvaluation } from '@/lib/repositories/progress/progress-counters';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export type ProgressCounterTrackActions = {
  onBump: (counterId: string, delta: number) => void;
  onSetCurrent: (counterId: string, value: number) => void;
  onUndo: (counterId: string) => void;
};

type ProgressCounterTrackBlockProps = {
  evaluation: ProgressCountersEvaluation;
  muted: string;
  faint: string;
  ink: string;
  primary: string;
  surface: string;
  surfaceLow: string;
  trackAccentFrom?: string;
  trackAccentTo?: string;
  /** 结案提示文案；任务侧可传「可标记完成」 */
  fullHint?: string;
  interactive?: boolean;
  disabled?: boolean;
  actions?: ProgressCounterTrackActions;
};

export function ProgressCounterTrackBlock({
  evaluation,
  muted,
  faint,
  ink,
  primary,
  surface,
  surfaceLow,
  trackAccentFrom = '#7BA3C9',
  trackAccentTo,
  fullHint = '可考虑结案',
  interactive = false,
  disabled = false,
  actions,
}: ProgressCounterTrackBlockProps) {
  const [setModal, setSetModal] = useState<{ id: string; title: string; value: string } | null>(
    null,
  );

  if (evaluation.ratio == null || evaluation.checks.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <MaterialIcons name="plus-one" size={12} color={muted} />
        <Text style={[styles.headText, { color: muted }]}>计数进度</Text>
        {evaluation.full ? (
          <Text style={[styles.headHint, { color: faint }]}>{fullHint}</Text>
        ) : null}
      </View>
      {evaluation.checks.map((check) => (
        <View key={check.id} style={styles.row}>
          <View style={styles.rowTop}>
            <Text style={[styles.title, { color: ink }]} numberOfLines={1}>
              {check.title}
            </Text>
            <Text style={[styles.caption, { color: muted }]} numberOfLines={1}>
              {check.progressCaption}
            </Text>
          </View>
          <FoldProgressBar
            ratio={check.ratio}
            height={4}
            colorFrom={trackAccentFrom}
            colorTo={trackAccentTo}
          />
          {interactive && actions ? (
            <View style={styles.actions}>
              <ActionBtn
                label="−1"
                disabled={disabled || check.current <= 0}
                color={muted}
                bg={surfaceLow}
                onPress={() => actions.onBump(check.id, -1)}
              />
              <ActionBtn
                label="+1"
                disabled={disabled}
                color="#FFF"
                bg={primary}
                onPress={() => actions.onBump(check.id, 1)}
              />
              <ActionBtn
                label="设为"
                disabled={disabled}
                color={muted}
                bg={surfaceLow}
                onPress={() =>
                  setSetModal({
                    id: check.id,
                    title: check.title,
                    value: String(check.current),
                  })
                }
              />
              <ActionBtn
                label="撤销"
                disabled={disabled}
                color={muted}
                bg={surfaceLow}
                onPress={() => actions.onUndo(check.id)}
              />
            </View>
          ) : null}
        </View>
      ))}

      <Modal
        visible={!!setModal}
        transparent
        animationType="fade"
        onRequestClose={() => setSetModal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSetModal(null)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: surface }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: ink }]}>
              设置「{setModal?.title ?? ''}」完成量
            </Text>
            <TextInput
              value={setModal?.value ?? ''}
              onChangeText={(t) =>
                setSetModal((prev) => (prev ? { ...prev, value: t.replace(/[^\d]/g, '') } : prev))
              }
              keyboardType="number-pad"
              maxLength={5}
              autoFocus
              style={[
                styles.modalInput,
                { color: ink, borderColor: faint, backgroundColor: surfaceLow },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setSetModal(null)} style={styles.modalBtn}>
                <Text style={{ color: muted, fontWeight: '700' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!setModal || !actions) return;
                  const n = Math.floor(Number(setModal.value || '0'));
                  if (!Number.isFinite(n)) {
                    setSetModal(null);
                    return;
                  }
                  actions.onSetCurrent(setModal.id, n);
                  setSetModal(null);
                }}
                style={styles.modalBtn}>
                <Text style={{ color: primary, fontWeight: '800' }}>确定</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ActionBtn({
  label,
  disabled,
  color,
  bg,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  color: string;
  bg: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation?.();
        onPress();
      }}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.actionBtn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}>
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    gap: 8,
    paddingTop: 2,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headText: {
    fontSize: 11,
    fontWeight: '700',
  },
  headHint: {
    marginLeft: 'auto',
    fontSize: 10,
    fontWeight: '600',
  },
  row: {
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    maxWidth: '46%',
  },
  caption: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  actionBtn: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  actionText: {
    fontSize: 11,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
  },
  modalBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
});
