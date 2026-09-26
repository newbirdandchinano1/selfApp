import { Skeleton } from '@/components/ui/skeleton';
import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export type SkeletonTone = {
  surface: string;
  outline: string;
  cardBg?: string;
};

/** 可配置占位条：宽高/圆角 */
export type SkeletonBarSpec = {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

type SkeletonCardProps = {
  children: React.ReactNode;
  tone?: Partial<SkeletonTone>;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  shadowed?: boolean;
};

/** 通用骨架卡片壳（表面色 + 描边 + 可选阴影） */
export function SkeletonCard({
  children,
  tone,
  style,
  padded = true,
  shadowed = false,
}: SkeletonCardProps) {
  const { colors, shadows } = useAppTheme();
  const bg = tone?.cardBg ?? tone?.surface ?? colors.surface;
  const border = tone?.outline ?? colors.outline;
  return (
    <View
      style={[
        styles.card,
        padded ? styles.cardPadded : null,
        shadowed ? shadows.card : null,
        { backgroundColor: bg, borderColor: border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

type SkeletonHeaderRowProps = {
  title?: SkeletonBarSpec;
  subtitle?: SkeletonBarSpec | false;
  action?: SkeletonBarSpec | false;
  actions?: number;
  style?: StyleProp<ViewStyle>;
};

/** 左标题（+副标题）+ 右操作按钮 */
export function SkeletonHeaderRow({
  title = { width: 72, height: 18, borderRadius: 6 },
  subtitle,
  action = { width: 88, height: 32, borderRadius: 10 },
  actions,
  style,
}: SkeletonHeaderRowProps) {
  const actionSpec = action === false ? null : action;
  const actionCount = actions ?? (actionSpec ? 1 : 0);
  return (
    <View style={[styles.headerRow, style]}>
      <View style={styles.headerCol}>
        <Skeleton
          width={title.width ?? 72}
          height={title.height ?? 18}
          borderRadius={title.borderRadius ?? 6}
          style={title.style}
        />
        {subtitle ? (
          <Skeleton
            width={subtitle.width ?? '70%'}
            height={subtitle.height ?? 11}
            borderRadius={subtitle.borderRadius ?? 5}
            style={[styles.subtitle, subtitle.style]}
          />
        ) : null}
      </View>
      {actionCount > 0 ? (
        <View style={styles.headerActions}>
          {Array.from({ length: actionCount }).map((_, i) => (
            <Skeleton
              key={i}
              width={actionSpec?.width ?? 76}
              height={actionSpec?.height ?? 32}
              borderRadius={actionSpec?.borderRadius ?? 10}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

type SkeletonListRowsProps = {
  count?: number;
  leadingSize?: number;
  titleWidth?: number | `${number}%`;
  metaWidth?: number | `${number}%`;
  tone?: Partial<SkeletonTone>;
  rowStyle?: StyleProp<ViewStyle>;
};

/** 左图标 + 标题/副标题行列表 */
export function SkeletonListRows({
  count = 3,
  leadingSize = 36,
  titleWidth = '58%',
  metaWidth = '42%',
  tone,
  rowStyle,
}: SkeletonListRowsProps) {
  const { colors } = useAppTheme();
  const border = tone?.outline ?? colors.outline;
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={[styles.listRow, { borderColor: border }, rowStyle]}>
          <Skeleton width={leadingSize} height={leadingSize} borderRadius={leadingSize / 2} />
          <View style={styles.listBody}>
            <Skeleton width={titleWidth} height={14} borderRadius={6} />
            <Skeleton width={metaWidth} height={11} borderRadius={5} style={styles.listMeta} />
          </View>
        </View>
      ))}
    </View>
  );
}

type SkeletonChipRowProps = {
  count?: number;
  chipWidth?: number;
  chipHeight?: number;
  pill?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SkeletonChipRow({
  count = 4,
  chipWidth = 56,
  chipHeight = 28,
  pill = true,
  style,
}: SkeletonChipRowProps) {
  return (
    <View style={[styles.chipRow, style]}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton
          key={index}
          width={chipWidth}
          height={chipHeight}
          borderRadius={pill ? Radius.pill : Radius.sm}
        />
      ))}
    </View>
  );
}

type SkeletonGridProps = {
  count?: number;
  columns?: 2 | 3 | 4;
  renderCell: (index: number) => React.ReactNode;
  style?: StyleProp<ViewStyle>;
  cellStyle?: StyleProp<ViewStyle>;
};

export function SkeletonGrid({
  count = 4,
  columns = 2,
  renderCell,
  style,
  cellStyle,
}: SkeletonGridProps) {
  const cellWidth = columns === 2 ? '48.5%' : columns === 3 ? '31%' : '23%';
  return (
    <View style={[styles.grid, style]}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={[{ width: cellWidth as `${number}%`, flexGrow: 1 }, cellStyle]}>
          {renderCell(index)}
        </View>
      ))}
    </View>
  );
}

/** 首页内容区标准内边距容器 */
export function SkeletonPage({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.page, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  page: {
    width: '100%',
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Layout.pagePaddingX,
    gap: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  card: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  cardPadded: {
    padding: Spacing['4xl'],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  headerCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  subtitle: {
    marginTop: 4,
  },
  list: {
    gap: 10,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: 14,
  },
  listBody: {
    flex: 1,
    minWidth: 0,
  },
  listMeta: {
    marginTop: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
});
