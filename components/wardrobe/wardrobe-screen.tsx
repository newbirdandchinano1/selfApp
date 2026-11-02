import {
  WARDROBE_CATEGORIES,
  WARDROBE_ITEMS,
  WARDROBE_OUTFITS,
  type ClosetLayout,
  type ClosetSort,
  type SeasonFilter,
  type WardrobeItem,
  type WardrobeOutfit,
  type WardrobeTab,
} from '@/components/wardrobe/data';
import { ClosetView } from '@/components/wardrobe/closet-view';
import {
  IconBack,
  IconCloset,
  IconFilter,
  IconGear,
  IconGrid,
  IconLooks,
  IconMore,
  IconPerson,
  IconPlus,
  IconSearch,
} from '@/components/wardrobe/icons';
import { MineView } from '@/components/wardrobe/mine-view';
import {
  CreatePop,
  LayoutPop,
  SearchOverlay,
  WardrobeSheet,
  type SheetContent,
} from '@/components/wardrobe/overlays';
import { OutfitsView } from '@/components/wardrobe/outfits-view';
import { useWardrobeFonts } from '@/components/wardrobe/use-wardrobe-fonts';
import { FOLD_MOTION_EASE, FOLD_MOTION_SPRING } from '@/components/review/fold-motion';
import { WARDROBE, wardrobeType } from '@/constants/wardrobe-theme';
import { toast } from '@/lib/app-feedback/toast-events';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type WardrobeScreenProps = {
  onBack: () => void;
};

const TAB_META: Record<WardrobeTab, { title: string; sub: string }> = {
  closet: { title: '我的橱柜', sub: 'WARDROBE · 12 ITEMS' },
  outfits: { title: '搭配', sub: 'OUTFITS · 8 LOOKS' },
  mine: { title: '我的', sub: 'PROFILE · ATELIER' },
};

const TABS: WardrobeTab[] = ['closet', 'outfits', 'mine'];

export function WardrobeScreen({ onBack }: WardrobeScreenProps) {
  const insets = useSafeAreaInsets();
  const { ready: fontsReady } = useWardrobeFonts();
  const [tab, setTab] = useState<WardrobeTab>('closet');
  const [prevTab, setPrevTab] = useState<WardrobeTab | null>(null);
  const [layout, setLayout] = useState<ClosetLayout>('card');
  const [sort, setSort] = useState<ClosetSort>('recent');
  const [season, setSeason] = useState<SeasonFilter>('all');
  const [occasion, setOccasion] = useState('全部');
  const [items, setItems] = useState<WardrobeItem[]>(() => [...WARDROBE_ITEMS]);
  const [outfits] = useState<WardrobeOutfit[]>(() => [...WARDROBE_OUTFITS]);
  const [categories] = useState(() => [...WARDROBE_CATEGORIES]);

  const [layoutPop, setLayoutPop] = useState(false);
  const [createPop, setCreatePop] = useState(false);
  const [createHint, setCreateHint] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetContent>(null);

  const [titleSwap, setTitleSwap] = useState(false);
  const [title, setTitle] = useState(TAB_META.closet.title);
  const [sub, setSub] = useState(TAB_META.closet.sub);

  const dockWidth = useRef(0);
  const dockIndX = useRef(new Animated.Value(0)).current;
  const fabRotate = useRef(new Animated.Value(0)).current;
  const fabScale = useRef(new Animated.Value(1)).current;
  const enterX = useRef(new Animated.Value(0)).current;
  const enterOp = useRef(new Animated.Value(1)).current;
  const leaveX = useRef(new Animated.Value(0)).current;
  const leaveOp = useRef(new Animated.Value(0)).current;
  /** 避免快速连点时闭包读到过期 tab */
  const tabRef = useRef<WardrobeTab>(tab);
  tabRef.current = tab;
  /** 切换代数：丢弃被打断的动画回调与标题定时器，防止 enterX 卡在 26 */
  const switchGenRef = useRef(0);
  const tabAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closePops = useCallback(() => {
    setLayoutPop(false);
    setCreatePop(false);
    setCreateHint(null);
  }, []);

  useEffect(() => {
    return () => {
      tabAnimRef.current?.stop();
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    Animated.timing(fabRotate, {
      toValue: createPop ? 1 : 0,
      duration: 450,
      easing: FOLD_MOTION_SPRING,
      useNativeDriver: true,
    }).start();
  }, [createPop, fabRotate]);

  useEffect(() => {
    Animated.timing(fabScale, {
      toValue: tab === 'mine' ? 0 : 1,
      duration: 320,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [fabScale, tab]);

  const switchTab = useCallback(
    (next: WardrobeTab) => {
      if (next === tabRef.current) return;
      const from = tabRef.current;
      tabRef.current = next;
      closePops();

      const gen = ++switchGenRef.current;
      setPrevTab(from);
      setTab(next);

      const index = TABS.indexOf(next);
      const slot = dockWidth.current > 0 ? (dockWidth.current - 10) / 3 : 0;
      Animated.timing(dockIndX, {
        toValue: index * slot,
        duration: 580,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }).start();

      // 先停掉上一轮，避免并行动画叠在同一组 Shared Value 上
      tabAnimRef.current?.stop();
      leaveX.stopAnimation();
      leaveOp.stopAnimation();
      enterX.stopAnimation();
      enterOp.stopAnimation();

      leaveX.setValue(0);
      leaveOp.setValue(1);
      enterX.setValue(26);
      enterOp.setValue(0);

      const anim = Animated.parallel([
        Animated.timing(leaveX, { toValue: -24, duration: 340, easing: FOLD_MOTION_EASE, useNativeDriver: true }),
        Animated.timing(leaveOp, { toValue: 0, duration: 280, easing: FOLD_MOTION_EASE, useNativeDriver: true }),
        Animated.timing(enterX, { toValue: 0, duration: 420, easing: FOLD_MOTION_EASE, useNativeDriver: true }),
        Animated.timing(enterOp, { toValue: 1, duration: 340, easing: FOLD_MOTION_EASE, useNativeDriver: true }),
      ]);
      tabAnimRef.current = anim;
      anim.start(() => {
        if (switchGenRef.current !== gen) return;
        // 当前页必须落在 translateX:0，否则会「整体偏右、左侧空白」
        enterX.setValue(0);
        enterOp.setValue(1);
        leaveOp.setValue(0);
        leaveX.setValue(0);
        setPrevTab(null);
      });

      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      setTitleSwap(true);
      titleTimerRef.current = setTimeout(() => {
        if (switchGenRef.current !== gen) return;
        setTitle(TAB_META[next].title);
        setSub(
          next === 'closet'
            ? `WARDROBE · ${items.length} ITEMS`
            : next === 'outfits'
              ? `OUTFITS · ${outfits.length} LOOKS`
              : TAB_META.mine.sub,
        );
        setTitleSwap(false);
      }, 135);
    },
    [closePops, dockIndX, enterOp, enterX, items.length, leaveOp, leaveX, outfits.length],
  );

  const [dockSlot, setDockSlot] = useState(110);
  const onDockLayout = (e: LayoutChangeEvent) => {
    dockWidth.current = e.nativeEvent.layout.width;
    const slot = (dockWidth.current - 10) / 3;
    setDockSlot(slot);
    dockIndX.setValue(TABS.indexOf(tab) * slot);
  };

  const openItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    closePops();
    setSearchOpen(false);
    setSheet({ kind: 'item', item });
  };

  const openOutfit = (id: string) => {
    const outfit = outfits.find((o) => o.id === id);
    if (!outfit) return;
    closePops();
    setSheet({ kind: 'outfit', outfit, items });
  };

  const wearItem = (id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, wear: item.wear + 1 } : item)));
    setSheet((cur) => {
      if (cur?.kind === 'item' && cur.item.id === id) {
        return { kind: 'item', item: { ...cur.item, wear: cur.item.wear + 1 } };
      }
      return cur;
    });
    toast.info('已记录穿着');
  };

  const ctxIcon = useMemo(() => {
    if (tab === 'closet') return <IconGrid size={16} color={WARDROBE.ink2} />;
    if (tab === 'outfits') return <IconFilter size={16} color={WARDROBE.ink2} />;
    return <IconGear size={16} color={WARDROBE.ink2} />;
  }, [tab]);

  const onCtx = () => {
    if (tab === 'closet') {
      setCreatePop(false);
      setLayoutPop((v) => !v);
      return;
    }
    // 对齐设计稿：搭配 Tab 左上按钮直接打开「管理场合」
    if (tab === 'outfits') {
      closePops();
      setSheet({ kind: 'generic', key: 'occasions', outfits });
      return;
    }
    setSheet({ kind: 'context', tab, sort, categories });
  };

  const plusRotate = fabRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] });

  const renderView = (which: WardrobeTab) => {
    if (which === 'closet') {
      return (
        <ClosetView
          items={items}
          categories={categories}
          layout={layout}
          sort={sort}
          season={season}
          onOpenItem={openItem}
          onManageCategories={() => setSheet({ kind: 'categories', categories })}
          onAddToCategory={(name) => {
            setCreateHint(name);
            setCreatePop(true);
            setLayoutPop(false);
          }}
          onCategoryMore={(name) => setSheet({ kind: 'category', name, categories })}
          onJumpMine={() => switchTab('mine')}
        />
      );
    }
    if (which === 'outfits') {
      return (
        <OutfitsView
          outfits={outfits}
          items={items}
          occasion={occasion}
          onOccasion={setOccasion}
          onOpenOutfit={openOutfit}
          onSort={() => setSheet({ kind: 'generic', key: 'outfit-sort' })}
        />
      );
    }
    return (
      <MineView
        items={items}
        outfits={outfits}
        categories={categories}
        season={season}
        onSeason={setSeason}
        onOpenSheet={(key) => {
          if (key === 'sort') setSheet({ kind: 'sort', sort });
          else if (key === 'categories') setSheet({ kind: 'categories', categories });
          else setSheet({ kind: 'generic', key, season, categories, items, outfits });
        }}
      />
    );
  };

  if (!fontsReady) {
    return (
      <View
        style={[
          styles.root,
          styles.fontBoot,
          { paddingTop: insets.top, backgroundColor: WARDROBE.screenMid },
        ]}>
        <ActivityIndicator color={WARDROBE.pine} />
        <Text style={styles.fontBootText}>加载衣橱字体…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: WARDROBE.screenMid }]}>
      <View style={styles.appbar}>
        <Pressable onPress={onBack} style={styles.iconBtn} accessibilityLabel="返回">
          <IconBack size={16} color={WARDROBE.ink2} />
        </Pressable>
        <Pressable onPress={onCtx} style={styles.iconBtn} accessibilityLabel="视图选项">
          {ctxIcon}
        </Pressable>
        <View style={styles.apptitle}>
          <Text style={[styles.title, titleSwap && styles.titleSwap]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <View style={styles.appActions}>
          <Pressable
            onPress={() => {
              closePops();
              setSearchOpen(true);
            }}
            style={styles.actionBtn}
            accessibilityLabel="搜索">
            <IconSearch size={15} color={WARDROBE.ink2} />
          </Pressable>
          <View style={styles.sep} />
          <Pressable
            onPress={() => {
              closePops();
              setSheet({ kind: 'context', tab, sort, categories });
            }}
            style={styles.actionBtn}
            accessibilityLabel="更多">
            <IconMore size={15} color={WARDROBE.ink2} />
          </Pressable>
        </View>
      </View>

      <View style={styles.viewport}>
        {prevTab ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.viewLayer, { opacity: leaveOp, transform: [{ translateX: leaveX }] }]}>
            {renderView(prevTab)}
          </Animated.View>
        ) : null}
        <Animated.View
          style={[styles.viewLayer, { opacity: enterOp, transform: [{ translateX: enterX }] }]}>
          {renderView(tab)}
        </Animated.View>
      </View>

      <Animated.View
        pointerEvents={tab === 'mine' ? 'none' : 'auto'}
        style={[
          styles.fab,
          {
            bottom: 92 + Math.max(insets.bottom - 8, 0),
            opacity: fabScale,
            transform: [{ scale: fabScale }],
          },
        ]}>
        <Pressable
          style={styles.fabInner}
          onPress={() => {
            if (createPop) closePops();
            else {
              setLayoutPop(false);
              setCreateHint(null);
              setCreatePop(true);
            }
          }}
          accessibilityLabel="添加">
          <View style={styles.fabBadge} />
          <Animated.View style={{ transform: [{ rotate: plusRotate }] }}>
            <IconPlus size={21} color={WARDROBE.onPine} />
          </Animated.View>
        </Pressable>
      </Animated.View>

      <View style={[styles.dock, { bottom: 14 + Math.max(insets.bottom - 10, 0) }]} onLayout={onDockLayout}>
        <Animated.View style={[styles.dockInd, { width: dockSlot, transform: [{ translateX: dockIndX }] }]} />
        {(
          [
            ['closet', '衣橱', IconCloset],
            ['outfits', '搭配', IconLooks],
            ['mine', '我的', IconPerson],
          ] as const
        ).map(([key, label, Icon]) => {
          const active = tab === key;
          return (
            <Pressable key={key} style={styles.dockBtn} onPress={() => switchTab(key)}>
              <Icon size={18} color={active ? WARDROBE.onPine : WARDROBE.muted} />
              <Text style={[styles.dockLabel, active && styles.dockLabelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <LayoutPop
        visible={layoutPop}
        layout={layout}
        onLayout={setLayout}
        onSort={() => setSheet({ kind: 'sort', sort })}
        onManageCategories={() => setSheet({ kind: 'categories', categories })}
        onClose={closePops}
      />
      <CreatePop visible={createPop} tab={tab} categoryHint={createHint} onClose={closePops} />

      <WardrobeSheet
        content={sheet}
        onClose={() => setSheet(null)}
        onSortPick={(value) => {
          setSort(value);
          setSheet(null);
          toast.info('已更新排序');
        }}
        onSeason={(value) => {
          setSeason(value);
          setSheet((cur) =>
            cur?.kind === 'generic' && cur.key === 'season' ? { ...cur, season: value } : cur,
          );
        }}
        onOpenItem={openItem}
        onWearItem={wearItem}
        onWearOutfit={(id) => {
          toast.info('已记录这套穿搭');
          void id;
        }}
        onOpenGeneric={(key) => {
          if (key === 'sort') setSheet({ kind: 'sort', sort });
          else if (key === 'categories') setSheet({ kind: 'categories', categories });
          else setSheet({ kind: 'generic', key, season, categories, items, outfits });
        }}
        onCategoryAction={(action, name) => {
          if (action === 'open' && name) setSheet({ kind: 'category', name, categories });
          else if (action === 'add' && name) {
            setSheet(null);
            setCreateHint(name);
            setCreatePop(true);
          }
        }}
      />

      <SearchOverlay
        visible={searchOpen}
        items={items}
        onClose={() => setSearchOpen(false)}
        onOpenItem={openItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fontBoot: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  fontBootText: {
    ...wardrobeType.appSub,
    color: WARDROBE.muted,
  },
  appbar: {
    height: 56,
    paddingHorizontal: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(252,249,241,0.66)',
  },
  apptitle: { flex: 1, minWidth: 0, alignItems: 'center' },
  title: {
    ...wardrobeType.appTitle,
    color: WARDROBE.pine,
  },
  titleSwap: { opacity: 0, transform: [{ translateY: 5 }] },
  sub: {
    ...wardrobeType.appSub,
    color: WARDROBE.muted,
    marginTop: 3,
  },
  appActions: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(252,249,241,0.66)',
    borderWidth: 1,
    borderColor: WARDROBE.line,
  },
  actionBtn: {
    width: 29,
    height: 29,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sep: { width: 1, height: 13, backgroundColor: WARDROBE.line },
  viewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  viewLayer: { ...StyleSheet.absoluteFill },
  fab: {
    position: 'absolute',
    right: 20,
    width: 54,
    height: 54,
    zIndex: 19,
  },
  fabInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: WARDROBE.pine,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E372D',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  fabBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: WARDROBE.amber,
    borderWidth: 2,
    borderColor: WARDROBE.paper,
  },
  dock: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 64,
    zIndex: 18,
    padding: 5,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    backgroundColor: 'rgba(252,249,241,0.92)',
    shadowColor: WARDROBE.ink,
    shadowOpacity: 0.17,
    shadowRadius: 20,
    elevation: 10,
  },
  dockInd: {
    position: 'absolute',
    left: 5,
    top: 5,
    height: 52,
    width: 110,
    borderRadius: 19,
    backgroundColor: WARDROBE.pine,
  },
  dockBtn: {
    flex: 1,
    height: 52,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    zIndex: 1,
  },
  dockLabel: {
    ...wardrobeType.dockLabel,
    color: WARDROBE.muted,
  },
  dockLabelActive: { color: WARDROBE.onPine },
});
