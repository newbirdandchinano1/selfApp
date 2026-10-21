import {
  RECIPE_TAB_MOTION,
  RecipeGlassTabBar,
  type RecipeGlassTabBarProps,
} from '@/components/recipe/recipe-glass-tab-bar';
import { RecipeHubHeader } from '@/components/recipe/recipe-hub-header';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getRecipePalette } from '@/lib/recipe-theme';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

export default function MyRecipesTabsLayout() {
  const p = getRecipePalette(useColorScheme());

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      {/* 共享顶栏：切 Tab 不换顶，返回退出整个菜谱模块 */}
      <RecipeHubHeader />
      <View style={styles.tabs}>
        <Tabs
          tabBar={props => <RecipeGlassTabBar {...(props as unknown as RecipeGlassTabBarProps)} />}
          screenOptions={{
            headerShown: false,
            // 场景交叉淡入，弹簧参数与 RECIPE_TAB_MOTION 统一
            animation: 'fade',
            transitionSpec: {
              animation: 'spring',
              config: { ...RECIPE_TAB_MOTION.scene },
            },
            sceneStyle: { backgroundColor: p.bg },
            tabBarStyle: {
              position: 'absolute',
              backgroundColor: 'transparent',
              borderTopWidth: 0,
              elevation: 0,
            },
          }}>
          <Tabs.Screen name="index" options={{ title: '菜谱', tabBarLabel: '菜谱' }} />
          <Tabs.Screen name="plan" options={{ title: '计划', tabBarLabel: '计划' }} />
          <Tabs.Screen name="shop" options={{ title: '采购', tabBarLabel: '采购' }} />
          <Tabs.Screen name="mine" options={{ title: '我的', tabBarLabel: '我的' }} />
        </Tabs>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { flex: 1 },
});
