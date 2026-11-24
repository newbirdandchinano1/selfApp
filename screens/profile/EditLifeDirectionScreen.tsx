/**
 * 总方向编辑：奶油松墨「北极星工坊」深色版（对齐 editorial HTML renderEditDirection）。
 */
import { useWardrobeFonts } from '@/components/wardrobe/use-wardrobe-fonts';
import {
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui/app-icon';
import {
  lifeRoadType,
  useLifeRoadTheme,
} from '@/constants/life-road-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import {
  getLifeDirection,
  upsertLifeDirection,
} from '@/lib/repositories/life-road/life-direction';
import type { LifeDirectionRow } from '@/lib/repositories/life-road/life-direction.types';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';

const PAGE_KEY = 'edit-life-direction';
const BODY_MAX = 200;
const THEME_MAX = 40;
const KEYWORD_MAX = 3;

const SAGE = '#A9C7B9';
const AMBER = '#E0B072';
const CREAM = '#F5F3E8';
const INK_DARK = '#121A16';

const KEYWORD_POOL = [
  '长期主义',
  '作品感',
  '节奏',
  '身体',
  '自由',
  '关系',
  '深度',
  '探索',
] as const;

const SAMPLE_BODIES = [
  '把时间与注意力，持续投向真正重要的事：做少而深的作品，也留出足够的时间生活。',
  '成为一个能把复杂问题讲清楚的人，用手上的作品，换来选择的自由。',
  '让身体有力量，让关系有温度，让作品有分量。慢一点，但一直在走。',
];

type DirectionExtra = { keywords?: string[] };

function parseExtra(raw: string | null | undefined): DirectionExtra {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const keywords = (parsed as DirectionExtra).keywords;
    if (!Array.isArray(keywords)) return {};
    return {
      keywords: keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0),
    };
  } catch {
    return {};
  }
}

function HeroGradientFill({ from, to }: { from: string; to: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="dirHeroGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#dirHeroGrad)" />
    </Svg>
  );
}

function CharRing({
  len,
  max,
  animate,
}: {
  len: number;
  max: number;
  animate: boolean;
}) {
  const ratio = Math.max(0, Math.min(1, len / max));
  const circumference = 2 * Math.PI * 11;
  const offsetAnim = useRef(new Animated.Value(circumference * (1 - ratio))).current;

  useEffect(() => {
    const target = circumference * (1 - ratio);
    if (!animate) {
      offsetAnim.setValue(target);
      return;
    }
    Animated.timing(offsetAnim, {
      toValue: target,
      duration: 280,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start();
  }, [animate, circumference, ratio, offsetAnim]);

  const [dashOffset, setDashOffset] = useState(circumference * (1 - ratio));
  useEffect(() => {
    const id = offsetAnim.addListener(({ value }) => setDashOffset(value));
    return () => offsetAnim.removeListener(id);
  }, [offsetAnim]);

  const stroke = ratio >= 1 ? '#E08B6D' : AMBER;

  return (
    <View style={styles.charRing}>
      <Svg width={28} height={28} viewBox="0 0 28 28" style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={14} cy={14} r={11} stroke="rgba(255,255,255,0.12)" strokeWidth={2} fill="none" />
        <Circle
          cx={14}
          cy={14}
          r={11}
          stroke={stroke}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
        />
      </Svg>
    </View>
  );
}

function KeywordOrbit({ keywords }: { keywords: string[] }) {
  const points = keywords.slice(0, KEYWORD_MAX).map((_, i) => {
    const ang = (i * 120 * Math.PI) / 180;
    return { x: 50 + 34 * Math.cos(ang), y: 50 + 34 * Math.sin(ang) };
  });

  return (
    <Svg
      width={80}
      height={80}
      viewBox="0 0 100 100"
      style={styles.orbitSvg}
      pointerEvents="none">
      <Circle
        cx={50}
        cy={50}
        r={34}
        stroke={SAGE}
        strokeOpacity={0.25}
        strokeDasharray="2 4"
        fill="none"
      />
      <Circle cx={50} cy={50} r={4} fill={AMBER} />
      {points.map((p, i) => (
        <React.Fragment key={i}>
          <Line
            x1={50}
            y1={50}
            x2={p.x}
            y2={p.y}
            stroke={AMBER}
            strokeOpacity={0.4}
            strokeWidth={1}
          />
          <Circle cx={p.x} cy={p.y} r={3} fill={SAGE} />
        </React.Fragment>
      ))}
    </Svg>
  );
}

export default function EditLifeDirectionScreen() {
  useWardrobeFonts();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lr } = useLifeRoadTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const { notifyAncestorsDataChanged } = usePageApiSync(PAGE_KEY);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [row, setRow] = useState<LifeDirectionRow | null>(null);
  const [body, setBody] = useState('');
  const [theme, setTheme] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const sampleIdx = useRef(0);

  const load = useCallback(async () => {
    try {
      const next = await getLifeDirection({ serverFallback: true });
      setRow(next);
      setBody(next?.body ?? '');
      setTheme(next?.year_theme ?? '');
      setKeywords(parseExtra(next?.extra_data).keywords?.slice(0, KEYWORD_MAX) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bodyLen = [...body].length;
  const dirty = useMemo(() => {
    const baseBody = row?.body ?? '';
    const baseTheme = row?.year_theme ?? '';
    const baseKw = (parseExtra(row?.extra_data).keywords ?? []).join('|');
    return (
      body.trim() !== baseBody.trim() ||
      theme.trim() !== baseTheme.trim() ||
      keywords.join('|') !== baseKw
    );
  }, [body, keywords, row, theme]);

  const canSave = Boolean(body.trim()) && dirty && !saving && !loading;

  const toggleKeyword = (kw: string) => {
    setKeywords((prev) => {
      if (prev.includes(kw)) return prev.filter((k) => k !== kw);
      if (prev.length >= KEYWORD_MAX) {
        toast.warn(`最多选 ${KEYWORD_MAX} 个关键词`);
        return prev;
      }
      return [...prev, kw];
    });
  };

  const fillSample = (idx: number) => {
    const next = SAMPLE_BODIES[idx % SAMPLE_BODIES.length]!;
    sampleIdx.current = idx + 1;
    setBody(next.slice(0, BODY_MAX));
  };

  const onSave = async () => {
    if (!body.trim()) {
      toast.warn('先写一句总方向');
      return;
    }
    setSaving(true);
    try {
      const extra = JSON.stringify({ keywords });
      const saved = await upsertLifeDirection({
        id: row?.id,
        body,
        year_theme: theme.trim() || null,
        extra_data: keywords.length > 0 ? extra : null,
      });
      setRow(saved);
      notifyAncestorsDataChanged();
      toast.success('总方向已保存');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请检查网络后重试'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.safe, { backgroundColor: lr.roadDeep }]}>
      <HeroGradientFill from={lr.roadDeep} to={lr.roadDeepMid} />
      <SafeAreaView style={styles.safeInner} edges={['left', 'right']}>
        <Stack.Screen options={{ headerShown: false }} />

        <View style={[styles.appBar, { paddingTop: insets.top + 6 }]}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={10}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 2 }]}>
            <AppIcon name="chevron-left" size={18} color={SAGE} />
            <Text style={{ fontSize: 12, fontWeight: '500', color: SAGE }}>返回</Text>
          </Pressable>
          <Text style={[lifeRoadType.kickerTiny, { color: AMBER }]}>总方向</Text>
          <Pressable
            onPress={() => void onSave()}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="保存"
            style={({ pressed }) => [
              styles.saveTop,
              canSave
                ? { backgroundColor: AMBER, opacity: pressed ? 0.9 : 1 }
                : { backgroundColor: 'rgba(255,255,255,0.08)' },
            ]}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: canSave ? INK_DARK : 'rgba(255,255,255,0.3)',
              }}>
              {saving ? '保存中' : '保存'}
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={AMBER} />
          </View>
        ) : (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.scroll,
                { paddingBottom: Math.max(insets.bottom, 16) + 32 },
              ]}
              showsVerticalScrollIndicator={false}>
              <FoldRiseIn animate={motionOn} index={0} fromY={10}>
                <View style={styles.previewCard}>
                  <KeywordOrbit keywords={keywords} />
                  <Text style={[lifeRoadType.kickerTiny, { color: SAGE }]}>实时预览</Text>
                  <Text
                    style={[
                      lifeRoadType.serifNorth,
                      { color: CREAM, marginTop: 8, fontSize: 16, lineHeight: 26 },
                    ]}>
                    {body.trim() || '你的总方向会在这里出现。'}
                  </Text>
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={motionOn} index={1} fromY={10}>
                <View style={[styles.section, styles.sectionBorder]}>
                  <View style={styles.fieldHead}>
                    <Text style={styles.fieldLabel}>长文正文 *</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <CharRing len={bodyLen} max={BODY_MAX} animate={motionOn} />
                      <Text style={[lifeRoadType.monoTiny, { color: SAGE }]}>
                        {bodyLen}/{BODY_MAX}
                      </Text>
                    </View>
                  </View>
                  <TextInput
                    value={body}
                    onChangeText={(t) => setBody([...t].slice(0, BODY_MAX).join(''))}
                    multiline
                    placeholder="写下一句指引长期方向的话…"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    style={[
                      styles.mainText,
                      lifeRoadType.serifNorth,
                      { color: bodyLen >= BODY_MAX ? '#E08B6D' : CREAM },
                    ]}
                    textAlignVertical="top"
                  />
                  <View style={styles.sampleRow}>
                    {SAMPLE_BODIES.map((_, i) => (
                      <Pressable
                        key={i}
                        onPress={() => fillSample(i)}
                        style={({ pressed }) => [
                          styles.sampleChip,
                          { opacity: pressed ? 0.75 : 1 },
                        ]}>
                        <Text style={{ fontSize: 11, color: SAGE }}>示例 {i + 1}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={motionOn} index={2} fromY={10}>
                <View style={[styles.section, styles.sectionBorder]}>
                  <Text style={styles.fieldLabel}>年度主题（≤40）</Text>
                  <TextInput
                    value={theme}
                    onChangeText={(t) => setTheme([...t].slice(0, THEME_MAX).join(''))}
                    placeholder="给这一年一个短名字…"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    style={[styles.lineInput, { color: CREAM }]}
                  />
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={motionOn} index={3} fromY={10}>
                <View style={styles.section}>
                  <View style={styles.fieldHead}>
                    <Text style={styles.fieldLabel}>关键词坐标</Text>
                    <Text style={{ fontSize: 11, color: AMBER }}>
                      {keywords.length}/{KEYWORD_MAX}
                    </Text>
                  </View>
                  <View style={styles.chips}>
                    {KEYWORD_POOL.map((kw) => {
                      const on = keywords.includes(kw);
                      return (
                        <Pressable
                          key={kw}
                          onPress={() => toggleKeyword(kw)}
                          style={[
                            styles.chip,
                            on
                              ? { backgroundColor: SAGE, borderColor: SAGE }
                              : {
                                  backgroundColor: 'transparent',
                                  borderColor: 'rgba(255,255,255,0.16)',
                                },
                          ]}>
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: '500',
                              color: on ? INK_DARK : '#E9F2ED',
                            }}>
                            {kw}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </FoldRiseIn>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  safeInner: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  saveTop: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 0 },
  previewCard: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 20,
    overflow: 'hidden',
    marginBottom: 24,
  },
  orbitSvg: {
    position: 'absolute',
    right: 12,
    top: 12,
    opacity: 0.45,
  },
  section: {
    paddingBottom: 20,
    marginBottom: 4,
  },
  sectionBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    marginBottom: 20,
  },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: SAGE,
  },
  mainText: {
    minHeight: 100,
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontSize: 15,
    lineHeight: 24,
  },
  sampleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  sampleChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  charRing: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineInput: {
    fontSize: 14,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
