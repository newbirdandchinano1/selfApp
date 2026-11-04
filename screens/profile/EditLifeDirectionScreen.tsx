/**
 * 总方向编辑：对齐 `我的道路-UI重构.html` route-direction
 *（字数环、年度主题、关键词芯片、实时预览、底栏保存）。
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
  type LifeRoadPalette,
} from '@/constants/life-road-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { currentCalendarYear } from '@/lib/life-road/life-road-limits';
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
import Svg, { Circle, Path } from 'react-native-svg';

const PAGE_KEY = 'edit-life-direction';
const BODY_MAX = 200;
const THEME_MAX = 40;
const KEYWORD_MAX = 3;

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

function CharRing({
  len,
  max,
  animate,
  lr,
}: {
  len: number;
  max: number;
  animate: boolean;
  lr: LifeRoadPalette;
}) {
  const ratio = Math.max(0, Math.min(1, len / max));
  const circumference = 2 * Math.PI * 17;
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

  const stroke =
    ratio >= 1 ? lr.clay : ratio >= 0.85 ? lr.amber : lr.sage;

  return (
    <View style={styles.charRing}>
      <Svg width={38} height={38} viewBox="0 0 40 40" style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={20} cy={20} r={17} stroke={lr.line3} strokeWidth={4} fill="none" />
        <Circle
          cx={20}
          cy={20}
          r={17}
          stroke={stroke}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
        />
      </Svg>
      <View style={styles.charRingLabel}>
        <Text style={[lifeRoadType.monoTiny, { color: lr.ink3, fontWeight: '700' }]}>{len}</Text>
        <Text style={{ fontSize: 7, color: lr.muted2, letterSpacing: 0.3 }}>/{max}</Text>
      </View>
    </View>
  );
}

function SparkIcon({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5l4.5 4.5L19 7"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  const themeLen = [...theme].length;
  const yearNow = currentCalendarYear();
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

  const fillSample = () => {
    const next = SAMPLE_BODIES[sampleIdx.current % SAMPLE_BODIES.length]!;
    sampleIdx.current += 1;
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

  const previewKeys = keywords.length > 0 ? keywords : ['长期主义', '作品感'];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: lr.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.appBar, { paddingTop: insets.top + 4 }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            {
              borderColor: lr.line,
              backgroundColor: 'rgba(252,249,241,0.66)',
              opacity: pressed ? 0.88 : 1,
            },
          ]}>
          <AppIcon name="arrow-back" size={18} color={lr.ink2} />
        </Pressable>
        <View style={styles.appBarTitleWrap}>
          <Text style={[lifeRoadType.appTitle, { color: lr.pine }]}>总方向</Text>
          <Text style={[lifeRoadType.appSub, { color: lr.muted }]}>
            TRUE NORTH · {yearNow}
          </Text>
        </View>
        <Pressable
          onPress={() => void onSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="保存"
          style={({ pressed }) => [
            styles.saveTop,
            canSave
              ? {
                  backgroundColor: lr.pine,
                  borderColor: lr.pine,
                  opacity: pressed ? 0.9 : 1,
                }
              : {
                  backgroundColor: 'rgba(255,255,255,0.38)',
                  borderColor: 'rgba(33,69,58,0.14)',
                },
          ]}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '600',
              letterSpacing: 0.4,
              color: canSave ? lr.onRoad : lr.muted,
            }}>
            {saving ? '保存中' : '保存'}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={lr.pine} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: Math.max(insets.bottom, 16) + 110 },
            ]}
            showsVerticalScrollIndicator={false}>
            <FoldRiseIn animate={motionOn} index={0} fromY={10}>
              <View
                style={[
                  styles.headNote,
                  {
                    borderColor: 'rgba(211,154,85,0.16)',
                    backgroundColor: 'rgba(243,227,199,0.27)',
                  },
                ]}>
                <AppIcon name="explore" size={14} color={lr.clay} />
                <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: '#7C6342' }}>
                  写你愿意反复回来的方向。不用完整，但要诚实。
                </Text>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={1} fromY={10}>
              <View
                style={[
                  styles.formCard,
                  { borderColor: lr.line, backgroundColor: lr.card2 },
                ]}>
                <View style={styles.fieldHead}>
                  <View style={styles.fieldLabel}>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>01</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}>
                      一句长期主义
                    </Text>
                    <Text style={{ fontSize: 10, color: lr.clay }}>必填</Text>
                  </View>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                    {bodyLen} / {BODY_MAX}
                  </Text>
                </View>
                <TextInput
                  value={body}
                  onChangeText={(t) => setBody([...t].slice(0, BODY_MAX).join(''))}
                  multiline
                  placeholder="例如：把时间与注意力，持续投向真正重要的事。"
                  placeholderTextColor={lr.muted2}
                  style={[
                    styles.mainText,
                    lifeRoadType.serifNorth,
                    { color: bodyLen >= BODY_MAX ? lr.clay : lr.ink },
                  ]}
                  textAlignVertical="top"
                />
                <View style={[styles.editorBottom, { borderTopColor: lr.line3 }]}>
                  <Pressable onPress={fillSample} style={styles.randomBtn} hitSlop={6}>
                    <SparkIcon color={lr.clay} />
                    <Text style={{ fontSize: 12, color: lr.clay, letterSpacing: 0.2 }}>
                      随机看看别人怎么写
                    </Text>
                  </Pressable>
                  <CharRing len={bodyLen} max={BODY_MAX} animate={motionOn} lr={lr} />
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={2} fromY={10}>
              <View
                style={[
                  styles.formCard,
                  { borderColor: lr.line, backgroundColor: lr.card2 },
                ]}>
                <View style={styles.fieldHead}>
                  <View style={styles.fieldLabel}>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>02</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}>
                      年度主题
                    </Text>
                  </View>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                    {themeLen} / {THEME_MAX}
                  </Text>
                </View>
                <TextInput
                  value={theme}
                  onChangeText={(t) => setTheme([...t].slice(0, THEME_MAX).join(''))}
                  placeholder="给这一年一个短名字，例如：做少而深"
                  placeholderTextColor={lr.muted2}
                  style={[
                    styles.lineInput,
                    lifeRoadType.serifNorth,
                    { color: lr.ink, borderBottomColor: lr.line },
                  ]}
                />
                <View style={styles.lineNote}>
                  <Text style={{ fontSize: 11, color: lr.muted, flex: 1 }}>
                    会显示在道路页右上角 · 关键词最多 3 个
                  </Text>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>≤ 40 字</Text>
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={3} fromY={10}>
              <View
                style={[
                  styles.formCard,
                  { borderColor: lr.line, backgroundColor: lr.card2 },
                ]}>
                <View style={styles.fieldHead}>
                  <View style={styles.fieldLabel}>
                    <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>03</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }}>
                      关键词芯片
                    </Text>
                  </View>
                  <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>
                    {keywords.length} / {KEYWORD_MAX}
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
                            ? {
                                backgroundColor: lr.pine,
                                borderColor: lr.pine,
                              }
                            : {
                                backgroundColor: 'rgba(255,255,255,0.36)',
                                borderColor: lr.line,
                              },
                        ]}>
                        {on ? <CheckIcon color={lr.onRoad} /> : null}
                        <Text
                          style={{
                            fontSize: 12,
                            letterSpacing: 0.2,
                            color: on ? lr.onRoad : lr.ink3,
                            fontWeight: on ? '700' : '500',
                          }}>
                          {kw}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.chipMeta}>
                  <Text style={{ fontSize: 11, color: lr.muted, flex: 1 }}>
                    从池中挑 3 个，让方向更容易被记住。
                  </Text>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: lr.ink2 }}>
                    {keywords.length} / {KEYWORD_MAX}
                  </Text>
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={4} fromY={10}>
              <View style={styles.previewLabel}>
                <Text style={[lifeRoadType.kickerTiny, { color: lr.clay }]}>
                  PREVIEW · 实时预览
                </Text>
                <Text style={[lifeRoadType.monoTiny, { color: lr.muted2 }]}>PROFILE CARD</Text>
              </View>
              <View style={[styles.previewCard, { backgroundColor: lr.roadDeep }]}>
                <View style={styles.previewOrbit} pointerEvents="none" />
                <View style={styles.previewTop}>
                  <Text style={[lifeRoadType.kickerTiny, { color: 'rgba(245,240,227,0.45)' }]}>
                    MY ROAD · 我的道路
                  </Text>
                  <View
                    style={[
                      styles.pvTheme,
                      {
                        borderColor: 'rgba(230,184,120,0.18)',
                        backgroundColor: 'rgba(230,184,120,0.07)',
                      },
                    ]}>
                    <Text style={{ fontSize: 10, color: lr.amber3, letterSpacing: 0.4 }}>
                      {theme.trim() || '年度主题'}
                    </Text>
                  </View>
                </View>
                <Text
                  style={[lifeRoadType.serifNorth, { color: lr.onRoadDir, marginTop: 9 }]}
                  numberOfLines={2}>
                  {body.trim() || '你的总方向会在这里出现。'}
                </Text>
                <View style={[styles.pvFoot, { borderTopColor: 'rgba(245,240,227,0.1)' }]}>
                  {previewKeys.map((k) => (
                    <View
                      key={k}
                      style={[
                        styles.pvKey,
                        {
                          borderColor: 'rgba(245,240,227,0.1)',
                          backgroundColor: 'rgba(245,240,227,0.04)',
                        },
                      ]}>
                      <Text style={{ fontSize: 10, color: 'rgba(245,240,227,0.6)' }}>{k}</Text>
                    </View>
                  ))}
                  <Text
                    style={[
                      lifeRoadType.monoTiny,
                      { color: 'rgba(245,240,227,0.35)', marginLeft: 'auto' },
                    ]}>
                    …
                  </Text>
                </View>
              </View>
            </FoldRiseIn>

            <View style={styles.helperNote}>
              <AppIcon name="info-outline" size={12} color={lr.muted2} />
              <Text style={{ flex: 1, fontSize: 11, lineHeight: 16, color: lr.muted }}>
                年度主题会显示在道路页右上角；当前导图顶栏以「+ 多年」为主。
              </Text>
            </View>
          </ScrollView>

          <View
            style={[
              styles.formFooter,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                backgroundColor: lr.paper,
              },
            ]}>
            <Pressable
              onPress={() => void onSave()}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.btnSave,
                {
                  backgroundColor: lr.pine,
                  opacity: !canSave ? 0.38 : pressed ? 0.92 : 1,
                },
              ]}>
              <CheckIcon color={lr.onRoad} />
              <Text style={[lifeRoadType.cta, { color: lr.onRoad, letterSpacing: 0.8 }]}>
                {saving ? '保存中…' : '保存总方向'}
              </Text>
            </Pressable>
            <Text style={styles.footerHint}>
              {canSave
                ? '有改动 · 保存后返回'
                : body.trim()
                  ? '有改动才可保存 · 保存后返回'
                  : '正文必填 · 有改动才可保存 · 保存后返回'}
            </Text>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 8,
    gap: 9,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0, alignItems: 'center' },
  saveTop: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingTop: 4, gap: 0 },
  headNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  formCard: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 13,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  fieldLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  mainText: {
    minHeight: 136,
    paddingHorizontal: 2,
    paddingVertical: 0,
  },
  editorBottom: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  randomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(191,111,82,0.35)',
    flexShrink: 1,
  },
  charRing: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charRingLabel: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineInput: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 1,
    paddingTop: 3,
    paddingBottom: 7,
    fontSize: 14,
  },
  lineNote: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipMeta: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewLabel: {
    marginTop: 14,
    marginHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  previewCard: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    borderRadius: 21,
    overflow: 'hidden',
  },
  previewOrbit: {
    position: 'absolute',
    right: -52,
    top: -64,
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 1,
    borderColor: 'rgba(245,240,227,0.08)',
  },
  previewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    zIndex: 2,
  },
  pvTheme: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pvFoot: {
    marginTop: 10,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    zIndex: 2,
  },
  pvKey: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  helperNote: {
    marginTop: 9,
    marginHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
  },
  formFooter: {
    paddingHorizontal: 18,
    paddingTop: 9,
  },
  btnSave: {
    height: 43,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  footerHint: {
    textAlign: 'center',
    marginTop: 7,
    fontSize: 11,
    color: '#A6AEA5',
    letterSpacing: 0.2,
  },
});
