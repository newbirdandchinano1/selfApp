import { WeaknessListSection } from '@/components/weakness/weakness-list-section';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WeaknessListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.85)' : '#727785';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const headerBg = isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.96)';
  const borderSoft = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.4)';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right', 'bottom']}>
      <View style={[styles.topBar, { backgroundColor: headerBg, borderBottomColor: borderSoft, paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={primary} />
        </Pressable>
        <Text style={[styles.topTitle, { color: text }]}>我的缺点</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.intro, { color: outline }]}>
            诚实面对短板；记录后保存或打开详情页时会自动生成 AI 分析与建议（基于智谱 GLM，与记账等功能共用密钥配置）。
          </Text>
          <WeaknessListSection />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 17, fontWeight: '800' },
  scroll: { paddingHorizontal: 18, paddingTop: 16, gap: 12 },
  intro: { fontSize: 13, lineHeight: 20, fontWeight: '600', marginBottom: 4 },
});
