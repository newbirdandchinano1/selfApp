import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type AccountType = 'cash' | 'bank' | 'wallet' | 'investment' | 'credit' | 'loan';
type ThemeColorKey = 'tertiary' | 'primary' | 'secondary' | 'error' | 'violet' | 'pink';

const TYPE_OPTIONS: { key: AccountType; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: 'cash', label: '现金', icon: 'payments' },
  { key: 'bank', label: '银行卡', icon: 'credit-card' },
  { key: 'wallet', label: '数字钱包', icon: 'account-balance-wallet' },
  { key: 'investment', label: '投资账户', icon: 'trending-up' },
  { key: 'credit', label: '信用卡', icon: 'contactless' },
  { key: 'loan', label: '个人贷款', icon: 'handshake' },
];

const COLOR_OPTIONS: { key: ThemeColorKey; value: string }[] = [
  { key: 'tertiary', value: '#D97706' },
  { key: 'primary', value: '#0058be' },
  { key: 'secondary', value: '#006c49' },
  { key: 'error', value: '#ba1a1a' },
  { key: 'violet', value: '#7C3AED' },
  { key: 'pink', value: '#EC4899' },
];

const ICON_OPTIONS: { key: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: 'home', icon: 'home' },
  { key: 'car', icon: 'directions-car' },
  { key: 'savings', icon: 'savings' },
  { key: 'bag', icon: 'shopping-bag' },
  { key: 'restaurant', icon: 'restaurant' },
  { key: 'flight', icon: 'flight' },
];

export default function AddAccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [accountType, setAccountType] = React.useState<AccountType>('bank');
  const [accountName, setAccountName] = React.useState('');
  const [balance, setBalance] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [colorKey, setColorKey] = React.useState<ThemeColorKey>('tertiary');
  const [iconKey, setIconKey] = React.useState<string>('savings');

  const activeColor = COLOR_OPTIONS.find((c) => c.key === colorKey)?.value ?? '#D97706';

  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(242,243,255,0.95)';
  const surfaceLowest = theme.surface;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
            backgroundColor: isDark ? 'rgba(15,23,42,0.72)' : 'rgba(250,248,255,0.82)',
          },
        ]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>添加账户</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 120 + Math.max(insets.bottom, 12) },
          ]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>选择账户类型</Text>
            <View style={styles.typeGrid}>
              {TYPE_OPTIONS.map((t) => {
                const active = t.key === accountType;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => setAccountType(t.key)}
                    style={({ pressed }) => [
                      styles.typeCard,
                      {
                        backgroundColor: surfaceLowest,
                        borderColor: active ? activeColor : outlineVariant,
                        shadowOpacity: active ? 0.08 : 0,
                      },
                      active && { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowRadius: 14, elevation: 3 },
                      pressed && { opacity: 0.85 },
                    ]}>
                    <View
                      style={[
                        styles.typeIconWrap,
                        { backgroundColor: active ? `${activeColor}1A` : surfaceLow },
                      ]}>
                      <MaterialIcons name={t.icon} size={22} color={activeColor} />
                    </View>
                    <Text style={[styles.typeLabel, { color: theme.text }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>账户详情</Text>
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>账户名称</Text>
                <TextInput
                  value={accountName}
                  onChangeText={setAccountName}
                  placeholder="例如：招商银行储蓄卡"
                  placeholderTextColor={outlineVariant}
                  style={[styles.textInput, { color: theme.text, borderBottomColor: outlineVariant }]}
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>当前余额</Text>
                <View style={[styles.balanceRow, { borderBottomColor: outlineVariant }]}>
                  <Text style={[styles.currency, { color: activeColor }]}>¥</Text>
                  <TextInput
                    value={balance}
                    onChangeText={setBalance}
                    placeholder="0.00"
                    placeholderTextColor={outlineVariant}
                    keyboardType="numeric"
                    style={[styles.balanceInput, { color: theme.text }]}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>备注 (选填)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="添加备注信息..."
                  placeholderTextColor={outlineVariant}
                  multiline
                  style={[styles.notesInput, { backgroundColor: surfaceLow, color: theme.text }]}
                />
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>个性化</Text>
            <View style={[styles.customCard, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
              <View style={styles.customBlock}>
                <Text style={[styles.customLabel, { color: theme.textSecondary }]}>主题颜色</Text>
                <View style={styles.colorRow}>
                  {COLOR_OPTIONS.map((c) => {
                    const active = c.key === colorKey;
                    return (
                      <Pressable
                        key={c.key}
                        onPress={() => setColorKey(c.key)}
                        style={({ pressed }) => [
                          styles.colorDot,
                          { backgroundColor: c.value },
                          active && { borderColor: c.value },
                          pressed && { opacity: 0.8 },
                        ]}
                      />
                    );
                  })}
                </View>
              </View>

              <View style={styles.customBlock}>
                <Text style={[styles.customLabel, { color: theme.textSecondary }]}>账户图标</Text>
                <View style={styles.iconGrid}>
                  {ICON_OPTIONS.map((it) => {
                    const active = it.key === iconKey;
                    return (
                      <Pressable
                        key={it.key}
                        onPress={() => setIconKey(it.key)}
                        style={({ pressed }) => [
                          styles.iconCell,
                          { backgroundColor: surfaceLow },
                          active && { backgroundColor: `${activeColor}1A` },
                          pressed && { opacity: 0.85 },
                        ]}>
                        <MaterialIcons name={it.icon} size={18} color={active ? activeColor : theme.text} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: isDark ? 'rgba(15,23,42,0.72)' : 'rgba(250,248,255,0.82)',
              borderTopColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)',
            },
          ]}>
          <View style={styles.footerInner}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.doneBtn,
                { backgroundColor: activeColor, opacity: pressed ? 0.92 : 1 },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}>
              <Text style={styles.doneText}>完成</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
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
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
    paddingRight: 40,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  content: {
    paddingTop: 92,
    paddingHorizontal: 18,
    gap: 24,
  },
  section: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  typeCard: {
    width: '31%',
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  typeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  form: {
    gap: 18,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  textInput: {
    borderBottomWidth: 1,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '800',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    borderBottomWidth: 1,
    paddingVertical: 6,
  },
  currency: {
    fontSize: 24,
    fontWeight: '900',
  },
  balanceInput: {
    flex: 1,
    padding: 0,
    fontSize: 32,
    fontWeight: '900',
  },
  notesInput: {
    borderRadius: 16,
    padding: 14,
    minHeight: 90,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  customCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    gap: 18,
  },
  customBlock: {
    gap: 10,
  },
  customLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  colorRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  iconCell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  footerInner: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  doneBtn: {
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
  doneText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
});

