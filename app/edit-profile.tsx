import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';




import { getDefaultUser, updateDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';

const GENDER_OPTIONS = ['男', '女'] as const;
const LIFESTYLE_OPTIONS = ['长期静坐不运动', '健身', '高强度锻炼'] as const;
const GOAL_OPTIONS = ['无', '减脂', '增肌'] as const;
const DEFAULT_GENDER: (typeof GENDER_OPTIONS)[number] = '男';
const DEFAULT_LIFESTYLE: (typeof LIFESTYLE_OPTIONS)[number] = '长期静坐不运动';
const DEFAULT_GOAL: (typeof GOAL_OPTIONS)[number] = '无';


export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [user, setUser] = useState<UserRow | null>(null);


  const [name, setName] = useState('默认用户');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [gender, setGender] = useState<(typeof GENDER_OPTIONS)[number]>(DEFAULT_GENDER);
  const [lifestyle, setLifestyle] = useState<(typeof LIFESTYLE_OPTIONS)[number]>(DEFAULT_LIFESTYLE);
  const [goal, setGoal] = useState<(typeof GOAL_OPTIONS)[number]>(DEFAULT_GOAL);
  const [height, setHeight] = useState('0');
  const [weight, setWeight] = useState('0');
  const [age, setAge] = useState('0');

  const handleNumericInput = (value: string, setter: (next: string) => void) => {
    setter(value.replace(/\D+/g, ''));
  };


  const saveProfile = async () => {
    try {
      await updateDefaultUser({
        name,
        avatar_uri: avatarUri,
        gender,
        lifestyle,
        goal,
        height: Number(height),
        weight: Number(weight),
        age: Number(age),
      });
      Alert.alert('保存成功');
      router.dismissTo('/(tabs)/profile');
    } catch (error) {
      const message = error instanceof Error ? error.message : '请稍后重试';
      Alert.alert('保存失败', message);
    }
  };

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '需要相册权限才能选择头像');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setAvatarUri(result.assets[0].uri);
      setUser(prev => (prev ? { ...prev, avatar_uri: result.assets[0].uri } : prev));
    }
  };



  useEffect(() => {
    let mounted = true;
  
    const loadUser = async () => {
      const data = await getDefaultUser();
      if (!mounted) return;
  
      setUser(data);
    };
  
    loadUser();
  
    return () => {
      mounted = false;
    };
  }, []);
  
  useEffect(() => {
    if (!user) return;
  
    setName(user.name ?? '默认用户');
    setAvatarUri(user.avatar_uri ?? null);
    setGender(
      GENDER_OPTIONS.includes(user.gender as (typeof GENDER_OPTIONS)[number])
        ? (user.gender as (typeof GENDER_OPTIONS)[number])
        : DEFAULT_GENDER
    );
    setLifestyle(
      LIFESTYLE_OPTIONS.includes(user.lifestyle as (typeof LIFESTYLE_OPTIONS)[number])
        ? (user.lifestyle as (typeof LIFESTYLE_OPTIONS)[number])
        : DEFAULT_LIFESTYLE
    );
    setGoal(
      GOAL_OPTIONS.includes(user.goal as (typeof GOAL_OPTIONS)[number])
        ? (user.goal as (typeof GOAL_OPTIONS)[number])
        : DEFAULT_GOAL
    );
    setHeight(String(user.height ?? 0));
    setWeight(String(user.weight ?? 0));
    setAge(String(user.age ?? 0));
  }, [user]);


  const palette = useMemo(
    () => ({
      bg: isDark ? theme.background : '#faf8ff',
      surface: isDark ? theme.surface : '#ffffff',
      text: isDark ? theme.text : '#131b2e',
      outline: isDark ? 'rgba(148,163,184,0.8)' : '#727785',
      outlineVariant: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.35)',
      primary: isDark ? '#60a5fa' : '#0058be',
      secondary: isDark ? '#34d399' : '#006c49',
      topBarBg: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.86)',
    }),
    [isDark, theme],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.bg }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.topBar,
          {
            backgroundColor: palette.topBarBg,
            paddingTop: Math.max(insets.top, 14),
            borderBottomColor: palette.outlineVariant,
          },
        ]}
      >
        <View style={styles.topBarInner}>
          <View style={styles.topLeft}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.roundBtn, { backgroundColor: pressed ? `${palette.primary}18` : 'transparent' }]}
            >
              <MaterialIcons name="arrow-back" size={22} color={palette.primary} />
            </Pressable>
            <Text style={[styles.topTitle, { color: palette.text }]}>编辑个人资料</Text>
          </View>

        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 18, paddingBottom: Math.max(insets.bottom + 20, 32) }}
      >
        <View style={styles.main}>
          <View style={styles.avatarSection}>
            <View style={styles.avatarWrap}>
              <Pressable
                onPress={pickAvatar}
                style={[
                  styles.avatarRing,
                  { borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(242,243,255,1)' },
                ]}
              >
                <Image
                  source={avatarUri ? { uri: avatarUri } : require('../assets/profile/avatar.png')}
                  style={styles.avatarImg}
                  contentFit="cover"
                />
              </Pressable>
              <Pressable onPress={pickAvatar} style={[styles.cameraBtn, { backgroundColor: palette.primary }]}>
                <MaterialIcons name="photo-camera" size={20} color="#fff" />
              </Pressable>
            </View>

            <Text style={[styles.avatarKicker, { color: palette.outline }]}>账号身份</Text>
            <Text style={[styles.avatarTitle, { color: palette.text }]}>编辑个人资料</Text>
          </View>

          <View style={styles.group}>
            <View style={styles.groupTitleRow}>
              <View style={[styles.groupMark, { backgroundColor: palette.primary }]} />
              <Text style={[styles.groupTitle, { color: palette.outline }]}>基本信息</Text>
            </View>

            <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}> 
              <Text style={[styles.fieldLabel, { color: palette.outline }]}>姓名</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="输入您的姓名"
                placeholderTextColor={isDark ? 'rgba(148,163,184,0.6)' : 'rgba(114,119,133,0.5)'}
                style={[styles.fieldInput, { color: palette.text, borderBottomColor: palette.outlineVariant }]}
              />
            </View>

            <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
              <Text style={[styles.fieldLabel, { color: palette.outline }]}>性别</Text>
              <View style={styles.optionRow}>
                {GENDER_OPTIONS.map(option => {
                  const active = gender === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setGender(option)}
                      style={[
                        styles.optionChip,
                        {
                          borderColor: active ? palette.primary : palette.outlineVariant,
                          backgroundColor: active ? `${palette.primary}16` : 'transparent',
                        },
                      ]}
                    >
                      <Text style={[styles.optionText, { color: active ? palette.primary : palette.text }]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
              <Text style={[styles.fieldLabel, { color: palette.outline }]}>生活习惯</Text>
              <View style={styles.optionWrap}>
                {LIFESTYLE_OPTIONS.map(option => {
                  const active = lifestyle === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setLifestyle(option)}
                      style={[
                        styles.optionChip,
                        {
                          borderColor: active ? palette.primary : palette.outlineVariant,
                          backgroundColor: active ? `${palette.primary}16` : 'transparent',
                        },
                      ]}
                    >
                      <Text style={[styles.optionText, { color: active ? palette.primary : palette.text }]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={[styles.fieldCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
              <Text style={[styles.fieldLabel, { color: palette.outline }]}>目标</Text>
              <View style={styles.optionRow}>
                {GOAL_OPTIONS.map(option => {
                  const active = goal === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setGoal(option)}
                      style={[
                        styles.optionChip,
                        {
                          borderColor: active ? palette.primary : palette.outlineVariant,
                          backgroundColor: active ? `${palette.primary}16` : 'transparent',
                        },
                      ]}
                    >
                      <Text style={[styles.optionText, { color: active ? palette.primary : palette.text }]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={styles.group}>
            <View style={styles.groupTitleRow}>
              <View style={[styles.groupMark, { backgroundColor: palette.secondary }]} />
              <Text style={[styles.groupTitle, { color: palette.outline }]}>体征数据</Text>
            </View>

            <View style={styles.metricGrid}>
              <View style={[styles.metricCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
                <Text style={[styles.fieldLabel, { color: palette.outline }]}>身高</Text>
                <View style={styles.metricRow}>
                  <TextInput
                    value={height}
                    onChangeText={(value) => handleNumericInput(value, setHeight)}
                    style={[styles.metricInput, { color: palette.text, borderBottomColor: palette.outlineVariant }]}
                  />
                  <Text style={[styles.metricUnit, { color: palette.outline }]}>cm</Text>
                </View>
              </View>

              <View style={[styles.metricCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
                <Text style={[styles.fieldLabel, { color: palette.outline }]}>体重</Text>
                <View style={styles.metricRow}>
                  <TextInput
                    value={weight}
                    onChangeText={(value) => handleNumericInput(value, setWeight)}
                    style={[styles.metricInput, { color: palette.text, borderBottomColor: palette.outlineVariant }]}
                  />
                  <Text style={[styles.metricUnit, { color: palette.outline }]}>kg</Text>
                </View>
              </View>

              <View style={[styles.metricCard, { backgroundColor: palette.surface, borderColor: palette.outlineVariant }]}>
                <Text style={[styles.fieldLabel, { color: palette.outline }]}>年龄</Text>
                <View style={styles.metricRow}>
                  <TextInput
                    value={age}
                    onChangeText={(value) => handleNumericInput(value, setAge)}
                    style={[styles.metricInput, { color: palette.text, borderBottomColor: palette.outlineVariant }]}
                  />
                  <Text style={[styles.metricUnit, { color: palette.outline }]}>岁</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={[styles.metaCard, { backgroundColor: `${palette.primary}0D`, borderColor: `${palette.primary}1F` }]}> 
            <View style={styles.metaLeft}>
              <Text style={[styles.metaTitle, { color: palette.primary }]}>数据精准度</Text>
              <Text style={[styles.metaDesc, { color: isDark ? 'rgba(226,232,240,0.8)' : '#424754' }]}>
                更新您的身体指标有助于我们的AI以 99.8% 的准确度计算您的代谢和健康基准。
              </Text>
            </View>
            <View style={styles.scoreWrap}>
              <View style={[styles.scoreOuter, { borderColor: `${palette.primary}33` }]}>
                <View style={[styles.scoreInner, { borderColor: palette.primary }]} />
                <Text style={[styles.scoreText, { color: palette.primary }]}>80%</Text>
              </View>
            </View>
          </View>

          <Pressable onPress={saveProfile} style={[styles.submitBtn, { backgroundColor: palette.primary }]}>
            <Text style={styles.submitText}>更新个人资料</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { borderBottomWidth: 1 },
  topBarInner: {
    height: 58,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundBtn: {
    width: 38,
    height: 38,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  saveText: { fontSize: 16, fontWeight: '800' },
  main: { paddingHorizontal: 22, gap: 26 },
  avatarSection: { alignItems: 'center', marginTop: 8, marginBottom: 10 },
  avatarWrap: { width: 132, height: 132, position: 'relative' },
  avatarRing: {
    width: '100%',
    height: '100%',
    borderRadius: 66,
    overflow: 'hidden',
    borderWidth: 4,
  },
  avatarImg: { width: '100%', height: '100%' },
  cameraBtn: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#faf8ff',
  },
  avatarKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginTop: 18,
    textTransform: 'uppercase',
  },
  avatarTitle: { fontSize: 28, fontWeight: '900', marginTop: 6, letterSpacing: -0.5 },
  group: { gap: 12 },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupMark: { width: 4, height: 16, borderRadius: 999 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  fieldCard: { borderRadius: 16, padding: 18, borderWidth: 1 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  fieldInput: { borderBottomWidth: 1, paddingBottom: 8, fontSize: 24, fontWeight: '700' },
  optionRow: { flexDirection: 'row', gap: 10 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { fontSize: 14, fontWeight: '700' },
  metricGrid: { gap: 12 },
  metricCard: { borderRadius: 16, padding: 18, borderWidth: 1 },
  metricRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  metricInput: { flex: 1, borderBottomWidth: 1, paddingBottom: 8, fontSize: 30, fontWeight: '900' },
  metricUnit: { fontSize: 14, fontWeight: '800', paddingBottom: 8 },
  metaCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  metaLeft: { flex: 1, gap: 6 },
  metaTitle: { fontSize: 22, fontWeight: '800' },
  metaDesc: { fontSize: 13, lineHeight: 20 },
  scoreWrap: { width: 82, alignItems: 'center', justifyContent: 'center' },
  scoreOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreInner: {
    position: 'absolute',
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 6,
    borderTopColor: 'transparent',
    borderLeftColor: 'transparent',
    transform: [{ rotate: '40deg' }],
  },
  scoreText: { fontSize: 12, fontWeight: '900' },
  submitBtn: {
    marginTop: 6,
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
