import { WishSavingsCoreForm } from '@/components/wish-savings/wish-savings-core-form';
import {
  defaultWishExtrasFormValue,
  wishExtrasFromRow,
  wishExtrasToSavePayload,
  WishSavingsWishExtrasFields,
  type WishExtrasFormValue,
} from '@/components/wish-savings/wish-savings-wish-extras-fields';
import { AppButton, AppCard, AppScreen, ScreenHeader } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getSavingsPlanById } from '@/lib/repositories/savings-plan/savings-plan';
import { clearWishItemAiReview, getWishItemById } from '@/lib/repositories/wish-list/wish-list';
import { tryPersistWishItemAiComment } from '@/lib/repositories/wish-list/wish-item-ai-comment';
import {
  addCalendarDays,
  defaultWishSavingsFormDates,
  parseIsoDateLocal,
  validateWishSavingsForm,
} from '@/lib/wish-savings-form-utils';
import {
  createWishWithLinkedPlan,
  getLinkedSavingsPlanId,
  updateWishWithLinkedPlan,
} from '@/lib/wish-savings-link';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type WishItemEditorMode = { kind: 'create' } | { kind: 'edit'; id: string };

type WishItemEditorScreenProps = {
  mode: WishItemEditorMode;
};

export function WishItemEditorScreen({ mode }: WishItemEditorScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();

  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('5000');
  const [startDate, setStartDate] = useState(() => defaultWishSavingsFormDates().start);
  const [endDate, setEndDate] = useState(() => defaultWishSavingsFormDates().end);
  const [iconUri, setIconUri] = useState<string | null>(null);
  const [wishExtras, setWishExtras] = useState<WishExtrasFormValue>(defaultWishExtrasFormValue);

  const [saving, setSaving] = useState(false);
  const [editLoadState, setEditLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    mode.kind === 'edit' ? 'loading' : 'idle',
  );
  const editHydrateKeyRef = useRef<string | null>(null);
  const initialIconUriRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (mode.kind !== 'edit') {
      editHydrateKeyRef.current = null;
      setEditLoadState('idle');
      return;
    }
    const key = mode.id;
    if (editHydrateKeyRef.current === key) return;

    let cancelled = false;
    void (async () => {
      setEditLoadState('loading');
      const row = await getWishItemById(key);
      if (cancelled) return;
      if (!row) {
        setEditLoadState('error');
        return;
      }

      setName(row.name);
      setTargetAmount(String(Math.max(0, Math.round(row.price))));
      setIconUri(row.reference_image_uri);
      initialIconUriRef.current = row.reference_image_uri;
      setWishExtras(wishExtrasFromRow(row));

      const planId = getLinkedSavingsPlanId(row);
      const plan = planId ? await getSavingsPlanById(planId) : null;
      if (plan) {
        const s0 = parseIsoDateLocal(plan.start_date);
        const e0 = parseIsoDateLocal(plan.end_date);
        const minEnd0 = addCalendarDays(s0, 1);
        setStartDate(s0);
        setEndDate(e0.getTime() < minEnd0.getTime() ? minEnd0 : e0);
        setTargetAmount(String(Math.max(0, Math.round(plan.target_amount))));
        if (plan.avatar_uri) setIconUri(plan.avatar_uri);
      }

      editHydrateKeyRef.current = key;
      setEditLoadState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const handleSaveWish = useCallback(async () => {
    if (mode.kind === 'edit' && editLoadState !== 'ready') return;

    const validated = validateWishSavingsForm(name, startDate, endDate, targetAmount);
    if (!validated.ok) {
      Alert.alert('无法保存', validated.message);
      return;
    }

    const payload = {
      ...validated.value,
      avatar_uri: iconUri,
      ...wishExtrasToSavePayload(wishExtras),
    };

    setSaving(true);
    try {
      if (mode.kind === 'create') {
        const newId = await createWishWithLinkedPlan(payload);
        void tryPersistWishItemAiComment(newId, {
          name: payload.name,
          price: payload.target_amount,
          categoryLabel: payload.category_label,
          desire_level: payload.desire_level ?? 3,
          reason: payload.reason,
        });
      } else {
        await updateWishWithLinkedPlan(mode.id, payload, {
          avatarChanged: iconUri !== initialIconUriRef.current,
        });
        await clearWishItemAiReview(mode.id);
      }
      router.back();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [mode, editLoadState, name, startDate, endDate, targetAmount, iconUri, wishExtras, router]);

  const formReady = mode.kind === 'create' || editLoadState === 'ready';
  const screenTitle = mode.kind === 'create' ? '添加好物' : '编辑好物';
  const formTitle = mode.kind === 'create' ? '添加目标好物' : '编辑目标好物';

  return (
    <AppScreen
      edges={['left', 'right']}
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 96, gap: Spacing['3xl'] }}
      header={
        <ScreenHeader
          title={screenTitle}
          subtitle={mode.kind === 'create' ? '同步创建存钱计划' : '修改后同步更新计划'}
          onBack={() => router.back()}
          right={
            <Pressable
              style={styles.headerSaveBtn}
              disabled={saving || !formReady}
              onPress={() => void handleSaveWish()}
              accessibilityRole="button"
              accessibilityLabel="保存">
              {saving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[Typography.bodyStrong, { color: formReady ? colors.primary : colors.textMuted }]}>
                  保存
                </Text>
              )}
            </Pressable>
          }
        />
      }>
      {mode.kind === 'edit' && editLoadState === 'loading' ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[Typography.body, { color: colors.textSecondary }]}>加载好物…</Text>
        </View>
      ) : null}

      {mode.kind === 'edit' && editLoadState === 'error' ? (
        <View style={styles.stateWrap}>
          <MaterialIcons name="error-outline" size={48} color={colors.textMuted} />
          <Text style={[Typography.title, { color: colors.text }]}>未找到该条目</Text>
          <Text style={[Typography.body, { color: colors.textSecondary }]}>可能已被删除，请返回清单。</Text>
          <AppButton label="返回" variant="outline" size="sm" onPress={() => router.back()} style={styles.stateBtn} />
        </View>
      ) : null}

      {formReady ? (
        <>
          <AppCard style={styles.formCard}>
            <WishSavingsCoreForm
              formTitle={formTitle}
              variant="wish"
              name={name}
              onNameChange={setName}
              namePlaceholder="输入你的心仪好物"
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              targetAmount={targetAmount}
              onTargetAmountChange={setTargetAmount}
              iconUri={iconUri}
              onIconUriChange={setIconUri}
              insetsBottom={insets.bottom}
            />
          </AppCard>

          <AppCard style={styles.formCard}>
            <WishSavingsWishExtrasFields
              value={wishExtras}
              onChange={setWishExtras}
              collapsible={false}
              sectionTitle="心愿信息"
              variant="wish"
            />
          </AppCard>

          <AppButton
            label={saving ? '保存中…' : '保存好物'}
            loading={saving}
            disabled={saving}
            fullWidth
            onPress={() => void handleSaveWish()}
          />
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  headerSaveBtn: {
    minWidth: 56,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  stateWrap: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  stateBtn: {
    marginTop: 8,
  },
  formCard: {
    gap: Spacing.md,
  },
});
