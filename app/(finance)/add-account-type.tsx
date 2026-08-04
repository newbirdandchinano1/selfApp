import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import { upsertFinanceAccountType } from '@/lib/repositories/finance/finance';
import { getCustomAccountTypeDraft, setCustomAccountTypeDraft, upsertCustomAccountTypeOption } from '@/lib/state/account-type-draft';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AddAccountTypeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [name, setName] = React.useState(() => getCustomAccountTypeDraft().name);
  const [isLiability, setIsLiability] = React.useState(() => getCustomAccountTypeDraft().isLiability);
  const [iconKey, setIconKey] = React.useState(() => getCustomAccountTypeDraft().iconKey || 'savings');

  const accentColor = isDark ? '#D97706' : '#B45309';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(242,243,255,0.95)';
  const canSave = name.trim().length > 0;

  const onSave = React.useCallback(async () => {
    const nextName = name.trim();
    if (!nextName) {
      Alert.alert('请输入类型名称', '类型名称不能为空。');
      return;
    }
    try {
      await upsertFinanceAccountType({
        name: nextName,
        is_liability: isLiability ? 1 : 0,
        icon_key: iconKey,
      });
      setCustomAccountTypeDraft({
        name: nextName,
        isLiability,
        iconKey,
      });
      upsertCustomAccountTypeOption({
        name: nextName,
        isLiability,
        iconKey,
      });
      router.back();
    } catch (e) {
      console.warn('保存自定义类型失败:', e);
      Alert.alert('保存失败', '自定义类型保存失败，请稍后重试。');
    }
  }, [iconKey, isLiability, name, router]);

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
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>自定义类型</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 + Math.max(insets.bottom, 12) }]} showsVerticalScrollIndicator={false}>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>类型名称</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="例如：房产 / 保险 / 借款 / 数字资产..."
            placeholderTextColor={outlineVariant}
            style={[styles.textInput, { color: theme.text, borderBottomColor: outlineVariant }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>类型性质</Text>
          <View style={[styles.segmentedWrap, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
            <Pressable
              onPress={() => setIsLiability(false)}
              style={({ pressed }) => [styles.segmentItem, !isLiability && { backgroundColor: `${accentColor}18` }, pressed && { opacity: 0.9 }]}>
              <MaterialIcons name="account-balance-wallet" size={16} color={accentColor} />
              <Text style={[styles.segmentText, { color: theme.text }]}>资产</Text>
            </Pressable>
            <Pressable
              onPress={() => setIsLiability(true)}
              style={({ pressed }) => [styles.segmentItem, isLiability && { backgroundColor: `${accentColor}18` }, pressed && { opacity: 0.9 }]}>
              <MaterialIcons name="credit-card" size={16} color={accentColor} />
              <Text style={[styles.segmentText, { color: theme.text }]}>负债</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>类型图标</Text>
          <View style={styles.iconGrid}>
            {FINANCE_ACCOUNT_ICON_OPTIONS.map((it) => {
              const active = it.key === iconKey;
              return (
                <Pressable
                  key={it.key}
                  onPress={() => setIconKey(it.key)}
                  style={({ pressed }) => [styles.iconCell, pressed && { opacity: 0.9 }]}
                >
                  <View
                    style={[
                      styles.iconCellInner,
                      { backgroundColor: surfaceLow },
                      active && { backgroundColor: `${accentColor}1A` },
                    ]}>
                    <MaterialIcons name={it.icon} size={18} color={active ? accentColor : theme.text} />
                  </View>
                </Pressable>
              );
            })}
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
            onPress={() => void onSave()}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.doneBtn,
              { backgroundColor: accentColor, opacity: !canSave ? 0.5 : pressed ? 0.92 : 1 },
              pressed && { transform: [{ scale: 0.98 }] },
            ]}>
            <Text style={styles.doneText}>保存类型</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  headerSpacer: { width: 40, height: 40 },
  content: {
    paddingTop: 106,
    paddingHorizontal: 18,
    gap: 18,
  },
  field: { gap: 8 },
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
  segmentedWrap: {
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    padding: 4,
    flexDirection: 'row',
    gap: 6,
  },
  segmentItem: {
    flex: 1,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  iconCell: {
    width: '20%',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  iconCellInner: {
    width: '100%',
    aspectRatio: 1,
    minWidth: 44,
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

