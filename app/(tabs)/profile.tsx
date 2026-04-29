import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VISION_CARD_WIDTH = SCREEN_WIDTH - 36;

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';
  const [user, setUser] = useState<UserRow | null>(null);

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? theme.surface : '#ffffff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.8)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const wishAccent = isDark ? '#f472b6' : '#b42375';

  const avatarUrl = user?.avatar_uri ? { uri: user.avatar_uri } : require('../../assets/profile/avatar.png');
  const visionUrl = require('../../assets/profile/vision.png');
  const progressBgUrl = require('../../assets/profile/progress.png');
  const displayName = user?.name?.trim() || '默认用户';
  const heightText = user?.height ? String(user.height) : '0';
  const weightText = user?.weight ? String(user.weight) : '0';
  const ageText = user?.age ? String(user.age) : '0';
  const bmiText =
    user && user.height > 0 && user.weight > 0
      ? (user.weight / ((user.height / 100) * (user.height / 100))).toFixed(1)
      : '0.0';

  const visionCards = useMemo(
    () => [
      {
        id: 'book',
        kicker: '年度目标',
        title: '完成 50 本书的阅读',
        progressText: '已读 12 / 50 (24%)',
        progress: 24,
        year: '2024',
      },
      {
        id: 'run',
        kicker: '健康挑战',
        title: '累计跑步 600 公里',
        progressText: '已跑 198 / 600 (33%)',
        progress: 33,
        year: '2024',
      },
      {
        id: 'travel',
        kicker: '人生体验',
        title: '打卡 12 座城市',
        progressText: '已完成 4 / 12 (34%)',
        progress: 34,
        year: '2024',
      },
    ],
    [],
  );

  const [activeVisionIndex, setActiveVisionIndex] = useState(0);
  const isUserInteractingVisionRef = useRef(false);
  const visionListRef = useRef<FlatList<(typeof visionCards)[number]>>(null);
  const visionScrollX = useRef(new Animated.Value(0)).current;
  const autoPlayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoPlay = () => {
    if (autoPlayTimerRef.current) {
      clearInterval(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
  };

  const scheduleAutoPlayResume = () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      isUserInteractingVisionRef.current = false;
      startAutoPlay();
    }, 2200);
  };

  const startAutoPlay = () => {
    clearAutoPlay();
    autoPlayTimerRef.current = setInterval(() => {
      setActiveVisionIndex(prev => {
        const next = (prev + 1) % visionCards.length;
        visionListRef.current?.scrollToOffset({
          offset: next * VISION_CARD_WIDTH,
          animated: true,
        });
        return next;
      });
    }, 3500);
  };

  useEffect(() => {
    startAutoPlay();
    return () => {
      clearAutoPlay();
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    };
  }, []);

  const loadUser = useCallback(async () => {
    try {
      const currentUser = await getDefaultUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useFocusEffect(
    useCallback(() => {
      loadUser();
    }, [loadUser]),
  );

  const healthBgUrl = require('../../assets/profile/health.png');
  const waterBgUrl = require('../../assets/profile/water.png');
  const savingsBgUrl = require('../../assets/profile/savings.png');

  const headerFadeAnim = useRef(new Animated.Value(0)).current;
  const headerLiftAnim = useRef(new Animated.Value(12)).current;
  const profilePulseAnim = useRef(new Animated.Value(1)).current;
  const contentFadeAnim = useRef(new Animated.Value(0)).current;
  const contentLiftAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFadeAnim, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(headerLiftAnim, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(contentFadeAnim, {
        toValue: 1,
        duration: 600,
        delay: 140,
        useNativeDriver: true,
      }),
      Animated.timing(contentLiftAnim, {
        toValue: 0,
        duration: 600,
        delay: 140,
        useNativeDriver: true,
      }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(profilePulseAnim, {
          toValue: 1.05,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(profilePulseAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );

    pulse.start();

    return () => {
      pulse.stop();
    };
  }, [contentFadeAnim, contentLiftAnim, headerFadeAnim, headerLiftAnim, profilePulseAnim]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: 36 + Math.max(insets.bottom, 12),
          },
        ]}>
        <Animated.View
          style={[
            styles.header,
            { backgroundColor: isDark ? surface : '#ffffff' },
            {
              opacity: headerFadeAnim,
              transform: [{ translateY: headerLiftAnim }],
            },
          ]}>
          <View style={[styles.headerBlob, { backgroundColor: `${primary}12` }]} />

          <View style={styles.headerTopRow}>
            <Animated.View style={[styles.avatarWrap, { transform: [{ scale: profilePulseAnim }] }]}>
              <View style={[styles.avatarRing, { borderColor: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(242,243,255,0.95)' }]}>
                <Image source={avatarUrl} style={styles.avatarImg} contentFit="cover" />
              </View>
              <View style={[styles.verifyBadge, { backgroundColor: primary, borderColor: isDark ? surface : '#fff' }]}>
                <MaterialIcons name="verified" size={16} color="#fff" />
              </View>
            </Animated.View>

            <View style={styles.headerInfo}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: text }]}>{displayName}</Text>
                <Pressable
                  onPress={() => router.push('/edit-profile')}
                  style={[styles.iconBtn, { borderColor: `${primary}30` }]}
                >
                  <MaterialIcons name="edit" size={18} color={primary} />
                </Pressable>
              </View>
            </View>
          </View>

          <View style={[styles.statsRow, { borderTopColor: outlineVariant }]}>
            {[
              { label: '身高', value: heightText, unit: 'cm' },
              { label: '体重', value: weightText, unit: 'kg' },
              { label: 'BMI', value: bmiText, unit: '' },
              { label: '年龄', value: ageText, unit: '' },
            ].map((item, idx) => (
              <View
                key={item.label}
                style={[
                  styles.statCell,
                  idx > 0 && { borderLeftWidth: 1, borderLeftColor: outlineVariant },
                ]}>
                <Text style={[styles.statLabel, { color: outline }]}>{item.label}</Text>
                <Text style={[styles.statValue, { color: text }]}>
                  {item.value}
                  {!!item.unit && <Text style={[styles.statUnit, { color: outline }]}> {item.unit}</Text>}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.main,
            {
              opacity: contentFadeAnim,
              transform: [{ translateY: contentLiftAnim }],
            },
          ]}>
          <View style={styles.sectionHead}>
            <View>
              <Text style={[styles.kicker, { color: outline }]}>VISION WALL</Text>
              <Text style={[styles.sectionTitle, { color: text }]}>愿景墙</Text>
            </View>
            <Pressable onPress={() => router.push('/vision-wall')}>
              <Text style={[styles.moreText, { color: primary }]}>查看全部</Text>
            </Pressable>
          </View>

          <View style={styles.visionStackWrap}>
            {[2, 1].map(level => (
              <View
                key={`desk-${level}`}
                pointerEvents="none"
                style={[
                  styles.visionDeskCard,
                  {
                    backgroundColor: isDark ? 'rgba(30,41,59,0.58)' : 'rgba(255,255,255,0.75)',
                    borderColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.3)',
                    transform: [{ translateY: level * 10 }, { scale: 1 - level * 0.03 }, { rotate: `${level % 2 === 0 ? 1.8 : -1.5}deg` }],
                    opacity: 0.9 - level * 0.2,
                  },
                ]}
              />
            ))}

            <Animated.FlatList
              ref={visionListRef}
              horizontal
              pagingEnabled
              data={visionCards}
              keyExtractor={item => item.id}
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              bounces={false}
              onScrollBeginDrag={() => {
                isUserInteractingVisionRef.current = true;
                clearAutoPlay();
              }}
              onScrollEndDrag={scheduleAutoPlayResume}
              onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / VISION_CARD_WIDTH);
                setActiveVisionIndex(Math.max(0, Math.min(index, visionCards.length - 1)));
                scheduleAutoPlayResume();
              }}
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: visionScrollX } } }], {
                useNativeDriver: true,
              })}
              scrollEventThrottle={16}
              renderItem={({ item, index }) => {
                const inputRange = [
                  (index - 1) * VISION_CARD_WIDTH,
                  index * VISION_CARD_WIDTH,
                  (index + 1) * VISION_CARD_WIDTH,
                ];

                const scale = visionScrollX.interpolate({
                  inputRange,
                  outputRange: [0.9, 1, 0.9],
                  extrapolate: 'clamp',
                });
                const translateY = visionScrollX.interpolate({
                  inputRange,
                  outputRange: [20, 0, 20],
                  extrapolate: 'clamp',
                });
                const rotate = visionScrollX.interpolate({
                  inputRange,
                  outputRange: ['5deg', '0deg', '-5deg'],
                  extrapolate: 'clamp',
                });
                const opacity = visionScrollX.interpolate({
                  inputRange,
                  outputRange: [0.72, 1, 0.72],
                  extrapolate: 'clamp',
                });

                return (
                  <Animated.View
                    style={[
                      styles.visionCard,
                      {
                        backgroundColor: surface,
                        opacity,
                        transform: [{ perspective: 1000 }, { translateY }, { rotateZ: rotate }, { scale }],
                      },
                    ]}
                  >
                    <Image source={visionUrl} style={styles.bgImage} contentFit="cover" />
                    <View style={styles.visionOverlay} />
                    <View style={styles.visionContent}>
                      <Text style={styles.cardKicker}>{item.kicker}</Text>
                      <Text style={styles.visionTitle}>{item.title}</Text>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              backgroundColor: 'rgba(173,198,255,0.95)',
                              width: `${item.progress}%` as `${number}%`,
                            },
                          ]}
                        />
                      </View>
                      <View style={styles.progressMetaRow}>
                        <Text style={styles.progressMeta}>{item.progressText}</Text>
                        <Text style={styles.progressYear}>{item.year}</Text>
                      </View>
                    </View>
                  </Animated.View>
                );
              }}
            />

            <View style={styles.visionDots}>
              {visionCards.map((card, idx) => (
                <View
                  key={card.id}
                  style={[
                    styles.visionDot,
                    {
                      width: idx === activeVisionIndex ? 18 : 8,
                      backgroundColor:
                        idx === activeVisionIndex
                          ? primary
                          : isDark
                            ? 'rgba(148,163,184,0.35)'
                            : 'rgba(114,119,133,0.25)',
                    },
                  ]}
                />
              ))}
            </View>
          </View>


          <View style={styles.sectionHead}>
            <View>
              <Text style={[styles.kicker, { color: outline }]}>DIGITAL IDENTITY</Text>
              <Text style={[styles.sectionTitle, { color: text }]}>AI 人格画像</Text>
            </View>
          </View>

          <View style={styles.gridWrap}>
            <Pressable
              onPress={() => router.push('/wish-list' as any)}
              style={[styles.wishEntryCard, { backgroundColor: surface, borderColor: `${wishAccent}24` }]}
            >
              <View style={[styles.wishEntryTopLine, { backgroundColor: `${wishAccent}66` }]} />
              <View style={styles.wishEntryBody}>
                <View style={[styles.wishEntryIcon, { backgroundColor: wishAccent }]}>
                  <MaterialIcons name="favorite-border" size={24} color="#fff" />
                </View>
                <View style={styles.wishEntryTextWrap}>
                  <Text style={[styles.wishEntryKicker, { color: wishAccent }]}>MONEY PLAN</Text>
                  <Text style={[styles.wishEntryTitle, { color: text }]}>欲望清单</Text>
                  <Text style={[styles.wishEntryDesc, { color: outline }]}>
                    记录想买的东西，汇总预算与 AI 评审建议
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={26} color={wishAccent} />
              </View>
            </Pressable>

            <View style={[styles.bigCard, { shadowColor: isDark ? '#000' : '#6c63ff' }]}>
              <Image source={progressBgUrl} style={styles.bgImage} contentFit="cover" />
              <View style={[styles.tintLayer, { backgroundColor: `${primary}66` }]} />
              <View style={styles.bigCardTop}>
                <Text style={styles.cardKicker}>计划完成情况</Text>
                <Text style={styles.percentText}>85%</Text>
              </View>
              <View style={styles.bigCardBottom}>
                <Text style={styles.whiteHint}>本周目标达成率 · 卓越</Text>
                <MaterialIcons name="trending-up" size={30} color="rgba(255,255,255,0.9)" />
              </View>
            </View>

            <View style={styles.twoColRow}>
              <View style={styles.smallCard}>
                <Image source={healthBgUrl} style={styles.bgImage} contentFit="cover" />
                <View style={[styles.tintLayer, { backgroundColor: `${secondary}66` }]} />
                <View>
                  <Text style={styles.cardKicker}>体脂率</Text>
                  <Text style={styles.smallValue}>18%</Text>
                </View>
                <View style={styles.tagPill}>
                  <Text style={styles.tagPillText}>健康态</Text>
                </View>
              </View>

              <View style={styles.smallCard}>
                <Image source={waterBgUrl} style={styles.bgImage} contentFit="cover" />
                <View style={[styles.tintLayer, { backgroundColor: `${primary}55` }]} />
                <View>
                  <Text style={styles.cardKicker}>饮水均值</Text>
                  <Text style={styles.smallValue}>1.8L</Text>
                </View>
                <Text style={styles.smallHint}>每日焕活能量</Text>
              </View>
            </View>

            <View style={styles.savingCard}>
              <Image source={savingsBgUrl} style={styles.bgImage} contentFit="cover" />
              <View style={[styles.tintLayer, { backgroundColor: `${tertiary}66` }]} />
              <View style={styles.savingLeft}>
                <Text style={styles.cardKicker}>储蓄状态</Text>
                <Text style={styles.savingTitle}>资产稳步增长</Text>
                <Text style={styles.savingSub}>目标进度: 30,000 CNY</Text>
              </View>
              <View style={styles.glassIcon}>
                <MaterialIcons name="account-balance" size={30} color="rgba(255,221,184,0.95)" />
              </View>
            </View>

            <View style={[styles.aiCard, { backgroundColor: surface, borderColor: `${primary}1A` }]}>
              <View style={[styles.aiTopLine, { backgroundColor: `${primary}66` }]} />
              <View style={styles.aiBody}>
                <View style={[styles.aiIcon, { backgroundColor: primary }]}> 
                  <MaterialIcons name="auto-awesome" size={24} color="#fff" />
                </View>
                <View style={styles.aiTextWrap}>
                  <View style={styles.aiTitleRow}>
                    <Text style={[styles.aiTitleKicker, { color: primary }]}>AI 智能人格洞察</Text>
                    <View style={[styles.aiDivider, { backgroundColor: `${primary}1A` }]} />
                  </View>
                  <Text style={[styles.aiQuote, { color: text }]}>“你这周的饮水量提升了 15%，非常棒。考虑增加 10g 蛋白质摄入以支持健身训练。在执行储蓄计划方面你做得也很出色，请继续保持你的节奏！”</Text>
                </View>
              </View>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingTop: 0,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 58,
    paddingBottom: 20,
    overflow: 'hidden',
  },
  headerBlob: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 999,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: {
    width: 96,
    height: 96,
    position: 'relative',
  },
  avatarRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    borderWidth: 4,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  verifyBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
  },
  headerInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  name: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  statUnit: {
    fontSize: 10,
    fontWeight: '700',
  },
  main: {
    paddingHorizontal: 18,
    paddingTop: 20,
    gap: 26,
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
  },
  sectionHead: {
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  kicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2.4,
    marginBottom: 3,
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  moreText: {
    fontSize: 14,
    fontWeight: '800',
  },
  visionStackWrap: {
    minHeight: 344,
    justifyContent: 'flex-end',
  },
  visionDeskCard: {
    position: 'absolute',
    height: 300,
    borderRadius: 22,
    borderWidth: 1,
  },
  visionCard: {
    width: SCREEN_WIDTH - 36,
    minHeight: 300,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  visionDots: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  visionDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
  },
  visionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(19,27,46,0.78)',
  },
  visionContent: {
    padding: 24,
    gap: 10,
  },
  cardKicker: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  visionTitle: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.9,
    lineHeight: 40,
  },
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressMeta: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  progressYear: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  gridWrap: {
    gap: 14,
  },
  wishEntryCard: {
    borderWidth: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  wishEntryTopLine: {
    height: 3,
    width: '100%',
  },
  wishEntryBody: {
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  wishEntryIcon: {
    width: 50,
    height: 50,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wishEntryTextWrap: {
    flex: 1,
    gap: 3,
  },
  wishEntryKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  wishEntryTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  wishEntryDesc: {
    fontSize: 13,
    fontWeight: '600',
  },
  bigCard: {
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 190,
    padding: 18,
    justifyContent: 'space-between',
  },
  tintLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  bigCardTop: {
    gap: 5,
  },
  percentText: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  bigCardBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  whiteHint: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '600',
  },
  twoColRow: {
    flexDirection: SCREEN_WIDTH >= 768 ? 'row' : 'column',
    gap: 14,
  },
  smallCard: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 178,
    padding: 18,
    justifyContent: 'space-between',
  },
  smallValue: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  tagPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  tagPillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  smallHint: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '600',
  },
  savingCard: {
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 162,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  savingLeft: {
    flex: 1,
    gap: 5,
    paddingRight: 16,
  },
  savingTitle: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  savingSub: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 12,
    fontWeight: '600',
  },
  glassIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  aiCard: {
    borderWidth: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  aiTopLine: {
    height: 3,
    width: '100%',
  },
  aiBody: {
    padding: 20,
    flexDirection: 'row',
    gap: 12,
  },
  aiIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-3deg' }],
  },
  aiTextWrap: {
    flex: 1,
    gap: 10,
  },
  aiTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiTitleKicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2.2,
  },
  aiDivider: {
    flex: 1,
    height: 1,
  },
  aiQuote: {
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '600',
    fontStyle: 'italic',
    opacity: 0.92,
  },
});
