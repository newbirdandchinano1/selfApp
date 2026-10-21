import { useColorScheme } from '@/hooks/use-color-scheme';
import { getRecipePalette } from '@/lib/recipe-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { recipeGlassTabBarContentInset } from './recipe-glass-tab-bar';

type Props = {
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

/** 菜谱子 Tab 占位：无独立顶栏（顶栏在 layout 共享），只渲染内容 */
export function RecipeHubPlaceholder({ title, subtitle, icon }: Props) {
  const insets = useSafeAreaInsets();
  const p = getRecipePalette(useColorScheme());

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View
        style={[
          styles.body,
          { paddingBottom: recipeGlassTabBarContentInset(insets.bottom) },
        ]}>
        <View style={[styles.iconWrap, { backgroundColor: p.primarySoft }]}>
          <MaterialIcons name={icon} size={36} color={p.primary} />
        </View>
        <Text style={[styles.heading, { color: p.text }]}>{title}</Text>
        <Text style={[styles.sub, { color: p.outlineMuted }]}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  heading: { fontSize: 20, fontWeight: '900' },
  sub: { fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 21 },
});
