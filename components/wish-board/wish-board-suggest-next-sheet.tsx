import {
  formatWishBoxPoints,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { aiWishBoardSuggestNext } from '@/lib/ai-api-client';
import type { WishBoardSuggestNextCandidate } from '@/lib/ai-types';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  DEFAULT_WISH_BOARD_ICON_KEY,
  WISH_BOARD_ICON_OPTIONS,
} from '@/lib/constants/wish-board-icons';
import { getPointsEarnedThisMonth } from '@/lib/repositories/points/points';
import {
  listWishBoardItems,
  listWishRedeemRecords,
} from '@/lib/repositories/wish-board/wish-board';
import type { WishBoardWishType } from '@/lib/repositories/wish-board/wish-board.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type WishBoardSuggestNextPick = {
  title: string;
  description: string | null;
  icon_key: string;
  wish_type: WishBoardWishType;
  cost_points: number;
};

type Props = {
  visible: boolean;
  balance: number;
  onClose: () => void;
  onPick: (draft: WishBoardSuggestNextPick) => void;
};

/** 下一颗心愿建议 Sheet：点选后预填新建表单，不自动创建 */
export function WishBoardSuggestNextSheet({ visible, balance, onClose, onPick }: Props) {
  const insets = useSafeAreaInsets();
  const { c, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const [preference, setPreference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<WishBoardSuggestNextCandidate[]>([]);

  useEffect(() => {
    if (!visible) {
      setPreference('');
      setError(null);
      setCandidates([]);
      setBusy(false);
    }
  }, [visible]);

  const runSuggest = () => {
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
        const active = items
          .filter(i => i.status === 'active')
          .slice(0, 20)
          .map(i => ({
            title: i.title,
            cost_points: i.cost_points,
            wish_type: i.wish_type,
            status: i.status,
            icon_key: i.icon_key,
          }));
        const redeemedSummary = redeemed.slice(0, 20).map(r => ({
          title: r.title,
          cost_points: r.cost_points,
          wish_type: r.wish_type,
          status: 'redeemed',
          icon_key: undefined,
        }));
        const data = await aiWishBoardSuggestNext({
          active,
          redeemed: redeemedSummary,
          balance,
          month_earned: monthEarned,
          preference: preference.trim() || undefined,
          icon_keys: WISH_BOARD_ICON_OPTIONS.map(o => o.key),
          limit: 3,
        });
        const list = (data.candidates ?? [])
          .map(row => {
            const icon = WISH_BOARD_ICON_OPTIONS.some(o => o.key === row.icon_key)
              ? row.icon_key
              : DEFAULT_WISH_BOARD_ICON_KEY;
            return {
              title: (row.title || '').trim().slice(0, 20),
              cost_points: Math.max(0, Math.round(Number(row.cost_points) || 0)),
              icon_key: icon,
              wish_type: (row.wish_type === 'repeat' ? 'repeat' : 'once') as 'once' | 'repeat',
              reason: (row.reason || '').trim().slice(0, 120),
            };
          })
          .filter(r => r.title);
        if (list.length === 0) {
          setError('暂时没有合适的建议，换个偏好再试');
          setCandidates([]);
          return;
        }
        setCandidates(list);
      } catch (e) {
        setError(toUserMessage(e, '获取建议失败，请稍后重试'));
        setCandidates([]);
      } finally {
        setBusy(false);
      }
    })();
  };

  const pick = (row: WishBoardSuggestNextCandidate) => {
    onPick({
      title: row.title,
      description: row.reason || null,
      icon_key: row.icon_key || DEFAULT_WISH_BOARD_ICON_KEY,
      wish_type: row.wish_type === 'repeat' ? 'repeat' : 'once',
      cost_points: row.cost_points,
    });
    onClose();
    toast.success('已带入新建表单，确认后再保存');
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
          <Text style={styles.heading}>下一颗心愿</Text>
          <Text style={styles.sub}>点选后进入新建并预填，不会自动创建。</Text>
          <TextInput
            value={preference}
            onChangeText={setPreference}
            editable={!busy}
            placeholder="可选：偏好一句，如「想多出门」"
            placeholderTextColor={c.muted}
            style={styles.input}
          />
          <Pressable
            onPress={runSuggest}
            disabled={busy}
            style={({ pressed }) => [
              styles.genBtn,
              { opacity: pressed || busy ? 0.75 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={candidates.length ? '重新建议' : '生成建议'}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.genBtnText}>{candidates.length ? '重新建议' : '生成建议'}</Text>
            )}
          </Pressable>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {candidates.map((row, idx) => {
              const emoji =
                WISH_BOARD_ICON_OPTIONS.find(o => o.key === row.icon_key)?.emoji ?? '🎁';
              return (
                <Pressable
                  key={`${row.title}-${idx}`}
                  onPress={() => pick(row)}
                  style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`选用 ${row.title}`}>
                  <Text style={styles.cardTitle}>
                    {emoji} {row.title}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {row.wish_type === 'repeat' ? '可重复' : '一次性'} ·{' '}
                    {formatWishBoxPoints(row.cost_points)} 分
                  </Text>
                  {row.reason ? <Text style={styles.cardReason}>{row.reason}</Text> : null}
                  <View style={styles.cardCta}>
                    <MaterialIcons name="add" size={16} color={c.pri} />
                    <Text style={styles.cardCtaText}>用这个去新建</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.85 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="关闭">
            <Text style={styles.closeBtnText}>关闭</Text>
          </Pressable>
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
    input: {
      marginTop: 12,
      borderWidth: 1.5,
      borderColor: c.line,
      borderRadius: 14,
      backgroundColor: c.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: c.ink,
    },
    genBtn: {
      marginTop: 12,
      height: 44,
      borderRadius: 14,
      backgroundColor: c.pri,
      alignItems: 'center',
      justifyContent: 'center',
    },
    genBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
    error: { marginTop: 10, fontSize: 12.5, color: c.once, fontWeight: '600' },
    list: { marginTop: 10, maxHeight: 320 },
    card: {
      marginTop: 8,
      padding: 12,
      borderRadius: 15,
      backgroundColor: c.wash,
      borderWidth: 1,
      borderColor: c.washLine,
    },
    cardTitle: { fontSize: 15, fontWeight: '800', color: c.ink },
    cardMeta: { marginTop: 4, fontSize: 12, fontWeight: '600', color: c.muted },
    cardReason: { marginTop: 6, fontSize: 12.5, lineHeight: 18, color: c.ink },
    cardCta: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    cardCtaText: { fontSize: 12.5, fontWeight: '700', color: c.pri },
    closeBtn: {
      marginTop: 12,
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
