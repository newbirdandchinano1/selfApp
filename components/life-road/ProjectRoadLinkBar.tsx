/**
 * 任务页项目卡「道路归属」条：对齐设计稿 .tp-road，点按打开导图。
 */
import {
  lifeRoadType,
  useLifeRoadTheme,
} from '@/constants/life-road-theme';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type ProjectRoadLinkBarProps = {
  /** 如「11 月 · 稳定节奏」 */
  caption: string;
  /** 可选：高亮某月节点（预留，导图默认展开当下） */
  monthGoalId?: string | null;
};

function TreeIcon({ color }: { color: string }) {
  return (
    <Svg width={9} height={9} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3v18M12 7c-2.8 0-5 1.7-5 4.2 0 2.3 2 4 5 4s5-1.7 5-4C17 8.7 14.8 7 12 7zM12 15c-2.1 0-3.8 1.3-3.8 3.2 0 1.8 1.6 2.8 3.8 2.8s3.8-1 3.8-2.8C15.8 16.3 14.1 15 12 15z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ProjectRoadLinkBar({ caption, monthGoalId }: ProjectRoadLinkBarProps) {
  const router = useRouter();
  const { lr } = useLifeRoadTheme();
  const label = caption.trim();
  if (!label) return null;

  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation?.();
        router.push({
          pathname: '/life-road',
          params: monthGoalId ? { focus_month_id: monthGoalId } : undefined,
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={`道路归属 ${label}，打开导图`}
      style={({ pressed }) => [
        styles.bar,
        {
          borderColor: 'rgba(191,111,82,0.22)',
          backgroundColor: pressed
            ? 'rgba(241,220,210,0.42)'
            : 'rgba(241,220,210,0.2)',
        },
      ]}>
      <View style={[styles.ri, { backgroundColor: 'rgba(191,111,82,0.12)' }]}>
        <TreeIcon color={lr.clay} />
      </View>
      <Text style={[styles.copy, { color: '#8C5541' }]} numberOfLines={1}>
        道路归属 · <Text style={{ fontWeight: '600' }}>{label}</Text>
      </Text>
      <Text style={[lifeRoadType.monoTiny, { color: lr.clay }]}>打开导图 →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  ri: {
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    letterSpacing: 0.1,
  },
});
