import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const categoryOptions = ['数码', '家居', '健康', '学习', '体验', '其他'];

export default function AddWishItemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [desireLevel, setDesireLevel] = useState(3);
  const [reason, setReason] = useState('');

  const bg = isDark ? theme.background : '#faf8ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.24)' : 'rgba(194,198,214,0.6)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const surface = isDark ? '#111827' : '#ffffff';
  const surfaceLow = isDark ? '#1f2937' : '#f2f3ff';

  const canSave = useMemo(() => name.trim().length > 0 && price.trim().length > 0, [name, price]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right', 'top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 10) + 4,
            backgroundColor: isDark ? 'rgba(17,24,39,0.82)' : 'rgba(255,255,255,0.82)',
            borderBottomColor: outlineVariant,
          },
        ]}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: primary }]}>添加新好物</Text>
        <Pressable style={styles.headerSaveBtn} onPress={() => router.back()}>
          <Text style={[styles.headerSaveText, { color: primary }]}>保存</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 120 }]}>
        <View style={styles.section}>
          <View style={[styles.underlineWrap, { borderBottomColor: outlineVariant }]}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="输入好物名称..."
              placeholderTextColor={outline}
              style={[styles.nameInput, { color: text }]}
            />
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: surfaceLow }]}>
          <View style={[styles.leftAccent, { backgroundColor: primary }]} />
          <Text style={[styles.kicker, { color: outline }]}>FINANCIAL ALLOCATION</Text>
          <Text style={[styles.sectionTitle, { color: text }]}>预估开销与分类</Text>

          <View style={styles.rowGrid}>
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: outline }]}>预估价格</Text>
              <View style={[styles.underlineWrap, { borderBottomColor: outlineVariant }]}>
                <Text style={[styles.currency, { color: text }]}>¥</Text>
                <TextInput
                  value={price}
                  onChangeText={v => setPrice(v.replace(/[^\d.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor={outline}
                  keyboardType="decimal-pad"
                  style={[styles.priceInput, { color: text }]}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: outline }]}>所属类别</Text>
              <View style={[styles.underlineWrap, { borderBottomColor: outlineVariant }]}>
                <Text style={[styles.categoryValue, { color: category ? text : outline }]}>
                  {category || '选择类别...'}
                </Text>
                <MaterialIcons name="arrow-drop-down" size={24} color={outline} />
              </View>
              <View style={styles.categoryWrap}>
                {categoryOptions.map(item => {
                  const active = item === category;
                  return (
                    <Pressable
                      key={item}
                      onPress={() => setCategory(item)}
                      style={[
                        styles.categoryPill,
                        {
                          backgroundColor: active ? `${primary}1A` : surface,
                          borderColor: active ? `${primary}44` : outlineVariant,
                        },
                      ]}>
                      <Text style={[styles.categoryPillText, { color: active ? primary : outline }]}>{item}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: surface }]}>
          <Text style={[styles.kicker, { color: outline }]}>INTENT METRIC</Text>
          <Text style={[styles.sectionTitle, { color: text }]}>欲望等级</Text>
          <View style={styles.starRow}>
            <Text style={[styles.edgeText, { color: outline }]}>理智购买</Text>
            <View style={styles.starsWrap}>
              {[1, 2, 3, 4, 5].map(level => {
                const active = level <= desireLevel;
                return (
                  <Pressable key={level} onPress={() => setDesireLevel(level)} style={styles.starBtn}>
                    <MaterialIcons name="star" size={30} color={active ? primary : '#c2c6d6'} />
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.edgeText, { color: text }]}>心之所向</Text>
          </View>
        </View>

        <View style={[styles.reasonWrap, { borderLeftColor: outlineVariant }]}>
          <Text style={[styles.kicker, { color: outline }]}>RATIONALE</Text>
          <Text style={[styles.sectionTitle, { color: text }]}>心动理由</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            placeholder="记录此刻的心动理由或必要性分析..."
            placeholderTextColor={outline}
            style={[
              styles.reasonInput,
              {
                backgroundColor: surface,
                borderColor: outlineVariant,
                color: text,
              },
            ]}
          />
        </View>

        <Pressable style={[styles.uploadCard, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
          <View style={[styles.uploadIconWrap, { backgroundColor: isDark ? '#374151' : '#eaedff' }]}>
            <MaterialIcons name="add-photo-alternate" size={22} color={outline} />
          </View>
          <Text style={[styles.uploadText, { color: outline }]}>上传参考图</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          disabled={!canSave}
          style={[
            styles.bottomBtn,
            {
              backgroundColor: primary,
              opacity: canSave ? 1 : 0.45,
            },
          ]}>
          <MaterialIcons name="save" size={18} color="#fff" />
          <Text style={styles.bottomBtnText}>存入清单</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 20,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSaveBtn: {
    minWidth: 56,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  headerSaveText: {
    fontSize: 16,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 112,
    gap: 18,
  },
  section: {
    gap: 8,
  },
  underlineWrap: {
    borderBottomWidth: 1,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nameInput: {
    flex: 1,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
    padding: 0,
  },
  sectionCard: {
    borderRadius: 16,
    padding: 20,
    gap: 10,
    overflow: 'hidden',
  },
  leftAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  rowGrid: {
    gap: 16,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  currency: {
    fontSize: 20,
    fontWeight: '700',
  },
  priceInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    padding: 0,
  },
  categoryValue: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  categoryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
  },
  edgeText: {
    fontSize: 13,
    fontWeight: '500',
  },
  starsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starBtn: {
    padding: 2,
  },
  reasonWrap: {
    borderLeftWidth: 1,
    paddingLeft: 16,
    gap: 8,
  },
  reasonInput: {
    minHeight: 112,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  uploadCard: {
    minHeight: 180,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  uploadIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadText: {
    fontSize: 15,
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(250,248,255,0.96)',
  },
  bottomBtn: {
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  bottomBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
