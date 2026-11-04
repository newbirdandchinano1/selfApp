import {
  OCCASIONS,
  RECENT_SEARCHES,
  isUncategorizedCategory,
  itemById,
  type ClosetLayout,
  type ClosetSort,
  type SeasonFilter,
  type WardrobeCategory,
  type WardrobeItem,
  type WardrobeOutfit,
  type WardrobeTab,
} from '@/components/wardrobe/data';
import {
  WardrobeGarment,
  wardrobeItemPhotoSurface,
} from '@/components/wardrobe/garments';
import {
  IconArrow,
  IconBox,
  IconCamera,
  IconCheck,
  IconClip,
  IconClose,
  IconCloset,
  IconDoubleCols,
  IconFolderPlus,
  IconGrid,
  IconHanger,
  IconImage,
  IconLayers,
  IconPalette,
  IconPlus,
  IconSearch,
  IconSeason,
  IconSingleCol,
  IconSort,
  IconTag,
} from '@/components/wardrobe/icons';
import { FOLD_MOTION_EASE, FOLD_MOTION_SPRING } from '@/components/review/fold-motion';
import { useWardrobeTheme, wardrobeEm, wardrobeFonts, wardrobeType, type WardrobePalette } from '@/constants/wardrobe-theme';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


type WardrobeStyles = ReturnType<typeof createStyles>;

function useWardrobeStyles(): { w: WardrobePalette; styles: WardrobeStyles } {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  return { w, styles };
}

/* ─── shared bits ─── */

function SheetRow({
  title,
  note,
  active,
  onPress,
  trailing,
  leading,
}: {
  title: string;
  note?: string;
  active?: boolean;
  onPress?: () => void;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
}) {
  const { styles } = useWardrobeStyles();
  return (
    <Pressable onPress={onPress} style={[styles.sheetRow, active && styles.sheetRowActive]}>
      {leading}
      <View style={styles.srCopy}>
        <Text style={[styles.srTitle, active && styles.srTitleActive]}>{title}</Text>
        {note ? <Text style={styles.srNote}>{note}</Text> : null}
      </View>
      {trailing ?? <View style={[styles.radio, active && styles.radioOn]} />}
    </Pressable>
  );
}

function DetailGrid({ pairs }: { pairs: [string, string][] }) {
  const { styles } = useWardrobeStyles();
  return (
    <View style={styles.detailGrid}>
      {pairs.map(([label, value]) => (
        <View key={label} style={styles.dg}>
          <Text style={styles.dgLabel}>{label}</Text>
          <Text style={styles.dgValue} numberOfLines={1}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** 穿搭统计进度条：对齐设计稿 growX（.8s，错峰 60ms） */
function StatBarFill({ widthPct, index }: { widthPct: number; index: number }) {
  const { styles } = useWardrobeStyles();
  const progress = useRef(new Animated.Value(0)).current;
  const target = Math.max(0, Math.min(100, widthPct));

  useEffect(() => {
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 800,
      delay: index * 60,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [index, progress, target]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${target}%`],
  });

  return <Animated.View style={[styles.sbFill, { width }]} />;
}

/* ─── LayoutPop ─── */

export type LayoutPopProps = {
  visible: boolean;
  layout: ClosetLayout;
  onLayout: (layout: ClosetLayout) => void;
  onSort: () => void;
  onManageCategories: () => void;
  onClose: () => void;
};

export const LayoutPop = memo(function LayoutPop({
  visible,
  layout,
  onLayout,
  onSort,
  onManageCategories,
  onClose,
}: LayoutPopProps) {
  const { w, styles } = useWardrobeStyles();
  const insets = useSafeAreaInsets();
  const rows: { key: ClosetLayout; label: string; icon: React.ReactNode }[] = [
    { key: 'card', label: '卡片布局', icon: <IconGrid size={11} color={w.pine} /> },
    { key: 'double', label: '双列布局', icon: <IconDoubleCols size={11} color={w.pine} /> },
    { key: 'single', label: '单列布局', icon: <IconSingleCol size={11} color={w.pine} /> },
  ];
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.layoutPopBackdrop}>
        {/* Android 会折叠空 View，必须 collapsable={false}，否则空白处点不到 */}
        <Pressable
          style={styles.layoutPopDismissHit}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭菜单"
          collapsable={false}
        />
        <View style={[styles.layoutPop, { top: Math.max(insets.top, 12) + 56 }]} collapsable={false}>
          <Text style={styles.popTitle}>VIEW · 视图</Text>
          {rows.map((row) => (
            <Pressable
              key={row.key}
              style={[styles.popRow, layout === row.key && styles.popRowActive]}
              onPress={() => {
                onLayout(row.key);
                onClose();
              }}>
              <View style={styles.pi}>{row.icon}</View>
              <Text style={[styles.popRowText, layout === row.key && styles.popRowTextActive]}>{row.label}</Text>
              <View style={[styles.check, layout === row.key && styles.checkOn]}>
                <IconCheck size={12} color={w.amber} />
              </View>
            </Pressable>
          ))}
          <View style={styles.popSep} />
          <Pressable
            style={styles.popRow}
            onPress={() => {
              onClose();
              onSort();
            }}>
            <View style={styles.pi}>
              <IconSort size={11} color={w.pine} />
            </View>
            <Text style={styles.popRowText}>修改排序</Text>
          </Pressable>
          <Pressable
            style={styles.popRow}
            onPress={() => {
              onClose();
              onManageCategories();
            }}>
            <View style={styles.pi}>
              <IconFolderPlus size={11} color={w.pine} />
            </View>
            <Text style={styles.popRowText}>管理分类</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

/* ─── CreatePop ─── */

type CreateOpt = { label: string; note: string; icon: React.ReactNode; tile: string };

function createOptsFor(tab: WardrobeTab, w: WardrobePalette): CreateOpt[] {
  if (tab === 'closet') {
    return [
      { label: '拍照', note: '用相机记录今天的穿搭', icon: <IconCamera size={14} color={w.pine} />, tile: w.sage2 },
      { label: '从相册导入', note: '选择已有照片', icon: <IconImage size={14} color={w.amber} />, tile: w.amber2 },
    ];
  }
  if (tab === 'outfits') {
    return [
      { label: '从单品组合', note: '挑选衣橱里的单品', icon: <IconLayers size={14} color={w.pine} />, tile: w.sage2 },
      { label: '拍照上传', note: '拍照或相册导入并抠图', icon: <IconCamera size={14} color={w.amber} />, tile: w.amber2 },
    ];
  }
  // mine Tab：管理衣橱入口（无 AI / Sparkle）
  return [
    { label: '新建衣橱', note: '为旅行或季节单独整理', icon: <IconBox size={14} color={w.pine} />, tile: w.sage2 },
    { label: '导入衣橱', note: '从备份恢复数据', icon: <IconClip size={14} color={w.amber} />, tile: w.amber2 },
    { label: '邀请共用', note: '与家人一起整理衣橱', icon: <IconLayers size={14} color={w.sky} />, tile: w.sky2 },
  ];
}

export type CreatePopProps = {
  visible: boolean;
  tab: WardrobeTab;
  categoryHint?: string | null;
  onClose: () => void;
  /** 选中创建入口；由页面打开对应编辑器 */
  onSelect?: (label: string) => void;
};

export const CreatePop = memo(function CreatePop({
  visible,
  tab,
  categoryHint,
  onClose,
  onSelect,
}: CreatePopProps) {
  const { w, styles } = useWardrobeStyles();
  const insets = useSafeAreaInsets();
  const opts = createOptsFor(tab, w);
  const title =
    tab === 'closet' && categoryHint
      ? `CREATE · 添加到${categoryHint}`
      : tab === 'outfits'
        ? 'CREATE · 新建搭配'
        : tab === 'mine'
          ? 'CREATE · 管理衣橱'
          : 'CREATE · 添加单品';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.layoutPopBackdrop}>
        <Pressable
          style={styles.layoutPopDismissHit}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭菜单"
          collapsable={false}
        />
        <View
          style={[styles.createPop, { bottom: 154 + Math.max(insets.bottom - 10, 0) }]}
          collapsable={false}>
          <Text style={styles.popTitle}>{title}</Text>
          {opts.map((opt) => (
            <Pressable
              key={opt.label}
              style={styles.createOpt}
              onPress={() => {
                onSelect?.(opt.label);
                onClose();
              }}>
              <View style={[styles.coIco, { backgroundColor: opt.tile }]}>{opt.icon}</View>
              <View>
                <Text style={styles.coTitle}>{opt.label}</Text>
                <Text style={styles.coNote}>{opt.note}</Text>
              </View>
            </Pressable>
          ))}
          <View style={styles.createArrow} />
        </View>
      </View>
    </Modal>
  );
});

/* ─── WardrobeSheet ─── */

export type SheetContent =
  | { kind: 'item'; item: WardrobeItem }
  | { kind: 'outfit'; outfit: WardrobeOutfit; items: WardrobeItem[] }
  | { kind: 'sort'; sort: ClosetSort }
  | { kind: 'categories'; categories: WardrobeCategory[] }
  | { kind: 'category'; name: string; categories: WardrobeCategory[] }
  | {
      kind: 'generic';
      key: string;
      season?: SeasonFilter;
      categories?: WardrobeCategory[];
      items?: WardrobeItem[];
      outfits?: WardrobeOutfit[];
    }
  | {
      kind: 'context';
      tab: WardrobeTab;
      sort: ClosetSort;
      categories: WardrobeCategory[];
      itemCount?: number;
      outfitCount?: number;
    }
  | null;

export type WardrobeSheetClosetRow = {
  id: string;
  name: string;
  is_default: number;
  item_count?: number;
};

export type WardrobeSheetOptionRow = {
  id: string;
  kind: string;
  value: string;
};

export type WardrobeSheetProps = {
  content: SheetContent;
  onClose: () => void;
  /** 含「全部」的场合名列表；缺省用演示 OCCASIONS */
  occasions?: readonly string[];
  closets?: WardrobeSheetClosetRow[];
  optionRows?: WardrobeSheetOptionRow[];
  bodyPairs?: [string, string][];
  aboutPairs?: [string, string][];
  wearHistory28?: boolean[] | null;
  onSortPick?: (sort: ClosetSort) => void;
  onSeason?: (season: SeasonFilter) => void;
  onOpenItem?: (id: string) => void;
  onWearItem?: (id: string) => void;
  onWearOutfit?: (id: string) => void;
  onOpenGeneric?: (key: string) => void;
  onCategoryAction?: (action: string, name?: string) => void;
  onCreateItem?: (categoryHint?: string) => void;
  onEditItem?: (id: string) => void;
  onDeleteItem?: (id: string) => void;
  onCreateOutfit?: (seedItemIds?: string[]) => void;
  onEditOutfit?: (id: string) => void;
  onDeleteOutfit?: (id: string) => void;
  onCreateCategory?: () => void;
  onRenameCategory?: (name: string) => void;
  onDeleteCategory?: (name: string) => void;
  onCreateOccasion?: () => void;
  onDeleteOccasion?: (name: string) => void;
  onCreateCloset?: () => void;
  onSelectCloset?: (id: string) => void;
  onDeleteCloset?: (id: string) => void;
  onCreateOption?: (kind: 'color' | 'brand' | 'season' | 'fit') => void;
  onDeleteOption?: (id: string, label: string) => void;
  onEditBody?: () => void;
  onOutfitSort?: (mode: 'recent' | 'wear' | 'occasion') => void;
};

export const WardrobeSheet = memo(function WardrobeSheet({
  content,
  onClose,
  occasions: occasionsProp,
  closets,
  optionRows,
  bodyPairs,
  aboutPairs,
  wearHistory28,
  onSortPick,
  onSeason,
  onOpenItem,
  onWearItem,
  onWearOutfit,
  onOpenGeneric,
  onCategoryAction,
  onCreateItem,
  onEditItem,
  onDeleteItem,
  onCreateOutfit,
  onEditOutfit,
  onDeleteOutfit,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onCreateOccasion,
  onDeleteOccasion,
  onCreateCloset,
  onSelectCloset,
  onDeleteCloset,
  onCreateOption,
  onDeleteOption,
  onEditBody,
  onOutfitSort,
}: WardrobeSheetProps) {
  const occasionList = occasionsProp?.length ? occasionsProp : OCCASIONS;
  const { w, styles } = useWardrobeStyles();
  const insets = useSafeAreaInsets();
  const visible = !!content;
  const translateY = useRef(new Animated.Value(480)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(backdrop, { toValue: 1, duration: 280, easing: FOLD_MOTION_EASE, useNativeDriver: true }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 380,
          easing: FOLD_MOTION_SPRING,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      translateY.setValue(480);
      backdrop.setValue(0);
    }
  }, [backdrop, translateY, visible]);

  const title = useMemo(() => {
    if (!content) return '';
    if (content.kind === 'item') return '单品详情';
    if (content.kind === 'outfit') return '搭配详情';
    if (content.kind === 'sort') return '排序方式';
    if (content.kind === 'categories') return '管理分类';
    if (content.kind === 'category') return content.name;
    if (content.kind === 'context') {
      if (content.tab === 'outfits') return '搭配选项';
      if (content.tab === 'mine') return '衣橱设置';
      return '衣橱选项';
    }
    const map: Record<string, string> = {
      wardrobe: '衣橱管理',
      options: '选项管理',
      body: '身材数据',
      season: '衣橱季节',
      stats: '穿搭统计',
      about: '关于 ATELIER',
      'outfit-sort': '搭配排序',
      occasions: '管理场合',
    };
    return map[content.key] ?? content.key;
  }, [content]);

  const body = (() => {
    if (!content) return null;
    if (content.kind === 'item') {
      const item = content.item;
      const dots =
        wearHistory28 && wearHistory28.length === 28
          ? wearHistory28
          : Array.from({ length: 28 }, () => false);
      return (
        <View>
          <View
            style={[
              styles.detailVisual,
              { backgroundColor: wardrobeItemPhotoSurface(item, w.card) },
            ]}>
            <Text style={styles.dvLabel}>ARCHIVE · {item.code}</Text>
            <View style={styles.dvSeason}>
              <Text style={styles.dvSeasonText}>{item.season}</Text>
            </View>
            <View style={styles.detailGarment}>
              <WardrobeGarment item={item} width={118} height={138} />
            </View>
          </View>
          <View style={styles.detailTitleRow}>
            <Text style={styles.detailTitle}>{item.name}</Text>
            <Text style={styles.detailPrice}>{item.price}</Text>
          </View>
          <View style={styles.detailTags}>
            {[...item.tags, item.fit].map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagChipText}>{tag}</Text>
              </View>
            ))}
          </View>
          <DetailGrid
            pairs={[
              ['品牌', item.brand],
              ['颜色', item.color],
              ['适合温度', item.warmth],
              ['入柜日期', item.date],
            ]}
          />
          <View style={styles.wearHistory}>
            <View style={styles.whHead}>
              <Text style={styles.whHeadText}>最近 28 天穿着记录</Text>
              <Text style={styles.whHeadBold}>{item.wear} 次</Text>
            </View>
            <View style={styles.whDots}>
              {dots.map((on, i) => (
                <View key={i} style={[styles.whDot, on && styles.whDotOn]} />
              ))}
            </View>
          </View>
          <View style={styles.detailActions}>
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => onWearItem?.(item.id)}>
              <IconHanger size={11} color={w.onPine} />
              <Text style={styles.btnPrimaryText}>穿这件</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnGhost]}
              onPress={() => {
                onClose();
                onCreateOutfit?.([item.id]);
              }}>
              <Text style={styles.btnGhostText}>加入搭配</Text>
            </Pressable>
          </View>
          <View style={[styles.detailActions, { marginTop: 8 }]}>
            <Pressable
              style={[styles.btn, styles.btnGhost]}
              onPress={() => {
                onClose();
                onEditItem?.(item.id);
              }}>
              <Text style={styles.btnGhostText}>编辑</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnGhost]}
              onPress={() => {
                onClose();
                onDeleteItem?.(item.id);
              }}>
              <Text style={styles.btnGhostText}>删除</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (content.kind === 'outfit') {
      const { outfit, items } = content;
      return (
        <View>
          <View style={[styles.detailVisual, { backgroundColor: w.paper2, height: 160 }]}>
            <Text style={styles.dvLabel}>LOOK · {outfit.date.replace('.', ' / ')}</Text>
            <View style={styles.dvSeason}>
              <Text style={styles.dvSeasonText}>{outfit.occasion}</Text>
            </View>
            <View style={styles.outfitCollage}>
              {outfit.items.map((id, index) => {
                const item = itemById(id, items);
                if (!item) return null;
                return (
                  <View
                    key={id}
                    style={[
                      styles.outfitMini,
                      { backgroundColor: wardrobeItemPhotoSurface(item, w.card) },
                      index === 0 && { left: '10%', transform: [{ rotate: '-8deg' }] },
                      index === 1 && { left: '50%', marginLeft: -35, top: '18%', zIndex: 2 },
                      index === 2 && { right: '10%', left: undefined, transform: [{ rotate: '8deg' }] },
                    ]}>
                    <WardrobeGarment item={item} width={42} height={52} />
                  </View>
                );
              })}
            </View>
          </View>
          <View style={styles.detailTitleRow}>
            <Text style={styles.detailTitle}>{outfit.name}</Text>
            <Text style={styles.detailPrice}>{outfit.wear} 次</Text>
          </View>
          <View style={styles.detailTags}>
            {[outfit.occasion, `${outfit.items.length} 件单品`, outfit.date].map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagChipText}>{tag}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.outfitNote}>{outfit.note}</Text>
          <View style={styles.sheetList}>
            {outfit.items.map((id) => {
              const item = itemById(id, items);
              if (!item) return null;
              return (
                <Pressable key={id} style={styles.sheetRow} onPress={() => onOpenItem?.(id)}>
                  <View
                    style={[
                      styles.srThumb,
                      { backgroundColor: wardrobeItemPhotoSurface(item, w.card) },
                    ]}>
                    <WardrobeGarment item={item} width={28} height={34} />
                  </View>
                  <View style={styles.srCopy}>
                    <Text style={styles.srTitle}>{item.name}</Text>
                    <Text style={styles.srNote}>
                      {item.category} · {item.brand}
                    </Text>
                  </View>
                  <Text style={styles.srPrice}>{item.price}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.detailActions}>
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => onWearOutfit?.(outfit.id)}>
              <IconHanger size={11} color={w.onPine} />
              <Text style={styles.btnPrimaryText}>穿这套</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnGhost]}
              onPress={() => {
                onClose();
                onEditOutfit?.(outfit.id);
              }}>
              <Text style={styles.btnGhostText}>编辑拼图</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.addRow, { marginTop: 8 }]}
            onPress={() => {
              onClose();
              onDeleteOutfit?.(outfit.id);
            }}>
            <Text style={styles.addRowText}>删除这套搭配</Text>
          </Pressable>
        </View>
      );
    }

    if (content.kind === 'sort') {
      const options: { value: ClosetSort; label: string; note: string }[] = [
        { value: 'recent', label: '最近添加', note: '按入柜时间倒序' },
        { value: 'category', label: '类别', note: '未分类 → 上衣 → 下装…' },
        { value: 'color', label: '颜色', note: '按色系归类' },
        { value: 'price', label: '价格（高 → 低）', note: '按单品价格排序' },
        { value: 'wear', label: '穿着次数（多 → 少）', note: '最常穿的单品优先' },
      ];
      return (
        <View style={styles.sheetList}>
          {options.map((opt) => (
            <SheetRow
              key={opt.value}
              title={opt.label}
              note={opt.note}
              active={content.sort === opt.value}
              onPress={() => onSortPick?.(opt.value)}
            />
          ))}
        </View>
      );
    }

    if (content.kind === 'categories') {
      return (
        <View style={styles.sheetList}>
          {content.categories.map((cat) => {
            const locked = isUncategorizedCategory(cat.name);
            return (
              <SheetRow
                key={cat.name}
                title={cat.name}
                note={
                  locked
                    ? `${cat.ids.length} 件单品 · 系统分类，不可编辑`
                    : `${cat.ids.length} 件单品 · 点击管理`
                }
                onPress={
                  locked ? undefined : () => onCategoryAction?.('open', cat.name)
                }
              />
            );
          })}
          <Pressable
            style={styles.addRow}
            onPress={() => {
              onClose();
              onCreateCategory?.();
            }}>
            <IconPlus size={12} color={w.muted} />
            <Text style={styles.addRowText}>新建分类</Text>
          </Pressable>
        </View>
      );
    }

    if (content.kind === 'category') {
      const cat = content.categories.find((c) => c.name === content.name);
      const locked = isUncategorizedCategory(content.name);
      return (
        <View style={styles.sheetList}>
          <SheetRow
            title="添加单品"
            note={`把新单品加入「${content.name}」`}
            onPress={() => onCategoryAction?.('add', content.name)}
          />
          {locked ? null : (
            <>
              <SheetRow
                title="重命名分类"
                note={`当前名称：${content.name}`}
                onPress={() => {
                  onClose();
                  onRenameCategory?.(content.name);
                }}
              />
              <SheetRow
                title="删除分类"
                note={
                  cat?.ids.length
                    ? '删除后单品将归入未分类'
                    : '该分类暂无单品，可直接删除'
                }
                onPress={() => {
                  onClose();
                  onDeleteCategory?.(content.name);
                }}
              />
            </>
          )}
        </View>
      );
    }

    if (content.kind === 'context') {
      if (content.tab === 'outfits') {
        return (
          <View style={styles.sheetList}>
            <SheetRow
              title="排序方式"
              note="最近添加 · 穿着次数 · 场合"
              onPress={() => onOpenGeneric?.('outfit-sort')}
            />
            <SheetRow
              title="管理场合"
              note={`${Math.max(0, occasionList.length - 1)} 个场合`}
              onPress={() => onOpenGeneric?.('occasions')}
            />
            <SheetRow
              title="新建搭配"
              note="从单品中组合一套新造型"
              onPress={() => {
                onClose();
                onCreateOutfit?.();
              }}
            />
          </View>
        );
      }
      if (content.tab === 'mine') {
        const itemCount = content.itemCount ?? 0;
        const outfitCount = content.outfitCount ?? 0;
        const closetNote = closets?.length
          ? `${closets.length} 个衣橱 · ${itemCount} 件单品`
          : `${itemCount} 件单品`;
        const optionNote = optionRows?.length
          ? `${optionRows.length} 个词条`
          : '颜色、品牌、季节与版型';
        return (
          <View style={styles.sheetList}>
            <SheetRow
              title="切换衣橱"
              note={closetNote}
              onPress={() => onOpenGeneric?.('wardrobe')}
            />
            <SheetRow
              title="选项管理"
              note={optionNote}
              onPress={() => onOpenGeneric?.('options')}
            />
            <SheetRow
              title="关于 ATELIER"
              note={`${itemCount} 件 · ${outfitCount} 套 · 云端同步`}
              onPress={() => onOpenGeneric?.('about')}
            />
          </View>
        );
      }
      const sortLabel =
        content.sort === 'recent'
          ? '最近添加'
          : content.sort === 'category'
            ? '按类别'
            : content.sort === 'color'
              ? '按颜色'
              : content.sort === 'price'
                ? '价格从高到低'
                : '穿着次数最多';
      return (
        <View style={styles.sheetList}>
          <SheetRow title="排序方式" note={sortLabel} onPress={() => onOpenGeneric?.('sort')} />
          <SheetRow
            title="管理分类"
            note={`${content.categories.length} 个分类`}
            onPress={() => onOpenGeneric?.('categories')}
          />
          <SheetRow
            title="切换衣橱"
            note={
              closets?.length
                ? `${closets.length} 个衣橱 · ${closets.reduce((n, c) => n + (c.item_count ?? 0), 0)} 件`
                : '管理多个衣橱'
            }
            onPress={() => onOpenGeneric?.('wardrobe')}
          />
        </View>
      );
    }

    if (content.kind === 'generic') {
      const key = content.key;
      if (key === 'wardrobe') {
        const list = closets?.length
          ? closets
          : [{ id: 'local', name: '我的橱柜', is_default: 1, item_count: content.items?.length ?? 0 }];
        return (
          <View style={styles.sheetList}>
            {list.map((c) => (
              <Pressable
                key={c.id}
                style={styles.pickRow}
                onPress={() => onSelectCloset?.(c.id)}
                onLongPress={() => {
                  if (c.is_default) return;
                  onClose();
                  onDeleteCloset?.(c.id);
                }}>
                <View style={styles.pIco}>
                  <IconCloset size={15} color={w.pine} />
                </View>
                <View style={styles.srCopy}>
                  <Text style={styles.srTitle}>{c.name}</Text>
                  <Text style={styles.srNote}>
                    {c.is_default ? '当前默认' : '长按可删除'}
                    {c.item_count != null ? ` · ${c.item_count} 件` : ''}
                  </Text>
                </View>
                <View style={[styles.radio, c.is_default ? styles.radioOn : null]} />
              </Pressable>
            ))}
            <Pressable
              style={styles.addRow}
              onPress={() => {
                onClose();
                onCreateCloset?.();
              }}>
              <IconPlus size={12} color={w.muted} />
              <Text style={styles.addRowText}>新建衣橱</Text>
            </Pressable>
          </View>
        );
      }
      if (key === 'options') {
        const rows = optionRows ?? [];
        const opts = [
          {
            kind: 'color' as const,
            label: '颜色',
            unit: '色系',
            tile: w.amber2,
            icon: <IconPalette size={15} color={w.amber} />,
          },
          {
            kind: 'brand' as const,
            label: '品牌',
            unit: '品牌',
            tile: w.sky2,
            icon: <IconTag size={15} color={w.sky} />,
          },
          {
            kind: 'season' as const,
            label: '季节',
            unit: '季节',
            tile: w.sage2,
            icon: <IconSeason size={15} color={w.pine2} />,
          },
          {
            kind: 'fit' as const,
            label: '版型',
            unit: '版型',
            tile: w.clay2,
            icon: <IconTag size={15} color={w.clay} />,
          },
        ];
        return (
          <View style={styles.sheetList}>
            {opts.map((o) => {
              const kindRows = rows.filter((r) => r.kind === o.kind);
              return (
                <View key={o.kind} style={styles.optionGroup}>
                  <Pressable
                    style={styles.pickRow}
                    onPress={() => {
                      onClose();
                      onCreateOption?.(o.kind);
                    }}>
                    <View style={[styles.pIco, { backgroundColor: o.tile }]}>{o.icon}</View>
                    <View style={styles.srCopy}>
                      <Text style={styles.srTitle}>{o.label}</Text>
                      <Text style={styles.srNote}>
                        {kindRows.length} 个{o.unit} · 点击添加
                      </Text>
                    </View>
                    <IconPlus size={12} color={w.muted2} />
                  </Pressable>
                  {kindRows.map((row) => (
                    <Pressable
                      key={row.id}
                      style={styles.optionChildRow}
                      onLongPress={() => {
                        onClose();
                        onDeleteOption?.(row.id, row.value);
                      }}>
                      <View style={styles.srCopy}>
                        <Text style={styles.srTitle}>{row.value}</Text>
                        <Text style={styles.srNote}>长按删除</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </View>
        );
      }
      if (key === 'body') {
        const pairs =
          bodyPairs ??
          ([
            ['身高', '—'],
            ['体重', '—'],
            ['肩宽', '—'],
            ['胸围', '—'],
            ['腰围', '—'],
            ['臀围', '—'],
            ['腿长', '—'],
            ['脚长', '—'],
            ['上装', '—'],
            ['下装', '—'],
            ['鞋码', '—'],
          ] as [string, string][]);
        return (
          <View>
            <DetailGrid pairs={pairs} />
            <Pressable
              style={[styles.btn, styles.btnPrimary, { marginTop: 12 }]}
              onPress={() => {
                onClose();
                onEditBody?.();
              }}>
              <Text style={styles.btnPrimaryText}>编辑身材 / 尺码</Text>
            </Pressable>
            <Text style={styles.mutedP}>数据同步到云端，用于多端一致的尺码与身材档案。</Text>
          </View>
        );
      }
      if (key === 'season') {
        const season = content.season ?? 'all';
        return (
          <View>
            <View style={styles.seasonCard}>
              <View>
                <Text style={styles.seasonTitle}>显示范围</Text>
                <Text style={styles.seasonNote}>
                  当前：{{ all: '不限制', ss: '春夏', aw: '秋冬' }[season]}
                </Text>
              </View>
              <View style={styles.segmented}>
                {(
                  [
                    ['all', '不限制'],
                    ['ss', '春夏'],
                    ['aw', '秋冬'],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => onSeason?.(value)}
                    style={[styles.seg, season === value && styles.segActive]}>
                    <Text style={[styles.segText, season === value && styles.segTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Text style={styles.mutedP}>切换后，衣橱首页会同步隐藏不属于该季节的单品。</Text>
          </View>
        );
      }
      if (key === 'stats') {
        const itemList = content.items ?? [];
        const cats = (content.categories ?? [])
          .filter((c) => c.ids.length)
          .sort((a, b) => b.ids.length - a.ids.length);
        const total = Math.max(itemList.length, 1);
        const topWorn = [...itemList].sort((a, b) => b.wear - a.wear)[0];
        const totalWear = itemList.reduce((sum, it) => sum + (it.wear || 0), 0);
        const used = itemList.filter((it) => it.wear > 0).length;
        const usagePct = itemList.length ? Math.round((used / itemList.length) * 100) : 0;
        const valueSum = itemList.reduce((sum, it) => {
          const n = Number(String(it.price).replace(/[^\d.]/g, ''));
          return sum + (Number.isFinite(n) ? n : 0);
        }, 0);
        return (
          <View>
            <View style={styles.statBars}>
              {cats.map((cat, index) => (
                <View key={cat.name} style={styles.sbRow}>
                  <Text style={styles.sbLabel}>{cat.name}</Text>
                  <View style={styles.sbTrack}>
                    <StatBarFill widthPct={(cat.ids.length / total) * 100} index={index} />
                  </View>
                  <Text style={styles.sbCount}>{cat.ids.length}</Text>
                </View>
              ))}
            </View>
            <DetailGrid
              pairs={[
                ['累计穿着', `${totalWear} 次`],
                ['最常穿', topWorn?.name ?? '—'],
                ['使用率', `${usagePct}%`],
                ['总价值', valueSum ? `¥${valueSum.toLocaleString('zh-CN')}` : '—'],
              ]}
            />
          </View>
        );
      }
      if (key === 'outfit-sort') {
        return (
          <View style={styles.sheetList}>
            {(
              [
                ['recent', '最近添加', '按更新时间倒序'],
                ['wear', '穿着次数', '最常穿的搭配优先'],
                ['occasion', '场合', '按场合名称分组'],
              ] as const
            ).map(([mode, label, note]) => (
              <SheetRow
                key={mode}
                title={label}
                note={note}
                onPress={() => {
                  onOutfitSort?.(mode);
                  onClose();
                }}
              />
            ))}
          </View>
        );
      }
      if (key === 'occasions') {
        const outfitList = content.outfits ?? [];
        return (
          <View style={styles.sheetList}>
            {occasionList.filter((o) => o !== '全部').map((o) => {
              const count = outfitList.filter((outfit) => outfit.occasion === o).length;
              return (
                <Pressable
                  key={o}
                  style={styles.pickRow}
                  onLongPress={() => {
                    onClose();
                    onDeleteOccasion?.(o);
                  }}>
                  <View style={styles.pIco}>
                    <IconTag size={15} color={w.pine} />
                  </View>
                  <View style={styles.srCopy}>
                    <Text style={styles.srTitle}>{o}</Text>
                    <Text style={styles.srNote}>{count} 套搭配 · 长按删除</Text>
                  </View>
                  <IconArrow size={11} color={w.muted2} />
                </Pressable>
              );
            })}
            <Pressable
              style={styles.addRow}
              onPress={() => {
                onClose();
                onCreateOccasion?.();
              }}>
              <IconPlus size={12} color={w.muted} />
              <Text style={styles.addRowText}>新建场合</Text>
            </Pressable>
          </View>
        );
      }
      if (key === 'about') {
        return (
          <View>
            <View style={styles.aboutCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>衣</Text>
              </View>
              <View>
                <Text style={styles.profileName}>ATELIER</Text>
                <Text style={styles.profileMeta}>WARDROBE · CLOUD SYNC</Text>
              </View>
            </View>
            <Text style={styles.mutedP}>
              衣橱数据经 `/api/app/wardrobe` 与云端同步；穿着次数以日志为准。
            </Text>
            <DetailGrid
              pairs={
                aboutPairs ??
                ([
                  ['单品', String(content.items?.length ?? 0)],
                  ['搭配', String(content.outfits?.length ?? 0)],
                  ['分类', String(content.categories?.length ?? 0)],
                  ['数据', '云端同步'],
                ] as [string, string][])
              }
            />
          </View>
        );
      }
    }
    return null;
  })();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Animated.View style={[styles.sheetBackdrop, { opacity: backdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16), transform: [{ translateY }] },
          ]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.sheetClose} accessibilityLabel="关闭">
              <IconClose size={16} color={w.ink2} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
            {body}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
});

/* ─── SearchOverlay ─── */

export type SearchOverlayProps = {
  visible: boolean;
  items: WardrobeItem[];
  onClose: () => void;
  onOpenItem: (id: string) => void;
};

const COLOR_TAGS: [string, string][] = [
  ['燕麦白', '#E8E0D1'],
  ['雾蓝', '#C4D7DC'],
  ['橄榄绿', '#C8D2BE'],
  ['焦糖棕', '#DEC3A5'],
  ['炭灰', '#C9C5BE'],
];

export const SearchOverlay = memo(function SearchOverlay({
  visible,
  items,
  onClose,
  onOpenItem,
}: SearchOverlayProps) {
  const { w, styles } = useWardrobeStyles();
  const [query, setQuery] = useState('');
  const [mounted, setMounted] = useState(false);
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-10)).current;

  // 先挂载节点，再开启动画，避免 native driver 在无视图时跑完导致透明度卡在 0
  useEffect(() => {
    if (visible) {
      setMounted(true);
      setQuery('');
    }
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      opacity.setValue(0);
      translateY.setValue(-10);
      const anim = Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 320,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 450,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]);
      anim.start();
      return () => anim.stop();
    }
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 260,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -10,
        duration: 320,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
    ]);
    anim.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => anim.stop();
  }, [mounted, opacity, translateY, visible]);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return null;
    return items.filter((item) =>
      [item.name, item.category, item.brand, item.color, item.season, ...item.tags]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [items, query]);

  if (!mounted) return null;

  return (
    <Animated.View
      style={[
        styles.searchOverlay,
        {
          paddingTop: insets.top + 8,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents={visible ? 'auto' : 'none'}>
      <View style={styles.searchTop}>
        <View style={styles.searchField}>
          <IconSearch size={16} color={w.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索单品、颜色、品牌…"
            placeholderTextColor={w.muted2}
            style={styles.searchInput}
            autoFocus={visible}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <IconClose size={14} color={w.muted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.searchCancel}>取消</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.searchBody} keyboardShouldPersistTaps="handled">
        {results == null ? (
          <>
            <Text style={styles.searchKicker}>RECENT · 最近搜索</Text>
            <View style={styles.searchTags}>
              {RECENT_SEARCHES.map((tag) => (
                <Pressable key={tag} style={styles.searchTag} onPress={() => setQuery(tag)}>
                  <Text style={styles.searchTagText}>{tag}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.searchKicker}>COLOR · 按色彩浏览</Text>
            <View style={styles.searchTags}>
              {COLOR_TAGS.map(([label, color]) => (
                <Pressable key={label} style={styles.searchTag} onPress={() => setQuery(label)}>
                  <View style={[styles.colorDot, { backgroundColor: color }]} />
                  <Text style={styles.searchTagText}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.searchKicker}>MOST WORN · 常穿单品</Text>
            <View style={styles.searchList}>
              {items
                .filter((i) => i.wear >= 8)
                .slice(0, 4)
                .map((item) => (
                  <SearchRow key={item.id} item={item} onPress={() => onOpenItem(item.id)} />
                ))}
            </View>
          </>
        ) : results.length === 0 ? (
          <View style={styles.searchEmpty}>
            <IconSearch size={28} color={w.muted2} />
            <Text style={styles.emptyTitle}>没有找到相关单品</Text>
            <Text style={styles.emptyHint}>试试「针织」「通勤」或「雾蓝」</Text>
          </View>
        ) : (
          <>
            <Text style={styles.searchKicker}>RESULT · {results.length} 件单品</Text>
            <View style={styles.searchList}>
              {results.map((item) => (
                <SearchRow key={item.id} item={item} onPress={() => onOpenItem(item.id)} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Animated.View>
  );
});

function SearchRow({ item, onPress }: { item: WardrobeItem; onPress: () => void }) {
  const { w, styles } = useWardrobeStyles();
  return (
    <Pressable style={styles.searchRow} onPress={onPress}>
      <View
        style={[styles.srThumb, { backgroundColor: wardrobeItemPhotoSurface(item, w.card) }]}>
        <WardrobeGarment item={item} width={28} height={34} />
      </View>
      <View style={styles.srCopy}>
        <Text style={styles.searchRowTitle}>{item.name}</Text>
        <Text style={styles.searchRowNote}>
          {item.category} · {item.color} · {item.brand}
        </Text>
      </View>
      <Text style={styles.srPrice}>{item.price}</Text>
    </Pressable>
  );
}

function createStyles(w: WardrobePalette) {
  return StyleSheet.create({
  popLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 28,
    elevation: 28,
  },
  popLayerModal: {
    flex: 1,
  },
  catcher: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: w.dim,
  },
  layoutPopBackdrop: {
    flex: 1,
    backgroundColor: w.dim,
  },
  layoutPopDismissHit: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  layoutPop: {
    position: 'absolute',
    left: 18,
    top: 92,
    width: 180,
    zIndex: 2,
    elevation: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.card2,
    padding: 6,
    shadowColor: w.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  createPop: {
    position: 'absolute',
    right: 20,
    bottom: 154,
    width: 214,
    zIndex: 2,
    elevation: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.card2,
    padding: 6,
    shadowColor: w.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  createArrow: {
    position: 'absolute',
    right: 20,
    bottom: -5,
    width: 10,
    height: 10,
    backgroundColor: w.card2,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: w.line,
    transform: [{ rotate: '45deg' }],
  },
  popTitle: {
    ...wardrobeType.popTitle,
    paddingHorizontal: 8,
    paddingTop: 5,
    paddingBottom: 6,
    color: w.muted,
  },
  popRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 10,
  },
  popRowActive: {},
  popRowText: {
    flex: 1,
    fontFamily: wardrobeFonts.sans,
    fontSize: 9.5,
    color: w.ink2,
  },
  popRowTextActive: { color: w.pine, fontFamily: wardrobeFonts.sansSemiBold },
  pi: {
    width: 19,
    height: 19,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: w.pineWash,
  },
  check: { width: 12, height: 12, opacity: 0 },
  checkOn: { opacity: 1 },
  popSep: { height: 1, backgroundColor: w.line3, marginVertical: 4, marginHorizontal: 6 },
  createOpt: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 8, borderRadius: 10 },
  coIco: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 9.5,
    color: w.ink2,
  },
  coNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: w.muted,
    marginTop: 2,
  },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: w.dim,
  },
  sheet: {
    backgroundColor: w.card2,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '88%',
    paddingTop: 8,
    borderWidth: 1,
    borderColor: w.line,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: w.line2,
    marginBottom: 6,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  sheetTitle: {
    ...wardrobeType.sheetTitle,
    color: w.ink,
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glass,
  },
  sheetBody: { paddingHorizontal: 16, paddingBottom: 12 },
  sheetList: { gap: 6 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: w.line3,
    backgroundColor: w.glass,
  },
  sheetRowActive: {
    borderColor: w.pine,
    backgroundColor: w.pineWash,
  },
  srCopy: { flex: 1, minWidth: 0 },
  srTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 9.5,
    color: w.ink2,
  },
  srTitleActive: { color: w.pine, fontFamily: wardrobeFonts.sansSemiBold },
  srNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: w.muted,
    marginTop: 2,
  },
  srPrice: {
    fontFamily: wardrobeFonts.monoSemiBold,
    fontSize: 8,
    color: w.clay,
  },
  srThumb: {
    width: 44,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  radio: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: w.line2,
  },
  radioOn: { borderColor: w.pineSolid, backgroundColor: w.pineSolid },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: w.line2,
  },
  addRowText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8,
    color: w.muted,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: w.line3,
    backgroundColor: w.glass,
  },
  optionGroup: { gap: 4 },
  optionChildRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: w.line3,
    backgroundColor: w.glass,
  },
  pIco: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: w.sage2,
  },
  detailVisual: {
    height: 174,
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 13,
    borderWidth: 1,
    borderColor: w.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dvLabel: {
    position: 'absolute',
    left: 12,
    top: 11,
    zIndex: 2,
    fontFamily: wardrobeFonts.mono,
    fontSize: 6,
    letterSpacing: wardrobeEm(0.18, 6),
    color: w.muted,
  },
  dvSeason: {
    position: 'absolute',
    right: 11,
    top: 10,
    zIndex: 2,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: w.glassStrong,
    borderWidth: 1,
    borderColor: w.glassBorder,
  },
  dvSeasonText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.04, 6.5),
    color: w.pine,
  },
  detailGarment: { zIndex: 1 },
  detailTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  detailTitle: {
    flex: 1,
    ...wardrobeType.detailTitle,
    color: w.ink,
  },
  detailPrice: {
    fontFamily: wardrobeFonts.monoBold,
    fontSize: 14,
    color: w.clay,
    paddingTop: 3,
  },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginVertical: 10, paddingHorizontal: 2 },
  tagChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: w.line3,
    backgroundColor: w.glass,
  },
  tagChipText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.03, 6.5),
    color: w.ink3,
  },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 11 },
  dg: {
    width: '48%' as unknown as number,
    flexGrow: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: w.line3,
    backgroundColor: w.glass,
  },
  dgLabel: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    letterSpacing: wardrobeEm(0.04, 7.5),
    color: w.muted,
  },
  dgValue: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 7.5,
    color: w.ink2,
    maxWidth: '60%',
  },
  wearHistory: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: w.line3,
    backgroundColor: w.glass,
  },
  whHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  whHeadText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    color: w.muted,
  },
  whHeadBold: {
    fontFamily: wardrobeFonts.monoBold,
    fontSize: 8,
    color: w.pine,
  },
  whDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  whDot: {
    width: '6.2%' as unknown as number,
    aspectRatio: 1,
    borderRadius: 2,
    backgroundColor: w.pineWash,
    minWidth: 10,
    minHeight: 10,
    flexGrow: 1,
    flexBasis: '6%',
    maxWidth: 14,
  },
  whDotOn: { backgroundColor: w.sage },
  detailActions: { flexDirection: 'row', gap: 8, paddingBottom: 8 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 999,
  },
  btnPrimary: { backgroundColor: w.pineSolid },
  btnPrimaryText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 9,
    color: w.onPine,
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: w.line2,
    backgroundColor: w.glass,
  },
  btnGhostText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 9,
    color: w.ink2,
  },
  outfitNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 9,
    lineHeight: 15,
    color: w.muted,
    marginBottom: 12,
    marginHorizontal: 2,
  },
  outfitCollage: { ...StyleSheet.absoluteFill },
  outfitMini: {
    position: 'absolute',
    width: 70,
    height: 88,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    top: '24%',
    borderWidth: 1,
    borderColor: w.glassBorder,
  },
  mutedP: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8.5,
    lineHeight: 14,
    color: w.muted,
    marginVertical: 12,
    marginHorizontal: 2,
  },
  seasonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: 12,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glass,
  },
  seasonTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: wardrobeEm(0.03, 10),
    color: w.ink2,
  },
  seasonNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: w.muted,
    marginTop: 2,
  },
  segmented: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: 999,
    backgroundColor: w.pineWash,
  },
  seg: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  segActive: { backgroundColor: w.card2 },
  segText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7,
    letterSpacing: wardrobeEm(0.02, 7),
    color: w.muted,
  },
  segTextActive: { color: w.pine, fontFamily: wardrobeFonts.sansSemiBold },
  statBars: { gap: 9, paddingVertical: 4, marginBottom: 12 },
  sbRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sbLabel: {
    width: 48,
    fontFamily: wardrobeFonts.sans,
    fontSize: 7,
    color: w.muted,
  },
  sbTrack: { flex: 1, height: 6, borderRadius: 99, backgroundColor: w.pineWash, overflow: 'hidden' },
  sbFill: { height: '100%', borderRadius: 99, backgroundColor: w.sage },
  sbCount: {
    width: 30,
    textAlign: 'right',
    fontFamily: wardrobeFonts.mono,
    fontSize: 7,
    color: w.ink3,
  },
  aboutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glassStrong,
    marginTop: 2,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: w.pineSolid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: wardrobeFonts.serif, fontSize: 22, color: w.onPine },
  profileName: {
    ...wardrobeType.profileName,
    color: w.ink,
  },
  profileMeta: {
    ...wardrobeType.profileMeta,
    color: w.muted,
    marginTop: 4,
  },
  searchOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 50,
    elevation: 50,
    backgroundColor: w.screenMid,
    paddingHorizontal: 18,
  },
  searchTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.card,
  },
  searchInput: {
    flex: 1,
    fontFamily: wardrobeFonts.sans,
    fontSize: 10,
    letterSpacing: wardrobeEm(0.02, 10),
    color: w.ink,
    padding: 0,
  },
  searchCancel: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 9,
    letterSpacing: wardrobeEm(0.03, 9),
    color: w.ink2,
  },
  searchBody: { flex: 1 },
  searchKicker: {
    ...wardrobeType.popTitle,
    color: w.muted,
    marginTop: 14,
    marginBottom: 8,
  },
  searchTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  searchTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glass,
  },
  searchTagText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8,
    color: w.ink3,
  },
  colorDot: { width: 7, height: 7, borderRadius: 4 },
  searchList: { gap: 6 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: w.line3,
    backgroundColor: w.glass,
  },
  searchEmpty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  searchRowTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 10,
    color: w.ink,
  },
  searchRowNote: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.03, 6.5),
    color: w.muted,
    marginTop: 3,
  },
  emptyTitle: {
    fontFamily: wardrobeFonts.serif,
    fontSize: 16,
    color: w.ink,
  },
  emptyHint: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8,
    lineHeight: 13,
    color: w.muted,
  },
  });
}
