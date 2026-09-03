import { AppButton, AppInput } from '@/components/ui';
import { WishBoardRedeemConditionsField } from '@/components/wish-board/wish-board-redeem-conditions-field';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  DEFAULT_WISH_BOARD_ICON_KEY,
  WISH_BOARD_ICON_OPTIONS,
  wishBoardIconTintSoft,
} from '@/lib/constants/wish-board-icons';
import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTasks } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  emptyWishBoardRedeemConditions,
  type WishBoardRedeemConditions,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import { createWishBoardItem } from '@/lib/repositories/wish-board/wish-board';
import type { WishBoardWishType } from '@/lib/repositories/wish-board/wish-board.types';
import { assertNonNegativeCostPoints } from '@/lib/reward-points';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

export function AddWishBoardModal({ visible, onClose, onCreated }: Props) {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [costText, setCostText] = useState('');
  const [iconKey, setIconKey] = useState(DEFAULT_WISH_BOARD_ICON_KEY);
  const [wishType, setWishType] = useState<WishBoardWishType>('once');
  const [redeemConditions, setRedeemConditions] = useState<WishBoardRedeemConditions>(
    emptyWishBoardRedeemConditions(),
  );
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [bindLoading, setBindLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setDescription('');
    setCostText('');
    setIconKey(DEFAULT_WISH_BOARD_ICON_KEY);
    setWishType('once');
    setRedeemConditions(emptyWishBoardRedeemConditions());
    setSaving(false);

    let cancelled = false;
    setBindLoading(true);
    void (async () => {
      try {
        const [nextProjects, nextTasks] = await Promise.all([getProjects(), getTasks()]);
        if (cancelled) return;
        setProjects(nextProjects);
        setTasks(nextTasks);
      } catch {
        if (!cancelled) {
          setProjects([]);
          setTasks([]);
        }
      } finally {
        if (!cancelled) setBindLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const onSubmit = async () => {
    let cost: number;
    try {
      cost = assertNonNegativeCostPoints(costText);
    } catch (e) {
      Alert.alert(e instanceof Error ? e.message : '所需积分须为非负数字（可含小数）');
      return;
    }
    if (!title.trim()) {
      Alert.alert('请填写心愿名称');
      return;
    }
    setSaving(true);
    try {
      await createWishBoardItem({
        title: title.trim(),
        description: description.trim() || null,
        icon_key: iconKey,
        wish_type: wishType,
        cost_points: cost,
        redeem_conditions: redeemConditions,
      });
      onClose();
      onCreated?.();
    } catch (e) {
      Alert.alert('添加失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const sheetBg = colors.surface;
  const outline = colors.outline;
  const muted = colors.textSecondary;
  const selectedBorder = colors.primary;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: sheetBg,
              borderColor: outline,
              paddingBottom: Math.max(insets.bottom, Spacing['4xl']),
            },
          ]}>
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>添加心愿</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="关闭">
              <MaterialIcons name="close" size={22} color={muted} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.form}>
            <AppInput
              label="心愿名称"
              value={title}
              onChangeText={setTitle}
              placeholder="例如：看一场电影"
              maxLength={80}
            />

            <AppInput
              label="描述（可选）"
              value={description}
              onChangeText={setDescription}
              placeholder="补充说明或兑换规则"
              multiline
              maxLength={500}
              inputStyle={{ minHeight: 72, textAlignVertical: 'top' }}
            />

            <Text style={[styles.fieldLabel, { color: muted }]}>图标</Text>
            <View style={styles.iconGrid}>
              {WISH_BOARD_ICON_OPTIONS.map(opt => {
                const selected = opt.key === iconKey;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setIconKey(opt.key)}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                    accessibilityState={{ selected }}
                    style={[
                      styles.iconCell,
                      {
                        borderColor: selected ? opt.tint : outline,
                        backgroundColor: selected
                          ? wishBoardIconTintSoft(opt.tint, isDark)
                          : colors.surfaceSubtle,
                      },
                    ]}>
                    <Text style={styles.iconEmoji}>{opt.emoji}</Text>
                  </Pressable>
                );
              })}
            </View>

            <AppInput
              label="所需积分"
              value={costText}
              onChangeText={setCostText}
              placeholder="0（可含小数）"
              keyboardType="decimal-pad"
            />

            <WishBoardRedeemConditionsField
              value={redeemConditions}
              onChange={setRedeemConditions}
              projects={projects}
              tasks={tasks}
              loading={bindLoading}
              textColor={colors.text}
              outline={muted}
              placeholderColor={outline}
              primary={colors.primary}
              surfaceLow={colors.surfaceSubtle}
              surfaceLowest={colors.surface}
              isDark={isDark}
            />

            <Text style={[styles.fieldLabel, { color: muted }]}>心愿类型</Text>
            <View style={styles.typeRow}>
              {(
                [
                  { key: 'once', label: '一次性心愿', hint: '兑换后结束' },
                  { key: 'repeat', label: '重复性心愿', hint: '可多次兑换' },
                ] as const
              ).map(opt => {
                const selected = wishType === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setWishType(opt.key)}
                    style={[
                      styles.typeChip,
                      {
                        borderColor: selected ? selectedBorder : outline,
                        backgroundColor: selected
                          ? isDark
                            ? 'rgba(96,165,250,0.16)'
                            : 'rgba(0,88,190,0.08)'
                          : 'transparent',
                      },
                    ]}>
                    <MaterialIcons
                      name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
                      size={18}
                      color={selected ? colors.primary : muted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.typeLabel, { color: colors.text }]}>{opt.label}</Text>
                      <Text style={[styles.typeHint, { color: muted }]}>{opt.hint}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <AppButton
              label="添加心愿"
              fullWidth
              loading={saving}
              onPress={() => void onSubmit()}
              style={styles.submitBtn}
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['4xl'],
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing['3xl'],
  },
  sheetTitle: {
    ...Typography.h3,
  },
  form: {
    gap: Spacing['3xl'],
    paddingBottom: Spacing['4xl'],
  },
  fieldLabel: {
    ...Typography.caption,
    marginBottom: -Spacing.md,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  iconCell: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: {
    fontSize: 22,
    lineHeight: 28,
  },
  typeRow: {
    gap: Spacing.md,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1.5,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.xl,
  },
  typeLabel: {
    ...Typography.bodyStrong,
  },
  typeHint: {
    ...Typography.caption,
    marginTop: 2,
  },
  submitBtn: {
    marginTop: Spacing.sm,
  },
});
