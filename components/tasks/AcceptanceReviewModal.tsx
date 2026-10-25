/**
 * 子任务全部完成后弹出：核对验收清单（提示任务目标，非拆分子任务）
 */
import { AcceptanceChecklistEditor } from '@/components/tasks/AcceptanceChecklistEditor';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { AcceptanceCriterionItem } from '@/lib/acceptance-criteria';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type AcceptanceReviewModalProps = {
  visible: boolean;
  title?: string;
  items: AcceptanceCriterionItem[];
  onChangeItems: (items: AcceptanceCriterionItem[]) => void;
  onDismiss: () => void;
  onConfirm: () => void;
  busy?: boolean;
};

export function AcceptanceReviewModal({
  visible,
  title = '核对验收清单',
  items,
  onChangeItems,
  onDismiss,
  onConfirm,
  busy = false,
}: AcceptanceReviewModalProps) {
  const { tf, isDark } = useTaskFoldTheme();
  const insets = useSafeAreaInsets();
  const cardBg = isDark ? '#1B2621' : '#FFFCF5';

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={[styles.overlay, { backgroundColor: 'rgba(25,34,28,0.45)' }]} onPress={onDismiss}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              borderColor: tf.line2,
              paddingBottom: Math.max(insets.bottom, 14),
            },
          ]}>
          <View style={styles.head}>
            <View style={[styles.iconWrap, { backgroundColor: tf.lily2 }]}>
              <MaterialIcons name="playlist-add-check" size={18} color={tf.frog} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: tf.ink }]}>{title}</Text>
              <Text style={[styles.sub, { color: tf.faint }]}>
                子任务已全部完成。核对验收标准后，「已核对」将完成主任务；「稍后」暂不完成。
              </Text>
            </View>
          </View>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {items.length > 0 ? (
              <AcceptanceChecklistEditor
                items={items}
                onChange={onChangeItems}
                mode="check"
                disabled={busy}
                showProgress
                inkColor={tf.ink2}
                faintColor={tf.faint}
                frogColor={tf.frog}
                onPondColor={tf.onPond}
                lineColor={tf.line2}
              />
            ) : (
              <Text style={{ fontSize: 13, color: tf.faint, paddingVertical: 8 }}>
                尚未填写验收标准。仍可直接核对完成，或稍后补充。
              </Text>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={onDismiss}
              disabled={busy}
              style={({ pressed }) => [
                styles.btnGhost,
                { borderColor: tf.line2, opacity: busy ? 0.55 : pressed ? 0.85 : 1 },
              ]}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: tf.ink2 }}>稍后</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={busy}
              style={({ pressed }) => [
                styles.btnPrimary,
                { backgroundColor: tf.pond, opacity: busy ? 0.55 : pressed ? 0.9 : 1 },
              ]}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: tf.onPond }}>已核对</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    paddingHorizontal: 14,
    maxHeight: '78%',
  },
  head: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '800' },
  sub: { fontSize: 11, lineHeight: 15, marginTop: 3 },
  list: { maxHeight: 280, marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  btnGhost: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
