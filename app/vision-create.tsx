import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type BackgroundOption =
  | {
      kind: 'image';
      source: number;
      selectedRing?: boolean;
      alt?: string;
    }
  | { kind: 'custom' };

export default function VisionCreateScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const visionPrimary = '#0058be';

  const [visionName, setVisionName] = useState('');
  const [details, setDetails] = useState('');
  const [selectedBgIdx, setSelectedBgIdx] = useState(0);

  // 追踪方式：进度 / 计数 / 倒数日 / 目标
  const [trackType, setTrackType] = useState<0 | 1 | 2 | 3>(0);
  // 方向：正向增长 / 反向减少
  const [direction, setDirection] = useState<'positive' | 'negative'>('positive');

  const [goalTotal, setGoalTotal] = useState('100');
  const [step, setStep] = useState('1');
  const [unit, setUnit] = useState('');

  // 计数配置
  const [countFrequency, setCountFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [countStep, setCountStep] = useState('1');
  const [countUnit, setCountUnit] = useState('次');

  // 倒数日配置
  const [countdownKind, setCountdownKind] = useState<'countdown' | 'countup'>('countdown');
  const [endDate, setEndDate] = useState('2025-12-31');
  const [dateFormat, setDateFormat] = useState<'ymd' | 'year' | 'month' | 'week' | 'day'>('ymd');

  const bgOptions: BackgroundOption[] = useMemo(
    () => [
      {
        kind: 'image',
        selectedRing: true,
        source: require('../assets/vision-bg/bg1.png'),
        alt: '自定义背景1',
      },
      {
        kind: 'image',
        source: require('../assets/vision-bg/bg2.png'),
        alt: '自定义背景2',
      },
      {
        kind: 'image',
        source: require('../assets/vision-bg/bg3.png'),
        alt: '自定义背景3',
      },
      { kind: 'custom' },
    ],
    []
  );

  const onSave = () => {
    // 这里先保留占位：后续你接接口/存储时再实现。
    // eslint-disable-next-line no-console
    console.log('save vision', { visionName, details, selectedBgIdx, trackType, direction, goalTotal, step, unit });
    router.back();
  };

  const placeholderColor = isDark ? 'rgba(148,163,184,0.55)' : 'rgba(114,119,133,0.55)';
  const textColor = theme.text;
  const outline = 'rgba(114,119,133,0.95)';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.85)' }]}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialIcons name="close" size={20} color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: textColor }]}>创建愿景</Text>
        </View>

        <Pressable
          onPress={onSave}
          style={({ pressed }) => [
            styles.saveBtn,
            pressed && { opacity: 0.85 },
            { backgroundColor: isDark ? 'rgba(30,41,59,0.2)' : 'rgba(234,237,255,0.6)' },
          ]}
        >
          <Text style={[styles.saveBtnText, { color: isDark ? '#60a5fa' : '#1d4ed8' }]}>保存</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          alwaysBounceVertical={false}
        >
          <View style={{ gap: 18 }}>
            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: outline }]}>愿景名称</Text>
              <TextInput
                value={visionName}
                onChangeText={setVisionName}
                placeholder="输入愿景名称..."
                placeholderTextColor={placeholderColor}
                style={[styles.input, { color: textColor, backgroundColor: 'rgba(234,237,255,0.9)' }]}
              />
            </View>

            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: outline }]}>详细描述</Text>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="添加备注或详细描述..."
                placeholderTextColor={placeholderColor}
                style={[
                  styles.textarea,
                  { color: textColor, backgroundColor: 'rgba(234,237,255,0.9)' },
                ]}
                multiline
                numberOfLines={3}
              />
            </View>
          </View>

          {/* 背景选择 */}
          <View style={{ gap: 10, marginTop: 18 }}>
            <Text style={[styles.label, { color: outline }]}>背景选择</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 2 }}>
              {bgOptions.map((opt, idx) => {
                const isSelected = idx === selectedBgIdx;

                if (opt.kind === 'custom') {
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => setSelectedBgIdx(idx)}
                      style={({ pressed }) => [styles.customBg, isSelected && styles.customBgSelected, pressed && { opacity: 0.9 }]}
                    >
                      <MaterialIcons name="add_a_photo" size={22} color={outline} />
                      <Text style={[styles.customBgText, { color: outline }]}>自定义</Text>
                    </Pressable>
                  );
                }

                return (
                  <Pressable
                    key={idx}
                    onPress={() => setSelectedBgIdx(idx)}
                    style={({ pressed }) => [
                      styles.bgCard,
                      pressed && { opacity: 0.9 },
                      isSelected && { borderColor: theme.primary, borderWidth: 2 },
                    ]}
                  >
                    <Image source={opt.source} style={styles.bgImg} contentFit="cover" transition={120} />
                    {isSelected && (
                      <View style={styles.bgSelectedOverlay}>
                        <MaterialIcons name="check_circle" size={20} color={theme.primary} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* 追踪方式 Tabs */}
          <View style={{ gap: 10, marginTop: 18 }}>
            <Text style={[styles.label, { color: outline }]}>追踪方式</Text>
            <View style={styles.trackTabs}>
              <TabButton active={trackType === 0} text="进度" onPress={() => setTrackType(0)} />
              <TabButton active={trackType === 1} text="计数" onPress={() => setTrackType(1)} />
              <TabButton active={trackType === 2} text="倒数日" onPress={() => setTrackType(2)} />
              <TabButton active={trackType === 3} text="目标" onPress={() => setTrackType(3)} />
            </View>
          </View>

          {/* 配置区域：仅在对应 tab 展示对应内容 */}
          {trackType === 1 ? (
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(255,255,255,0.95)',
                  borderColor: 'rgba(194,198,214,0.35)',
                },
              ]}
            >
              <View style={styles.sectionHeader}>
                <View style={{ gap: 6 }}>
                  <Text style={[styles.panelTitle, { color: textColor }]}>频率</Text>
                  <Text style={[styles.panelSub, { color: outline }]}>设定更新周期</Text>
                </View>

                <View style={styles.directionTabs}>
                  <Pressable
                    onPress={() => setCountFrequency('daily')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      countFrequency === 'daily' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        countFrequency === 'daily' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      每日
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCountFrequency('weekly')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      countFrequency === 'weekly' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        countFrequency === 'weekly' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      每周
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCountFrequency('monthly')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      countFrequency === 'monthly' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        countFrequency === 'monthly' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      每月
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={{ gap: 14 }}>
                <Text style={[styles.panelTitle, { color: textColor }]}>计数设置</Text>
                <View style={styles.grid2}>
                  <View style={styles.grid2LabelsRow}>
                    <Text style={[styles.grid2Label, { color: outline }]}>每次增加</Text>
                    <Text style={[styles.grid2Label, { color: outline }]}>单位</Text>
                  </View>
                  <View style={styles.grid2InputsRow}>
                    <TextInput
                      value={countStep}
                      onChangeText={setCountStep}
                      keyboardType="numeric"
                      placeholder="1"
                      placeholderTextColor={placeholderColor}
                      style={[styles.grid2Input, { color: textColor }]}
                    />
                    <TextInput
                      value={countUnit}
                      onChangeText={setCountUnit}
                      placeholder="例如：次"
                      placeholderTextColor={placeholderColor}
                      style={[styles.grid2Input, { color: textColor }]}
                    />
                  </View>
                </View>
              </View>
            </View>
          ) : trackType === 2 ? (
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(255,255,255,0.95)',
                  borderColor: 'rgba(194,198,214,0.35)',
                },
              ]}
            >
              <Text style={[styles.panelTitle, { color: textColor, marginBottom: 16 }]}>倒数日设置</Text>

              <View style={{ gap: 10 }}>
                <Text style={[styles.label, { color: outline }]}>类型</Text>
                <View style={styles.directionTabs}>
                  <Pressable
                    onPress={() => setCountdownKind('countdown')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      { flex: 1, alignItems: 'center' },
                      countdownKind === 'countdown' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        countdownKind === 'countdown' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      倒数日
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCountdownKind('countup')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      { flex: 1, alignItems: 'center' },
                      countdownKind === 'countup' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        countdownKind === 'countup' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      正数日
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={{ marginTop: 18, gap: 8 }}>
                <Text style={[styles.label, { color: outline }]}>结束日期</Text>
                <TextInput
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={placeholderColor}
                  style={[styles.grid2Input, { color: textColor }]}
                />
              </View>

              <View style={{ marginTop: 18, gap: 10 }}>
                <Text style={[styles.label, { color: outline }]}>显示格式</Text>
                <View style={[styles.directionTabs, { gap: 4 }]}>
                  {[
                    { key: 'ymd' as const, label: '年月天' },
                    { key: 'year' as const, label: '年' },
                    { key: 'month' as const, label: '月' },
                    { key: 'week' as const, label: '周' },
                    { key: 'day' as const, label: '天' },
                  ].map((item) => (
                    <Pressable
                      key={item.key}
                      onPress={() => setDateFormat(item.key)}
                      style={({ pressed }) => [
                        styles.directionBtn,
                        { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
                        dateFormat === item.key && { backgroundColor: visionPrimary },
                        pressed && { opacity: 0.9 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.directionBtnText,
                          { fontSize: 11 },
                          dateFormat === item.key ? { color: '#fff' } : { color: outline },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          ) : trackType === 3 ? (
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(255,255,255,0.95)',
                  borderColor: 'rgba(194,198,214,0.35)',
                  gap: 16,
                },
              ]}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: 12,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: 'rgba(194,198,214,0.45)',
                }}
              >
                <View style={{ gap: 4 }}>
                  <Text style={[styles.panelTitle, { color: textColor }]}>目标设置</Text>
                  <Text style={[styles.panelSub, { color: outline }]}>通过关联任务来追踪愿景达成</Text>
                </View>
                <MaterialIcons name="track-changes" size={18} color={visionPrimary} />
              </View>

              <Pressable
                style={({ pressed }) => [
                  {
                    width: '100%',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: 'rgba(234,237,255,0.72)',
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(0,88,190,0.12)',
                    }}
                  >
                    <MaterialIcons name="add-link" size={18} color={visionPrimary} />
                  </View>
                  <View style={{ gap: 2 }}>
                    <Text style={{ color: textColor, fontSize: 14, fontWeight: '700' }}>关联当前任务</Text>
                    <Text style={{ color: outline, fontSize: 12, fontWeight: '600' }}>从现有任务库中选择</Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={outline} />
              </Pressable>

              <View style={{ gap: 10 }}>
                <Text style={[styles.label, { color: outline }]}>已关联任务</Text>
                <View
                  style={{
                    borderWidth: 2,
                    borderStyle: 'dashed',
                    borderColor: 'rgba(194,198,214,0.45)',
                    borderRadius: 12,
                    paddingVertical: 26,
                    paddingHorizontal: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <MaterialIcons name="task-alt" size={28} color={'rgba(114,119,133,0.35)'} />
                  <Text style={{ color: 'rgba(114,119,133,0.55)', fontSize: 13, fontStyle: 'italic' }}>
                    尚未选择任务，点击上方按钮开始
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View
              style={[
                styles.panel,
                {
                  backgroundColor: 'rgba(234,237,255,0.5)',
                  borderColor: 'rgba(194,198,214,0.35)',
                },
              ]}
            >
              <View style={styles.sectionHeader}>
                <View style={{ gap: 6 }}>
                  <Text style={[styles.panelTitle, { color: textColor }]}>方向</Text>
                  <Text style={[styles.panelSub, { color: outline }]}>定义进度的演变方式</Text>
                </View>

                <View style={styles.directionTabs}>
                  <Pressable
                    onPress={() => setDirection('positive')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      direction === 'positive' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        direction === 'positive' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      正向增长
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDirection('negative')}
                    style={({ pressed }) => [
                      styles.directionBtn,
                      direction === 'negative' && { backgroundColor: visionPrimary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        direction === 'negative' ? { color: '#fff' } : { color: outline },
                      ]}
                    >
                      反向减少
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.grid2}>
                <View style={styles.grid2LabelsRow}>
                  <Text style={[styles.grid2Label, { color: outline }]}>目标总量</Text>
                  <Text style={[styles.grid2Label, { color: outline }]}>步长</Text>
                </View>
                <View style={styles.grid2InputsRow}>
                  <TextInput
                    value={goalTotal}
                    onChangeText={setGoalTotal}
                    keyboardType="numeric"
                    placeholder=""
                    placeholderTextColor={placeholderColor}
                    style={[styles.grid2Input, { color: textColor }]}
                  />
                  <TextInput
                    value={step}
                    onChangeText={setStep}
                    keyboardType="numeric"
                    placeholder=""
                    placeholderTextColor={placeholderColor}
                    style={[styles.grid2Input, { color: textColor }]}
                  />
                </View>
              </View>

              <View style={{ marginTop: 18 }}>
                <Text style={[styles.label, { color: outline }]}>度量单位</Text>
                <TextInput
                  value={unit}
                  onChangeText={setUnit}
                  placeholder="例如：公里, 页数, 小时..."
                  placeholderTextColor={placeholderColor}
                  style={[
                    styles.input,
                    { color: textColor, backgroundColor: 'rgba(234,237,255,0.9)' },
                  ]}
                />
              </View>
            </View>
          )}

          {/* 页面底部还有按钮，但按钮不再绝对定位，因此这里不需要额外占位高度 */}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Footer Button */}
      <View style={[styles.footer, { backgroundColor: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(255,255,255,0.85)' }]}>
        <Pressable
          onPress={() => {
            // 这里先直接复用“保存”占位逻辑
            onSave();
          }}
          style={({ pressed }) => [
            styles.primaryFooterBtn,
            pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
          ]}
        >
          <Text style={styles.primaryFooterText}>开启愿景</Text>
          <MaterialIcons name="rocket_launch" size={18} color="#fff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function TabButton({ active, text, onPress }: { active: boolean; text: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabBtn,
        active && { backgroundColor: 'rgba(250,248,255,1)' },
        pressed && { opacity: 0.9 },
      ]}
    >
      <Text style={[styles.tabBtnText, active ? { color: '#0058be', fontWeight: '700' } : { color: 'rgba(114,119,133,0.95)' }]}>
        {text}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType: 'numeric' | 'default';
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={[styles.input, { backgroundColor: 'rgba(234,237,255,0.9)' }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.18)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248,250,252,0.18)',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  saveBtnText: {
    fontWeight: '700',
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    // 底部按钮与布局同流，不需要很大的 padding 兜底，避免末尾出现大片空白
    paddingBottom: 18,
    gap: 10,
  },

  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    width: '100%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
  },
  textarea: {
    width: '100%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 90,
    fontSize: 14,
    fontWeight: '600',
    textAlignVertical: 'top',
  },

  bgCard: {
    width: 96,
    height: 128,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 0,
    borderColor: '#0058be',
  },
  bgImg: {
    width: '100%',
    height: '100%',
  },
  bgFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(234,237,255,0.72)',
  },
  bgFallbackText: {
    fontSize: 11,
    fontWeight: '700',
  },
  bgSelectedOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,88,190,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customBg: {
    width: 96,
    height: 128,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(194,198,214,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(250,248,255,0.6)',
  },
  customBgSelected: {
    borderColor: '#0058be',
  },
  customBgText: {
    fontSize: 10,
    fontWeight: '700',
  },

  trackTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(234,237,255,0.65)',
    borderRadius: 16,
    padding: 3,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },

  panel: {
    marginTop: 18,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  panelTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  panelSub: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.85,
  },
  directionTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(234,237,255,0.8)',
    borderRadius: 12,
    padding: 4,
    gap: 6,
  },
  directionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  directionBtnText: {
    fontWeight: '700',
    fontSize: 12,
  },

  grid2: {
    gap: 10,
  },
  grid2LabelsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  grid2Label: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginLeft: 2,
  },
  grid2InputsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  grid2Input: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
    backgroundColor: 'rgba(234,237,255,0.9)',
  },

  primaryFooterBtn: {
    width: '100%',
    backgroundColor: '#0058be',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryFooterText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  footer: {
    // 不使用 absolute，确保 iOS 下滚动区域是自适应的（不会凭空多出大块空白）
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
  },
});

