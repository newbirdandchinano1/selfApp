import {
  OCCASIONS,
  RECENT_SEARCHES,
  itemById,
  type ClosetLayout,
  type ClosetSort,
  type SeasonFilter,
  type WardrobeCategory,
  type WardrobeItem,
  type WardrobeOutfit,
  type WardrobeTab,
} from '@/components/wardrobe/data';
import { WardrobeGarment } from '@/components/wardrobe/garments';
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
  IconLink,
  IconPalette,
  IconPlus,
  IconSearch,
  IconSeason,
  IconSingleCol,
  IconSort,
  IconSparkle,
  IconTag,
} from '@/components/wardrobe/icons';
import { FOLD_MOTION_EASE, FOLD_MOTION_SPRING } from '@/components/review/fold-motion';
import { WARDROBE, wardrobeEm, wardrobeFonts, wardrobeType } from '@/constants/wardrobe-theme';
import { toast } from '@/lib/app-feedback/toast-events';
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
  if (!visible) return null;
  const rows: { key: ClosetLayout; label: string; icon: React.ReactNode }[] = [
    { key: 'card', label: '卡片布局', icon: <IconGrid size={11} color={WARDROBE.pine} /> },
    { key: 'double', label: '双列布局', icon: <IconDoubleCols size={11} color={WARDROBE.pine} /> },
    { key: 'single', label: '单列布局', icon: <IconSingleCol size={11} color={WARDROBE.pine} /> },
  ];
  return (
    <>
      <Pressable style={styles.catcher} onPress={onClose} />
      <View style={styles.layoutPop}>
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
              <IconCheck size={12} color={WARDROBE.amber} />
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
            <IconSort size={11} color={WARDROBE.pine} />
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
            <IconFolderPlus size={11} color={WARDROBE.pine} />
          </View>
          <Text style={styles.popRowText}>管理分类</Text>
        </Pressable>
      </View>
    </>
  );
});

/* ─── CreatePop ─── */

const CREATE_OPTS: Record<
  WardrobeTab,
  { label: string; note: string; icon: React.ReactNode; tile: string }[]
> = {
  closet: [
    { label: '拍照', note: '用相机记录今天的穿搭', icon: <IconCamera size={14} color="#41604F" />, tile: '#E1E8E1' },
    { label: '从相册导入', note: '选择已有照片', icon: <IconImage size={14} color="#8C6A3C" />, tile: '#F1E5D3' },
    { label: '淘宝链接', note: '粘贴链接自动识别', icon: <IconLink size={14} color="#4A5F79" />, tile: '#E3E7EF' },
    { label: '从剪贴板导入', note: '读取剪贴板中的图片', icon: <IconClip size={14} color="#8C5541" />, tile: '#F0DFD5' },
  ],
  outfits: [
    { label: '从单品组合', note: '挑选衣橱里的单品', icon: <IconLayers size={14} color="#41604F" />, tile: '#E1E8E1' },
    { label: '拍照上传', note: '记录今天的造型', icon: <IconCamera size={14} color="#8C6A3C" />, tile: '#F1E5D3' },
    { label: 'AI 灵感', note: '根据场合生成搭配', icon: <IconSparkle size={14} color="#4A5F79" />, tile: '#E3E7EF' },
  ],
  mine: [
    { label: '新建衣橱', note: '为旅行或季节单独整理', icon: <IconBox size={14} color="#41604F" />, tile: '#E1E8E1' },
    { label: '导入衣橱', note: '从备份恢复数据', icon: <IconClip size={14} color="#8C6A3C" />, tile: '#F1E5D3' },
    { label: '邀请共用', note: '与家人一起整理衣橱', icon: <IconLayers size={14} color="#4A5F79" />, tile: '#E3E7EF' },
  ],
};

export type CreatePopProps = {
  visible: boolean;
  tab: WardrobeTab;
  categoryHint?: string | null;
  onClose: () => void;
};

export const CreatePop = memo(function CreatePop({ visible, tab, categoryHint, onClose }: CreatePopProps) {
  if (!visible) return null;
  const opts = CREATE_OPTS[tab];
  const title =
    tab === 'closet' && categoryHint
      ? `CREATE · 添加到${categoryHint}`
      : tab === 'outfits'
        ? 'CREATE · 新建搭配'
        : tab === 'mine'
          ? 'CREATE · 管理衣橱'
          : 'CREATE · 添加单品';

  return (
    <>
      <Pressable style={styles.catcher} onPress={onClose} />
      <View style={styles.createPop}>
        <Text style={styles.popTitle}>{title}</Text>
        {opts.map((opt) => (
          <Pressable
            key={opt.label}
            style={styles.createOpt}
            onPress={() => {
              toast.info(`演示：${opt.label}`);
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
    </>
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
  | { kind: 'context'; tab: WardrobeTab; sort: ClosetSort; categories: WardrobeCategory[] }
  | null;

export type WardrobeSheetProps = {
  content: SheetContent;
  onClose: () => void;
  onSortPick?: (sort: ClosetSort) => void;
  onSeason?: (season: SeasonFilter) => void;
  onOpenItem?: (id: string) => void;
  onWearItem?: (id: string) => void;
  onWearOutfit?: (id: string) => void;
  onOpenGeneric?: (key: string) => void;
  onCategoryAction?: (action: string, name?: string) => void;
};

export const WardrobeSheet = memo(function WardrobeSheet({
  content,
  onClose,
  onSortPick,
  onSeason,
  onOpenItem,
  onWearItem,
  onWearOutfit,
  onOpenGeneric,
  onCategoryAction,
}: WardrobeSheetProps) {
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
      sizes: '详细尺码管理',
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
      const dots = Array.from({ length: 28 }, (_, index) => (index * 7 + item.wear) % 4 === 0);
      return (
        <View>
          <View style={[styles.detailVisual, { backgroundColor: item.tint }]}>
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
              <IconHanger size={11} color={WARDROBE.onPine} />
              <Text style={styles.btnPrimaryText}>穿这件</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnGhost]}
              onPress={() => toast.info('演示：加入搭配')}>
              <Text style={styles.btnGhostText}>加入搭配</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (content.kind === 'outfit') {
      const { outfit, items } = content;
      return (
        <View>
          <View style={[styles.detailVisual, { backgroundColor: '#F1E9DA', height: 160 }]}>
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
                      { backgroundColor: item.tint },
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
                  <View style={[styles.srThumb, { backgroundColor: item.tint }]}>
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
              <IconHanger size={11} color={WARDROBE.onPine} />
              <Text style={styles.btnPrimaryText}>穿这套</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnGhost]}
              onPress={() => toast.info('演示：编辑搭配')}>
              <Text style={styles.btnGhostText}>编辑搭配</Text>
            </Pressable>
          </View>
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
          {content.categories.map((cat) => (
            <SheetRow
              key={cat.name}
              title={cat.name}
              note={`${cat.ids.length} 件单品 · 点击管理`}
              onPress={() => onCategoryAction?.('open', cat.name)}
            />
          ))}
          <Pressable
            style={styles.addRow}
            onPress={() => {
              toast.info('演示：新建分类');
              onClose();
            }}>
            <IconPlus size={12} color={WARDROBE.muted} />
            <Text style={styles.addRowText}>新建分类</Text>
          </Pressable>
        </View>
      );
    }

    if (content.kind === 'category') {
      const cat = content.categories.find((c) => c.name === content.name);
      return (
        <View style={styles.sheetList}>
          <SheetRow
            title="添加单品"
            note={`把新单品加入「${content.name}」`}
            onPress={() => onCategoryAction?.('add', content.name)}
          />
          <SheetRow
            title="重命名分类"
            note={`当前名称：${content.name}`}
            onPress={() => toast.info('演示：重命名分类')}
          />
          <SheetRow title="调整顺序" note="拖动分类在衣橱中的位置" onPress={() => toast.info('演示：调整顺序')} />
          <SheetRow
            title="删除分类"
            note={cat?.ids.length ? '需先移动其中单品' : '该分类暂无单品，可直接删除'}
            onPress={() => toast.info('演示：删除分类')}
          />
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
              note={`${OCCASIONS.length - 1} 个场合`}
              onPress={() => onOpenGeneric?.('occasions')}
            />
            <SheetRow
              title="新建搭配"
              note="从单品中组合一套新造型"
              onPress={() => toast.info('演示：新建搭配')}
            />
          </View>
        );
      }
      if (content.tab === 'mine') {
        return (
          <View style={styles.sheetList}>
            <SheetRow
              title="切换衣橱"
              note="我的橱柜 · 旅行衣橱"
              onPress={() => onOpenGeneric?.('wardrobe')}
            />
            <SheetRow
              title="选项管理"
              note="分类、颜色、品牌与季节"
              onPress={() => onOpenGeneric?.('options')}
            />
            <SheetRow
              title="关于 ATELIER"
              note="版本 2.0 · 交互演示"
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
            note="我的橱柜 · 12 件单品"
            onPress={() => onOpenGeneric?.('wardrobe')}
          />
        </View>
      );
    }

    if (content.kind === 'generic') {
      const key = content.key;
      if (key === 'wardrobe') {
        return (
          <View style={styles.sheetList}>
            <View style={styles.pickRow}>
              <View style={styles.pIco}>
                <IconCloset size={15} color={WARDROBE.pine} />
              </View>
              <View style={styles.srCopy}>
                <Text style={styles.srTitle}>我的橱柜</Text>
                <Text style={styles.srNote}>当前衣橱 · 12 件单品</Text>
              </View>
              <View style={[styles.radio, styles.radioOn]} />
            </View>
            <View style={styles.pickRow}>
              <View style={styles.pIco}>
                <IconCloset size={15} color={WARDROBE.pine} />
              </View>
              <View style={styles.srCopy}>
                <Text style={styles.srTitle}>旅行衣橱</Text>
                <Text style={styles.srNote}>4 件单品 · 上次更新 10.18</Text>
              </View>
              <View style={styles.radio} />
            </View>
            <Pressable style={styles.addRow} onPress={() => toast.info('演示：新建衣橱')}>
              <IconPlus size={12} color={WARDROBE.muted} />
              <Text style={styles.addRowText}>新建衣橱</Text>
            </Pressable>
          </View>
        );
      }
      if (key === 'options') {
        const opts = [
          { label: '分类', note: '9 个分类', tile: '#E1E8E1', tone: '#41604F', icon: <IconTag size={15} color="#41604F" /> },
          { label: '颜色', note: '4 个色系', tile: '#F1E5D3', tone: '#8C6A3C', icon: <IconPalette size={15} color="#8C6A3C" /> },
          { label: '品牌', note: '10 个品牌', tile: '#E3E7EF', tone: '#4A5F79', icon: <IconTag size={15} color="#4A5F79" /> },
          { label: '季节', note: '4 个季节', tile: '#E0E9E4', tone: '#3E6150', icon: <IconSeason size={15} color="#3E6150" /> },
        ];
        return (
          <View style={styles.sheetList}>
            {opts.map((o) => (
              <Pressable key={o.label} style={styles.pickRow} onPress={() => toast.info(`演示：${o.label}`)}>
                <View style={[styles.pIco, { backgroundColor: o.tile }]}>{o.icon}</View>
                <View style={styles.srCopy}>
                  <Text style={styles.srTitle}>{o.label}</Text>
                  <Text style={styles.srNote}>{o.note}</Text>
                </View>
                <IconArrow size={11} color={WARDROBE.muted2} />
              </Pressable>
            ))}
          </View>
        );
      }
      if (key === 'sizes') {
        return (
          <View style={styles.sheetList}>
            {[
              ['上装', 'M · 肩宽 38 / 胸围 84', '#E3E7EF', '#4A5F79'],
              ['下装', '27 · 腰围 66 / 臀围 90', '#E9E2D5', '#77694F'],
              ['鞋履', '38 · 脚长 240mm', '#E0E9E4', '#3E6150'],
              ['配饰', 'ONE SIZE', '#F0DFD5', '#8C5541'],
            ].map(([label, note, tile, tone]) => (
              <View key={label} style={styles.pickRow}>
                <View style={[styles.pIco, { backgroundColor: tile }]}>
                  <IconHanger size={15} color={tone} />
                </View>
                <View style={styles.srCopy}>
                  <Text style={styles.srTitle}>{label}</Text>
                  <Text style={styles.srNote}>{note}</Text>
                </View>
                <IconArrow size={11} color={WARDROBE.muted2} />
              </View>
            ))}
          </View>
        );
      }
      if (key === 'body') {
        return (
          <View>
            <DetailGrid
              pairs={[
                ['身高', '165 cm'],
                ['体重', '52 kg'],
                ['肩宽', '38 cm'],
                ['胸围', '84 cm'],
                ['腰围', '66 cm'],
                ['臀围', '90 cm'],
                ['腿长', '98 cm'],
                ['脚长', '240 mm'],
              ]}
            />
            <Text style={styles.mutedP}>身材数据仅保存在本机，用于推荐更合身的单品。</Text>
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
        const cats = (content.categories ?? []).filter((c) => c.ids.length).sort((a, b) => b.ids.length - a.ids.length);
        const total = content.items?.length || 12;
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
                ['本月穿着', '32 次'],
                ['最常穿', '帆布鞋'],
                ['使用率', '71%'],
                ['总价值', '¥7,100'],
              ]}
            />
          </View>
        );
      }
      if (key === 'outfit-sort') {
        return (
          <View style={styles.sheetList}>
            {[
              ['最近添加', '按创建时间倒序'],
              ['穿着次数', '最常穿的搭配优先'],
              ['场合', '按场合分组'],
            ].map(([label, note], i) => (
              <SheetRow
                key={label}
                title={label}
                note={note}
                active={i === 0}
                onPress={() => {
                  toast.info(`演示：按${label}排序`);
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
            {OCCASIONS.slice(1).map((o) => {
              const count = outfitList.filter((outfit) => outfit.occasion === o).length;
              return (
                <View key={o} style={styles.pickRow}>
                  <View style={styles.pIco}>
                    <IconTag size={15} color={WARDROBE.pine} />
                  </View>
                  <View style={styles.srCopy}>
                    <Text style={styles.srTitle}>{o}</Text>
                    <Text style={styles.srNote}>{count} 套搭配</Text>
                  </View>
                  <IconArrow size={11} color={WARDROBE.muted2} />
                </View>
              );
            })}
            <Pressable style={styles.addRow} onPress={() => toast.info('演示：新建场合')}>
              <IconPlus size={12} color={WARDROBE.muted} />
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
                <Text style={styles.profileMeta}>WARDROBE SYSTEM · VERSION 2.0</Text>
              </View>
            </View>
            <Text style={styles.mutedP}>
              一款安静、克制的衣橱管理工具。用分类、色彩与穿着记录，看看自己真正需要什么。</Text>
            <DetailGrid
              pairs={[
                ['单品', '12'],
                ['搭配', '8'],
                ['衣橱天数', '286'],
                ['数据', '仅存本机'],
              ]}
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
              <IconClose size={16} color={WARDROBE.ink2} />
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
          <IconSearch size={16} color={WARDROBE.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索单品、颜色、品牌…"
            placeholderTextColor={WARDROBE.muted2}
            style={styles.searchInput}
            autoFocus={visible}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <IconClose size={14} color={WARDROBE.muted} />
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
            <IconSearch size={28} color={WARDROBE.muted2} />
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
  return (
    <Pressable style={styles.searchRow} onPress={onPress}>
      <View style={[styles.srThumb, { backgroundColor: item.tint }]}>
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

const styles = StyleSheet.create({
  catcher: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20,30,25,0.1)',
    zIndex: 38,
    elevation: 20,
  },
  layoutPop: {
    position: 'absolute',
    left: 18,
    top: 92,
    width: 180,
    zIndex: 40,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: WARDROBE.card2,
    padding: 6,
    shadowColor: '#18261E',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 24,
  },
  createPop: {
    position: 'absolute',
    right: 20,
    bottom: 154,
    width: 214,
    zIndex: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: WARDROBE.card2,
    padding: 6,
    shadowColor: '#18261E',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  createArrow: {
    position: 'absolute',
    right: 20,
    bottom: -5,
    width: 10,
    height: 10,
    backgroundColor: WARDROBE.card2,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: WARDROBE.line,
    transform: [{ rotate: '45deg' }],
  },
  popTitle: {
    ...wardrobeType.popTitle,
    paddingHorizontal: 8,
    paddingTop: 5,
    paddingBottom: 6,
    color: WARDROBE.muted,
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
    color: WARDROBE.ink2,
  },
  popRowTextActive: { color: WARDROBE.pine, fontFamily: wardrobeFonts.sansSemiBold },
  pi: {
    width: 19,
    height: 19,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(33,69,58,0.06)',
  },
  check: { width: 12, height: 12, opacity: 0 },
  checkOn: { opacity: 1 },
  popSep: { height: 1, backgroundColor: WARDROBE.line3, marginVertical: 4, marginHorizontal: 6 },
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
    color: WARDROBE.ink2,
  },
  coNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: WARDROBE.muted,
    marginTop: 2,
  },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(24,35,29,0.34)',
  },
  sheet: {
    backgroundColor: WARDROBE.card2,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '88%',
    paddingTop: 8,
    borderWidth: 1,
    borderColor: WARDROBE.line,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: WARDROBE.line2,
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
    color: WARDROBE.ink,
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(252,249,241,0.7)',
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
    borderColor: WARDROBE.line3,
    backgroundColor: 'rgba(252,249,241,0.55)',
  },
  sheetRowActive: {
    borderColor: 'rgba(33,69,58,0.24)',
    backgroundColor: 'rgba(33,69,58,0.04)',
  },
  srCopy: { flex: 1, minWidth: 0 },
  srTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 9.5,
    color: WARDROBE.ink2,
  },
  srTitleActive: { color: WARDROBE.pine, fontFamily: wardrobeFonts.sansSemiBold },
  srNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: WARDROBE.muted,
    marginTop: 2,
  },
  srPrice: {
    fontFamily: wardrobeFonts.monoSemiBold,
    fontSize: 8,
    color: WARDROBE.clay,
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
    borderColor: WARDROBE.line2,
  },
  radioOn: { borderColor: WARDROBE.pine, backgroundColor: WARDROBE.pine },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: WARDROBE.line2,
  },
  addRowText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8,
    color: WARDROBE.muted,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: WARDROBE.line3,
    backgroundColor: 'rgba(252,249,241,0.55)',
  },
  pIco: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WARDROBE.sage2,
  },
  detailVisual: {
    height: 174,
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
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
    color: 'rgba(44,64,55,0.5)',
  },
  dvSeason: {
    position: 'absolute',
    right: 11,
    top: 10,
    zIndex: 2,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,253,247,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  dvSeasonText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.04, 6.5),
    color: WARDROBE.pine,
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
    color: WARDROBE.ink,
  },
  detailPrice: {
    fontFamily: wardrobeFonts.monoBold,
    fontSize: 14,
    color: WARDROBE.clay,
    paddingTop: 3,
  },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginVertical: 10, paddingHorizontal: 2 },
  tagChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: WARDROBE.line3,
    backgroundColor: 'rgba(252,249,241,0.7)',
  },
  tagChipText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.03, 6.5),
    color: WARDROBE.ink3,
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
    borderColor: WARDROBE.line3,
    backgroundColor: 'rgba(252,249,241,0.66)',
  },
  dgLabel: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    letterSpacing: wardrobeEm(0.04, 7.5),
    color: WARDROBE.muted,
  },
  dgValue: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 7.5,
    color: WARDROBE.ink2,
    maxWidth: '60%',
  },
  wearHistory: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: WARDROBE.line3,
    backgroundColor: 'rgba(252,249,241,0.5)',
  },
  whHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  whHeadText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    color: WARDROBE.muted,
  },
  whHeadBold: {
    fontFamily: wardrobeFonts.monoBold,
    fontSize: 8,
    color: WARDROBE.pine,
  },
  whDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  whDot: {
    width: '6.2%' as unknown as number,
    aspectRatio: 1,
    borderRadius: 2,
    backgroundColor: 'rgba(33,69,58,0.075)',
    minWidth: 10,
    minHeight: 10,
    flexGrow: 1,
    flexBasis: '6%',
    maxWidth: 14,
  },
  whDotOn: { backgroundColor: WARDROBE.sage },
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
  btnPrimary: { backgroundColor: WARDROBE.pine },
  btnPrimaryText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 9,
    color: WARDROBE.onPine,
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: WARDROBE.line2,
    backgroundColor: 'rgba(252,249,241,0.56)',
  },
  btnGhostText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 9,
    color: WARDROBE.ink2,
  },
  outfitNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 9,
    lineHeight: 15,
    color: WARDROBE.muted,
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
    borderColor: 'rgba(255,255,255,0.66)',
  },
  mutedP: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8.5,
    lineHeight: 14,
    color: WARDROBE.muted,
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
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(252,249,241,0.62)',
  },
  seasonTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: wardrobeEm(0.03, 10),
    color: WARDROBE.ink2,
  },
  seasonNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: WARDROBE.muted,
    marginTop: 2,
  },
  segmented: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(33,69,58,0.06)',
  },
  seg: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  segActive: { backgroundColor: WARDROBE.card2 },
  segText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7,
    letterSpacing: wardrobeEm(0.02, 7),
    color: WARDROBE.muted,
  },
  segTextActive: { color: WARDROBE.pine, fontFamily: wardrobeFonts.sansSemiBold },
  statBars: { gap: 9, paddingVertical: 4, marginBottom: 12 },
  sbRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sbLabel: {
    width: 48,
    fontFamily: wardrobeFonts.sans,
    fontSize: 7,
    color: WARDROBE.muted,
  },
  sbTrack: { flex: 1, height: 6, borderRadius: 99, backgroundColor: 'rgba(33,69,58,0.07)', overflow: 'hidden' },
  sbFill: { height: '100%', borderRadius: 99, backgroundColor: WARDROBE.sage },
  sbCount: {
    width: 30,
    textAlign: 'right',
    fontFamily: wardrobeFonts.mono,
    fontSize: 7,
    color: WARDROBE.ink3,
  },
  aboutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(255,253,247,0.95)',
    marginTop: 2,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: WARDROBE.pine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: wardrobeFonts.serif, fontSize: 22, color: '#F6F0E1' },
  profileName: {
    ...wardrobeType.profileName,
    color: WARDROBE.ink,
  },
  profileMeta: {
    ...wardrobeType.profileMeta,
    color: WARDROBE.muted,
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
    backgroundColor: 'rgba(244,240,231,0.96)',
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
    borderColor: WARDROBE.line,
    backgroundColor: WARDROBE.card,
  },
  searchInput: {
    flex: 1,
    fontFamily: wardrobeFonts.sans,
    fontSize: 10,
    letterSpacing: wardrobeEm(0.02, 10),
    color: WARDROBE.ink,
    padding: 0,
  },
  searchCancel: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 9,
    letterSpacing: wardrobeEm(0.03, 9),
    color: WARDROBE.ink2,
  },
  searchBody: { flex: 1 },
  searchKicker: {
    ...wardrobeType.popTitle,
    color: WARDROBE.muted,
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
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(252,249,241,0.7)',
  },
  searchTagText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8,
    color: WARDROBE.ink3,
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
    borderColor: WARDROBE.line3,
    backgroundColor: 'rgba(252,249,241,0.56)',
  },
  searchEmpty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  searchRowTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 10,
    color: WARDROBE.ink,
  },
  searchRowNote: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.03, 6.5),
    color: WARDROBE.muted,
    marginTop: 3,
  },
  emptyTitle: {
    fontFamily: wardrobeFonts.serif,
    fontSize: 16,
    color: WARDROBE.ink,
  },
  emptyHint: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8,
    lineHeight: 13,
    color: WARDROBE.muted,
  },
});
