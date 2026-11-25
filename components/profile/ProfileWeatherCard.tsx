/**
 * 我的页 · 天气卡：场景插画 + 和风图标 + 逐时/逐日图文。
 */
import { WeatherConditionIcon } from '@/components/weather/WeatherConditionIcon';
import { WeatherHeroMotion } from '@/components/weather/WeatherHeroMotion';
import { AppIcon } from '@/components/ui/app-icon';
import { foldFonts } from '@/constants/review-fold-theme';
import { useWeatherAwareFoldTheme as useFoldTheme } from '@/hooks/use-weather-aware-fold-theme';
import {
  useWeatherSummary,
  useWeatherSummaryRefreshOnToken,
} from '@/hooks/use-weather-summary';
import { useAppTheme } from '@/hooks/use-app-theme';
import { resolveWeatherDayPart } from '@/lib/weather-scene';
import { weatherSceneVisual } from '@/lib/weather-visuals';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

function fmtTemp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}°`;
}

function fmtHm(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : iso;
}

function fmtMd(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 10) return '—';
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

function weekdayLabel(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 10) return '';
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] ?? '';
}

function sourceHint(source: string | undefined): string {
  if (source === 'manual') return '手动位置';
  if (source === 'gps') return '定位';
  return '默认成都';
}

type Props = {
  refreshToken?: number;
};

export function ProfileWeatherCard({ refreshToken = 0 }: Props) {
  const { fold } = useFoldTheme();
  const { scheme } = useAppTheme();
  const router = useRouter();
  const { summary, scene, location, status, error, refresh } = useWeatherSummary();
  useWeatherSummaryRefreshOnToken(refreshToken);

  const dayPart = resolveWeatherDayPart(scheme === 'dark' ? 'dark' : 'light');
  const visual = useMemo(
    () => weatherSceneVisual(scene ?? 'cloudy', dayPart),
    [scene, dayPart],
  );

  const loading = status === 'loading' || status === 'idle';
  const now = summary?.now;
  const air = summary?.air;
  const daily = summary?.daily ?? [];
  const hourly = (summary?.hourly ?? []).slice(0, 12);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: fold.card,
          borderColor: fold.line,
        },
      ]}>
      {/* 氛围洗底 */}
      <View
        pointerEvents="none"
        style={[
          styles.wash,
          {
            backgroundColor: visual.wash,
            opacity: dayPart === 'night' ? 0.35 : 0.28,
          },
        ]}
      />

      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: fold.ink2 }]}>天气</Text>
          <Text style={[styles.sub, { color: fold.faint }]} numberOfLines={1}>
            {location
              ? `${location.label} · ${sourceHint(location.source)}`
              : loading
                ? '正在定位…'
                : '未定位'}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/weather-location')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.linkBtn,
            { borderColor: fold.line, backgroundColor: fold.paper2, opacity: pressed ? 0.85 : 1 },
          ]}>
          <AppIcon name="place" size={12} color={fold.pine} />
          <Text style={[styles.linkText, { color: fold.pine }]}>位置</Text>
        </Pressable>
        <Pressable
          onPress={() => void refresh(true)}
          hitSlop={8}
          accessibilityLabel="刷新天气"
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.paper2, opacity: pressed ? 0.85 : 1 },
          ]}>
          {loading && !summary ? (
            <ActivityIndicator size="small" color={fold.pine} />
          ) : (
            <AppIcon name="refresh" size={14} color={fold.ink2} />
          )}
        </Pressable>
      </View>

      {loading && !summary ? (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color={fold.pine} />
          <Text style={[styles.sub, { color: fold.muted }]}>拉取天气…</Text>
        </View>
      ) : error && !summary ? (
        <Pressable onPress={() => void refresh(true)} style={styles.centerRow}>
          <Text style={[styles.sub, { color: fold.clay }]}>{error}</Text>
          <Text style={[styles.linkText, { color: fold.pine }]}>重试</Text>
        </Pressable>
      ) : (
        <>
          <View style={styles.hero}>
            <View
              style={[
                styles.heroArt,
                {
                  backgroundColor: visual.wash,
                  borderColor: fold.line,
                },
              ]}>
              <WeatherHeroMotion
                scene={scene ?? 'cloudy'}
                dayPart={dayPart}
                icon={now?.icon}
                text={now?.text}
                size={88}
              />
            </View>
            <View style={styles.heroMain}>
              <View style={styles.nowRow}>
                <WeatherConditionIcon
                  icon={now?.icon}
                  text={now?.text}
                  size={52}
                  color={visual.accent}
                />
                <Text style={[styles.temp, { color: fold.ink, fontFamily: foldFonts.serif }]}>
                  {fmtTemp(now?.temp)}
                </Text>
              </View>
              <Text style={[styles.cond, { color: fold.ink2 }]} numberOfLines={1}>
                {now?.text ?? visual.label}
                {now?.feelsLike != null ? ` · 体感 ${fmtTemp(now.feelsLike)}` : ''}
              </Text>
              <Text style={[styles.sub, { color: fold.muted }]} numberOfLines={2}>
                {[
                  now?.windDir ? `${now.windDir}风${now.windScale ?? ''}级` : null,
                  now?.humidityPct != null ? `湿度 ${now.humidityPct}%` : null,
                  air?.category
                    ? `空气 ${air.aqiDisplay ?? air.aqi ?? '—'} ${air.category}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </View>

          {hourly.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hScroll}>
              {hourly.map((h, i) => (
                <View
                  key={`${h.time ?? i}`}
                  style={[styles.hItem, { backgroundColor: fold.paper2 }]}>
                  <Text style={[styles.hMeta, { color: fold.faint }]}>{fmtHm(h.time)}</Text>
                  <WeatherConditionIcon
                    icon={h.icon}
                    text={h.text}
                    size={28}
                    color={fold.pine}
                  />
                  <Text style={[styles.hTemp, { color: fold.ink2, fontFamily: foldFonts.mono }]}>
                    {fmtTemp(h.temp)}
                  </Text>
                  <Text style={[styles.hMeta, { color: fold.muted }]} numberOfLines={1}>
                    {h.text ?? '—'}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {daily.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hScroll}>
              {daily.map((d, i) => (
                <View
                  key={`${d.date ?? i}`}
                  style={[styles.dItem, { backgroundColor: fold.paper2 }]}>
                  <Text style={[styles.hMeta, { color: fold.faint }]}>
                    {i === 0 ? '今天' : `周${weekdayLabel(d.date)}`}
                  </Text>
                  <WeatherConditionIcon
                    icon={d.iconDay}
                    text={d.textDay}
                    size={30}
                    color={fold.pine}
                  />
                  <Text style={[styles.hMeta, { color: fold.muted }]}>{fmtMd(d.date)}</Text>
                  <Text style={[styles.hTemp, { color: fold.ink2, fontFamily: foldFonts.mono }]}>
                    {fmtTemp(d.tempMax)}/{fmtTemp(d.tempMin)}
                  </Text>
                  <Text style={[styles.hMeta, { color: fold.muted }]} numberOfLines={1}>
                    {d.textDay ?? '—'}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {air?.healthEffect || (air?.pollutants?.length ?? 0) > 0 ? (
            <View style={[styles.airBox, { backgroundColor: fold.paper2 }]}>
              <View style={styles.airHead}>
                <AppIcon name="air" size={14} color={fold.pine} />
                <Text style={[styles.airTitle, { color: fold.ink2 }]}>
                  空气质量
                  {air?.category ? ` · ${air.category}` : ''}
                  {air?.primaryPollutant ? ` · 首要 ${air.primaryPollutant}` : ''}
                </Text>
              </View>
              {air?.healthEffect ? (
                <Text style={[styles.airBody, { color: fold.muted }]} numberOfLines={2}>
                  {air.healthEffect}
                </Text>
              ) : null}
              {air?.pollutants?.length ? (
                <Text style={[styles.airBody, { color: fold.faint }]} numberOfLines={2}>
                  {air.pollutants
                    .slice(0, 4)
                    .map((p) => `${p.name} ${p.value ?? '—'}${p.unit ?? ''}`)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
          ) : null}

          {error ? (
            <Text style={[styles.sub, { color: fold.faint, marginTop: 6 }]}>{error}</Text>
          ) : null}
        </>
      )}
    </View>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 11, marginTop: 2 },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  linkText: { fontSize: 11, fontWeight: '600' },
  iconBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroArt: {
    width: 100,
    height: 100,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroMain: { flex: 1, minWidth: 0, gap: 2, justifyContent: 'center' },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  temp: { fontSize: 40, fontWeight: '600', lineHeight: 44 },
  cond: { fontSize: 14, fontWeight: '600' },
  hScroll: { gap: 8, paddingVertical: 2 },
  hItem: {
    width: 64,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 3,
  },
  dItem: {
    width: 72,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 3,
  },
  hMeta: { fontSize: 10 },
  hTemp: { fontSize: 13, fontWeight: '700' },
  airBox: { borderRadius: 12, padding: 10, gap: 4 },
  airHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  airTitle: { fontSize: 12, fontWeight: '700', flex: 1 },
  airBody: { fontSize: 11, lineHeight: 16 },
});
