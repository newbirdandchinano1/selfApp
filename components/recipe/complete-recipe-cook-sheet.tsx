import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { addRecipeCookLog } from '@/lib/recipe-cook-log';
import { getRecipePalette } from '@/lib/recipe-theme';
import { recordRecipeCooked, type RecipeItem } from '@/lib/recipes';
import { PaletteDark, PaletteLight } from '@/constants/design-tokens';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
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

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export type CompleteRecipeCookSheetProps = {
  visible: boolean;
  onClose: () => void;
  recipeId: string;
  recipeTitle: string;
  /** 保存成功后回传更新后的菜谱（times_cooked / last_cooked_at） */
  onSaved?: (recipe: RecipeItem) => void;
};

export function CompleteRecipeCookSheet({
  visible,
  onClose,
  recipeId,
  recipeTitle,
  onSaved,
}: CompleteRecipeCookSheetProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const p = getRecipePalette(colorScheme);
  const tokens = (colorScheme ?? 'light') === 'dark' ? PaletteDark : PaletteLight;
  const reduceMotion = useReducedMotion();

  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [shouldRender, setShouldRender] = useState(visible);
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const resetForm = useCallback(() => {
    setRating(0);
    setNote('');
    setSaving(false);
  }, []);

  const playOpen = useCallback(() => {
    if (reduceMotion) {
      translateY.setValue(0);
      backdropOpacity.setValue(1);
      return;
    }
    translateY.setValue(SCREEN_HEIGHT);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, reduceMotion, translateY]);

  const playClose = useCallback(
    (after?: () => void) => {
      if (reduceMotion) {
        translateY.setValue(SCREEN_HEIGHT);
        backdropOpacity.setValue(0);
        after?.();
        return;
      }
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: 280,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) after?.();
      });
    },
    [backdropOpacity, reduceMotion, translateY],
  );

  const requestClose = useCallback(() => {
    if (saving) return;
    onCloseRef.current();
  }, [saving]);

  useEffect(() => {
    if (!visible) return;
    resetForm();
    setShouldRender(true);
    const raf = requestAnimationFrame(playOpen);
    return () => cancelAnimationFrame(raf);
  }, [playOpen, resetForm, visible]);

  useEffect(() => {
    if (visible || !shouldRender) return;
    playClose(() => setShouldRender(false));
  }, [playClose, shouldRender, visible]);

  const onSave = useCallback(async () => {
    if (saving || !recipeId) return;
    if (rating < 1 || rating > 5) {
      toast.info('请先选择评分');
      return;
    }
    setSaving(true);
    try {
      const updated = await recordRecipeCooked(recipeId);
      if (!updated) {
        toast.error('菜谱不存在或已删除');
        return;
      }
      await addRecipeCookLog({
        recipeId,
        rating,
        note,
        cookedAt: updated.last_cooked_at,
      });
      toast.success('制作记录已保存');
      onSaved?.(updated);
      onCloseRef.current();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }, [note, onSaved, rating, recipeId, saving]);

  if (!shouldRender) return null;

  return (
    <Modal
      visible={shouldRender}
      transparent
      animationType="none"
      onRequestClose={requestClose}
      statusBarTranslucent>
      <View style={styles.root} pointerEvents="box-none">
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: p.overlay, opacity: backdropOpacity }]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          accessibilityLabel="关闭"
          disabled={saving}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
          pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: p.bg,
                paddingBottom: Math.max(insets.bottom, 16),
                transform: [{ translateY }],
              },
            ]}>
            <View style={styles.header}>
              <Pressable
                onPress={requestClose}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="取消"
                style={({ pressed }) => [
                  styles.headerBtn,
                  {
                    borderColor: p.border,
                    backgroundColor: p.card,
                    opacity: pressed || saving ? 0.7 : 1,
                  },
                ]}>
                <Text style={[styles.headerBtnText, { color: tokens.danger }]}>取消</Text>
              </Pressable>
              <Text style={[styles.headerTitle, { color: p.text }]}>完成制作</Text>
              <Pressable
                onPress={() => void onSave()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="保存"
                style={({ pressed }) => [
                  styles.headerBtn,
                  {
                    borderColor: p.border,
                    backgroundColor: p.card,
                    opacity: pressed || saving ? 0.7 : 1,
                  },
                ]}>
                {saving ? (
                  <ActivityIndicator size="small" color={tokens.success} />
                ) : (
                  <Text style={[styles.headerBtnText, { color: tokens.success }]}>保存</Text>
                )}
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              bounces={false}>
              <View style={[styles.recipeChip, { backgroundColor: p.card, borderColor: p.border }]}>
                <Text style={[styles.recipeChipText, { color: p.text }]} numberOfLines={1}>
                  {recipeTitle}
                </Text>
              </View>

              <Text style={[styles.prompt, { color: p.text }]}>这次做得怎么样？</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map(n => {
                  const filled = n <= rating;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => setRating(n)}
                      accessibilityRole="button"
                      accessibilityLabel={`${n} 星`}
                      hitSlop={6}
                      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }, styles.starHit]}>
                      <MaterialIcons
                        name={filled ? 'star' : 'star-border'}
                        size={36}
                        color={filled ? p.accent : p.outlineMuted}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.ratingHint, { color: p.outlineMuted }]}>
                {rating > 0 ? `${rating} 星` : '点选 1～5 星'}
              </Text>

              <Text style={[styles.fieldLabel, { color: p.outlineMuted }]}>备注（可选）</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="口味、火候、下次改进…"
                placeholderTextColor={p.outlineMuted}
                multiline
                maxLength={200}
                style={[
                  styles.noteInput,
                  {
                    color: p.text,
                    backgroundColor: p.card,
                    borderColor: p.border,
                  },
                ]}
              />
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheetWrap: { justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: SCREEN_HEIGHT * 0.78,
    paddingTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  headerBtn: {
    minWidth: 64,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  headerBtnText: { fontSize: 14, fontWeight: '800' },
  headerTitle: { fontSize: 16, fontWeight: '900' },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 12, gap: 10 },
  recipeChip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  recipeChipText: { fontSize: 15, fontWeight: '800' },
  prompt: { fontSize: 17, fontWeight: '900', marginTop: 6 },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  starHit: { padding: 4 },
  ratingHint: { textAlign: 'center', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  noteInput: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '500',
    textAlignVertical: 'top',
  },
});
