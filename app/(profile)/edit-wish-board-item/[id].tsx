import { AppButton, AppInput, AppScreen, ScreenHeader } from '@/components/ui';
import { Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getWishBoardItemById,
  updateWishBoardItem,
} from '@/lib/repositories/wish-board/wish-board';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

export default function EditWishBoardItemScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const [title, setTitle] = useState('');
  const [costText, setCostText] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [redeemed, setRedeemed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const row = await getWishBoardItemById(id);
        if (!row || cancelled) {
          if (!cancelled && !row) {
            Alert.alert('未找到心愿', undefined, [{ text: '好', onPress: () => router.back() }]);
          }
          return;
        }
        setTitle(row.title);
        setCostText(String(row.cost_points));
        setDescription(row.description ?? '');
        setRedeemed(row.wish_type === 'once' && row.status === 'redeemed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const onSave = async () => {
    if (redeemed) {
      Alert.alert('已兑换的心愿不可编辑');
      return;
    }
    const cost = Math.floor(Number(costText));
    if (!title.trim()) {
      Alert.alert('请填写心愿名称');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      Alert.alert('所需积分须为非负整数');
      return;
    }
    setSaving(true);
    try {
      await updateWishBoardItem(id, {
        title: title.trim(),
        cost_points: cost,
        description: description.trim() || null,
      });
      router.back();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppScreen header={<ScreenHeader title="编辑心愿" onBack={() => router.back()} />}>
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      header={<ScreenHeader title="编辑心愿" onBack={() => router.back()} />}
      contentContainerStyle={styles.content}>
      {redeemed ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>该心愿已兑换，仅可查看。</Text>
      ) : null}
      <View style={styles.form}>
        <AppInput
          label="心愿名称"
          value={title}
          onChangeText={setTitle}
          editable={!redeemed}
          maxLength={80}
        />
        <AppInput
          label="所需积分"
          value={costText}
          onChangeText={setCostText}
          editable={!redeemed}
          keyboardType="number-pad"
        />
        <AppInput
          label="描述（可选）"
          value={description}
          onChangeText={setDescription}
          editable={!redeemed}
          multiline
          maxLength={500}
          style={{ minHeight: 96, textAlignVertical: 'top' }}
        />
      </View>
      {!redeemed ? (
        <AppButton label="保存" fullWidth loading={saving} onPress={() => void onSave()} />
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing['5xl'],
    paddingBottom: Spacing['6xl'],
    gap: Spacing.lg,
  },
  form: {
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  hint: {
    marginTop: Spacing.sm,
    fontSize: 13,
  },
});
