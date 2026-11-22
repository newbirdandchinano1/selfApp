/**
 * 天气位置设置：自动定位 / 手填城市与经纬度
 */
import { AppIcon } from '@/components/ui/app-icon';
import { AppInput } from '@/components/ui/app-input';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  WEATHER_CITY_PRESETS,
  defaultWeatherLocationSettings,
  loadWeatherLocationSettings,
  saveWeatherLocationSettings,
  type WeatherLocationMode,
  type WeatherLocationSettings,
} from '@/lib/weather-location';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function WeatherLocationScreen() {
  const router = useRouter();
  const { fold } = useFoldTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<WeatherLocationMode>('auto');
  const [label, setLabel] = useState('');
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await loadWeatherLocationSettings();
        if (cancelled) return;
        setMode(s.mode);
        setLabel(s.label);
        setLatText(s.lat != null ? String(s.lat) : '');
        setLngText(s.lng != null ? String(s.lng) : '');
      } catch {
        if (!cancelled) {
          const d = defaultWeatherLocationSettings();
          setMode(d.mode);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPreset = useCallback((p: (typeof WEATHER_CITY_PRESETS)[number]) => {
    setMode('manual');
    setLabel(p.label);
    setLatText(String(p.lat));
    setLngText(String(p.lng));
  }, []);

  const onSave = useCallback(async () => {
    setSaving(true);
    try {
      const latRaw = latText.trim();
      const lngRaw = lngText.trim();
      const lat = latRaw === '' ? null : Number(latRaw);
      const lng = lngRaw === '' ? null : Number(lngRaw);

      if (mode === 'manual') {
        if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          toast.error('手动模式请填写有效的纬度与经度');
          return;
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          toast.error('经纬度超出范围');
          return;
        }
      }

      const next: WeatherLocationSettings = {
        mode,
        label: label.trim(),
        lat: mode === 'manual' ? lat : null,
        lng: mode === 'manual' ? lng : null,
      };
      await saveWeatherLocationSettings(next);
      toast.success(mode === 'auto' ? '已改为自动定位' : '手动位置已保存');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  }, [label, latText, lngText, mode, router]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [
            styles.navBtn,
            { borderColor: fold.line, backgroundColor: fold.card, opacity: pressed ? 0.85 : 1 },
          ]}>
          <AppIcon name="arrow-back" size={18} color={fold.ink2} />
        </Pressable>
        <Text style={[styles.title, { color: fold.ink }]}>天气位置</Text>
        <Pressable
          onPress={() => void onSave()}
          disabled={saving || loading}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: fold.pineButton,
              opacity: saving || loading ? 0.55 : pressed ? 0.9 : 1,
            },
          ]}>
          {saving ? (
            <ActivityIndicator size="small" color={fold.onPineButton} />
          ) : (
            <Text style={[styles.saveText, { color: fold.onPineButton }]}>保存</Text>
          )}
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={[styles.hint, { color: fold.muted }]}>
            自动定位需授权位置权限；失败时回落成都。手动模式用经纬度查天气，城市名仅作展示。
          </Text>

          <View style={[styles.modeRow, { backgroundColor: fold.card, borderColor: fold.line }]}>
            {([
              { id: 'auto' as const, label: '自动定位' },
              { id: 'manual' as const, label: '手动填写' },
            ]).map((opt) => {
              const active = mode === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => setMode(opt.id)}
                  style={[
                    styles.modeChip,
                    {
                      backgroundColor: active ? fold.sage2 : fold.paper2,
                      borderColor: active ? fold.pine : fold.line,
                    },
                  ]}>
                  <Text style={{ color: active ? fold.pine : fold.ink2, fontWeight: '700', fontSize: 13 }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.section, { color: fold.ink2 }]}>常用城市</Text>
          <View style={styles.presetRow}>
            {WEATHER_CITY_PRESETS.map((p) => (
              <Pressable
                key={p.label}
                onPress={() => applyPreset(p)}
                style={({ pressed }) => [
                  styles.preset,
                  {
                    backgroundColor: fold.paper2,
                    borderColor: fold.line,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={{ color: fold.ink2, fontSize: 12, fontWeight: '600' }}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.section, { color: fold.ink2 }]}>城市名（可选）</Text>
          <AppInput
            value={label}
            onChangeText={setLabel}
            placeholder="如：成都"
            editable={!saving}
          />

          <Text style={[styles.section, { color: fold.ink2 }]}>纬度</Text>
          <AppInput
            value={latText}
            onChangeText={setLatText}
            placeholder="如：30.57"
            keyboardType="decimal-pad"
            editable={!saving && mode === 'manual'}
          />

          <Text style={[styles.section, { color: fold.ink2 }]}>经度</Text>
          <AppInput
            value={lngText}
            onChangeText={setLngText}
            placeholder="如：104.07"
            keyboardType="decimal-pad"
            editable={!saving && mode === 'manual'}
          />

          {mode === 'auto' ? (
            <Text style={[styles.hint, { color: fold.faint }]}>
              当前为自动定位：保存后将忽略上方经纬度，改用手机 GPS。
            </Text>
          ) : (
            <Text style={[styles.hint, { color: fold.faint }]}>
              当前为手动模式：请确保纬度、经度均已填写。
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 17, fontWeight: '700' },
  saveBtn: {
    minWidth: 64,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  saveText: { fontSize: 13, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },
  hint: { fontSize: 12, lineHeight: 18, marginBottom: 4 },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 8,
    marginBottom: 6,
  },
  modeChip: {
    flex: 1,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
  },
  section: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
});
