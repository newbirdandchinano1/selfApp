import {
  formatWishBoxPoints,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { formatSignedMoneyTrunc2 } from '@/lib/finance-net-worth';
import type {
  WishBoardRedeemConditionCheck,
  WishBoardRedeemConditionKind,
  WishBoardRedeemEligibility,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type GapActionKind = WishBoardRedeemConditionKind | 'points';

type GapRow = {
  key: string;
  emoji: string;
  title: string;
  subtitle: string;
  actionKind: GapActionKind;
  actionLabel: string;
};

type Props = {
  visible: boolean;
  title: string;
  eligibility: WishBoardRedeemEligibility;
  /** 当前净资产（与详情页同一口径），用于「还差 ¥X」文案 */
  currentNetWorth?: number;
  onClose: () => void;
  /** 每行右侧行动按钮：去完成 / 去攒钱 / 去赚积分 */
  onAction?: (kind: GapActionKind) => void;
  onGoTasks?: () => void;
};

function kindEmoji(kind: WishBoardRedeemConditionKind): string {
  switch (kind) {
    case 'project':
      return '📁';
    case 'task':
      return '✅';
    case 'todo':
      return '📝';
    case 'net_worth':
      return '💰';
    default:
      return '🔗';
  }
}

function kindLabel(kind: WishBoardRedeemConditionKind): string {
  if (kind === 'project') return '项目';
  if (kind === 'todo') return '待办';
  if (kind === 'net_worth') return '净资产';
  return '任务';
}

function kindAction(kind: GapActionKind): string {
  if (kind === 'net_worth') return '去攒钱';
  if (kind === 'points') return '去赚积分';
  return '去完成';
}

/** 金额展示：整数去掉 .00（设计稿「还差 ¥8,600」） */
function formatMoneyShort(value: number): string {
  const text = formatSignedMoneyTrunc2(value);
  return text.endsWith('.00') ? text.slice(0, -3) : text;
}

function progressSubtitle(check: WishBoardRedeemConditionCheck): string {
  const progress = check.progress;
  if (!progress) return '尚未完成';
  const left = Math.max(0, progress.total - progress.done);
  return `${progress.done} / ${progress.total} 项 · ${left === 0 ? '已完成' : `还差 ${left} 项子任务`}`;
}

export function WishBoardGapSheet({
  visible,
  title,
  eligibility,
  currentNetWorth,
  onClose,
  onAction,
  onGoTasks,
}: Props) {
  const insets = useSafeAreaInsets();
  const { c, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);

  const rows = useMemo(() => {
    const list: GapRow[] = eligibility.pending.map(check => {
      let rowTitle: string;
      let subtitle: string;
      if (check.kind === 'net_worth') {
        const need = eligibility.conditions.min_net_worth;
        rowTitle =
          need != null ? `净资产达到 ${formatMoneyShort(need)}` : '净资产达到门槛';
        const current =
          typeof currentNetWorth === 'number' && Number.isFinite(currentNetWorth)
            ? currentNetWorth
            : null;
        if (need != null && current != null) {
          const gap = Math.max(0, need - current);
          subtitle =
            gap > 0
              ? `当前 ${formatMoneyShort(current)} · 还差 ${formatMoneyShort(gap)}`
              : `当前 ${formatMoneyShort(current)}`;
        } else {
          subtitle = current != null ? `当前 ${formatMoneyShort(current)}` : '净资产同步后判定';
        }
      } else {
        rowTitle = `完成${kindLabel(check.kind)}「${check.title}」`;
        subtitle = check.missing ? '关联项已不存在' : progressSubtitle(check);
      }
      return {
        key: `${check.kind}:${check.id}`,
        emoji: kindEmoji(check.kind),
        title: rowTitle,
        subtitle,
        actionKind: check.kind,
        actionLabel: kindAction(check.kind),
      };
    });
    if (!eligibility.pointsOk) {
      const need = Math.max(0, eligibility.costPoints - eligibility.balance);
      list.push({
        key: 'points',
        emoji: '⭐',
        title: `积分攒到 ${formatWishBoxPoints(eligibility.costPoints)} 分`,
        subtitle: `当前 ${formatWishBoxPoints(eligibility.balance)} · 还差 ${formatWishBoxPoints(need)}`,
        actionKind: 'points',
        actionLabel: kindAction('points'),
      });
    }
    return list;
  }, [eligibility, currentNetWorth]);

  const count = rows.length;

  const runAction = (kind: GapActionKind) => {
    onClose();
    onAction?.(kind);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="关闭" />
        <View
          style={[
            styles.sheet,
            shadows.sheet,
            { paddingBottom: Math.max(insets.bottom, 18) },
          ]}>
          <View style={styles.handle} />
          <Text style={styles.heading}>还差一点点就能兑换 ✨</Text>
          <Text style={styles.sub}>
            {count > 0
              ? `完成下面 ${count} 件事，「${title}」就是你的了：`
              : `「${title}」还差一点点就能兑换`}
          </Text>

          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            bounces={false}>
            {rows.map(row => (
              <View key={row.key} style={styles.row}>
                <View style={styles.si}>
                  <Text style={styles.siEmoji}>{row.emoji}</Text>
                </View>
                <View style={styles.tt}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {row.title}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={2}>
                    {row.subtitle}
                  </Text>
                </View>
                <Pressable
                  onPress={() => runAction(row.actionKind)}
                  style={({ pressed }) => [styles.actBtn, { opacity: pressed ? 0.75 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.actionLabel}${row.title}`}>
                  <Text style={styles.actBtnText}>{row.actionLabel} ›</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.btnGhost, { opacity: pressed ? 0.88 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="再等等我">
              <Text style={styles.btnGhostText}>再等等我</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onGoTasks?.();
                onClose();
              }}
              style={({ pressed }) => [
                styles.btnPrimary,
                shadows.button,
                { opacity: pressed ? 0.9 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="去完成任务">
              <Text style={styles.btnPrimaryText}>去完成任务</Text>
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
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: c.overlay,
  },
  sheet: {
    backgroundColor: c.sheet,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '78%',
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#E3D2BF',
    alignSelf: 'center',
    marginBottom: 14,
  },
  heading: {
    fontSize: 20,
    fontWeight: '800',
    color: c.ink,
  },
  sub: {
    fontSize: 13,
    color: c.muted,
    marginTop: 5,
    lineHeight: 21,
  },
  list: {
    marginTop: 10,
    maxHeight: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: c.wash,
    borderWidth: 1,
    borderColor: c.washLine,
    marginTop: 7,
  },
  si: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: c.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  siEmoji: {
    fontSize: 18,
  },
  tt: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: c.ink,
  },
  rowSub: {
    fontSize: 11.5,
    color: c.muted,
    marginTop: 2,
  },
  actBtn: {
    flexShrink: 0,
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.priLine,
  },
  actBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.pri,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  btnGhost: {
    flex: 1,
    height: 48,
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
    height: 48,
    borderRadius: 17,
    backgroundColor: c.pri,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  });
}
