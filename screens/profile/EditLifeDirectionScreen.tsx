/**
 * 总方向编辑：对齐设计稿 12（字数环、年度主题、关键词、实时预览）。
 */
import {
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui/app-icon';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
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
import Svg, { Circle } from 'react-native-svg';

const PAGE_KEY = 'edit-life-direction';
const BODY_MAX = 200;
const THEME_MAX = 40;
const KEYWORD_MAX = 3;

const KEYWORD_POOL = ['稳定', '留痕', '松弛', '身体', '作品', '关系', '专注', '勇气'] as const;

const SAMPLE_BODIES = [
  '把今年活成「可以被回看」的一年。少一点临时起意，多一点能留下痕迹的事。',
  '先把底座打稳：身体、金钱、注意力，再谈扩张。',
  '少开新坑，把已经开始的事做到能交差、能复盘。',
  '今年只押三件事：健康、作品、一段认真的关系。',
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

function CharRing({ ratio, animate }: { ratio: number; animate: boolean }) {
  const { fold } = useFoldTheme();
  const clamped = Math.max(0, Math.min(1, ratio));
  const circumference = 2 * Math.PI * 14;
  const offsetAnim = useRef(new Animated.Value(circumference * (1 - clamped))).current;

  useEffect(() => {
    const target = circumference * (1 - clamped);
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
  }, [animate, circumference, clamped, offsetAnim]);

  const [dashOffset, setDashOffset] = useState(circumference * (1 - clamped));
  useEffect(() => {
    const id = offsetAnim.addListener(({ value }) => setDashOffset(value));
    return () => offsetAnim.removeListener(id);
  }, [offsetAnim]);

  return (
    <View style={styles.charRing}>
      <Svg width={34} height={34} viewBox="0 0 34 34" style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={17} cy={17} r={14} stroke={fold.line} strokeWidth={3} fill="none" />
        <Circle
          cx={17}
          cy={17}
          r={14}
          stroke={fold.amber}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
        />
      </Svg>
      <Text style={[styles.charRingPct, { color: '#8A6222', fontFamily: foldFonts.mono }]}>
        {Math.round(clamped * 100)}
      </Text>
    </View>
  );
}

export default function EditLifeDirectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const { notifyAncestorsDataChanged } = usePageApiSync(PAGE_KEY);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [row, setRow] = useState<LifeDirectionRow | null>(null);
  const [body, setBody] = useState('');
  const [theme, setTheme] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draftAt, setDraftAt] = useState<string | null>(null);
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

  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      setDraftAt(
        `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
      );
    }, 600);
    return () => clearTimeout(t);
  }, [body, theme, keywords, loading]);

  const bodyLen = [...body].length;
  const ratio = bodyLen / BODY_MAX;
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
      toast.warn('请填写总方向');
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
      toast.success('已保存总方向');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请检查网络后重试'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.appBar, { paddingTop: insets.top + 4, borderBottomColor: fold.line }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="arrow-back" size={20} color={fold.ink} />
        </Pressable>
        <View style={styles.appBarTitleWrap}>
          <Text style={[styles.appTitle, { color: fold.ink }]}>总方向</Text>
          <Text style={[styles.appSub, { color: fold.muted }]}>1–200 字 · 只对自己可见</Text>
        </View>
        <Pressable
          onPress={() => void onSave()}
          disabled={saving || loading || !dirty}
          accessibilityRole="button"
          accessibilityLabel="保存"
          style={({ pressed }) => [
            styles.pillBtn,
            {
              backgroundColor: dirty ? fold.pineButton : fold.paper2,
              borderColor: dirty ? fold.pineButton : fold.line,
              opacity: !dirty || saving || loading ? 0.55 : pressed ? 0.9 : 1,
            },
          ]}>
          <Text style={{ color: dirty ? fold.onPineButton : fold.muted, fontWeight: '700', fontSize: 12 }}>
            {saving ? '保存中' : '保存'}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: Math.max(insets.bottom, 16) + 28 },
            ]}
            showsVerticalScrollIndicator={false}>
            <FoldRiseIn animate={motionOn} index={0} fromY={10}>
              <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
                <View style={styles.rowline}>
                  <Text style={[styles.prompt, { color: fold.ink2 }]}>今年，我想往哪里走</Text>
                  <CharRing ratio={ratio} animate={motionOn} />
                </View>
                <TextInput
                  value={body}
                  onChangeText={(t) => setBody([...t].slice(0, BODY_MAX).join(''))}
                  multiline
                  placeholder="少一点临时起意，多一点能留下痕迹的事。"
                  placeholderTextColor={fold.faint}
                  style={[
                    styles.textarea,
                    { color: fold.ink, borderColor: fold.line, backgroundColor: fold.paper },
                  ]}
                  textAlignVertical="top"
                />
                <View style={styles.rowline}>
                  <Text style={{ fontSize: 11, color: fold.faint }}>
                    {bodyLen} / {BODY_MAX} 字
                  </Text>
                  <Pressable onPress={fillSample} hitSlop={8}>
                    <Text style={{ fontSize: 11, color: '#8B6126', fontWeight: '700' }}>
                      随机看看别人怎么写 ›
                    </Text>
                  </Pressable>
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={1} fromY={10}>
              <View style={styles.field}>
                <View style={styles.rowline}>
                  <Text style={[styles.label, { color: fold.ink2 }]}>年度主题</Text>
                  <Text style={{ fontSize: 11, color: fold.faint }}>显示在道路页右上角</Text>
                </View>
                <View style={[styles.inputRow, { backgroundColor: fold.card, borderColor: fold.line }]}>
                  <TextInput
                    value={theme}
                    onChangeText={(t) => setTheme([...t].slice(0, THEME_MAX).join(''))}
                    placeholder="如：留痕之年"
                    placeholderTextColor={fold.faint}
                    style={[styles.inputText, { color: fold.ink }]}
                  />
                  <AppIcon name="edit" size={14} color={fold.faint} />
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={2} fromY={10}>
              <View style={styles.field}>
                <View style={styles.rowline}>
                  <Text style={[styles.label, { color: fold.ink2 }]}>这一年的三个关键词</Text>
                  <Text style={{ fontSize: 11, color: fold.faint }}>最多 {KEYWORD_MAX} 个</Text>
                </View>
                <View style={styles.tpills}>
                  {KEYWORD_POOL.map((kw) => {
                    const on = keywords.includes(kw);
                    return (
                      <Pressable
                        key={kw}
                        onPress={() => toggleKeyword(kw)}
                        style={[
                          styles.tpill,
                          {
                            backgroundColor: on ? '#E7EFE9' : '#F8F4EA',
                            borderColor: on ? '#BFD4C6' : fold.line,
                          },
                        ]}>
                        {on ? <AppIcon name="check" size={12} color="#3C5C4D" /> : null}
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: on ? '800' : '600',
                            color: on ? '#3C5C4D' : '#6F7A72',
                          }}>
                          {kw}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={3} fromY={10}>
              <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
                <View style={styles.rowline}>
                  <Text style={[styles.label, { color: fold.ink2 }]}>在道路页会这样出现</Text>
                  <View style={[styles.liveTag, { backgroundColor: fold.sage2 }]}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: fold.pine2 }}>实时预览</Text>
                  </View>
                </View>
                <View style={styles.rowline}>
                  <Text style={[styles.kicker, { color: fold.muted }]}>TOTAL DIRECTION</Text>
                  <View style={[styles.yearTag, { backgroundColor: fold.amber2 }]}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#8B6126' }}>{yearNow}</Text>
                  </View>
                </View>
                <Text
                  style={[
                    styles.previewBody,
                    { color: fold.pine, fontFamily: foldFonts.serif },
                  ]}>
                  {body.trim() || '（写下总方向后会显示在这里）'}
                </Text>
              </View>
            </FoldRiseIn>

            <View style={[styles.noteCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <AppIcon name="lightbulb-outline" size={13} color={fold.faint} />
              <Text style={{ flex: 1, fontSize: 11, lineHeight: 16, color: fold.faint }}>
                总方向不设 KPI。它只用来判断一条新赌注「值不值得占用今年 5 个名额」。
              </Text>
            </View>

            <Pressable
              onPress={() => void onSave()}
              disabled={saving || !body.trim()}
              style={({ pressed }) => [
                styles.primary,
                {
                  backgroundColor: fold.pineButton,
                  opacity: saving || !body.trim() ? 0.55 : pressed ? 0.92 : 1,
                },
              ]}>
              <Text style={{ color: fold.onPineButton, fontWeight: '800', fontSize: 14 }}>
                {saving ? '保存中…' : '保存总方向'}
              </Text>
            </Pressable>

            <View style={styles.formFoot}>
              <View style={[styles.dot, { backgroundColor: fold.sage }]} />
              <Text style={{ fontSize: 11, color: fold.faint }}>
                {draftAt ? `草稿已自动保存 · ${draftAt}` : '编辑后将自动保留草稿标记'}
              </Text>
            </View>
          </ScrollView>
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
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0 },
  appTitle: { fontSize: 18, fontWeight: '800' },
  appSub: { marginTop: 2, fontSize: 11, fontWeight: '600' },
  pillBtn: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 15, paddingTop: 10, gap: 10 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 10,
    gap: 6,
  },
  rowline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  prompt: { fontSize: 13, fontWeight: '800', flex: 1 },
  charRing: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  charRingPct: {
    position: 'absolute',
    fontSize: 8,
    fontWeight: '800',
  },
  textarea: {
    minHeight: 110,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 22,
  },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '800' },
  inputRow: {
    height: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputText: { flex: 1, fontSize: 14, fontWeight: '600', paddingVertical: 0 },
  tpills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tpill: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  liveTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  kicker: { fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
  yearTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  previewBody: { fontSize: 14, lineHeight: 21, fontWeight: '600', marginTop: 2 },
  noteCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  primary: {
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  formFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
