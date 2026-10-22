import { useHealthHomeTheme } from '@/constants/health-home-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type HealthIntakeDeletePreview = {
  title: string;
  /** 如「12:40 · 合并水分 / 蛋白 / 碳水 / 热量」 */
  detail: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  iconColor?: string;
  /** 删除后预计冲正的积分（负数表示扣回），null 表示不展示 */
  pointsDelta?: number | null;
};

type Props = {
  visible: boolean;
  preview: HealthIntakeDeletePreview | null;
  onClose: () => void;
  onConfirm: () => void;
  confirming?: boolean;
};

/** 摄入删除确认底栏 — 对齐 health-screens/13 */
export function HealthIntakeDeleteConfirmSheet({
  visible,
  preview,
  onClose,
  onConfirm,
  confirming = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { hh } = useHealthHomeTheme();
  const pointsDelta = preview?.pointsDelta;
  const showPoints =
    typeof pointsDelta === 'number' && Number.isFinite(pointsDelta) && pointsDelta !== 0;
  const pointsLabel =
    showPoints && pointsDelta != null
      ? `${pointsDelta > 0 ? '+' : ''}${Math.round(pointsDelta)} 分`
      : '';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={[styles.overlay, { backgroundColor: 'rgba(30, 42, 36, 0.42)' }]}
          onPress={confirming ? undefined : onClose}
          accessibilityLabel="关闭"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: hh.card,
              paddingBottom: Math.max(insets.bottom, 18),
              shadowColor: hh.shadow,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: hh.lineStrong }]} />

          <Text style={[styles.title, { color: '#8B3A32' }]}>删除这条记录？</Text>
          <Text style={[styles.sub, { color: hh.muted }]}>
            删除后无法恢复；当天四项总量会立即重算，健康指标积分也会自动冲正。
          </Text>

          {preview ? (
            <View style={[styles.previewCard, { backgroundColor: hh.cardMuted }]}>
              <View
                style={[
                  styles.previewIcon,
                  {
                    backgroundColor: `${preview.iconColor ?? hh.pine}22`,
                  },
                ]}
              >
                <MaterialIcons
                  name={preview.icon ?? 'restaurant'}
                  size={22}
                  color={preview.iconColor ?? hh.pine}
                />
              </View>
              <View style={styles.previewText}>
                <Text style={[styles.previewTitle, { color: hh.ink }]} numberOfLines={1}>
                  {preview.title}
                </Text>
                <Text style={[styles.previewDetail, { color: hh.muted }]} numberOfLines={2}>
                  {preview.detail}
                </Text>
              </View>
              {showPoints ? (
                <Text style={[styles.pointsDelta, { color: '#A54E4E' }]}>{pointsLabel}</Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              disabled={confirming}
              style={({ pressed }) => [
                styles.btnCancel,
                {
                  backgroundColor: hh.cardMuted,
                  opacity: confirming ? 0.5 : pressed ? 0.88 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="取消"
            >
              <Text style={[styles.btnCancelText, { color: hh.inkSoft }]}>取消</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={confirming}
              style={({ pressed }) => [
                styles.btnDelete,
                {
                  backgroundColor: 'rgba(165, 78, 78, 0.14)',
                  opacity: confirming ? 0.85 : pressed ? 0.9 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="确认删除"
            >
              {confirming ? (
                <ActivityIndicator color="#A54E4E" />
              ) : (
                <Text style={styles.btnDeleteText}>删除</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 99,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  sub: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
  },
  previewCard: {
    marginTop: 16,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  previewDetail: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  pointsDelta: {
    fontSize: 15,
    fontWeight: '800',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  btnCancel: {
    flex: 1,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancelText: {
    fontSize: 16,
    fontWeight: '700',
  },
  btnDelete: {
    flex: 1,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDeleteText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#A54E4E',
  },
});
