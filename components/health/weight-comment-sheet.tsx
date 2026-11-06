/**
 * 体重趋势短评（只读）；失败时展示本地规则短评 + 免责声明。
 */
import { useHealthHomeTheme } from '@/constants/health-home-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  analyzeFoodWeightComment,
  type FoodWeightCommentJson,
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

export type WeightCommentContext = {
  /** 近 14～30 日体重点 */
  weightLines: string[];
  goalLabel?: string;
  /** 同期热量日均说明 */
  calorieAvgLine?: string;
};

export type WeightCommentSheetProps = {
  visible: boolean;
  onClose: () => void;
  context: WeightCommentContext | null;
};

function buildContextBlock(ctx: WeightCommentContext): string {
  const lines = [
    `目标：${ctx.goalLabel?.trim() || '未设置'}`,
    ctx.calorieAvgLine?.trim() || '同期热量日均：暂无',
    '近端体重（本地，不同步云）：',
    ...(ctx.weightLines.length ? ctx.weightLines : ['（暂无体重记录）']),
  ];
  return lines.join('\n');
}

function ruleFallback(ctx: WeightCommentContext): FoodWeightCommentJson {
  const caution = '仅供参考，非医疗建议；勿据此自行调整用药或极端节食。';
  if (ctx.weightLines.length < 2) {
    return {
      comment: '体重记录还少，再记几天就能看趋势。平时按目标节奏吃就好。',
      caution,
    };
  }
  return {
    comment: '近端体重有记录。波动属正常，结合饮食目标看整体方向即可。',
    caution,
  };
}

export function WeightCommentSheet({ visible, onClose, context }: WeightCommentSheetProps) {
  const insets = useSafeAreaInsets();
  const { hh } = useHealthHomeTheme();
  const styles = useMemo(() => createStyles(), []);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FoodWeightCommentJson | null>(null);
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

  const runComment = useCallback(async () => {
    if (!context) {
      toast.info('暂无体重上下文');
      return;
    }
    setLoading(true);
    try {
      const r = await analyzeFoodWeightComment({
        contextBlock: buildContextBlock(context),
      });
      if (r.ok) {
        setData({
          ...r.data,
          caution: r.data.caution?.trim() || '仅供参考，非医疗建议。',
        });
        setFromAi(true);
      } else {
        setData(ruleFallback(context));
        setFromAi(false);
        toast.info('AI 短评暂不可用，已用规则文案');
      }
      setFetched(true);
    } catch (e) {
      setData(ruleFallback(context));
      setFromAi(false);
      setFetched(true);
      toast.info(toUserMessage(e, '已回退规则文案'));
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    if (!visible || !context || fetched || loading) return;
    void runComment();
  }, [visible, context, fetched, loading, runComment]);

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityLabel="关闭" />
        <View style={[styles.sheet, { backgroundColor: hh.card, borderColor: hh.line }]}>
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: hh.ink }]}>体重短评</Text>
              <Text style={[styles.sub, { color: hh.muted }]}>
                {fromAi ? 'AI · 只读 · 非医疗建议' : fetched ? '规则文案 · 只读' : '生成中…'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="关闭体重短评">
              <MaterialIcons name="close" size={22} color={hh.inkSoft} />
            </Pressable>
          </View>

          <View style={styles.body}>
            {loading && !data ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={hh.pine} />
                <Text style={[styles.loadingText, { color: hh.muted }]}>在看体重趋势…</Text>
              </View>
            ) : data ? (
              <View style={[styles.card, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
                <Text style={[styles.cardBody, { color: hh.inkSoft }]}>{data.comment}</Text>
                {data.caution?.trim() ? (
                  <Text style={[styles.caution, { color: hh.faint }]}>{data.caution.trim()}</Text>
                ) : null}
              </View>
            ) : (
              <Text style={[styles.empty, { color: hh.muted }]}>暂无短评</Text>
            )}
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={() => {
                setFetched(false);
                setData(null);
                void runComment();
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
      gap: 10,
    },
    cardBody: { fontSize: 14, fontWeight: '500', lineHeight: 22 },
    caution: { fontSize: 11, fontWeight: '500', lineHeight: 16 },
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
