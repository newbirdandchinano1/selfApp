import { WishBoxGradientFill } from '@/components/wish-board/wish-box-gradient-fill';
import {
  formatWishBoxPoints,
  wishBoxTintGradient,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { resolveWishBoardIconOption } from '@/lib/constants/wish-board-icons';
import type { WishBoardWishType } from '@/lib/repositories/wish-board/wish-board.types';
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

export type WishBoardRedeemConfirmItem = {
  title: string;
  wish_type: WishBoardWishType;
  cost_points: number;
  icon_key: string | null;
};

type Props = {
  visible: boolean;
  item: WishBoardRedeemConfirmItem;
  balance: number;
  /** 该心愿历史已兑换次数；本次为 redeemCount + 1 */
  redeemCount: number;
  onClose: () => void;
  onConfirm: () => void;
  confirming?: boolean;
};

/** 兑换确认弹层（设计稿 06）：二次对账 + 足迹提示，防误触兑换 */
export function WishBoardRedeemConfirmSheet({
  visible,
  item,
  balance,
  redeemCount,
  onClose,
  onConfirm,
  confirming = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { gradients, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const icon = resolveWishBoardIconOption(item.icon_key);
  const typeLabel = item.wish_type === 'repeat' ? '可重复' : '一次性';
  const nextTimes = redeemCount + 1;
  const cost = Number.isFinite(item.cost_points) ? Math.max(0, item.cost_points) : 0;
  const remain = balance - cost;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.overlay}
          onPress={confirming ? undefined : onClose}
          accessibilityLabel="关闭"
        />
        <View
          style={[
            styles.sheet,
            shadows.sheet,
            { paddingBottom: Math.max(insets.bottom, 18) },
          ]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.iconBox}>
              <WishBoxGradientFill
                colors={wishBoxTintGradient(icon.tint)}
                radius={20}
              />
              <Text style={styles.iconEmoji}>{icon.emoji}</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.heading}>确认兑换这个心愿？</Text>
              <Text style={styles.sub} numberOfLines={2}>
                {item.title} · {typeLabel} · 本次第 {nextTimes} 次兑换
              </Text>
            </View>
          </View>

          <View style={styles.total}>
            <Text style={styles.totalLabel}>本次消耗积分</Text>
            <Text style={styles.totalValue}>-{formatWishBoxPoints(cost)}</Text>
          </View>

          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>当前积分余额</Text>
            <Text style={styles.sumValue}>{formatWishBoxPoints(balance)}</Text>
          </View>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>本次消耗</Text>
            <Text style={[styles.sumValue, styles.sumValuePri]}>-{formatWishBoxPoints(cost)}</Text>
          </View>
          <View style={[styles.sumRow, styles.sumRowLast]}>
            <Text style={styles.sumLabel}>兑换后剩余</Text>
            <Text style={styles.sumValue}>{formatWishBoxPoints(remain)}</Text>
          </View>

          <View style={styles.note}>
            <Text style={styles.noteEmoji}>🧾</Text>
            <Text style={styles.noteText}>
              兑换将自动记入「兑换足迹」，包含时间与消耗积分，可随时查看或删除。
            </Text>
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              disabled={confirming}
              style={({ pressed }) => [
                styles.btnGhost,
                { opacity: confirming ? 0.5 : pressed ? 0.88 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="再想想">
              <Text style={styles.btnGhostText}>再想想</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={confirming}
              style={({ pressed }) => [
                styles.btnPrimary,
                shadows.button,
                { opacity: confirming ? 0.85 : pressed ? 0.9 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="确认兑换">
              <WishBoxGradientFill colors={gradients.primary} radius={17} />
              {confirming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>确认兑换</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.overlay,
  },
  sheet: {
    backgroundColor: c.sheet,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 99,
    backgroundColor: c.handle,
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconBox: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconEmoji: {
    fontSize: 33,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  heading: {
    fontSize: 17,
    fontWeight: '800',
    color: c.ink,
  },
  sub: {
    fontSize: 13,
    color: c.muted,
    marginTop: 5,
    lineHeight: 20,
  },
  total: {
    backgroundColor: c.coinWash,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 2,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.totalLabel,
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '800',
    color: c.pri,
    fontVariant: ['tabular-nums'],
  },
  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: c.divider,
  },
  sumRowLast: {
    borderBottomWidth: 0,
  },
  sumLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    color: c.muted,
  },
  sumValue: {
    fontSize: 13.5,
    fontWeight: '800',
    color: c.ink,
    fontVariant: ['tabular-nums'],
  },
  sumValuePri: {
    color: c.pri,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: c.wash,
    borderWidth: 1,
    borderColor: c.washLine,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginTop: 12,
  },
  noteEmoji: {
    fontSize: 15,
    marginTop: 1,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    color: c.ink2,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  btnGhost: {
    flex: 1,
    height: 50,
    borderRadius: 17,
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostText: {
    fontSize: 16,
    fontWeight: '800',
    color: c.ink,
  },
  btnPrimary: {
    flex: 1,
    height: 50,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btnPrimaryText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  });
}
