import {
  OCCASIONS,
  isUncategorizedCategory,
  type ClosetLayout,
  type ClosetSort,
  type SeasonFilter,
  type WardrobeCategory,
  type WardrobeItem,
  type WardrobeOutfit,
  type WardrobeTab,
} from '@/components/wardrobe/data';
import { AiIdleInsightsSheet } from '@/components/wardrobe/ai-idle-insights-sheet';
import { AiSimilarItemsSheet } from '@/components/wardrobe/ai-similar-items-sheet';
import { AiSuggestOutfitSheet } from '@/components/wardrobe/ai-suggest-outfit-sheet';
import { AiSuggestTodaySheet } from '@/components/wardrobe/ai-suggest-today-sheet';
import {
  AiWearCommentSheet,
  type AiWearCommentTarget,
} from '@/components/wardrobe/ai-wear-comment-sheet';
import { ClosetView } from '@/components/wardrobe/closet-view';
import { CollageEditor } from '@/components/wardrobe/collage-editor';
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
import {
  WardrobeEditorHost,
  switchDefaultCloset,
  type WardrobeEditor,
} from '@/components/wardrobe/wardrobe-editors';
import { OutfitsView } from '@/components/wardrobe/outfits-view';
import { useWardrobeFonts } from '@/components/wardrobe/use-wardrobe-fonts';
import { FOLD_MOTION_EASE, FOLD_MOTION_SPRING } from '@/components/review/fold-motion';
import { useWardrobeTheme, wardrobeType, type WardrobePalette } from '@/constants/wardrobe-theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { beginApiLoading, endApiLoading } from '@/lib/api-loading-tracker';
import { toast } from '@/lib/app-feedback/toast-events';
import {
  fetchAndCacheWardrobe,
  fetchWardrobeWearWeek,
  loadWardrobeMineWearExtras,
  loadWardrobeScreenData,
  recordWardrobeItemWear,
  recordWardrobeOutfitWear,
  type WardrobeWearWeek,
} from '@/lib/repositories/wardrobe/wardrobe';
import {
  fetchItemWearHistory28,
  listLocalCategoryMeta,
  listLocalClosetMeta,
  listLocalOccasionMeta,
  listLocalOptions,
  loadLocalBodyProfile,
  resolveCategoryIdByName,
} from '@/lib/repositories/wardrobe/wardrobe-writes';
import {
  pickWardrobeLocalImage,
  prepareWardrobeImagesFromLocal,
  type WardrobeImageSource,
} from '@/lib/wardrobe-images';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutChangeEvent,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type WardrobeScreenProps = {
  onBack: () => void;
  /** 助手导航等：初始 Tab（closet / outfits / mine） */
  initialTab?: WardrobeTab;
};

const TAB_META: Record<WardrobeTab, { title: string; sub: string }> = {
  closet: { title: '我的橱柜', sub: 'WARDROBE · 12 ITEMS' },
  outfits: { title: '搭配', sub: 'OUTFITS · 8 LOOKS' },
  mine: { title: '我的', sub: 'PROFILE · ATELIER' },
};

const TABS: WardrobeTab[] = ['closet', 'outfits', 'mine'];

export function WardrobeScreen({ onBack, initialTab }: WardrobeScreenProps) {
  const insets = useSafeAreaInsets();
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const { ready: fontsReady } = useWardrobeFonts();
  const [tab, setTab] = useState<WardrobeTab>(() =>
    initialTab && TABS.includes(initialTab) ? initialTab : 'closet',
  );
  const [prevTab, setPrevTab] = useState<WardrobeTab | null>(null);
  const [layout, setLayout] = useState<ClosetLayout>('card');
  const [sort, setSort] = useState<ClosetSort>('recent');
  const [season, setSeason] = useState<SeasonFilter>('all');
  const [occasion, setOccasion] = useState('全部');
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<WardrobeOutfit[]>([]);
  const outfitsRef = useRef<WardrobeOutfit[]>([]);
  outfitsRef.current = outfits;
  const [categories, setCategories] = useState<WardrobeCategory[]>([]);
  const [occasionNames, setOccasionNames] = useState<string[]>(() => [...OCCASIONS]);
  const [closetId, setClosetId] = useState('wcloset_default');
  const [categoryMeta, setCategoryMeta] = useState<{ id: string; name: string }[]>([]);
  const [occasionMeta, setOccasionMeta] = useState<{ id: string; name: string }[]>([]);
  const [closetMeta, setClosetMeta] = useState<
    { id: string; name: string; is_default: number; created_at?: string | null; item_count?: number }[]
  >([]);
  const [optionRows, setOptionRows] = useState<{ id: string; kind: string; value: string }[]>([]);
  const [bodyPairs, setBodyPairs] = useState<[string, string][]>([]);
  const [bodyProfile, setBodyProfile] = useState<Record<string, unknown> | null>(null);
  const [wearHistory28, setWearHistory28] = useState<boolean[] | null>(null);
  const [wearWeek, setWearWeek] = useState<WardrobeWearWeek | null>(null);
  const [wornThisMonth, setWornThisMonth] = useState(0);
  const [sparkDayCounts, setSparkDayCounts] = useState<number[]>(() => Array.from({ length: 8 }, () => 0));
  const [outfitSort, setOutfitSort] = useState<'recent' | 'wear' | 'occasion'>('recent');
  const [dataReady, setDataReady] = useState(false);
  const [editor, setEditor] = useState<WardrobeEditor | null>(null);
  const [collage, setCollage] = useState<{
    outfit: WardrobeOutfit | null;
    seedItemIds?: string[];
    /** 拍照上传：抠图或原图本地 URI，写入拼图 photo */
    seedPhotoUri?: string;
  } | null>(null);

  const [layoutPop, setLayoutPop] = useState(false);
  const [createPop, setCreatePop] = useState(false);
  const [createHint, setCreateHint] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetContent>(null);
  const [suggestTodayOpen, setSuggestTodayOpen] = useState(false);
  const [suggestOutfitOpen, setSuggestOutfitOpen] = useState(false);
  const [suggestOutfitSeeds, setSuggestOutfitSeeds] = useState<string[] | undefined>();
  const [idleInsightsOpen, setIdleInsightsOpen] = useState(false);
  const [wearCommentTarget, setWearCommentTarget] = useState<AiWearCommentTarget | null>(null);
  const [similarTargetId, setSimilarTargetId] = useState<string | null>(null);

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

  const refreshMeta = useCallback(async (activeClosetId: string) => {
    const [cats, occs, closets, opts, profile, mineWear] = await Promise.all([
      listLocalCategoryMeta(activeClosetId),
      listLocalOccasionMeta(),
      listLocalClosetMeta(),
      listLocalOptions(),
      loadLocalBodyProfile(activeClosetId),
      loadWardrobeMineWearExtras(activeClosetId),
    ]);
    setCategoryMeta(cats.map((c) => ({ id: c.id, name: c.name })));
    setOccasionMeta(occs.map((o) => ({ id: o.id, name: o.name })));
    setClosetMeta(
      closets.map((c) => ({
        id: c.id,
        name: c.name,
        is_default: c.is_default,
        created_at: c.created_at,
        item_count: c.item_count,
      })),
    );
    setOptionRows(opts);
    setBodyProfile(profile);
    setWornThisMonth(mineWear.wornThisMonth);
    setSparkDayCounts(mineWear.sparkDayCounts);
    const fmt = (v: unknown, unit: string) =>
      v == null || v === '' ? '—' : `${v}${unit ? ` ${unit}` : ''}`;
    setBodyPairs([
      ['身高', fmt(profile?.height_cm, 'cm')],
      ['体重', fmt(profile?.weight_kg, 'kg')],
      ['肩宽', fmt(profile?.shoulder_cm, 'cm')],
      ['胸围', fmt(profile?.bust_cm, 'cm')],
      ['腰围', fmt(profile?.waist_cm, 'cm')],
      ['臀围', fmt(profile?.hip_cm, 'cm')],
      ['腿长', fmt(profile?.inseam_cm, 'cm')],
      ['脚长', fmt(profile?.foot_mm, 'mm')],
      ['上装', fmt(profile?.size_top, '')],
      ['下装', fmt(profile?.size_bottom, '')],
      ['鞋码', fmt(profile?.size_shoe, '')],
    ]);
  }, []);

  const applyScreenData = useCallback(
    async (data: Awaited<ReturnType<typeof loadWardrobeScreenData>>) => {
      setClosetId(data.closetId);
      setItems(data.items);
      setOutfits(data.outfits);
      setCategories(data.categories);
      setOccasionNames(data.occasionNames.length > 1 ? data.occasionNames : [...OCCASIONS]);
      setSub(
        tabRef.current === 'closet'
          ? `WARDROBE · ${data.itemCount} ITEMS`
          : tabRef.current === 'outfits'
            ? `OUTFITS · ${data.outfitCount} LOOKS`
            : TAB_META.mine.sub,
      );
      await refreshMeta(data.closetId);
    },
    [refreshMeta],
  );

  const reloadWearWeek = useCallback(async (activeClosetId: string) => {
    try {
      const week = await fetchWardrobeWearWeek({ closet_id: activeClosetId });
      setWearWeek(week);
      return week;
    } catch (e) {
      if (__DEV__) console.warn('[wardrobe-screen] wear week failed', e);
      return null;
    }
  }, []);

  const reloadLocal = useCallback(async () => {
    const data = await loadWardrobeScreenData(closetId);
    await applyScreenData(data);
    await reloadWearWeek(data.closetId);
    return data;
  }, [applyScreenData, closetId, reloadWearWeek]);

  const refreshFromNetwork = useCallback(async () => {
    try {
      const cached = await fetchAndCacheWardrobe({ closet_id: closetId });
      const next = await loadWardrobeScreenData(cached.closetId);
      await applyScreenData(next);
      // 走 wear/week（含上周对比）；bootstrap.wear_week 仅作兜底缓存字段
      await reloadWearWeek(cached.closetId);
    } catch (e) {
      if (__DEV__) console.warn('[wardrobe-screen] refresh failed', e);
      await reloadLocal();
    }
  }, [applyScreenData, closetId, reloadLocal, reloadWearWeek]);

  const { refreshing, onRefresh } = usePullToRefresh(refreshFromNetwork);
  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        colors={[w.pine]}
        tintColor={w.pine}
        progressBackgroundColor={w.card}
      />
    ),
    [onRefresh, refreshing, w.card, w.pine],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const local = await loadWardrobeScreenData();
        if (!cancelled) {
          await applyScreenData(local);
          await reloadWearWeek(local.closetId);
          setDataReady(true);
        }
        const cached = await fetchAndCacheWardrobe({ closet_id: local.closetId });
        if (cancelled) return;
        const next = await loadWardrobeScreenData(cached.closetId);
        await applyScreenData(next);
        await reloadWearWeek(cached.closetId);
      } catch (e) {
        if (__DEV__) console.warn('[wardrobe-screen] load failed', e);
        if (!cancelled) setDataReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyScreenData, reloadWearWeek]);

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
    setWearHistory28(null);
    setSheet({ kind: 'item', item });
    void fetchItemWearHistory28(id).then(setWearHistory28);
  };

  const openOutfit = (id: string) => {
    const outfit = outfitsRef.current.find((o) => o.id === id);
    if (!outfit) return;
    closePops();
    setSheet({ kind: 'outfit', outfit, items });
  };

  const sortedOutfits = useMemo(() => {
    const list = [...outfits];
    if (outfitSort === 'wear') return list.sort((a, b) => b.wear - a.wear);
    if (outfitSort === 'occasion') {
      return list.sort((a, b) => a.occasion.localeCompare(b.occasion, 'zh') || a.name.localeCompare(b.name, 'zh'));
    }
    return list;
  }, [outfitSort, outfits]);

  const openCreateItem = useCallback(
    async (
      categoryHint?: string | null,
      seeds?: { imageUri?: string; cutoutUri?: string },
    ) => {
      let cats = categoryMeta;
      if (!cats.length) {
        await fetchAndCacheWardrobe({ closet_id: closetId });
        const data = await reloadLocal();
        cats = await listLocalCategoryMeta(data.closetId);
        if (!cats.length) {
          toast.info('分类尚未同步，请检查网络后重试');
          return;
        }
      }
      const selectable = cats.filter((c) => !isUncategorizedCategory(c.name));
      let categoryId = selectable[0]?.id;
      if (categoryHint && !isUncategorizedCategory(categoryHint)) {
        categoryId =
          (await resolveCategoryIdByName(closetId, categoryHint)) ?? categoryId;
      }
      setEditor({
        type: 'item',
        mode: 'create',
        closetId,
        categoryId,
        categoryHint:
          categoryHint && !isUncategorizedCategory(categoryHint) ? categoryHint : undefined,
        categories: cats.map((c) => ({ id: c.id, name: c.name })),
        options: optionRows,
        seedImageUri: seeds?.imageUri,
        seedCutoutUri: seeds?.cutoutUri,
      });
    },
    [categoryMeta, closetId, optionRows, reloadLocal],
  );

  const openCreateOutfit = useCallback((opts?: { seedItemIds?: string[]; seedPhotoUri?: string }) => {
    setCollage({
      outfit: null,
      seedItemIds: opts?.seedItemIds,
      seedPhotoUri: opts?.seedPhotoUri,
    });
  }, []);

  const openEditOutfitCollage = useCallback(
    (id: string) => {
      const next = outfits.find((x) => x.id === id);
      if (!next) return;
      setCollage({ outfit: next });
    },
    [outfits],
  );

  const importItemFromImage = useCallback(
    async (source: WardrobeImageSource) => {
      const picked = await pickWardrobeLocalImage(source);
      if (!picked.ok) {
        if (picked.reason === 'permission') {
          toast.info(source === 'camera' ? '需要相机权限才能拍照' : '需要相册权限才能选图');
        }
        return;
      }
      beginApiLoading();
      try {
        const prepared = await prepareWardrobeImagesFromLocal(picked.uri);
        if (prepared.cutoutApplied) {
          toast.info('已完成抠图，请完善单品信息');
        } else {
          toast.info('已导入原图（当前环境暂不可用抠图）');
        }
        await openCreateItem(createHint, {
          imageUri: prepared.imageUri,
          cutoutUri: prepared.cutoutUri,
        });
      } catch (e) {
        toast.info(e instanceof Error ? e.message : '导入失败');
      } finally {
        endApiLoading();
      }
    },
    [createHint, openCreateItem],
  );

  /** 搭配页「拍照上传」：选图 → Vision 抠图 → 种子打开拼图编辑器 */
  const importOutfitFromImage = useCallback(
    async (source: WardrobeImageSource) => {
      const picked = await pickWardrobeLocalImage(source);
      if (!picked.ok) {
        if (picked.reason === 'permission') {
          toast.info(source === 'camera' ? '需要相机权限才能拍照' : '需要相册权限才能选图');
        }
        return;
      }
      beginApiLoading();
      try {
        const prepared = await prepareWardrobeImagesFromLocal(picked.uri);
        const seedPhotoUri = prepared.cutoutUri?.trim() || prepared.imageUri;
        if (prepared.cutoutApplied) {
          toast.info('已完成抠图，可继续搭配单品');
        } else {
          toast.info('已导入原图（当前环境暂不可用抠图）');
        }
        openCreateOutfit({ seedPhotoUri });
      } catch (e) {
        toast.info(e instanceof Error ? e.message : '导入失败');
      } finally {
        endApiLoading();
      }
    },
    [openCreateOutfit],
  );

  const promptOutfitPhotoUpload = useCallback(() => {
    Alert.alert('拍照上传', '选择照片来源，导入后将尝试抠图', [
      { text: '拍照', onPress: () => void importOutfitFromImage('camera') },
      { text: '从相册选择', onPress: () => void importOutfitFromImage('library') },
      { text: '取消', style: 'cancel' },
    ]);
  }, [importOutfitFromImage]);

  const onCreateSelect = useCallback(
    (label: string) => {
      if (label === '从单品组合') {
        openCreateOutfit();
        return;
      }
      if (label === '拍照上传') {
        promptOutfitPhotoUpload();
        return;
      }
      if (label === '新建衣橱') {
        setEditor({ type: 'closet', mode: 'create' });
        return;
      }
      if (label === '导入衣橱' || label === '邀请共用') {
        toast.info('该入口后续开放，请先用「新建衣橱」');
        return;
      }
      if (label === '拍照') {
        void importItemFromImage('camera');
        return;
      }
      if (label === '从相册导入') {
        void importItemFromImage('library');
        return;
      }
      void openCreateItem(createHint);
    },
    [createHint, importItemFromImage, openCreateItem, openCreateOutfit, promptOutfitPhotoUpload],
  );

  const openWearItemComment = useCallback(
    (id: string) => {
      const item = items.find((x) => x.id === id);
      if (!item) {
        toast.info('单品不存在');
        return;
      }
      setWearCommentTarget({ kind: 'item', id, name: item.name });
    },
    [items],
  );

  const openWearOutfitComment = useCallback(
    (id: string) => {
      const outfit = outfits.find((x) => x.id === id);
      if (!outfit) {
        toast.info('搭配不存在');
        return;
      }
      setWearCommentTarget({
        kind: 'outfit',
        id,
        name: outfit.name,
        occasion: outfit.occasion,
      });
    },
    [outfits],
  );

  const confirmWearWithNote = useCallback(
    async (payload: { note?: string }): Promise<boolean> => {
      const target = wearCommentTarget;
      if (!target) return false;
      if (target.kind === 'item') {
        const res = await recordWardrobeItemWear(target.id, { note: payload.note });
        if (!res.ok) {
          toast.info(res.error || '记录穿着失败');
          return false;
        }
        const nextData = await reloadLocal();
        const nextItem = nextData.items.find((x) => x.id === target.id) ?? res.item;
        const hist = await fetchItemWearHistory28(target.id);
        setWearHistory28(hist);
        setSheet((cur) => {
          if (cur?.kind === 'item' && cur.item.id === target.id && nextItem) {
            return { kind: 'item', item: nextItem };
          }
          return cur;
        });
        toast.info(res.created ? '已记录穿着' : '今日已记过这件');
        return true;
      }
      const res = await recordWardrobeOutfitWear(target.id, { note: payload.note });
      if (!res.ok) {
        toast.info(res.error || '记录穿搭失败');
        return false;
      }
      await reloadLocal();
      toast.info(res.created ? '已记录这套穿搭' : '今日已记过这套');
      return true;
    },
    [reloadLocal, wearCommentTarget],
  );

  const bodySummary = useMemo(() => {
    const pick = (v: unknown) => {
      if (v == null || v === '') return null;
      const n = Number(v);
      if (Number.isFinite(n)) return String(n);
      const s = String(v).trim();
      return s || null;
    };
    const height = pick(bodyProfile?.height_cm);
    const shoulder = pick(bodyProfile?.shoulder_cm);
    const waist = pick(bodyProfile?.waist_cm);
    const parts: string[] = [];
    if (height) parts.push(`身高 ${height}`);
    if (shoulder) parts.push(`肩宽 ${shoulder}`);
    if (waist) parts.push(`腰围 ${waist}`);
    return parts.length ? parts.join(' · ') : '尚未填写';
  }, [bodyProfile]);

  const establishedYear = useMemo(() => {
    const years = closetMeta
      .map((c) => {
        const raw = (c.created_at ?? '').trim();
        const y = Number(raw.slice(0, 4));
        return Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : null;
      })
      .filter((y): y is number => y != null);
    if (years.length) return Math.min(...years);
    return new Date().getFullYear();
  }, [closetMeta]);

  const ctxIcon = useMemo(() => {
    if (tab === 'closet') return <IconGrid size={16} color={w.ink2} />;
    if (tab === 'outfits') return <IconFilter size={16} color={w.ink2} />;
    return <IconGear size={16} color={w.ink2} />;
  }, [tab, w.ink2]);

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
    closePops();
    setSheet({
      kind: 'context',
      tab,
      sort,
      categories,
      itemCount: items.length,
      outfitCount: outfits.length,
    });
  };

  const plusRotate = fabRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] });

  const renderView = (which: WardrobeTab) => {
    // 切换动画期间离开层不挂 RefreshControl，避免同一 element 双挂载
    const rc = which === tab ? refreshControl : undefined;
    if (which === 'closet') {
      return (
        <ClosetView
          items={items}
          categories={categories}
          layout={layout}
          sort={sort}
          season={season}
          wearWeek={wearWeek}
          refreshControl={rc}
          onOpenItem={openItem}
          onManageCategories={() => setSheet({ kind: 'categories', categories })}
          onAddToCategory={(name) => {
            setCreateHint(name);
            setCreatePop(true);
            setLayoutPop(false);
          }}
          onCategoryMore={(name) => setSheet({ kind: 'category', name, categories })}
          onJumpMine={() => switchTab('mine')}
          onSuggestToday={() => {
            if (!items.length) {
              toast.info('请先添加几件单品');
              return;
            }
            setSuggestTodayOpen(true);
          }}
        />
      );
    }
    if (which === 'outfits') {
      return (
        <OutfitsView
          outfits={sortedOutfits}
          items={items}
          occasion={occasion}
          occasions={occasionNames}
          refreshControl={rc}
          onOccasion={setOccasion}
          onOpenOutfit={openOutfit}
          onSort={() => setSheet({ kind: 'generic', key: 'outfit-sort' })}
          onSuggestOutfit={() => {
            if (!items.length) {
              toast.info('请先添加几件单品');
              return;
            }
            setSuggestOutfitSeeds(undefined);
            setSuggestOutfitOpen(true);
          }}
        />
      );
    }
    return (
      <MineView
        items={items}
        outfits={outfits}
        categories={categories}
        season={season}
        closetCount={closetMeta.length || 1}
        closetName={closetMeta.find((c) => c.id === closetId)?.name ?? '我的衣橱'}
        establishedYear={establishedYear}
        bodySummary={bodySummary}
        optionCount={optionRows.length}
        wornThisMonth={wornThisMonth}
        sparkDayCounts={sparkDayCounts}
        refreshControl={rc}
        onSeason={setSeason}
        onOpenSheet={(key) => {
          if (key === 'sort') setSheet({ kind: 'sort', sort });
          else if (key === 'categories') setSheet({ kind: 'categories', categories });
          else setSheet({ kind: 'generic', key, season, categories, items, outfits });
        }}
        onIdleInsights={() => {
          if (!items.length) {
            toast.info('请先添加几件单品');
            return;
          }
          setIdleInsightsOpen(true);
        }}
      />
    );
  };

  if (!fontsReady || !dataReady) {
    return (
      <View
        style={[
          styles.root,
          styles.fontBoot,
          { paddingTop: insets.top, backgroundColor: w.screenMid },
        ]}>
        <ActivityIndicator color={w.pine} />
        <Text style={styles.fontBootText}>{!fontsReady ? '加载衣橱字体…' : '同步衣橱…'}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: w.screenMid }]}>
      <View style={styles.appbar}>
        <Pressable onPress={onBack} style={styles.iconBtn} accessibilityLabel="返回" hitSlop={6}>
          <IconBack size={16} color={w.ink2} />
        </Pressable>
        <Pressable onPress={onCtx} style={styles.iconBtn} accessibilityLabel="视图选项" hitSlop={6}>
          {ctxIcon}
        </Pressable>
        {/* 不接手势 + 裁剪溢出，避免宽字距副标题盖住左右按钮 */}
        <View style={styles.apptitle} pointerEvents="none">
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
            <IconSearch size={15} color={w.ink2} />
          </Pressable>
          <View style={styles.sep} />
          <Pressable
            onPress={() => {
              closePops();
              setSheet({ kind: 'context', tab, sort, categories });
            }}
            style={styles.actionBtn}
            accessibilityLabel="更多">
            <IconMore size={15} color={w.ink2} />
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
            <IconPlus size={21} color={w.onPine} />
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
              <Icon size={18} color={active ? w.onPine : w.muted} />
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
      <CreatePop
        visible={createPop}
        tab={tab}
        categoryHint={createHint}
        onClose={closePops}
        onSelect={onCreateSelect}
      />

      <WardrobeSheet
        content={sheet}
        occasions={occasionNames}
        closets={closetMeta.map((c) => ({
          ...c,
          item_count: c.id === closetId ? items.length : c.item_count,
        }))}
        optionRows={optionRows}
        bodyPairs={bodyPairs}
        aboutPairs={[
          ['单品', String(items.length)],
          ['搭配', String(outfits.length)],
          ['分类', String(categories.length)],
          ['数据', '云端同步'],
        ]}
        wearHistory28={wearHistory28}
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
        onWearItem={openWearItemComment}
        onWearOutfit={openWearOutfitComment}
        onOpenGeneric={(key) => {
          if (key === 'sort') setSheet({ kind: 'sort', sort });
          else if (key === 'categories') setSheet({ kind: 'categories', categories });
          else setSheet({ kind: 'generic', key, season, categories, items, outfits });
        }}
        onCategoryAction={(action, name) => {
          if (action === 'open' && name) setSheet({ kind: 'category', name, categories });
          else if (action === 'add' && name) {
            setSheet(null);
            void openCreateItem(name);
          }
        }}
        onCreateItem={(hint) => void openCreateItem(hint)}
        onEditItem={(id) => {
          const item = items.find((x) => x.id === id);
          if (!item) return;
          const categoryId =
            categoryMeta.find((c) => c.name === item.category)?.id ?? categoryMeta[0]?.id;
          setEditor({
            type: 'item',
            mode: 'edit',
            closetId,
            categoryId,
            categories: categoryMeta,
            options: optionRows,
            item: { ...item, category_id: categoryId },
          });
        }}
        onDeleteItem={(id) => {
          const item = items.find((x) => x.id === id);
          if (!item) return;
          setEditor({ type: 'confirm-delete', target: 'item', id, label: item.name });
        }}
        onCreateOutfit={(seed) => openCreateOutfit(seed?.length ? { seedItemIds: seed } : undefined)}
        onSuggestOutfitFromItem={(itemId) => {
          setSuggestOutfitSeeds([itemId]);
          setSuggestOutfitOpen(true);
        }}
        onFindSimilarItem={(itemId) => {
          if (items.length < 2) {
            toast.info('衣橱里再多几件单品再找相似');
            return;
          }
          setSimilarTargetId(itemId);
        }}
        onIdleInsights={() => {
          if (!items.length) {
            toast.info('请先添加几件单品');
            return;
          }
          setIdleInsightsOpen(true);
        }}
        onEditOutfit={(id) => openEditOutfitCollage(id)}
        onDeleteOutfit={(id) => {
          const outfit = outfits.find((x) => x.id === id);
          if (!outfit) return;
          setEditor({ type: 'confirm-delete', target: 'outfit', id, label: outfit.name });
        }}
        onCreateCategory={() => setEditor({ type: 'category', mode: 'create', closetId })}
        onRenameCategory={(name) => {
          if (isUncategorizedCategory(name)) {
            toast.info('「未分类」不可编辑');
            return;
          }
          const cat = categoryMeta.find((c) => c.name === name);
          if (!cat) return;
          setEditor({
            type: 'category',
            mode: 'rename',
            closetId,
            categoryId: cat.id,
            name,
          });
        }}
        onDeleteCategory={(name) => {
          if (isUncategorizedCategory(name)) {
            toast.info('「未分类」不可编辑');
            return;
          }
          const cat = categoryMeta.find((c) => c.name === name);
          if (!cat) return;
          setEditor({ type: 'confirm-delete', target: 'category', id: cat.id, label: name });
        }}
        onCreateOccasion={() => setEditor({ type: 'occasion', mode: 'create' })}
        onDeleteOccasion={(name) => {
          const occ = occasionMeta.find((o) => o.name === name);
          if (!occ) return;
          setEditor({ type: 'confirm-delete', target: 'occasion', id: occ.id, label: name });
        }}
        onCreateCloset={() => setEditor({ type: 'closet', mode: 'create' })}
        onSelectCloset={(id) => {
          void (async () => {
            const res = await switchDefaultCloset(id);
            if (!res.ok) {
              toast.info(res.error || '切换失败');
              return;
            }
            await fetchAndCacheWardrobe({ closet_id: id });
            const next = await loadWardrobeScreenData(id);
            await applyScreenData(next);
            toast.info('已切换默认衣橱');
            setSheet(null);
          })();
        }}
        onDeleteCloset={(id) => {
          const c = closetMeta.find((x) => x.id === id);
          if (!c) return;
          setEditor({ type: 'confirm-delete', target: 'closet', id, label: c.name });
        }}
        onCreateOption={(kind) => setEditor({ type: 'option', kind, closetId })}
        onDeleteOption={(id, label) =>
          setEditor({ type: 'confirm-delete', target: 'option', id, label })
        }
        onEditBody={() =>
          setEditor({
            type: 'body',
            closetId,
            profile: {
              closet_id: closetId,
              height_cm: bodyProfile?.height_cm as number | null | undefined,
              weight_kg: bodyProfile?.weight_kg as number | null | undefined,
              shoulder_cm: bodyProfile?.shoulder_cm as number | null | undefined,
              bust_cm: bodyProfile?.bust_cm as number | null | undefined,
              waist_cm: bodyProfile?.waist_cm as number | null | undefined,
              hip_cm: bodyProfile?.hip_cm as number | null | undefined,
              inseam_cm: bodyProfile?.inseam_cm as number | null | undefined,
              foot_mm: bodyProfile?.foot_mm as number | null | undefined,
              size_top: (bodyProfile?.size_top as string | null | undefined) ?? null,
              size_bottom: (bodyProfile?.size_bottom as string | null | undefined) ?? null,
              size_shoe: (bodyProfile?.size_shoe as string | null | undefined) ?? null,
            },
          })
        }
        onOutfitSort={(mode) => {
          setOutfitSort(mode);
          toast.info(
            mode === 'wear' ? '按穿着次数排序' : mode === 'occasion' ? '按场合排序' : '按最近更新排序',
          );
        }}
      />

      <WardrobeEditorHost
        editor={editor}
        onClose={() => setEditor(null)}
        onSaved={async () => {
          await reloadLocal();
        }}
      />

      <CollageEditor
        visible={Boolean(collage)}
        closetId={closetId}
        items={items}
        occasions={occasionMeta}
        outfit={collage?.outfit ?? null}
        seedItemIds={collage?.seedItemIds}
        seedPhotoUri={collage?.seedPhotoUri}
        onClose={(opts) => {
          const reopenId = opts?.reopenOutfitId;
          const wasCreate = !collage?.outfit;
          setCollage(null);
          if (!reopenId) return;
          void (async () => {
            const data = await reloadLocal();
            if (wasCreate && tabRef.current !== 'outfits') switchTab('outfits');
            const next = data.outfits.find((o) => o.id === reopenId);
            if (!next) return;
            setTimeout(() => {
              setSheet({ kind: 'outfit', outfit: next, items: data.items });
            }, 280);
          })();
        }}
        onSaved={async () => {
          /* 关闭时统一 reload，避免与 reopen 竞态 */
        }}
      />

      <SearchOverlay
        visible={searchOpen}
        items={items}
        onClose={() => setSearchOpen(false)}
        onOpenItem={openItem}
      />

      <AiSuggestTodaySheet
        visible={suggestTodayOpen}
        onClose={() => setSuggestTodayOpen(false)}
        items={items}
        outfits={outfits}
        seasonFilter={season}
        onOpenOutfit={openOutfit}
        onOpenItem={openItem}
        onWearOutfit={(id) => {
          setSuggestTodayOpen(false);
          openWearOutfitComment(id);
        }}
        onWearItems={(ids) => {
          void (async () => {
            let created = 0;
            for (const id of ids) {
              const res = await recordWardrobeItemWear(id);
              if (res.ok && res.created) created += 1;
            }
            await reloadLocal();
            toast.info(created > 0 ? `已记录 ${created} 件穿着` : '今日已记过这些');
          })();
        }}
        onSeedCollage={(seedItemIds) => openCreateOutfit({ seedItemIds })}
      />

      <AiSuggestOutfitSheet
        visible={suggestOutfitOpen}
        onClose={() => {
          setSuggestOutfitOpen(false);
          setSuggestOutfitSeeds(undefined);
        }}
        items={items}
        outfits={outfits}
        occasion={occasion}
        seasonFilter={season}
        seedItemIds={suggestOutfitSeeds}
        onOpenOutfit={openOutfit}
        onOpenCollage={(seedItemIds) => openCreateOutfit({ seedItemIds })}
      />

      <AiIdleInsightsSheet
        visible={idleInsightsOpen}
        onClose={() => setIdleInsightsOpen(false)}
        items={items}
        categoryNames={categories.map((c) => c.name)}
        wornThisMonth={wornThisMonth}
        onOpenItem={openItem}
      />

      <AiWearCommentSheet
        visible={!!wearCommentTarget}
        target={wearCommentTarget}
        onClose={() => setWearCommentTarget(null)}
        onConfirm={confirmWearWithNote}
      />

      <AiSimilarItemsSheet
        visible={!!similarTargetId}
        onClose={() => setSimilarTargetId(null)}
        items={items}
        targetItemId={similarTargetId}
        onOpenItem={openItem}
      />
    </View>
  );
}

function createStyles(w: WardrobePalette) {
  return StyleSheet.create({
  root: { flex: 1 },
  fontBoot: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  fontBootText: {
    ...wardrobeType.appSub,
    color: w.muted,
  },
  appbar: {
    height: 56,
    paddingHorizontal: 18,
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
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glass,
  },
  apptitle: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  title: {
    ...wardrobeType.appTitle,
    color: w.pine,
    textAlign: 'center',
  },
  titleSwap: { opacity: 0, transform: [{ translateY: 5 }] },
  sub: {
    ...wardrobeType.appSub,
    color: w.muted,
    marginTop: 3,
    textAlign: 'center',
  },
  appActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    padding: 3,
    borderRadius: 999,
    backgroundColor: w.glass,
    borderWidth: 1,
    borderColor: w.line,
  },
  actionBtn: {
    width: 29,
    height: 29,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sep: { width: 1, height: 13, backgroundColor: w.line },
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
    backgroundColor: w.pineSolid,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: w.shadow,
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
    backgroundColor: w.amber,
    borderWidth: 2,
    borderColor: w.paper,
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
    borderColor: w.glassBorder,
    backgroundColor: w.glassStrong,
    shadowColor: w.shadow,
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
    backgroundColor: w.pineSolid,
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
    color: w.muted,
  },
  dockLabelActive: { color: w.onPine },
  });
}
