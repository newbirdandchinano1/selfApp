import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type VisionCardModel =
  | {
      kind: 'progress';
      title: string;
      leftText: string;
      percentText: string;
      percent: number; // 0..1
      imageSource: number;
    }
  | {
      kind: 'count';
      title: string;
      leftKicker: string;
      leftValue: string;
      rightKicker: string;
      rightValue: string;
      imageSource: number;
    }
  | {
      kind: 'target';
      title: string;
      percentText: string;
      percent: number; // 0..1
      imageSource: number;
    }
  | {
      kind: 'countdown';
      title: string;
      dateText: string;
      remainText: string;
      imageSource: number;
    };

const VisionCard = ({ card }: { card: VisionCardModel }) => {
  return (
    <View style={styles.card}>
      <Image source={card.imageSource} style={styles.cardBgImg} contentFit="cover" transition={120} />

      {/* 用半透明遮罩模拟 HTML 里的渐变背景（避免再引入 LinearGradient 依赖） */}
      <View style={styles.cardOverlay} />

      <View style={styles.cardContent}>
        {card.kind === 'progress' && (
          <>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <View style={{ gap: 8 }}>
              <View style={styles.cardRowBetween}>
                <Text style={styles.cardMeta}>{card.leftText}</Text>
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
                <Text style={styles.countKicker}>截止日期</Text>
                <Text style={styles.countValue}>{card.dateText}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={styles.countKicker}>剩余时间</Text>
                <Text style={styles.remainValue}>{card.remainText}</Text>
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  );
};

export default function VisionWallScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const cards: VisionCardModel[] = [
    {
      kind: 'progress',
      title: '西藏骑行之旅',
      leftText: '650 km / 1000 km',
      percentText: '65%',
      percent: 0.65,
      imageSource: require('../assets/vision-wall/card1.png'),
    },
    {
      kind: 'count',
      title: '完成 50 本书的阅读',
      leftKicker: '本周进度',
      leftValue: '本周: 2 次',
      rightKicker: '当前总量',
      rightValue: '已读 12 / 50',
      imageSource: require('../assets/vision-wall/card2.png'),
    },
    {
      kind: 'target',
      title: '储蓄目标',
      percentText: '60%',
      percent: 0.6,
      imageSource: require('../assets/vision-wall/card3.png'),
    },
    {
      kind: 'countdown',
      title: '学会一门新语言',
      dateText: '2024-12-31',
      remainText: '还有 45 天',
      imageSource: require('../assets/vision-wall/card4.png'),
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? 'rgba(15,23,42,0.95)' : theme.background }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.85)' }]}>
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
        <Text style={[styles.headerTitle, { color: isDark ? 'rgba(248,250,252,0.95)' : 'rgba(15,23,42,0.95)' }]}>
          愿景墙
        </Text>
        <View style={{ width: 36 }} />
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
          {cards.map((card, idx) => (
            <VisionCard key={idx} card={card} />
          ))}
        </View>

        <View style={{ height: 24 }} />

        <View style={{ paddingHorizontal: 6 }}>
          <Pressable
            style={({ pressed }) => [
              styles.createBtn,
              pressed && { transform: [{ scale: 0.98 }], opacity: 0.95 },
            ]}
            onPress={() => router.push('/vision-create')}
          >
            <MaterialIcons name="add" size={18} color="#fff" />
            <Text style={styles.createBtnText}>创建新的愿景</Text>
          </Pressable>

          <Text style={[styles.footerText, { color: isDark ? 'rgba(226,232,240,0.45)' : 'rgba(114,119,133,0.45)' }]}>
            The Quantified Life • © 2024
          </Text>
        </View>
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
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.15)',
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

  createBtn: {
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#0058be',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
    shadowColor: '#0058be',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
  },
  createBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  footerText: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.95,
    letterSpacing: 0.4,
  },
});

