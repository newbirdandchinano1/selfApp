import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  analyzeFoodNutritionFromImage,
  getActiveAiLlmApiKey,
  TINY_TEST_JPEG_BASE64,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function nonFoodCodeHint(code: number): string {
  if (code === 1) return '明显非食物或无可分析的食物';
  if (code === 2) return '无法识别、不清晰或分析失败';
  if (code === 3) return '画面过于混杂，无法对单一食物估算';
  return `非食物代码 ${code}`;
}

export default function ZhipuApiTestScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[(colorScheme ?? 'light') as 'light' | 'dark'];

  const [log, setLog] = useState<string>('');
  const [busy, setBusy] = useState(false);

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
        body: { flex: 1, padding: 16, gap: 14 },
        label: { fontSize: 13, fontWeight: '700', color: theme.text, marginBottom: 6 },
        btn: {
          borderRadius: 12,
          paddingVertical: 14,
          alignItems: 'center',
          backgroundColor: isDark ? '#2563eb' : '#0058be',
        },
        btnSecondary: {
          backgroundColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(0,88,190,0.12)',
        },
        btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
        btnTextSecondary: { color: isDark ? '#e2e8f0' : '#0058be', fontSize: 15, fontWeight: '800' },
        logBox: {
          minHeight: 200,
          borderRadius: 12,
          padding: 12,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(0,0,0,0.08)',
          backgroundColor: isDark ? 'rgba(15,23,42,0.45)' : '#f8fafc',
        },
        logText: { fontSize: 12, fontFamily: 'monospace', color: isDark ? '#cbd5e1' : '#334155', lineHeight: 18 },
        hint: { fontSize: 12, color: isDark ? '#94a3b8' : '#64748b', lineHeight: 18 },
      }),
    [isDark, theme.text],
  );

  const formatOutput = (r: Awaited<ReturnType<typeof analyzeFoodNutritionFromImage>>) => {
    const lines: string[] = [];
    lines.push(`请求次数: ${r.attempts}`);
    if (r.ok) {
      lines.push(`状态: 成功${r.repaired ? '（已对字段做容错修正）' : ''}`);
      if (r.data.is_food === 1) {
        const name = r.data.food_name?.trim();
        lines.push(
          `判定: 食物${name ? ` — ${name}` : ''} — 蛋白质 ${r.data.protein_g} g · 碳水 ${r.data.carbohydrate_g} g · 钠 ${r.data.sodium_mg} mg`,
        );
        if (r.data.ai_evaluation?.trim()) lines.push(`点评: ${r.data.ai_evaluation.trim()}`);
      } else {
        lines.push(`判定: 非食物 / 无法按食物估算 — ${nonFoodCodeHint(r.data.non_food_code)}`);
      }
    } else {
      lines.push(`状态: 失败 — ${r.error}`);
      lines.push(`兜底数据: ${r.data.is_food === 1 ? '食物' : '非食物'} — ${nonFoodCodeHint(r.data.non_food_code)}`);
    }
    lines.push('');
    lines.push('JSON:');
    lines.push(JSON.stringify(r.data, null, 2));
    if (r.ok && r.rawContent) {
      lines.push('');
      lines.push('模型原始 content:');
      lines.push(r.rawContent);
    }
    return lines.join('\n');
  };

  const runAnalyze = async (mode: 'tiny' | 'picker') => {
    const key = getActiveAiLlmApiKey();
    setBusy(true);
    setLog('分析中…');
    try {
      if (mode === 'tiny') {
        const r = await analyzeFoodNutritionFromImage({
          apiKey: key,
          imageBase64: TINY_TEST_JPEG_BASE64,
          imageMimeType: 'image/jpeg',
        });
        setLog(formatOutput(r));
        return;
      }

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setLog('需要相册权限才能选图。');
        return;
      }

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });

      const asset0 = picked.assets?.[0];
      const imageBase64 = asset0?.base64;
      if (picked.canceled || !imageBase64) {
        setLog('已取消选图。');
        return;
      }

      const mime = asset0.mimeType?.trim() || 'image/jpeg';
      const r = await analyzeFoodNutritionFromImage({
        apiKey: key,
        imageBase64,
        imageMimeType: mime,
      });
      setLog(formatOutput(r));
    } catch (e) {
      setLog(`异常: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? theme.background : '#faf8ff' }} edges={['top']}>
      <View style={stylesMemo.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginRight: 8 }}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={stylesMemo.title}>食物营养分析</Text>
      </View>

      <ScrollView contentContainerStyle={stylesMemo.body} keyboardShouldPersistTaps="handled">
        <Text style={stylesMemo.hint}>
          调用智谱视觉模型，估算图中食物的蛋白质（g）、碳水化合物（g）、钠（mg）。接口强制 JSON，字段均为数字；非食物时
          is_food=0 并用 non_food_code 1～3 表示原因。含 1305 重试、空图与解析失败兜底、字段类型容错（如字符串数字转数值）。
        </Text>

        <Pressable
          style={[stylesMemo.btn, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void runAnalyze('tiny')}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={stylesMemo.btnText}>内置小图试跑</Text>}
        </Pressable>

        <Pressable
          style={[stylesMemo.btn, stylesMemo.btnSecondary, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void runAnalyze('picker')}
        >
          <Text style={stylesMemo.btnTextSecondary}>相册选图分析</Text>
        </Pressable>

        <View>
          <Text style={stylesMemo.label}>结果</Text>
          <Pressable onLongPress={() => setLog('')} style={stylesMemo.logBox}>
            <Text style={stylesMemo.logText} selectable>
              {log || '选图或试跑。长按清空。'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
