/**
 * 我的页 · 星座运势卡：徽章插画 + 星级图示；点击进入详情。
 */
import { ZodiacSignArt } from '@/components/profile/ZodiacSignArt';
import { AppIcon } from '@/components/ui/app-icon';
import { foldFonts } from '@/constants/review-fold-theme';
import { useWeatherAwareFoldTheme as useFoldTheme } from '@/hooks/use-weather-aware-fold-theme';
import {
  apiExternalHoroscope,
  type ExternalHoroscopeDayLike,
} from '@/lib/api/endpoints/external';
import { toUserMessage } from '@/lib/app-feedback';
import { resolveZodiacVisual } from '@/lib/zodiac-visuals';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

function StarRow({
  value,
  color,
  empty,
  size = 11,
}: {
  value: number | null | undefined;
  color: string;
  empty: string;
  size?: number;
}) {
  const v =
    value == null || !Number.isFinite(value)
      ? 0
      : Math.max(0, Math.min(5, Math.round(value)));
  return (
    <View style={styles.starRow}>
      {Array.from({ length: 5 }).map((_, i) => (
        <AppIcon
          key={i}
          name={i < v ? 'star' : 'star-border'}
          size={size}
          color={i < v ? color : empty}
        />
      ))}
    </View>
  );
}

function PeriodBlock({
  title,
  data,
  accent,
  ink,
  muted,
  faint,
  paper2,
  starEmpty,
}: {
  title: string;
  data: ExternalHoroscopeDayLike | null;
  accent: string;
  ink: string;
  muted: string;
  faint: string;
  paper2: string;
  starEmpty: string;
}) {
  if (!data) {
    return (
      <View style={[styles.period, { backgroundColor: paper2 }]}>
        <Text style={[styles.periodTitle, { color: ink }]}>{title}</Text>
        <Text style={[styles.body, { color: faint }]}>暂无数据</Text>
      </View>
    );
  }
  return (
    <View style={[styles.period, { backgroundColor: paper2 }]}>
      <View style={styles.periodHead}>
        <Text style={[styles.periodTitle, { color: ink }]}>{title}</Text>
        <StarRow value={data.summaryStar} color={accent} empty={starEmpty} size={10} />
      </View>
      {data.notice ? (
        <Text style={[styles.notice, { color: muted }]} numberOfLines={2}>
          {data.notice}
        </Text>
      ) : null}
      <Text style={[styles.body, { color: muted }]} numberOfLines={3}>
        {data.general ?? '—'}
      </Text>
      <View style={styles.metricGrid}>
        {(
          [
            ['爱情', data.loveStar],
            ['事业', data.workStar],
            ['财运', data.moneyStar],
          ] as const
        ).map(([label, star]) => (
          <View key={label} style={styles.metric}>
            <AppIcon
              name={label === '爱情' ? 'favorite' : label === '事业' ? 'work' : 'savings'}
              size={12}
              color={accent}
            />
            <Text style={[styles.metricLabel, { color: faint }]}>{label}</Text>
            <StarRow value={star} color={accent} empty={starEmpty} size={9} />
          </View>
        ))}
      </View>
      <Text style={[styles.lucky, { color: muted }]} numberOfLines={2}>
        {[
          data.luckyColor ? `吉色 ${data.luckyColor}` : null,
          data.luckyNum ? `幸运数 ${data.luckyNum}` : null,
          data.luckyDirection ? `方位 ${data.luckyDirection}` : null,
          data.luckyTime ? `吉时 ${data.luckyTime}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}

type Props = {
  zodiacLabel: string;
  refreshToken?: number;
};

export function ProfileHoroscopeCard({ zodiacLabel, refreshToken = 0 }: Props) {
  const { fold } = useFoldTheme();
  const router = useRouter();
  const zodiac = useMemo(() => resolveZodiacVisual(zodiacLabel), [zodiacLabel]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<ExternalHoroscopeDayLike | null>(null);
  const [tomorrow, setTomorrow] = useState<ExternalHoroscopeDayLike | null>(null);
  const [signName, setSignName] = useState(zodiac.name);
  const abortRef = useRef<AbortController | null>(null);

  const openDetail = useCallback(() => {
    const star = zodiacLabel.trim();
    if (!star) return;
    router.push({
      pathname: '/horoscope-detail',
      params: { star },
    });
  }, [router, zodiacLabel]);

  const load = useCallback(async () => {
    const star = zodiacLabel.trim();
    if (!star) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const data = await apiExternalHoroscope({
        star,
        scopes: 'day,tomorrow',
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setSignName(data.sign?.name || zodiac.name);
      setDay(data.day);
      setTomorrow(data.tomorrow);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setDay(null);
      setTomorrow(null);
      setError(toUserMessage(e, '运势加载失败'));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [zodiac.name, zodiacLabel]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load, refreshToken]);

  return (
    <Pressable
      onPress={openDetail}
      accessibilityRole="button"
      accessibilityLabel={`${signName}星座运势，点击查看详情`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: fold.card,
          borderColor: fold.line,
          opacity: pressed ? 0.94 : 1,
        },
      ]}>
      <View
        pointerEvents="none"
        style={[styles.wash, { backgroundColor: zodiac.wash, opacity: 0.55 }]}
      />

      <View style={styles.header}>
        <ZodiacSignArt zodiacLabel={signName} visual={zodiac} size={64} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: fold.ink2 }]}>星座运势</Text>
            <Text style={[styles.detailHint, { color: fold.pine }]}>详情 ›</Text>
          </View>
          <Text style={[styles.signName, { color: zodiac.accent, fontFamily: foldFonts.serif }]}>
            {zodiac.glyph} {signName}
          </Text>
          <Text style={[styles.sub, { color: fold.faint }]}>今日 / 明日预览</Text>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            void load();
          }}
          hitSlop={8}
          accessibilityLabel="刷新运势"
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.paper2, opacity: pressed ? 0.85 : 1 },
          ]}>
          {loading ? (
            <ActivityIndicator size="small" color={fold.pine} />
          ) : (
            <AppIcon name="refresh" size={14} color={fold.ink2} />
          )}
        </Pressable>
      </View>

      {loading && !day && !tomorrow ? (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color={fold.pine} />
          <Text style={[styles.sub, { color: fold.muted }]}>拉取运势…</Text>
        </View>
      ) : error && !day && !tomorrow ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            void load();
          }}
          style={styles.centerRow}>
          <Text style={[styles.sub, { color: fold.muted }]}>{error}</Text>
          <Text style={[styles.retry, { color: fold.pine }]}>重试</Text>
        </Pressable>
      ) : (
        <View style={styles.cols}>
          <PeriodBlock
            title="今日"
            data={day}
            accent={zodiac.accent}
            ink={fold.ink2}
            muted={fold.muted}
            faint={fold.faint}
            paper2={fold.paper2}
            starEmpty={fold.starEmpty}
          />
          <PeriodBlock
            title="明日"
            data={tomorrow}
            accent={zodiac.accent}
            ink={fold.ink2}
            muted={fold.muted}
            faint={fold.faint}
            paper2={fold.paper2}
            starEmpty={fold.starEmpty}
          />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    overflow: 'hidden',
  },
  wash: {
    ...StyleSheet.absoluteFill,
    borderRadius: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700' },
  detailHint: { fontSize: 11, fontWeight: '600' },
  signName: { fontSize: 18, fontWeight: '600', marginTop: 2 },
  sub: { fontSize: 11, marginTop: 2 },
  iconBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  retry: { fontSize: 11, fontWeight: '600' },
  cols: { gap: 8 },
  period: { borderRadius: 12, padding: 10, gap: 6 },
  periodHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  periodTitle: { fontSize: 13, fontWeight: '700' },
  notice: { fontSize: 11, fontWeight: '600' },
  body: { fontSize: 11, lineHeight: 16 },
  metricGrid: { gap: 4 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricLabel: { fontSize: 10, width: 28 },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  lucky: { fontSize: 10, marginTop: 2 },
});
