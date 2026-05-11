import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteVision,
  getVisionRowById,
  listVisions,
  parseVisionExtra,
  serializeVisionExtra,
  updateVision,
} from '@/lib/repositories/visions/vision';
import { visionRowToWallCard } from '@/lib/repositories/visions/vision-present';
import type { VisionWallCardModel } from '@/lib/visions-registry';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

type WallEntry = { id: string; card: VisionWallCardModel };

function formatStoredAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(Number(n.toFixed(6)));
}

const VisionCard = ({
  card,
  visionId,
  onOpenDetail,
  onAdjustAmount,
}: {
  card: VisionWallCardModel;
  visionId: string;
  onOpenDetail: () => void;
  onAdjustAmount: (visionId: string, deltaSign: -1 | 1, step: number) => void;
}) => {
  const showProgressAdjust = card.kind === 'progress' && card.wallAdjust;
  const showCountAdjust = card.kind === 'count' && card.wallAdjust;
  const showTargetAdjust = card.kind === 'target' && card.wallAdjust && !card.taskProgressOnly;

  return (
    <View style={styles.card}>
      <Image source={card.imageSource} style={styles.cardBgImg} contentFit="cover" transition={120} />

      {/* 用半透明遮罩模拟 HTML 里的渐变背景（避免再引入 LinearGradient 依赖） */}
      <View style={styles.cardOverlay} />

      <View style={styles.cardContent} pointerEvents="box-none">
        <Pressable onPress={onOpenDetail} style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
          {card.kind === 'progress' && (
            <>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <View style={styles.countRow}>
                <View style={{ gap: 4 }}>
                  <Text style={styles.countKicker}>{card.leftKicker}</Text>
                  <Text style={styles.countValue}>{card.leftValue}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.countKicker}>{card.rightKicker}</Text>
                  <Text style={styles.countValue}>{card.rightValue}</Text>
                </View>
              </View>
            </>
          )}

          {card.kind === 'count' && (
            <>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <View style={styles.countRow}>
                <View style={{ gap: 4 }}>
                  <Text style={styles.countKicker}>{card.leftKicker}</Text>
                  <Text style={styles.countValue}>{card.leftValue}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.countKicker}>{card.rightKicker}</Text>
                  <Text style={styles.countValue}>{card.rightValue}</Text>
                </View>
              </View>
            </>
          )}

          {card.kind === 'target' && (
            <>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <View style={{ gap: 10 }}>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.cardPercentText}>{card.percentText}</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.round(card.percent * 100)}%` },
                    ]}
                  />
                </View>
              </View>
            </>
          )}

          {card.kind === 'countdown' && (
            <>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <View style={styles.countRow}>
                <View style={{ gap: 4 }}>
                  <Text style={styles.countKicker}>
                    {card.countdownKind === 'countup' ? '记录日期' : '截止日期'}
                  </Text>
                  <Text style={styles.countValue}>{card.dateText}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {card.countdownKind === 'countup' ? null : (
                    <Text style={styles.countKicker}>剩余时间</Text>
                  )}
                  <Text style={styles.remainValue}>{card.remainText}</Text>
                </View>
              </View>
            </>
          )}
        </Pressable>

        {showProgressAdjust && card.wallAdjust ? (
          <View style={styles.adjustRow}>
            <Pressable
              onPress={() => onAdjustAmount(visionId, -1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, pressed && { opacity: 0.85 }]}
              accessibilityLabel="减少进度量"
            >
              <MaterialIcons name="remove" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.adjustHint}>步长 {card.wallAdjust.step}</Text>
            <Pressable
              onPress={() => onAdjustAmount(visionId, 1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, styles.adjustBtnPrimary, pressed && { opacity: 0.9 }]}
              accessibilityLabel="增加进度量"
            >
              <MaterialIcons name="add" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {showCountAdjust && card.wallAdjust ? (
          <View style={styles.adjustRow}>
            <Pressable
              onPress={() => onAdjustAmount(visionId, -1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, pressed && { opacity: 0.85 }]}
              accessibilityLabel="减少累计"
            >
              <MaterialIcons name="remove" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.adjustHint}>每次 {card.wallAdjust.step}</Text>
            <Pressable
              onPress={() => onAdjustAmount(visionId, 1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, styles.adjustBtnPrimary, pressed && { opacity: 0.9 }]}
              accessibilityLabel="增加累计"
            >
              <MaterialIcons name="add" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {showTargetAdjust && card.wallAdjust ? (
          <View style={styles.adjustRow}>
            <Pressable
              onPress={() => onAdjustAmount(visionId, -1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, pressed && { opacity: 0.85 }]}
              accessibilityLabel="减少当前量"
            >
              <MaterialIcons name="remove" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.adjustHint}>步长 {card.wallAdjust.step}</Text>
            <Pressable
              onPress={() => onAdjustAmount(visionId, 1, card.wallAdjust!.step)}
              style={({ pressed }) => [styles.adjustBtn, styles.adjustBtnPrimary, pressed && { opacity: 0.9 }]}
              accessibilityLabel="增加当前量"
            >
              <MaterialIcons name="add" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
};

export default function VisionWallScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const [wallEntries, setWallEntries] = useState<WallEntry[]>([]);

  const loadWallEntries = useCallback(async () => {
    try {
      const rows = await listVisions();
      const dbEntries: WallEntry[] = await Promise.all(
        rows.map(async r => ({
          id: r.id,
          card: await visionRowToWallCard(r),
        })),
      );
      setWallEntries(dbEntries);
    } catch {
      setWallEntries([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadWallEntries();
    }, [loadWallEntries]),
  );

  const onAdjustVisionAmount = useCallback(
    async (visionId: string, deltaSign: -1 | 1, step: number) => {
      const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
      try {
        const row = await getVisionRowById(visionId);
        if (!row) return;
        const extra = parseVisionExtra(row.extra_data) ?? {};
        const cur = Number(extra.currentAmount ?? 0);
        const next = Math.max(0, cur + deltaSign * safeStep);
        extra.currentAmount = formatStoredAmount(next);
        await updateVision(visionId, { extra_data: serializeVisionExtra(extra) });
        await loadWallEntries();
      } catch {
        Alert.alert('更新失败', '无法保存累计值，请重试。');
      }
    },
    [loadWallEntries],
  );

  const requestDeleteVision = useCallback((entry: WallEntry) => {
    Alert.alert('删除愿景', '确定删除这条愿景吗？删除后将从愿景墙与我的页移除；在同步或恢复功能前可能无法找回。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteVision(entry.id);
              setWallEntries(prev => prev.filter(e => e.id !== entry.id));
            } catch {
              Alert.alert('删除失败', '无法删除本地数据，请稍后重试。');
            }
          })();
        },
      },
    ]);
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? 'rgba(15,23,42,0.95)' : theme.background }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.85)' }]}>
        <View style={styles.headerLeading}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialIcons
              name="arrow-back"
              size={22}
              color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'}
            />
          </Pressable>
        </View>
        <View style={styles.headerCenter}>
          <Text
            style={[styles.headerTitle, { color: isDark ? 'rgba(248,250,252,0.95)' : 'rgba(15,23,42,0.95)' }]}
            numberOfLines={1}
          >
            愿景墙
          </Text>
        </View>
        <View style={styles.headerTrailing}>
          <Pressable
            onPress={() => router.push('/vision-create')}
            style={({ pressed }) => [styles.headerCreateBtn, pressed && { opacity: 0.88 }]}
          >
            <MaterialIcons name="add" size={17} color="#fff" />
            <Text style={styles.headerCreateBtnText}>创建愿景</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={{ marginTop: 8, marginBottom: 16 }}>
          <Text style={[styles.kicker, { color: isDark ? 'rgba(148,163,184,0.95)' : 'rgba(114,119,133,0.95)' }]}>
            Life Manifesto
          </Text>
          <Text style={[styles.heroTitle, { color: theme.text }]}>未来的数字索引</Text>
          <Text style={[styles.heroDesc, { color: theme.text }]}>
            将长期的渴望转化为可量化的愿景，追踪每一个向着终点前进的刻度。
          </Text>
        </View>

        <View style={{ gap: 16 }}>
          {wallEntries.length === 0 ? (
            <View style={{ paddingVertical: 36, paddingHorizontal: 12, alignItems: 'center' }}>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '600',
                  color: isDark ? 'rgba(148,163,184,0.9)' : 'rgba(114,119,133,0.9)',
                  textAlign: 'center',
                  lineHeight: 22,
                }}
              >
                暂无愿景，点击右上角「创建愿景」添加第一条。
              </Text>
            </View>
          ) : (
            wallEntries.map(entry => (
              <Swipeable
                key={entry.id}
                overshootRight={false}
                rightThreshold={48}
                renderRightActions={() => (
                  <Pressable
                    onPress={() => requestDeleteVision(entry)}
                    style={({ pressed }) => [styles.swipeDeleteAction, pressed && { opacity: 0.92 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`删除愿景 ${entry.card.title}`}
                  >
                    <MaterialIcons name="delete-outline" size={24} color="#fff" />
                    <Text style={styles.swipeDeleteText}>删除</Text>
                  </Pressable>
                )}
              >
                <VisionCard
                  card={entry.card}
                  visionId={entry.id}
                  onOpenDetail={() =>
                    router.push({ pathname: '/vision-detail/[id]', params: { id: entry.id } })
                  }
                  onAdjustAmount={onAdjustVisionAmount}
                />
              </Swipeable>
            ))
          )}
        </View>

        <Text style={[styles.footerText, { color: isDark ? 'rgba(226,232,240,0.45)' : 'rgba(114,119,133,0.45)' }]}>
          The Quantified Life • © 2024
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.15)',
  },
  headerLeading: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTrailing: {
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#0058be',
    shadowColor: '#0058be',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  headerCreateBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: -0.2,
  },

  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 30,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  heroDesc: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.75,
    lineHeight: 20,
  },

  card: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    aspectRatio: 16 / 10,
    position: 'relative',
  },
  cardBgImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  cardOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(19,27,46,0.55)',
  },
  cardContent: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
    gap: 10,
  },
  adjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  adjustBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  adjustBtnPrimary: {
    backgroundColor: '#0058be',
    borderColor: 'rgba(255,255,255,0.25)',
  },
  adjustHint: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 6,
  },
  cardRowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardMeta: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '700',
  },
  cardPercentText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  progressTrack: {
    height: 6,
    width: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#0058be',
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  countKicker: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  countValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  remainValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.2,
  },

  footerText: {
    marginTop: 22,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.95,
    letterSpacing: 0.4,
  },

  swipeDeleteAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    borderRadius: 20,
    marginLeft: 10,
    marginVertical: 2,
    gap: 4,
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
});

