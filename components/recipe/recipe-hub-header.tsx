import { useColorScheme } from '@/hooks/use-color-scheme';
import { getRecipePalette } from '@/lib/recipe-theme';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  /** 右侧附加按钮（仅菜谱页编辑态用） */
  rightSlot?: React.ReactNode;
  subtitle?: string | null;
};

type NavLike = {
  canGoBack: () => boolean;
  goBack: () => void;
  getParent: () => NavLike | undefined;
  getState?: () => { type?: string } | undefined;
};

/**
 * 菜谱模块共享顶栏：切底栏 Tab 时标题与返回不变。
 * 返回始终退出整个 my-recipes（回到个人中心等外层 Stack），不在子 Tab 间回退。
 */
export function RecipeHubHeader({ rightSlot, subtitle }: Props) {
  const insets = useSafeAreaInsets();
  const p = getRecipePalette(useColorScheme());
  const navigation = useNavigation();
  const router = useRouter();

  const exitHub = useCallback(() => {
    // 向上找到 Stack（跳过 Tab），再 goBack，避免 /my-recipes/plan → /my-recipes
    let nav = navigation as unknown as NavLike;
    for (let i = 0; i < 6 && nav; i += 1) {
      const type = nav.getState?.()?.type;
      if (type === 'tab') {
        nav = nav.getParent?.() as NavLike;
        continue;
      }
      if (nav.canGoBack()) {
        nav.goBack();
        return;
      }
      nav = nav.getParent?.() as NavLike;
    }
    if (router.canGoBack()) {
      // 仍可能落在子 Tab：尽量 dismiss 到个人中心
      try {
        router.dismissTo('/(tabs)/profile');
        return;
      } catch {
        router.back();
        return;
      }
    }
    router.replace('/(tabs)/profile');
  }, [navigation, router]);

  return (
    <View style={[styles.wrap, { paddingTop: insets.top, backgroundColor: p.bg }]}>
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [
            styles.iconBtn,
            { backgroundColor: p.card, borderColor: p.border, opacity: pressed ? 0.75 : 1 },
          ]}
          onPress={exitHub}
          accessibilityLabel="返回">
          <MaterialIcons name="arrow-back-ios-new" size={18} color={p.primary} />
        </Pressable>
        <View style={styles.center}>
          <Text style={[styles.title, { color: p.text }]}>我的菜谱</Text>
          {subtitle ? (
            <Text style={[styles.sub, { color: p.textSecondary }]}>{subtitle}</Text>
          ) : null}
        </View>
        {rightSlot ?? <View style={styles.iconBtnSpacer} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnSpacer: { width: 42, height: 42 },
  center: { flex: 1, gap: 2 },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: 0.3 },
  sub: { fontSize: 12, fontWeight: '600' },
});
