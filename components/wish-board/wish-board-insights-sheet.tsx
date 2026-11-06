import {
  formatWishBoxPoints,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { aiWishBoardInsights } from '@/lib/ai-api-client';
import { toUserMessage } from '@/lib/app-feedback';
import { getPointsEarnedThisMonth } from '@/lib/repositories/points/points';
import {
  listWishBoardItems,
  listWishRedeemRecords,
} from '@/lib/repositories/wish-board/wish-board';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
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

type Props = {
  visible: boolean;
  balance: number;
  onClose: () => void;
};

/** 积分与心愿健康度洞察 Sheet（只读 tips；不改分、不改心愿） */
export function WishBoardInsightsSheet({ visible, balance, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { c, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tips, setTips] = useState<string[]>([]);
  const [meta, setMeta] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setError(null);
      setTips([]);
      setMeta(null);
      setBusy(false);
      return;
    }
    void runInsights();
    // 打开时拉一次；balance 变化不自动重跑，避免抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const runInsights = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const [items, redeemed, monthEarned] = await Promise.all([
          listWishBoardItems(),
          listWishRedeemRecords().catch(() => []),
          getPointsEarnedThisMonth().catch(() => 0),
        ]);
        const activeRows = items.filter(i => i.status === 'active');
        const active = activeRows.slice(0, 20).map(i => ({
          title: i.title,
          cost_points: i.cost_points,
          wish_type: i.wish_type,
          status: i.status,
          icon_key: i.icon_key ?? undefined,
        }));
        const redeemedSummary = redeemed.slice(0, 20).map(r => ({
          title: r.title,
          cost_points: r.cost_points,
          wish_type: r.wish_type,
          status: 'redeemed',
        }));

        const waitingGaps: number[] = [];
        for (const item of activeRows) {
          const gap = Math.max(0, item.cost_points - balance);
          if (gap > 0) waitingGaps.push(gap);
        }
        const waiting_gap_avg =
          waitingGaps.length > 0
            ? waitingGaps.reduce((a, b) => a + b, 0) / waitingGaps.length
            : undefined;
        const repeatCount = activeRows.filter(i => i.wish_type === 'repeat').length;
        const repeat_ratio =
          activeRows.length > 0 ? repeatCount / activeRows.length : undefined;

        const data = await aiWishBoardInsights({
          balance,
          month_earned: monthEarned,
          active,
          redeemed: redeemedSummary,
          waiting_gap_avg,
          repeat_ratio,
          period_label: '近期',
        });
        const list = (data.tips ?? [])
          .map(t => (typeof t === 'string' ? t.trim() : ''))
          .filter(Boolean)
          .slice(0, 5);
        if (list.length === 0) {
          setError('暂时没有洞察，稍后再试');
          setTips([]);
          setMeta(null);
          return;
        }
        setTips(list);
        setMeta(
          `余额 ${formatWishBoxPoints(balance)} · 本月已攒 ${formatWishBoxPoints(monthEarned)} · 活跃 ${activeRows.length}`,
        );
      } catch (e) {
        setError(toUserMessage(e, '获取洞察失败，请稍后重试'));
        setTips([]);
        setMeta(null);
      } finally {
        setBusy(false);
      }
    })();
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
          <Text style={styles.heading}>积分健康度</Text>
          <Text style={styles.sub}>只读洞察，不会改积分或心愿。</Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}

          {busy && tips.length === 0 ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator color={c.pri} />
              <Text style={styles.hint}>正在分析…</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {tips.map((tip, idx) => (
              <View key={`${tip}-${idx}`} style={styles.card}>
                <View style={styles.cardIndex}>
                  <Text style={styles.cardIndexText}>{idx + 1}</Text>
                </View>
                <Text style={styles.cardText}>{tip}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={runInsights}
              disabled={busy}
              style={({ pressed }) => [
                styles.retryBtn,
                { opacity: pressed || busy ? 0.75 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="重新分析">
              {busy ? (
                <ActivityIndicator color={c.pri} />
              ) : (
                <>
                  <MaterialIcons name="refresh" size={16} color={c.pri} />
                  <Text style={styles.retryText}>重新分析</Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="关闭">
              <Text style={styles.closeBtnText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
    },
    sheet: {
      backgroundColor: c.sheet,
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      paddingHorizontal: 20,
      paddingTop: 12,
      maxHeight: '82%',
    },
    handle: {
      width: 44,
      height: 5,
      borderRadius: 99,
      backgroundColor: '#E3D2BF',
      alignSelf: 'center',
      marginBottom: 14,
    },
    heading: { fontSize: 20, fontWeight: '800', color: c.ink },
    sub: { marginTop: 5, fontSize: 13, color: c.muted, lineHeight: 20 },
    meta: { marginTop: 8, fontSize: 12, fontWeight: '600', color: c.muted },
    centerBlock: { alignItems: 'center', paddingVertical: 28, gap: 12 },
    hint: { fontSize: 13, color: c.muted },
    error: { marginTop: 10, fontSize: 12.5, color: c.once, fontWeight: '600' },
    list: { marginTop: 10, maxHeight: 360 },
    card: {
      marginTop: 8,
      padding: 12,
      borderRadius: 15,
      backgroundColor: c.wash,
      borderWidth: 1,
      borderColor: c.washLine,
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
    },
    cardIndex: {
      width: 22,
      height: 22,
      borderRadius: 8,
      backgroundColor: c.priSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    cardIndexText: { fontSize: 11, fontWeight: '800', color: c.pri },
    cardText: { flex: 1, fontSize: 14, lineHeight: 21, color: c.ink, fontWeight: '600' },
    actions: { marginTop: 12, gap: 8 },
    retryBtn: {
      height: 44,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: c.priLine,
      backgroundColor: c.priSoft,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
    },
    retryText: { fontSize: 14, fontWeight: '800', color: c.pri },
    closeBtn: {
      height: 44,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: c.line,
      backgroundColor: c.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeBtnText: { fontSize: 15, fontWeight: '800', color: c.ink },
  });
}
