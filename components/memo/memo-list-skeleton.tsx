import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/ui/skeleton';
import { Spacing } from '@/constants/design-tokens';

const PAPERS = ['#F7A1A1', '#9ED9A8', '#9EC5F5', '#F7C57A', '#CDB4F0'];
const HEIGHTS = [128, 168, 112, 148, 136, 156];

/**
 * 备忘录加载骨架：两列便利贴占位，避免加载中出现空态闪烁。
 * 仅备忘录使用；其它 CRUD 页面仍走默认 spinner。
 */
export function MemoListSkeleton() {
  const notes = HEIGHTS.map((height, index) => ({ height, color: PAPERS[index % PAPERS.length] }));
  const left = notes.filter((_, index) => index % 2 === 0);
  const right = notes.filter((_, index) => index % 2 === 1);

  return (
    <View style={styles.board} accessibilityLabel="备忘加载中">
      {[left, right].map((column, columnIndex) => (
        <View key={columnIndex} style={styles.column}>
          {column.map((note, index) => (
            <View
              key={`${columnIndex}-${index}`}
              style={[styles.note, { height: note.height, backgroundColor: note.color }]}>
              <Skeleton width="70%" height={14} borderRadius={4} />
              <Skeleton width="100%" height={10} borderRadius={4} />
              <Skeleton width="82%" height={10} borderRadius={4} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing['4xl'],
    gap: Spacing.md,
  },
  column: { flex: 1, gap: Spacing.lg },
  note: {
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingTop: 18,
    gap: 8,
    opacity: 0.72,
  },
});
