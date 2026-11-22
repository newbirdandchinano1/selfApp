/**
 * 星座运势详情：今日 / 明日 / 本周 / 本月 / 本年（徽章插画 + 星级图示）
 */
import { ZodiacSignArt } from '@/components/profile/ZodiacSignArt';
import { AppIcon } from '@/components/ui/app-icon';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import {
  apiExternalHoroscope,
  type ExternalHoroscopeDayLike,
  type ExternalHoroscopeMonth,
  type ExternalHoroscopeWeek,
  type ExternalHoroscopeYear,
} from '@/lib/api/endpoints/external';
import { toUserMessage } from '@/lib/app-feedback';
import { resolveZodiacVisual } from '@/lib/zodiac-visuals';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function StarRow({
  value,
  color,
  empty,
}: {
  value: number | null | undefined;
  color: string;
  empty: string;
}) {
  const v =
    value == null || !Number.isFinite(value)
      ? 0
      : Math.max(0, Math.min(5, Math.round(value)));
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <AppIcon
          key={i}
          name={i < v ? 'star' : 'star-border'}
          size={13}
          color={i < v ? color : empty}
        />
      ))}
    </View>
  );
}

function indexLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return String(Math.round(n));
}

function Field({
  label,
  value,
  ink,
  muted,
}: {
  label: string;
  value: string | null | undefined;
  ink: string;
  muted: string;
}) {
  const text = value?.trim();
  if (!text) return null;
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: ink }]}>{label}</Text>
      <Text style={[styles.fieldBody, { color: muted }]}>{text}</Text>
    </View>
  );
}

function DayLikeSection({
  title,
  data,
  fold,
  accent,
  extras,
}: {
  title: string;
  data: ExternalHoroscopeDayLike | null;
  fold: ReturnType<typeof useFoldTheme>['fold'];
  accent: string;
  extras?: React.ReactNode;
}) {
  if (!data) {
    return (
      <View style={[styles.section, { backgroundColor: fold.card, borderColor: fold.line }]}>
        <Text style={[styles.sectionTitle, { color: fold.ink2 }]}>{title}</Text>
        <Text style={[styles.fieldBody, { color: fold.faint }]}>暂无数据</Text>
      </View>
    );
  }
  return (
    <View style={[styles.section, { backgroundColor: fold.card, borderColor: fold.line }]}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: fold.ink2 }]}>{title}</Text>
        <StarRow value={data.summaryStar} color={accent} empty={fold.starEmpty} />
      </View>
      {data.notice ? (
        <Text style={[styles.notice, { color: accent }]}>{data.notice}</Text>
      ) : null}
      <View style={styles.starGrid}>
        {(
          [
            ['爱情', data.loveStar, 'favorite'],
            ['事业', data.workStar, 'work'],
            ['财运', data.moneyStar, 'savings'],
          ] as const
        ).map(([label, star, icon]) => (
          <View key={label} style={styles.starLine}>
            <AppIcon name={icon} size={14} color={accent} />
            <Text style={[styles.starLabel, { color: fold.faint }]}>{label}</Text>
            <StarRow value={star} color={accent} empty={fold.starEmpty} />
          </View>
        ))}
      </View>
      <Text style={[styles.lucky, { color: fold.muted }]}>
        {[
          data.luckyColor ? `吉色 ${data.luckyColor}` : null,
          data.luckyNum ? `幸运数 ${data.luckyNum}` : null,
          data.luckyDirection ? `方位 ${data.luckyDirection}` : null,
          data.luckyTime ? `吉时 ${data.luckyTime}` : null,
          data.nobleSign ? `贵人 ${data.nobleSign}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Field label="综合运势" value={data.general} ink={fold.ink2} muted={fold.muted} />
      <Field label="爱情" value={data.love} ink={fold.ink2} muted={fold.muted} />
      <Field label="事业" value={data.work} ink={fold.ink2} muted={fold.muted} />
      <Field label="财运" value={data.money} ink={fold.ink2} muted={fold.muted} />
      {extras}
    </View>
  );
}

export default function HoroscopeDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const params = useLocalSearchParams<{ star?: string }>();
  const star = useMemo(() => {
    const raw = params.star;
    const v = Array.isArray(raw) ? raw[0] : raw;
    return (v ?? '').trim();
  }, [params.star]);
  const zodiac = useMemo(() => resolveZodiacVisual(star), [star]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signName, setSignName] = useState(star || zodiac.name);
  const [day, setDay] = useState<ExternalHoroscopeDayLike | null>(null);
  const [tomorrow, setTomorrow] = useState<ExternalHoroscopeDayLike | null>(null);
  const [week, setWeek] = useState<ExternalHoroscopeWeek | null>(null);
  const [month, setMonth] = useState<ExternalHoroscopeMonth | null>(null);
  const [year, setYear] = useState<ExternalHoroscopeYear | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!star) {
      setLoading(false);
      setError('未指定星座');
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const data = await apiExternalHoroscope({
        star,
        scopes: 'all',
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setSignName(data.sign?.name || star);
      setDay(data.day);
      setTomorrow(data.tomorrow);
      setWeek(data.week);
      setMonth(data.month);
      setYear(data.year);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(toUserMessage(e, '运势加载失败'));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [star]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + 6,
            borderBottomColor: fold.line,
            backgroundColor: fold.paper,
          },
        ]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={8}
          style={({ pressed }) => [
            styles.backBtn,
            {
              borderColor: fold.line,
              backgroundColor: pressed ? fold.paper2 : fold.card,
            },
          ]}>
          <AppIcon name="arrow-back" size={18} color={fold.ink2} />
        </Pressable>
        <ZodiacSignArt zodiacLabel={signName || star} visual={zodiac} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: fold.ink }]} numberOfLines={1}>
            星座运势
          </Text>
          <Text style={[styles.sub, { color: zodiac.accent, fontFamily: foldFonts.serif }]}>
            {zodiac.glyph} {signName || zodiac.name}
          </Text>
        </View>
        <Pressable
          onPress={() => void load()}
          accessibilityLabel="刷新运势"
          hitSlop={8}
          style={({ pressed }) => [
            styles.backBtn,
            {
              borderColor: fold.line,
              backgroundColor: pressed ? fold.paper2 : fold.card,
            },
          ]}>
          {loading ? (
            <ActivityIndicator size="small" color={fold.pine} />
          ) : (
            <AppIcon name="refresh" size={16} color={fold.ink2} />
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}>
        {loading && !day && !tomorrow && !week ? (
          <View style={styles.center}>
            <ActivityIndicator color={fold.pine} />
            <Text style={[styles.sub, { color: fold.muted }]}>拉取完整运势…</Text>
          </View>
        ) : error && !day && !tomorrow && !week ? (
          <Pressable onPress={() => void load()} style={styles.center}>
            <Text style={[styles.sub, { color: fold.muted }]}>{error}</Text>
            <Text style={[styles.retry, { color: fold.pine }]}>重试</Text>
          </Pressable>
        ) : (
          <>
            <DayLikeSection title="今日" data={day} fold={fold} accent={zodiac.accent} />
            <DayLikeSection title="明日" data={tomorrow} fold={fold} accent={zodiac.accent} />
            <DayLikeSection
              title="本周"
              data={week}
              fold={fold}
              accent={zodiac.accent}
              extras={
                week ? (
                  <>
                    <Field label="健康" value={week.health} ink={fold.ink2} muted={fold.muted} />
                    <Field
                      label="本周提示"
                      value={week.weekNotice}
                      ink={fold.ink2}
                      muted={fold.muted}
                    />
                    <Field
                      label="幸运日"
                      value={week.luckyDay}
                      ink={fold.ink2}
                      muted={fold.muted}
                    />
                    <Field
                      label="对手星座"
                      value={week.rivalSign}
                      ink={fold.ink2}
                      muted={fold.muted}
                    />
                  </>
                ) : null
              }
            />
            <DayLikeSection
              title="本月"
              data={month}
              fold={fold}
              accent={zodiac.accent}
              extras={
                month ? (
                  <>
                    <Field
                      label="速配星座"
                      value={month.matchSign}
                      ink={fold.ink2}
                      muted={fold.muted}
                    />
                    <Field
                      label="对手星座"
                      value={month.rivalSign}
                      ink={fold.ink2}
                      muted={fold.muted}
                    />
                    <Field
                      label="优势"
                      value={month.advantage}
                      ink={fold.ink2}
                      muted={fold.muted}
                    />
                    <Field
                      label="短板"
                      value={month.weakness}
                      ink={fold.ink2}
                      muted={fold.muted}
                    />
                  </>
                ) : null
              }
            />
            {year ? (
              <View
                style={[styles.section, { backgroundColor: fold.card, borderColor: fold.line }]}>
                <Text style={[styles.sectionTitle, { color: fold.ink2 }]}>本年</Text>
                {year.oneword ? (
                  <Text
                    style={[styles.notice, { color: zodiac.accent, fontFamily: foldFonts.serif }]}>
                    {year.oneword}
                  </Text>
                ) : null}
                <View style={styles.starGrid}>
                  {(
                    [
                      ['综合', year.generalIndex],
                      ['爱情', year.loveIndex],
                      ['事业', year.workIndex],
                      ['财运', year.moneyIndex],
                    ] as const
                  ).map(([label, idx]) => (
                    <View key={label} style={styles.starLine}>
                      <Text style={[styles.starLabel, { color: fold.faint }]}>{label}</Text>
                      <Text
                        style={[
                          styles.indexVal,
                          { color: zodiac.accent, fontFamily: foldFonts.mono },
                        ]}>
                        {indexLabel(idx)}
                      </Text>
                    </View>
                  ))}
                </View>
                <Field label="综合" value={year.general} ink={fold.ink2} muted={fold.muted} />
                <Field label="爱情" value={year.love} ink={fold.ink2} muted={fold.muted} />
                <Field label="事业" value={year.work} ink={fold.ink2} muted={fold.muted} />
                <Field label="财运" value={year.money} ink={fold.ink2} muted={fold.muted} />
                <Field label="健康" value={year.health} ink={fold.ink2} muted={fold.muted} />
              </View>
            ) : (
              <View
                style={[styles.section, { backgroundColor: fold.card, borderColor: fold.line }]}>
                <Text style={[styles.sectionTitle, { color: fold.ink2 }]}>本年</Text>
                <Text style={[styles.fieldBody, { color: fold.faint }]}>暂无数据</Text>
              </View>
            )}
            {error ? (
              <Text style={[styles.sub, { color: fold.faint, textAlign: 'center' }]}>{error}</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2 },
  scroll: { padding: 16, gap: 12 },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 48,
  },
  retry: { fontSize: 13, fontWeight: '700' },
  section: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  notice: { fontSize: 13, fontWeight: '600', lineHeight: 20 },
  starGrid: { gap: 8 },
  starLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  starLabel: { fontSize: 12, width: 32 },
  indexVal: { fontSize: 16, fontWeight: '700' },
  lucky: { fontSize: 11, lineHeight: 16 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700' },
  fieldBody: { fontSize: 13, lineHeight: 20 },
});
