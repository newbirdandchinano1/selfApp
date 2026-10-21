import { WishBoxGradientFill } from '@/components/wish-board/wish-box-gradient-fill';
import { WishBoardDescriptionField } from '@/components/wish-board/wish-board-description-field';
import { WishFormLabel } from '@/components/wish-board/wish-board-form-ui';
import { WishBoardRedeemConditionsField } from '@/components/wish-board/wish-board-redeem-conditions-field';
import {
  formatWishBoxPoints,
  wishBoxTintGradient,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { toast } from '@/lib/app-feedback';
import {
  DEFAULT_WISH_BOARD_ICON_KEY,
  WISH_BOARD_ICON_OPTIONS,
  type WishBoardIconOption,
} from '@/lib/constants/wish-board-icons';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  emptyWishBoardRedeemConditions,
  type WishBoardRedeemConditions,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import type { WishBoardWishType } from '@/lib/repositories/wish-board/wish-board.types';
import { assertNonNegativeCostPoints, formatPoints, POINTS_ABS_MAX } from '@/lib/reward-points';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TITLE_MAX = 20;
const COST_STEP = 100;

export type WishBoardItemFormValues = {
  title: string;
  description: string | null;
  icon_key: string;
  wish_type: WishBoardWishType;
  cost_points: number;
  redeem_conditions: WishBoardRedeemConditions;
};

type InitialValues = {
  title?: string;
  description?: string | null;
  icon_key?: string;
  wish_type?: WishBoardWishType;
  cost_points?: number;
  redeem_conditions?: WishBoardRedeemConditions;
};

type Props = {
  mode: 'create' | 'edit';
  initial?: InitialValues;
  /** 当前积分余额（「当前余额 2,680」） */
  balance: number;
  projects: ProjectRow[];
  tasks: TaskRow[];
  currentNetWorth?: number | null;
  conditionsLoading?: boolean;
  saving?: boolean;
  /** 已兑换心愿：只读查看 */
  readOnly?: boolean;
  /** 顶部提示（例如「该心愿已兑换，仅可查看」） */
  notice?: string;
  /** 编辑时用于把上传的配图绑定到心愿 */
  wishId?: string | null;
  onUploadedUri?: (uri: string) => void;
  onSubmit: (values: WishBoardItemFormValues) => void;
  onCancel: () => void;
};

/** 新增 / 编辑心愿共用的 WishBox 全屏表单（设计稿 05） */
export function WishBoardItemForm({
  mode,
  initial,
  balance,
  projects,
  tasks,
  currentNetWorth = null,
  conditionsLoading = false,
  saving = false,
  readOnly = false,
  notice,
  wishId,
  onUploadedUri,
  onSubmit,
  onCancel,
}: Props) {
  const insets = useSafeAreaInsets();
  const { c, gradients } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const disabled = readOnly || saving;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [costText, setCostText] = useState(
    initial?.cost_points == null ? '' : formatPoints(initial.cost_points),
  );
  const [iconKey, setIconKey] = useState(initial?.icon_key || DEFAULT_WISH_BOARD_ICON_KEY);
  const [wishType, setWishType] = useState<WishBoardWishType>(initial?.wish_type ?? 'once');
  const [redeemConditions, setRedeemConditions] = useState<WishBoardRedeemConditions>(
    initial?.redeem_conditions ?? emptyWishBoardRedeemConditions(),
  );

  const cost = useMemo(() => {
    const parsed = Number(String(costText).trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }, [costText]);

  const stepCost = (delta: number) => {
    const next = Math.min(POINTS_ABS_MAX, Math.max(0, cost + delta));
    setCostText(formatPoints(next));
  };

  const handleSubmit = () => {
    if (readOnly || saving) return;
    let nextCost: number;
    try {
      nextCost = assertNonNegativeCostPoints(costText || '0');
    } catch (e) {
      toast.warn(e instanceof Error ? e.message : '所需积分须为非负数字');
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.warn('请填写心愿名称');
      return;
    }
    onSubmit({
      title: trimmedTitle,
      description: description.trim() || null,
      icon_key: iconKey,
      wish_type: wishType,
      cost_points: nextCost,
      redeem_conditions: redeemConditions,
    });
  };

  const typeOptions = [
    { key: 'once' as const, label: '一次性', hint: '兑换后即结束' },
    { key: 'repeat' as const, label: '可重复', hint: '可多次兑换' },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top, backgroundColor: c.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.appbar}>
        <Pressable
          onPress={onCancel}
          hitSlop={8}
          style={({ pressed }) => [styles.appbarSide, { opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="取消">
          <Text style={[styles.appbarCancel, { color: c.muted }]}>取消</Text>
        </Pressable>
        <Text style={[styles.appbarTitle, { color: c.ink }]}>{mode === 'create' ? '新增心愿' : '编辑心愿'}</Text>
        {readOnly ? (
          <View style={styles.appbarSide} />
        ) : (
          <Pressable
            onPress={handleSubmit}
            disabled={saving}
            hitSlop={8}
            style={({ pressed }) => [
              styles.appbarSide,
              styles.appbarRight,
              { opacity: pressed ? 0.7 : saving ? 0.5 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="保存">
            {saving ? (
              <ActivityIndicator size="small" color={c.pri} />
            ) : (
              <Text style={[styles.appbarSave, { color: c.pri }]}>保存</Text>
            )}
          </Pressable>
        )}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.form,
          { paddingBottom: Math.max(insets.bottom, 16) + (readOnly ? 32 : 96) },
        ]}>
        {notice ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <WishFormLabel label="选个图标" hint="点击切换" />
        <IconSelector value={iconKey} onChange={setIconKey} disabled={disabled} />

        <WishFormLabel label="心愿名称" required hint={`${[...title].length}/${TITLE_MAX}`} />
        <TextInput
          value={title}
          onChangeText={text => setTitle([...text].slice(0, TITLE_MAX).join(''))}
          editable={!disabled}
          placeholder="例如：给自己一场周末露营"
          placeholderTextColor={c.muted}
          maxLength={TITLE_MAX}
          style={[styles.field, styles.fieldText]}
        />

        <WishBoardDescriptionField
          value={description}
          onChange={setDescription}
          onUploadedUri={onUploadedUri}
          wishId={wishId}
          editable={!disabled}
        />

        <WishFormLabel
          label="所需积分"
          required
          hint={`当前余额 ${formatWishBoxPoints(balance)}`}
        />
        <View style={[styles.stepper, disabled && styles.dim]}>
          <Pressable
            onPress={() => stepCost(-COST_STEP)}
            disabled={disabled}
            style={({ pressed }) => [styles.stepBtn, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="减少 100 积分">
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <View style={styles.stepValueRow}>
            <TextInput
              value={costText}
              onChangeText={setCostText}
              editable={!disabled}
              placeholder="0"
              placeholderTextColor={c.muted}
              keyboardType="decimal-pad"
              style={styles.stepValue}
            />
            <Text style={styles.stepUnit}>分</Text>
          </View>
          <Pressable
            onPress={() => stepCost(COST_STEP)}
            disabled={disabled}
            style={({ pressed }) => [
              styles.stepBtn,
              styles.stepBtnAdd,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="增加 100 积分">
            <Text style={styles.stepBtnAddText}>＋</Text>
          </Pressable>
        </View>

        <WishFormLabel label="心愿类型" required />
        <View style={[styles.typeseg, disabled && styles.dim]}>
          {typeOptions.map(opt => {
            const selected = wishType === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setWishType(opt.key)}
                disabled={disabled}
                style={[styles.typeSeg, selected ? styles.typeSegOn : styles.typeSegOff]}
                accessibilityRole="button"
                accessibilityState={{ selected }}>
                <Text style={[styles.typeLabel, selected && styles.typeLabelOn]}>
                  {opt.label}
                </Text>
                <Text style={[styles.typeHint, selected && styles.typeHintOn]}>{opt.hint}</Text>
              </Pressable>
            );
          })}
        </View>

        <WishBoardRedeemConditionsField
          value={redeemConditions}
          onChange={setRedeemConditions}
          projects={projects}
          tasks={tasks}
          currentNetWorth={currentNetWorth}
          loading={conditionsLoading}
          disabled={disabled}
        />
      </ScrollView>

      {readOnly ? null : (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 22) }]}>
          <Pressable
            onPress={handleSubmit}
            disabled={saving}
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.9 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={mode === 'create' ? '保存心愿' : '保存修改'}>
            <WishBoxGradientFill colors={gradients.primary} radius={17} />
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>
                {mode === 'create' ? '保存心愿' : '保存修改'}
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/** 图标选择：左侧大图标预览 + 右侧横滑小图标（设计稿 .ico-sel） */
function IconSelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const { c, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const selected = useMemo<WishBoardIconOption>(
    () =>
      WISH_BOARD_ICON_OPTIONS.find(o => o.key === value) ??
      WISH_BOARD_ICON_OPTIONS.find(o => o.key === DEFAULT_WISH_BOARD_ICON_KEY)!,
    [value],
  );
  const [gridOpen, setGridOpen] = useState(false);
  const gradient = wishBoxTintGradient(selected.tint);

  const choose = (key: string) => {
    onChange(key);
    setGridOpen(false);
  };

  return (
    <View style={styles.icoSel}>
      <View style={[styles.bigIco, shadows.soft]}>
        <WishBoxGradientFill key={selected.key} colors={gradient} radius={20} />
        <Text style={styles.bigIcoEmoji}>{selected.emoji}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.icoRow}>
        {WISH_BOARD_ICON_OPTIONS.map(opt => {
          const isSelected = opt.key === value;
          return (
            <Pressable
              key={opt.key}
              onPress={() => choose(opt.key)}
              disabled={disabled}
              style={[styles.ico, isSelected && styles.icoSelected]}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected: isSelected }}>
              <Text style={styles.icoEmoji}>{opt.emoji}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setGridOpen(true)}
          disabled={disabled}
          style={[styles.ico, styles.icoPlus]}
          accessibilityRole="button"
          accessibilityLabel="更多图标">
          <Text style={styles.icoPlusText}>＋</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={gridOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setGridOpen(false)}>
        <Pressable style={styles.gridOverlay} onPress={() => setGridOpen(false)}>
          <Pressable style={[styles.gridCard, shadows.dialog]} onPress={() => {}}>
            <View style={styles.gridHead}>
              <Text style={styles.gridTitle}>选个图标</Text>
              <Pressable onPress={() => setGridOpen(false)} hitSlop={10} accessibilityLabel="关闭">
                <MaterialIcons name="close" size={21} color={c.ink2} />
              </Pressable>
            </View>
            <View style={styles.grid}>
              {WISH_BOARD_ICON_OPTIONS.map(opt => {
                const isSelected = opt.key === value;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => choose(opt.key)}
                    style={[styles.ico, styles.gridIco, isSelected && styles.icoSelected]}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}>
                    <Text style={[styles.icoEmoji, styles.gridEmoji]}>{opt.emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(c: WishBoxPalette, shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: c.bg,
  },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  appbarSide: {
    minWidth: 48,
    minHeight: 40,
    justifyContent: 'center',
  },
  appbarRight: {
    alignItems: 'flex-end',
  },
  appbarCancel: {
    fontSize: 14.5,
    color: c.muted,
    fontWeight: '600',
  },
  appbarTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: c.ink,
  },
  appbarSave: {
    fontSize: 14.5,
    fontWeight: '800',
    color: c.pri,
  },
  form: {
    paddingHorizontal: 20,
  },
  notice: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 14,
    backgroundColor: c.amberSoft,
  },
  noticeText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.once,
    lineHeight: 18,
  },
  dim: {
    opacity: 0.6,
  },
  icoSel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bigIco: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bigIcoEmoji: {
    fontSize: 32,
  },
  icoRow: {
    gap: 6,
    alignItems: 'center',
    paddingRight: 16,
  },
  ico: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icoSelected: {
    borderColor: c.pri,
    backgroundColor: c.priSoft,
    ...shadows.soft,
  },
  icoEmoji: {
    fontSize: 17,
  },
  icoPlus: {
    backgroundColor: c.fieldSoft,
  },
  icoPlusText: {
    fontSize: 19,
    fontWeight: '700',
    color: c.faintInk,
  },
  gridOverlay: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  gridCard: {
    backgroundColor: c.sheet,
    borderRadius: 26,
    padding: 20,
  },
  gridHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  gridTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: c.ink,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gridIco: {
    width: 46,
    height: 46,
    borderRadius: 15,
  },
  gridEmoji: {
    fontSize: 23,
  },
  field: {
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    borderRadius: 15,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  fieldText: {
    fontSize: 13.5,
    color: c.ink,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 6,
    paddingLeft: 16,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: c.graySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 22,
    fontWeight: '800',
    color: c.ink,
    lineHeight: 26,
  },
  stepBtnAdd: {
    backgroundColor: c.pri,
    ...shadows.button,
    shadowOpacity: 0.3,
  },
  stepBtnAddText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 24,
  },
  stepValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  stepValue: {
    minWidth: 70,
    fontSize: 19,
    fontWeight: '800',
    color: c.ink,
    textAlign: 'center',
    paddingVertical: 2,
    fontVariant: ['tabular-nums'],
  },
  stepUnit: {
    fontSize: 12,
    fontWeight: '700',
    color: c.muted,
    marginBottom: 5,
    marginLeft: 3,
  },
  typeseg: {
    flexDirection: 'row',
    gap: 5,
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    borderRadius: 16,
    padding: 5,
  },
  typeSeg: {
    flex: 1,
    borderRadius: 11,
    paddingVertical: 7,
    alignItems: 'center',
  },
  typeSegOn: {
    backgroundColor: c.ink,
  },
  typeSegOff: {
    backgroundColor: 'transparent',
  },
  typeLabel: {
    fontSize: 13.5,
    fontWeight: '800',
    color: c.muted,
  },
  typeLabelOn: {
    color: c.onInk,
  },
  typeHint: {
    fontSize: 11,
    fontWeight: '600',
    color: c.muted,
    marginTop: 1,
  },
  typeHintOn: {
    color: c.onInkSoft,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: c.footer,
  },
  saveBtn: {
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...shadows.button,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  });
}
