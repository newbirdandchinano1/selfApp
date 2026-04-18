import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Item = {
  id: string;
  title: string;
  subtitle: string;
  tone: 'error' | 'primary' | 'tertiary' | 'outline';
};

const DATA: { key: string; title: string; badge: string; tone: Item['tone']; items: Item[]; dim?: boolean }[] = [
  {
    key: 'q1',
    title: '紧急且重要',
    badge: '高风险',
    tone: 'error',
    items: [
      { id: 'q1-1', title: '季度财务报告提交', subtitle: '今日下午 5:00 截止', tone: 'error' },
      { id: 'q1-2', title: '客户紧急会议 - 服务器宕机', subtitle: '高优先级处理', tone: 'error' },
    ],
  },
  {
    key: 'q2',
    title: '重要但不紧急',
    badge: '深度工作',
    tone: 'primary',
    items: [
      { id: 'q2-1', title: '起草 2024 产品愿景', subtitle: '战略对齐工作', tone: 'primary' },
      { id: 'q2-2', title: '设计系统审计与更新', subtitle: '可扩展性维护', tone: 'primary' },
    ],
  },
  {
    key: 'q3',
    title: '紧急但不重要',
    badge: '委派',
    tone: 'tertiary',
    items: [{ id: 'q3-1', title: '回复非紧急 Slack 消息', subtitle: '降噪优先', tone: 'tertiary' }],
  },
  {
    key: 'q4',
    title: '不紧急也不重要',
    badge: '消除',
    tone: 'outline',
    dim: true,
    items: [{ id: 'q4-1', title: '整理桌面下载文件夹', subtitle: '琐碎整理', tone: 'outline' }],
  },
];

export default function AddFrogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [selected, setSelected] = React.useState<Record<string, boolean>>({
    'q1-1': true,
    'q2-2': true,
  });

  const surface = theme.background;
  const card = theme.surface;
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.28)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(100,116,139,0.7)';
  const blue = isDark ? '#60a5fa' : '#1d4ed8';
  const error = isDark ? '#f87171' : '#ba1a1a';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const tertiary = isDark ? '#fbbf24' : '#825100';

  const getTone = (tone: Item['tone']) => {
    if (tone === 'error') return error;
    if (tone === 'tertiary') return tertiary;
    if (tone === 'outline') return outline;
    return primary;
  };

  const toggle = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedIds = React.useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: surface }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
            backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)',
            borderBottomColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)',
          },
        ]}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
            <MaterialIcons name="arrow-back" size={22} color={blue} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: blue }]}>新增青蛙</Text>
        </View>
        <Pressable hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="more-vert" size={22} color={isDark ? 'rgba(148,163,184,0.9)' : 'rgba(100,116,139,0.9)'} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 140 + Math.max(insets.bottom, 12) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.editorial}>
          <Text style={[styles.kicker, { color: primary }]}>高风险</Text>
          <Text style={[styles.h1, { color: theme.text }]}>选择今日青蛙</Text>
        </View>

        <View style={styles.sections}>
          {DATA.map((sec) => {
            const secColor = getTone(sec.tone);
            const badgeBg =
              sec.tone === 'error'
                ? `${error}1A`
                : sec.tone === 'outline'
                  ? isDark
                    ? 'rgba(148,163,184,0.12)'
                    : 'rgba(148,163,184,0.18)'
                  : `${secColor}1A`;

            return (
              <View
                key={sec.key}
                style={[
                  styles.section,
                  sec.dim && { opacity: 0.65 },
                ]}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionHeaderLeft}>
                    <View style={[styles.sectionBar, { backgroundColor: secColor }]} />
                    <Text style={[styles.sectionTitle, { color: sec.tone === 'outline' ? theme.textSecondary : theme.text }]}>
                      {sec.title}
                    </Text>
                  </View>
                  <View style={[styles.sectionBadge, { backgroundColor: badgeBg }]}>
                    <Text style={[styles.sectionBadgeText, { color: secColor }]}>{sec.badge}</Text>
                  </View>
                </View>

                <View style={styles.items}>
                  {sec.items.map((it) => {
                    const checked = !!selected[it.id];
                    const toneColor = getTone(it.tone);
                    const boxBg = checked ? toneColor : 'transparent';
                    const boxBorder = checked ? toneColor : outlineVariant;
                    const titleColor = sec.tone === 'outline' ? theme.textSecondary : theme.text;
                    const hoverColor = checked ? toneColor : titleColor;

                    return (
                      <Pressable
                        key={it.id}
                        onPress={() => toggle(it.id)}
                        style={({ pressed }) => [
                          styles.item,
                          { backgroundColor: card, borderColor: pressed ? `${toneColor}33` : 'transparent' },
                          pressed && { transform: [{ scale: 0.995 }] },
                        ]}>
                        <View style={styles.itemLeft}>
                          <View style={[styles.checkbox, { backgroundColor: boxBg, borderColor: boxBorder }]}>
                            {checked ? <MaterialIcons name="check" size={16} color="#fff" /> : null}
                          </View>
                          <View style={styles.itemText}>
                            <Text style={[styles.itemTitle, { color: checked ? hoverColor : titleColor }]}>{it.title}</Text>
                            <Text style={[styles.itemSubtitle, { color: theme.textSecondary }]}>{it.subtitle}</Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: Math.max(insets.bottom, 12),
            backgroundColor: isDark ? 'rgba(15,23,42,0.65)' : 'rgba(255,255,255,0.65)',
            borderTopColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)',
          },
        ]}>
        <View style={styles.bottomBarInner}>
          <Pressable
            onPress={() => router.back()}
            disabled={selectedIds.length === 0}
            style={({ pressed }) => [
              styles.confirmBtn,
              {
                opacity: selectedIds.length === 0 ? 0.55 : pressed ? 0.92 : 1,
                backgroundColor: selectedIds.length === 0 ? `${primary}80` : primary,
              },
              pressed && selectedIds.length > 0 && { transform: [{ scale: 0.98 }] },
            ]}>
            <Text style={styles.confirmText}>确认指派</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  content: {
    paddingTop: 92,
    paddingHorizontal: 18,
    gap: 18,
  },
  editorial: {
    gap: 10,
    paddingBottom: 8,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  h1: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 46,
  },
  sections: {
    gap: 18,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionBar: {
    width: 6,
    height: 26,
    borderRadius: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  sectionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sectionBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  items: {
    gap: 10,
  },
  item: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    flex: 1,
    gap: 6,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  itemSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  bottomBarInner: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  confirmBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 8,
  },
  confirmText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
});

