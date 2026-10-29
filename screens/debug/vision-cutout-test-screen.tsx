import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  cutOutPerson,
  getVisionCutoutAvailability,
  type VisionCutoutAvailability,
  type VisionCutoutQuality,
} from 'zheng-vision-cutout';

const QUALITIES: { id: VisionCutoutQuality; label: string }[] = [
  { id: 'accurate', label: '精细' },
  { id: 'balanced', label: '均衡' },
  { id: 'fast', label: '快速' },
];

/** Vision 人像抠图原生模块联调页。 */
export default function VisionCutoutTestScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[(colorScheme ?? 'light') as 'light' | 'dark'];

  const [availability, setAvailability] = useState<VisionCutoutAvailability | null>(null);
  const [sourceUri, setSourceUri] = useState<string | null>(null);
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [quality, setQuality] = useState<VisionCutoutQuality>('accurate');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');

  const stylesMemo = useMemo(
    () =>
      StyleSheet.create({
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(0,0,0,0.08)',
        },
        title: { fontSize: 18, fontWeight: '800', color: theme.text, flex: 1 },
        body: { padding: 16, gap: 14, paddingBottom: 40 },
        status: {
          borderRadius: 12,
          padding: 12,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(0,0,0,0.08)',
          backgroundColor: isDark ? 'rgba(15,23,42,0.45)' : '#f8fafc',
          gap: 4,
        },
        statusText: { fontSize: 13, color: isDark ? '#cbd5e1' : '#334155', lineHeight: 20 },
        label: { fontSize: 13, fontWeight: '700', color: theme.text },
        chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        chip: {
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(148,163,184,0.35)' : 'rgba(30,57,50,0.18)',
        },
        chipOn: {
          backgroundColor: isDark ? '#2D463F' : '#1E3932',
          borderColor: isDark ? '#2D463F' : '#1E3932',
        },
        chipText: { fontSize: 13, fontWeight: '700', color: isDark ? '#e2e8f0' : '#1E3932' },
        chipTextOn: { color: '#fff' },
        btn: {
          borderRadius: 12,
          paddingVertical: 14,
          alignItems: 'center',
          backgroundColor: isDark ? '#2D463F' : '#1E3932',
        },
        btnDisabled: { opacity: 0.45 },
        btnSecondary: {
          backgroundColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(30,57,50,0.12)',
        },
        btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
        btnTextSecondary: {
          color: isDark ? '#e2e8f0' : '#1E3932',
          fontSize: 15,
          fontWeight: '800',
        },
        row: { flexDirection: 'row', gap: 10 },
        previewCol: { flex: 1, gap: 6 },
        previewLabel: { fontSize: 12, fontWeight: '700', color: isDark ? '#94a3b8' : '#64748b' },
        previewBox: {
          height: 200,
          borderRadius: 12,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(0,0,0,0.08)',
        },
        checker: {
          ...StyleSheet.absoluteFillObject,
          flexDirection: 'row',
          flexWrap: 'wrap',
        },
        checkerCell: { width: '12.5%', height: '12.5%' },
        emptyPreview: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isDark ? 'rgba(15,23,42,0.35)' : '#f1f5f9',
        },
        emptyText: { fontSize: 12, color: isDark ? '#64748b' : '#94a3b8' },
        logBox: {
          minHeight: 120,
          borderRadius: 12,
          padding: 12,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(0,0,0,0.08)',
          backgroundColor: isDark ? 'rgba(15,23,42,0.45)' : '#f8fafc',
        },
        logText: {
          fontSize: 12,
          fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
          color: isDark ? '#cbd5e1' : '#334155',
          lineHeight: 18,
        },
        hint: { fontSize: 12, color: isDark ? '#94a3b8' : '#64748b', lineHeight: 18 },
      }),
    [isDark, theme.text],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const info = await getVisionCutoutAvailability();
        if (alive) setAvailability(info);
      } catch (e) {
        if (alive) {
          setAvailability({
            linked: false,
            platform: Platform.OS,
            available: false,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const appendLog = useCallback((line: string) => {
    setLog(prev => `${prev ? `${prev}\n` : ''}${line}`);
  }, []);

  const onPick = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setLog('未获得相册权限');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    setSourceUri(picked.assets[0].uri);
    setResultUri(null);
    setLog(`已选图\n${picked.assets[0].uri}`);
  }, []);

  const onCutOut = useCallback(async () => {
    if (!sourceUri || busy) return;
    setBusy(true);
    setResultUri(null);
    const started = Date.now();
    appendLog(`开始抠图 quality=${quality} …`);
    try {
      const { uri } = await cutOutPerson(sourceUri, { quality });
      setResultUri(uri);
      appendLog(`成功 ${Date.now() - started}ms\n${uri}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLog(`失败 ${Date.now() - started}ms\n${msg}`);
    } finally {
      setBusy(false);
    }
  }, [appendLog, busy, quality, sourceUri]);

  const availabilityLabel =
    availability == null ? '检测中…' : availability.available ? '可用' : '不可用';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top']}>
      <View style={stylesMemo.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ width: 36 }}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={stylesMemo.title}>Vision 抠图测试</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={stylesMemo.body}>
        <View style={stylesMemo.status}>
          <Text style={stylesMemo.statusText}>平台：{availability?.platform ?? Platform.OS}</Text>
          <Text style={stylesMemo.statusText}>
            模块已链入：{availability == null ? '…' : availability.linked ? '是' : '否'}
          </Text>
          <Text style={stylesMemo.statusText}>能力状态：{availabilityLabel}</Text>
          {availability?.reason ? (
            <Text style={stylesMemo.statusText}>原因：{availability.reason}</Text>
          ) : null}
        </View>

        <Text style={stylesMemo.hint}>
          用人像穿搭照测试去背景留人。若「模块已链入=否」，说明手机上的原生包太旧：请用含
          ZhengVisionCutout.podspec 的代码重新 EAS development 打包并安装（仅热更新 JS 不够）。
        </Text>

        <Text style={stylesMemo.label}>质量</Text>
        <View style={stylesMemo.chips}>
          {QUALITIES.map(q => {
            const on = quality === q.id;
            return (
              <Pressable
                key={q.id}
                onPress={() => setQuality(q.id)}
                style={[stylesMemo.chip, on && stylesMemo.chipOn]}>
                <Text style={[stylesMemo.chipText, on && stylesMemo.chipTextOn]}>{q.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() => void onPick()}
          disabled={busy}
          style={[stylesMemo.btn, stylesMemo.btnSecondary, busy && stylesMemo.btnDisabled]}>
          <Text style={stylesMemo.btnTextSecondary}>选择穿搭照片</Text>
        </Pressable>

        <Pressable
          onPress={() => void onCutOut()}
          disabled={busy || !sourceUri || availability?.available === false}
          style={[
            stylesMemo.btn,
            (busy || !sourceUri || availability?.available === false) && stylesMemo.btnDisabled,
          ]}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={stylesMemo.btnText}>开始抠图</Text>
          )}
        </Pressable>

        <View style={stylesMemo.row}>
          <View style={stylesMemo.previewCol}>
            <Text style={stylesMemo.previewLabel}>原图</Text>
            <View style={stylesMemo.previewBox}>
              {sourceUri ? (
                <Image source={{ uri: sourceUri }} style={{ flex: 1 }} contentFit="contain" />
              ) : (
                <View style={stylesMemo.emptyPreview}>
                  <Text style={stylesMemo.emptyText}>未选择</Text>
                </View>
              )}
            </View>
          </View>
          <View style={stylesMemo.previewCol}>
            <Text style={stylesMemo.previewLabel}>透明 PNG</Text>
            <View style={stylesMemo.previewBox}>
              <View style={stylesMemo.checker} pointerEvents="none">
                {Array.from({ length: 64 }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      stylesMemo.checkerCell,
                      {
                        backgroundColor:
                          (Math.floor(i / 8) + (i % 8)) % 2 === 0
                            ? isDark
                              ? '#334155'
                              : '#e2e8f0'
                            : isDark
                              ? '#1e293b'
                              : '#ffffff',
                      },
                    ]}
                  />
                ))}
              </View>
              {resultUri ? (
                <Image source={{ uri: resultUri }} style={{ flex: 1 }} contentFit="contain" />
              ) : (
                <View style={[stylesMemo.emptyPreview, { backgroundColor: 'transparent' }]}>
                  <Text style={stylesMemo.emptyText}>{busy ? '处理中…' : '无结果'}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <Text style={stylesMemo.label}>日志</Text>
        <View style={stylesMemo.logBox}>
          <Text style={stylesMemo.logText}>{log || '操作记录会显示在这里'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
