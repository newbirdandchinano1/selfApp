/**
 * 「今日小结」：日终收口文案（只读）；失败回退规则文案。
 */
import { useHealthHomeTheme } from '@/constants/health-home-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { buildHealthIntakeReminderCopy, type HealthIntakeDeficit } from '@/lib/health-intake-reminder-logic';
import {
  analyzeFoodDailyWrapup,
  type FoodDailyWrapupJson,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type DailyWrapupGapContext = {
  todayYmd: string;
  totals: { hydration: number; protein: number; carbohydrate: number; calories: number };
  targets: { hydration: number; protein: number; carbohydrate: number; calories: number };
};

export type DailyWrapupSheetProps = {
  visible: boolean;
  onClose: () => void;
  gap: DailyWrapupGapContext | null;
};

function remain(target: number, current: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.round(target - Math.max(0, current)));
}

function buildWrapupContextBlock(gap: DailyWrapupGapContext): string {
  const rH = remain(gap.targets.hydration, gap.totals.hydration);
  const rP = remain(gap.targets.protein, gap.totals.protein);
  const rC = remain(gap.targets.carbohydrate, gap.totals.carbohydrate);
  const rK = remain(gap.targets.calories, gap.totals.calories);
  const hit = (cur: number, tgt: number, reverse = false) => {
    if (!(tgt > 0)) return '无目标';
    if (reverse) return cur <= tgt ? '达标' : '超标';
    return cur >= tgt ? '达标' : '未达标';
  };
  return [
    `日期：${gap.todayYmd}`,
    `今日已摄入：水分 ${Math.round(gap.totals.hydration)}ml / 蛋白 ${Math.round(gap.totals.protein)}g / 碳水 ${Math.round(gap.totals.carbohydrate)}g / 热量 ${Math.round(gap.totals.calories)}kcal`,
    `今日目标：水分 ${gap.targets.hydration}ml / 蛋白 ${gap.targets.protein}g / 碳水 ${gap.targets.carbohydrate}g / 热量 ${gap.targets.calories}kcal`,
    `缺口：水分 ${rH}ml / 蛋白 ${rP}g / 碳水 ${rC}g / 热量 ${rK}kcal`,
    `达标：水分 ${hit(gap.totals.hydration, gap.targets.hydration)} / 蛋白 ${hit(gap.totals.protein, gap.targets.protein)} / 碳水 ${hit(gap.totals.carbohydrate, gap.targets.carbohydrate)} / 热量 ${hit(gap.totals.calories, gap.targets.calories, true)}`,
  ].join('\n');
}

function ruleFallback(gap: DailyWrapupGapContext): FoodDailyWrapupJson {
  const candidates: HealthIntakeDeficit[] = (
    [
      { key: 'protein' as const, label: '蛋白', unitKey: 'protein' },
      { key: 'hydration' as const, label: '水分', unitKey: 'hydration' },
      { key: 'carbohydrate' as const, label: '碳水', unitKey: 'carbohydrate' },
    ] as const
  )
    .map((m) => {
      const current = gap.totals[m.unitKey];
      const target = gap.targets[m.unitKey];
      const rem = remain(target, current);
      return {
        key: m.key,
        label: m.label,
        remain: rem,
        current,
        target,
        gapRatio: target > 0 ? rem / target : 0,
      };
    })
    .filter((d) => d.remain > 0 && d.target > 0)
    .sort((a, b) => b.gapRatio - a.gapRatio);

  if (candidates.length === 0) {
    const calOver =
      gap.targets.calories > 0 && gap.totals.calories > gap.targets.calories
        ? `热量已超约 ${Math.round(gap.totals.calories - gap.targets.calories)}kcal，明天注意节奏。`
        : '今日关注项已达标，收工。';
    return { title: '今日小结', body: calOver };
  }
  const copy = buildHealthIntakeReminderCopy(candidates);
  return { title: '今日小结', body: copy.body };
}

export function DailyWrapupSheet({ visible, onClose, gap }: DailyWrapupSheetProps) {
  const insets = useSafeAreaInsets();
  const { hh } = useHealthHomeTheme();
  const styles = useMemo(() => createStyles(), []);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FoodDailyWrapupJson | null>(null);
  const [fromAi, setFromAi] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFromAi(false);
      setFetched(false);
      setLoading(false);
    }
  }, [visible]);

  const runWrapup = useCallback(async () => {
    if (!gap) {
      toast.info('暂无今日摄入数据');
      return;
    }
    setLoading(true);
    try {
      const r = await analyzeFoodDailyWrapup({
        contextBlock: buildWrapupContextBlock(gap),
      });
      if (r.ok) {
        setData(r.data);
        setFromAi(true);
      } else {
        setData(ruleFallback(gap));
        setFromAi(false);
        toast.info('AI 小结暂不可用，已用规则文案');
      }
      setFetched(true);
    } catch (e) {
      setData(ruleFallback(gap));
      setFromAi(false);
      setFetched(true);
      toast.info(toUserMessage(e, '已回退规则文案'));
    } finally {
      setLoading(false);
    }
  }, [gap]);

  useEffect(() => {
    if (!visible || !gap || fetched || loading) return;
    void runWrapup();
  }, [visible, gap, fetched, loading, runWrapup]);

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityLabel="关闭" />
        <View style={[styles.sheet, { backgroundColor: hh.card, borderColor: hh.line }]}>
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: hh.ink }]}>今日小结</Text>
              <Text style={[styles.sub, { color: hh.muted }]}>
                {fromAi ? 'AI 收口 · 只读' : fetched ? '规则文案 · 只读' : '生成中…'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="关闭今日小结">
              <MaterialIcons name="close" size={22} color={hh.inkSoft} />
            </Pressable>
          </View>

          <View style={styles.body}>
            {loading && !data ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={hh.pine} />
                <Text style={[styles.loadingText, { color: hh.muted }]}>在看今日达成…</Text>
              </View>
            ) : data ? (
              <View style={[styles.card, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
                <Text style={[styles.cardTitle, { color: hh.ink }]}>{data.title}</Text>
                <Text style={[styles.cardBody, { color: hh.inkSoft }]}>{data.body}</Text>
              </View>
            ) : (
              <Text style={[styles.empty, { color: hh.muted }]}>暂无小结</Text>
            )}
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={() => {
                setFetched(false);
                setData(null);
                void runWrapup();
              }}
              disabled={loading}
              style={[styles.secondaryBtn, { borderColor: hh.line, opacity: loading ? 0.5 : 1 }]}>
              <Text style={[styles.secondaryBtnText, { color: hh.pine }]}>
                {loading ? '生成中…' : '再生成一次'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles() {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(20, 28, 22, 0.45)',
      paddingHorizontal: 12,
    },
    sheet: {
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
    },
    head: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 10,
    },
    title: { fontSize: 17, fontWeight: '800' },
    sub: { marginTop: 4, fontSize: 12, fontWeight: '500' },
    body: { paddingHorizontal: 16, paddingBottom: 8, minHeight: 120 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, fontWeight: '600' },
    card: {
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 16,
      gap: 8,
    },
    cardTitle: { fontSize: 15, fontWeight: '800' },
    cardBody: { fontSize: 14, fontWeight: '500', lineHeight: 22 },
    empty: { fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 24 },
    footer: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4 },
    secondaryBtn: {
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 12,
      alignItems: 'center',
    },
    secondaryBtnText: { fontSize: 14, fontWeight: '700' },
  });
}
