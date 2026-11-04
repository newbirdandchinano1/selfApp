/**
 * 拼图编辑器：对齐 `衣橱-UI重构-拼图版.html` collage-editor 的 UI / 动画 / 交互。
 */
import { CollageArtboardBg } from '@/components/wardrobe/collage-artboard-bg';
import {
  COLLAGE_PATTERNS,
  COLLAGE_RATIOS,
  COLLAGE_RATIO_NAMES,
  COLLAGE_SEASONS,
  COLLAGE_STICKER_CATALOG,
  COLLAGE_SWATCHES,
  COLLAGE_TONES,
  clampPct,
  collageUid,
  fitArtboardSize,
  defaultCollagePhoto,
  hydrateCollageRuntime,
  serializeCollageExtra,
  type CollageBgSub,
  type CollageCaption,
  type CollagePiece,
  type CollagePhoto,
  type CollagePhotoKind,
  type CollageRatio,
  type CollageSticker,
  type CollageStickerType,
  type CollageTool,
} from '@/components/wardrobe/collage-model';
import type { WardrobeItem, WardrobeOutfit } from '@/components/wardrobe/data';
import { WardrobeGarment, wardrobeItemHasCutout } from '@/components/wardrobe/garments';
import { StoredImage } from '@/components/stored-image';
import { toast } from '@/lib/app-feedback/toast-events';
import { toUserMessage } from '@/lib/app-feedback/to-user-message';
import {
  bindWardrobeCollagePhoto,
  pickWardrobeLocalImage,
  prepareWardrobeImagesFromLocal,
  uploadWardrobeCollagePhoto,
  type WardrobeImageSource,
} from '@/lib/wardrobe-images';
import {
  createWardrobeOutfit,
  updateWardrobeOutfit,
} from '@/lib/repositories/wardrobe/wardrobe-writes';
import { wardrobeEm, wardrobeFonts } from '@/constants/wardrobe-theme';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const SPRING = Easing.bezier(0.34, 1.56, 0.64, 1);
const CE = {
  ink: '#F6F1E5',
  muted: 'rgba(246,241,229,0.5)',
  line: 'rgba(246,241,229,0.11)',
  gold: '#E6BC7A',
} as const;

export type CollageEditorProps = {
  visible: boolean;
  closetId: string;
  items: WardrobeItem[];
  occasions: { id: string; name: string }[];
  outfit: WardrobeOutfit | null;
  seedItemIds?: string[];
  /** 新建时种子照片（本地 URI，优先抠图结果） */
  seedPhotoUri?: string;
  onClose: (opts?: { reopenOutfitId?: string }) => void;
  onSaved: (outfitId: string) => void | Promise<void>;
};

type DragKey = 'photo' | 'caption' | `item:${string}` | `sticker:${string}`;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function PhotoSvg({ kind, w, h }: { kind: 'portrait' | 'detail'; w: number; h: number }) {
  if (kind === 'detail') {
    return (
      <Svg width={w} height={h} viewBox="0 0 180 225">
        <Defs>
          <LinearGradient id="fab" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#EBE1CF" />
            <Stop offset="0.52" stopColor="#C5AD8C" />
            <Stop offset="1" stopColor="#8E7659" />
          </LinearGradient>
        </Defs>
        <Rect width={180} height={225} fill="url(#fab)" />
        <Path
          d="M-18 24c35 18 42 56 82 60s52-29 91-13"
          fill="none"
          stroke="#F6EFE2"
          strokeWidth={11}
          opacity={0.32}
        />
        <SvgText x={14} y={209} fill="#FFF8E8" opacity={0.68} fontSize={5} fontFamily="monospace">
          FABRIC STUDY / 02
        </SvgText>
      </Svg>
    );
  }
  return (
    <Svg width={w} height={h} viewBox="0 0 180 225">
      <Defs>
        <LinearGradient id="room" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#EFE5D5" />
          <Stop offset="0.55" stopColor="#D9CBB8" />
          <Stop offset="1" stopColor="#BFAD94" />
        </LinearGradient>
        <LinearGradient id="shirt" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#345C4C" />
          <Stop offset="1" stopColor="#1F3B31" />
        </LinearGradient>
      </Defs>
      <Rect width={180} height={225} fill="url(#room)" />
      <Circle cx={36} cy={41} r={31} fill="#F5E4C7" opacity={0.55} />
      <Path d="M0 168 180 145v80H0Z" fill="#CDBEA5" />
      <Path d="M44 225c0-54 19-78 46-78s46 24 46 78Z" fill="url(#shirt)" />
      <Path d="M77 126h26v23c0 11-26 11-26 0Z" fill="#D8A98B" />
      <Ellipse cx={90} cy={101} rx={29} ry={35} fill="#E6BCA0" />
      <Path
        d="M60 96c-2-35 16-53 31-53 22 0 37 20 31 55-6-13-16-20-31-20-13 0-24 6-31 18Z"
        fill="#2C2725"
      />
      <SvgText x={13} y={209} fill="#FFF8E8" opacity={0.72} fontSize={5} fontFamily="monospace">
        OOTD · NOV 02
      </SvgText>
    </Svg>
  );
}

function StickerVisual({ type, preview }: { type: CollageStickerType; preview?: boolean }) {
  const scale = preview ? 0.72 : 1;
  if (type === 'tape') {
    return (
      <View
        style={{
          width: 58 * scale,
          height: 18 * scale,
          backgroundColor: 'rgba(255,245,215,0.66)',
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: 'rgba(118,96,62,0.24)',
          borderStyle: 'dashed',
        }}
      />
    );
  }
  if (type === 'stamp') {
    return (
      <View
        style={{
          width: 52 * scale,
          height: 52 * scale,
          borderRadius: 26 * scale,
          borderWidth: 1,
          borderColor: 'rgba(35,58,47,0.38)',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(255,250,239,0.24)',
        }}>
        <Text
          style={{
            fontFamily: wardrobeFonts.mono,
            fontSize: 5 * scale,
            letterSpacing: 0.6,
            color: '#2D4A3E',
            textAlign: 'center',
            lineHeight: 7.5 * scale,
          }}>
          {'ATELIER\nLOOK 01'}
        </Text>
      </View>
    );
  }
  if (type === 'label') {
    return (
      <View
        style={{
          paddingHorizontal: 7 * scale,
          paddingVertical: 4 * scale,
          backgroundColor: '#F1E2C5',
          borderWidth: 1,
          borderColor: 'rgba(112,92,62,0.16)',
        }}>
        <Text
          style={{
            fontFamily: wardrobeFonts.mono,
            fontSize: 5 * scale,
            letterSpacing: 0.5,
            color: '#4E493B',
          }}>
          NOV · 02
        </Text>
      </View>
    );
  }
  if (type === 'heart') {
    return (
      <Svg width={27 * scale} height={27 * scale} viewBox="0 0 24 24">
        <Path
          d="M20.5 8.8c0 4.2-8.5 10-8.5 10s-8.5-5.8-8.5-10A4.3 4.3 0 0 1 12 6.5a4.3 4.3 0 0 1 8.5 2.3Z"
          fill="#B96664"
        />
      </Svg>
    );
  }
  if (type === 'asterisk') {
    return (
      <Svg width={30 * scale} height={30 * scale} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M8.5 4.5l7 15M8.5 19.5l7-15"
          stroke="#C88B43"
          strokeWidth={1.25}
          strokeLinecap="round"
        />
      </Svg>
    );
  }
  return (
    <Svg width={30 * scale} height={30 * scale} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.5 13.7 8l4.6 1.8-4.6 1.8-1.7 4.7-1.8-4.7-4.7-1.8L10.2 8 12 3.5Z"
        stroke="#C88B43"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m18.5 16.5.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"
        stroke="#C88B43"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function clampScale(n: number, min = 0.35, max = 2.8) {
  return Math.min(max, Math.max(min, n));
}

type DragLayerProps = {
  dragKey: DragKey;
  x: number;
  y: number;
  rot: number;
  scale?: number;
  selected: boolean;
  boardW: number;
  boardH: number;
  onSelect: (key: DragKey | null) => void;
  onMove: (key: DragKey, x: number, y: number) => void;
  onScale?: (key: DragKey, scale: number) => void;
  onRemove: (key: DragKey) => void;
  style?: object;
  children: React.ReactNode;
  zIndex?: number;
  /** 抠图纯净层：去掉纸色底与重阴影，避免看起来像「还有背景」 */
  pure?: boolean;
};

function DraggableLayer({
  dragKey,
  x,
  y,
  rot,
  scale = 1,
  selected,
  boardW,
  boardH,
  onSelect,
  onMove,
  onScale,
  onRemove,
  style,
  children,
  zIndex = 3,
  pure = false,
}: DragLayerProps) {
  const start = useRef({ x: 0, y: 0, scale: 1 });
  const sizeRef = useRef({ w: 80, h: 100 });
  const [size, setSize] = useState({ w: 80, h: 100 });
  // 拖动 / 缩放中每帧都会变；用 ref 固定手势，避免重建打断双指。
  const posRef = useRef({ x, y });
  posRef.current = { x, y };
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const boardRef = useRef({ w: boardW, h: boardH });
  boardRef.current = { w: boardW, h: boardH };
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .minPointers(1)
      .maxPointers(1)
      .onBegin(() => {
        onSelectRef.current(dragKey);
        start.current = { x: posRef.current.x, y: posRef.current.y, scale: scaleRef.current };
      })
      .onUpdate((e) => {
        const { w, h } = boardRef.current;
        if (!w || !h) return;
        onMoveRef.current(
          dragKey,
          clampPct(start.current.x + (e.translationX / w) * 100),
          clampPct(start.current.y + (e.translationY / h) * 100),
        );
      });

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        onSelectRef.current(dragKey);
        start.current.scale = scaleRef.current;
      })
      .onUpdate((e) => {
        if (!onScaleRef.current) return;
        onScaleRef.current(dragKey, clampScale(start.current.scale * e.scale));
      });

    return Gesture.Simultaneous(pan, pinch);
  }, [dragKey]);

  const cx = (x / 100) * boardW;
  const cy = (y / 100) * boardH;

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) {
            sizeRef.current = { w: width, h: height };
            setSize({ w: width, h: height });
          }
        }}
        style={[
          {
            position: 'absolute',
            left: cx - size.w / 2,
            top: cy - size.h / 2,
            transform: [{ rotate: `${rot}deg` }, { scale }],
            zIndex: selected ? 15 : zIndex,
            shadowColor: pure ? 'transparent' : '#000',
            shadowOpacity: pure ? 0 : selected ? 0.31 : 0.22,
            shadowRadius: pure ? 0 : selected ? 16 : 11,
            shadowOffset: { width: 0, height: pure ? 0 : selected ? 15 : 10 },
            elevation: pure ? 0 : selected ? 12 : 6,
          },
          selected
            ? {
                borderWidth: pure ? 1 : 1.5,
                borderColor: CE.gold,
                borderStyle: pure ? 'dashed' : 'solid',
                shadowColor: pure ? 'transparent' : CE.gold,
              }
            : null,
          style,
        ]}>
        {selected ? (
          <Pressable
            onPress={() => onRemove(dragKey)}
            hitSlop={8}
            style={styles.deleteBtn}
            accessibilityLabel="移除">
            <Svg width={8} height={8} viewBox="0 0 24 24">
              <Path d="M6 6l12 12M18 6L6 18" stroke="#FFF7E8" strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
          </Pressable>
        ) : null}
        {children}
      </View>
    </GestureDetector>
  );
}

export function CollageEditor({
  visible,
  closetId,
  items,
  occasions,
  outfit,
  seedItemIds,
  seedPhotoUri,
  onClose,
  onSaved,
}: CollageEditorProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const enterOp = useRef(new Animated.Value(0)).current;
  const enterY = useRef(new Animated.Value(26)).current;
  const trayH = useRef(new Animated.Value(0)).current;
  const saveOp = useRef(new Animated.Value(0)).current;
  const saveY = useRef(new Animated.Value(36)).current;
  const shineX = useRef(new Animated.Value(-20)).current;

  const [ratio, setRatio] = useState<CollageRatio>('1:1');
  const [bg, setBg] = useState('stripeBlue');
  const [photo, setPhoto] = useState<CollagePhoto>(() => hydrateCollageRuntime(null, []).photo);
  const [caption, setCaption] = useState<CollageCaption>(() => hydrateCollageRuntime(null, []).caption);
  const [pieces, setPieces] = useState<CollagePiece[]>([]);
  const [stickers, setStickers] = useState<CollageSticker[]>([]);
  const [selected, setSelected] = useState<DragKey | null>(null);
  const [tool, setTool] = useState<CollageTool>('');
  const [sub, setSub] = useState<CollageBgSub>('bg');
  const [trayOpen, setTrayOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  /** 打开保存 Sheet 后延迟武装遮罩，避免「完成」同一次触摸穿透立刻关掉 */
  const [saveBackdropArmed, setSaveBackdropArmed] = useState(false);
  const [editorTip, setEditorTip] = useState<string | null>(null);
  const editorTipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [boardBox, setBoardBox] = useState({ w: 318, h: 318 });
  const [wrapSize, setWrapSize] = useState({ w: 360, h: 400 });
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [tagsText, setTagsText] = useState('通勤, 温柔, 针织');
  const [occasionId, setOccasionId] = useState('');
  const [seasons, setSeasons] = useState<string[]>(['秋']);
  const boardSizeRef = useRef(boardBox);
  boardSizeRef.current = boardBox;

  const itemById = useCallback(
    (id: string) => items.find((it) => it.id === id),
    [items],
  );

  const resetFromProps = useCallback(() => {
    const runtime = hydrateCollageRuntime(
      outfit?.collage ?? null,
      outfit?.items?.length ? outfit.items : seedItemIds ?? [],
      outfit?.name,
    );
    const seedUri = seedPhotoUri?.trim() || '';
    const photoSeeded =
      !outfit && seedUri
        ? defaultCollagePhoto('custom', seedUri)
        : runtime.photo;
    setRatio(runtime.ratio);
    setBg(runtime.bg);
    setPhoto(photoSeeded);
    setCaption(runtime.caption);
    setPieces(runtime.items);
    setStickers(runtime.stickers);
    setSelected(photoSeeded.kind === 'custom' ? 'photo' : null);
    setTool('');
    setSub('bg');
    setTrayOpen(false);
    setSaveOpen(false);
    setName(outfit?.name ?? '');
    setNote(outfit?.note || '记录今天的配色与层次，留一点松弛感。');
    setTagsText((runtime.tags ?? ['通勤', '温柔', '针织']).join(', '));
    setSeasons(runtime.seasons?.length ? runtime.seasons : ['秋']);
    const occ =
      occasions.find((o) => o.name === outfit?.occasion)?.id ?? occasions[0]?.id ?? '';
    setOccasionId(occ);
  }, [occasions, outfit, seedItemIds, seedPhotoUri]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      resetFromProps();
      enterOp.setValue(0);
      enterY.setValue(26);
      Animated.parallel([
        Animated.timing(enterOp, { toValue: 1, duration: 380, easing: EASE, useNativeDriver: true }),
        Animated.timing(enterY, { toValue: 0, duration: 620, easing: EASE, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(enterOp, { toValue: 0, duration: 320, easing: EASE, useNativeDriver: true }),
        Animated.timing(enterY, { toValue: 26, duration: 420, easing: EASE, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Animated.timing(trayH, {
      toValue: trayOpen ? 1 : 0,
      duration: trayOpen ? 500 : 360,
      easing: EASE,
      useNativeDriver: false,
    }).start();
  }, [trayH, trayOpen]);

  const showEditorTip = useCallback((message: string) => {
    if (editorTipTimer.current) clearTimeout(editorTipTimer.current);
    setEditorTip(message);
    editorTipTimer.current = setTimeout(() => {
      editorTipTimer.current = null;
      setEditorTip(null);
    }, 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (editorTipTimer.current) clearTimeout(editorTipTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!saveOpen) {
      setSaveBackdropArmed(false);
      return;
    }
    setSaveBackdropArmed(false);
    saveOp.setValue(0);
    saveY.setValue(36);
    Animated.parallel([
      Animated.timing(saveOp, { toValue: 1, duration: 320, easing: EASE, useNativeDriver: true }),
      Animated.timing(saveY, { toValue: 0, duration: 550, easing: SPRING, useNativeDriver: true }),
    ]).start();
    const arm = setTimeout(() => setSaveBackdropArmed(true), 360);
    return () => clearTimeout(arm);
  }, [saveOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(3100),
        Animated.timing(shineX, { toValue: 240, duration: 900, easing: EASE, useNativeDriver: true }),
        Animated.timing(shineX, { toValue: -20, duration: 0, useNativeDriver: true }),
        Animated.delay(1400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shineX]);

  useEffect(() => {
    const next = fitArtboardSize(wrapSize.w, wrapSize.h, ratio);
    setBoardBox({ w: next.width, h: next.height });
  }, [ratio, wrapSize.h, wrapSize.w]);

  const onWrapLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setWrapSize({ w: width, h: height });
  };

  const openTray = (next: CollageTool, nextSub?: CollageBgSub, force = false) => {
    const subVal = next === 'background' ? nextSub || 'bg' : 'bg';
    if (!force && trayOpen && tool === next && (!nextSub || sub === subVal)) {
      setTrayOpen(false);
      setTool('');
      return;
    }
    setTool(next);
    setSub(subVal);
    setTrayOpen(true);
  };

  const closeTray = () => {
    setTrayOpen(false);
    setTool('');
    setSub('bg');
  };

  const onMove = useCallback((key: DragKey, nx: number, ny: number) => {
    if (key === 'photo') setPhoto((p) => ({ ...p, x: nx, y: ny }));
    else if (key === 'caption') setCaption((c) => ({ ...c, x: nx, y: ny }));
    else if (key.startsWith('item:')) {
      const uid = key.slice(5);
      setPieces((list) => list.map((p) => (p.uid === uid ? { ...p, x: nx, y: ny } : p)));
    } else if (key.startsWith('sticker:')) {
      const uid = key.slice(8);
      setStickers((list) => list.map((s) => (s.uid === uid ? { ...s, x: nx, y: ny } : s)));
    }
  }, []);

  const onScale = useCallback((key: DragKey, next: number) => {
    const scale = clampScale(next);
    if (key === 'photo') setPhoto((p) => ({ ...p, scale }));
    else if (key.startsWith('item:')) {
      const uid = key.slice(5);
      setPieces((list) => list.map((p) => (p.uid === uid ? { ...p, scale } : p)));
    }
  }, []);

  const onRemove = useCallback((key: DragKey) => {
    if (key === 'photo') setPhoto(defaultCollagePhoto('none'));
    else if (key === 'caption') setCaption((c) => ({ ...c, text: '' }));
    else if (key.startsWith('item:')) {
      const uid = key.slice(5);
      setPieces((list) => list.filter((p) => p.uid !== uid));
    } else if (key.startsWith('sticker:')) {
      const uid = key.slice(8);
      setStickers((list) => list.filter((s) => s.uid !== uid));
    }
    setSelected(null);
  }, []);

  const clearPhoto = useCallback(() => {
    setPhoto(defaultCollagePhoto('none'));
    setSelected(null);
  }, []);

  const applyPhotoFromSource = useCallback(
    async (source: WardrobeImageSource) => {
      if (photoBusy) return;
      setPhotoBusy(true);
      try {
        const picked = await pickWardrobeLocalImage(source);
        if (!picked.ok) {
          if (picked.reason === 'permission') {
            toast.info(source === 'camera' ? '需要相机权限才能拍照' : '需要相册权限才能选图');
          }
          return;
        }
        const prepared = await prepareWardrobeImagesFromLocal(picked.uri);
        const uri = prepared.cutoutUri?.trim() || prepared.imageUri;
        setPhoto((prev) => ({
          ...defaultCollagePhoto('custom', uri),
          x: prev.kind === 'none' ? 70 : prev.x,
          y: prev.kind === 'none' ? 32 : prev.y,
          rot: prev.kind === 'none' ? 2 : prev.rot,
          scale: prev.kind === 'none' ? 1 : prev.scale,
        }));
        setSelected('photo');
        if (prepared.cutoutApplied) {
          toast.info('已完成抠图，可拖动或双指缩放');
        } else {
          toast.info('已加入原图（当前环境暂不可用抠图）');
        }
      } catch (e) {
        toast.error(toUserMessage(e, '导入照片失败'));
      } finally {
        setPhotoBusy(false);
      }
    },
    [photoBusy],
  );

  const promptPhotoSource = useCallback(() => {
    Alert.alert('导入照片', undefined, [
      { text: '拍照', onPress: () => void applyPhotoFromSource('camera') },
      { text: '从相册选择', onPress: () => void applyPhotoFromSource('library') },
      { text: '取消', style: 'cancel' },
    ]);
  }, [applyPhotoFromSource]);

  const handleDone = () => {
    if (!pieces.length) {
      // Modal 盖住根级 Toast，提示改在编辑器内展示
      showEditorTip('请先加入至少一件单品');
      openTray('items', undefined, true);
      return;
    }
    closeTray();
    setSaveOpen(true);
  };

  const handleClose = () => {
    setSaveOpen(false);
    closeTray();
    onClose(outfit ? { reopenOutfitId: outfit.id } : undefined);
  };

  const toggleSeason = (value: string) => {
    if (value === '四季') {
      setSeasons(['四季']);
      return;
    }
    setSeasons((prev) => {
      let next = prev.filter((s) => s !== '四季');
      if (next.includes(value)) next = next.filter((s) => s !== value);
      else next = [...next, value];
      return next.length ? next : [value];
    });
  };

  const submit = async () => {
    if (busy) return;
    if (!pieces.length) {
      toast.info('请先加入至少一件单品');
      return;
    }
    const itemIds = [...new Set(pieces.map((p) => p.id))];
    const tags = tagsText
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const saveName = name.trim() || '未命名搭配';
    const saveNote = note.trim() || '在拼图里保存的一套新搭配。';
    setBusy(true);
    try {
      let photoToSave = photo;
      if (photo.kind === 'custom' && photo.uri?.trim()) {
        const remoteUri = await uploadWardrobeCollagePhoto({
          localUri: photo.uri,
          outfitId: outfit?.id,
        });
        photoToSave = { ...photo, kind: 'custom', uri: remoteUri };
        setPhoto(photoToSave);
      } else if (photo.kind === 'custom') {
        photoToSave = defaultCollagePhoto('none');
      }

      const extra = serializeCollageExtra({
        ratio,
        bg,
        photo: photoToSave,
        caption,
        items: pieces,
        stickers,
        seasons,
        tags,
      });

      const res = outfit
        ? await updateWardrobeOutfit(outfit.id, {
            name: saveName,
            note: saveNote,
            occasion_id: occasionId || null,
            item_ids: itemIds,
            extra_data: extra,
          })
        : await createWardrobeOutfit({
            closet_id: closetId,
            name: saveName,
            note: saveNote,
            occasion_id: occasionId || null,
            item_ids: itemIds,
            extra_data: extra,
          });
      if (!res.ok) {
        toast.info(res.error || '保存失败');
        return;
      }
      const id = res.id || outfit?.id;
      if (!id) {
        toast.info('保存失败');
        return;
      }
      if (photoToSave.kind === 'custom' && photoToSave.uri) {
        await bindWardrobeCollagePhoto(id, photoToSave.uri);
      }
      toast.info(`搭配已保存：${saveName}`);
      setSaveOpen(false);
      await onSaved(id);
      onClose({ reopenOutfitId: id });
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败'));
    } finally {
      setBusy(false);
    }
  };

  const tone = COLLAGE_TONES[caption.tone] || COLLAGE_TONES[0];
  const subLabel = `COLLAGE · ${outfit?.name || 'NEW LOOK'}`;

  if (!mounted) return null;

  return (
    <Modal visible={mounted} animationType="none" transparent onRequestClose={handleClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.View
        style={[
          styles.root,
          {
            opacity: enterOp,
            transform: [{ translateY: enterY }, { scale: enterOp.interpolate({ inputRange: [0, 1], outputRange: [0.982, 1] }) }],
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}>
        <View style={styles.topbar}>
          <Pressable style={styles.closeBtn} onPress={handleClose} accessibilityLabel="关闭拼图">
            <Svg width={14} height={14} viewBox="0 0 24 24">
              <Path d="M6 6l12 12M18 6L6 18" stroke="rgba(246,241,229,0.86)" strokeWidth={1.5} strokeLinecap="round" />
            </Svg>
          </Pressable>
          <View style={styles.heading}>
            <Text style={styles.headingTitle}>拼图</Text>
            <Text style={styles.headingSub} numberOfLines={1}>
              {subLabel}
            </Text>
          </View>
          <Pressable style={styles.doneBtn} onPress={handleDone}>
            <Animated.View
              pointerEvents="none"
              style={[styles.doneShine, { transform: [{ translateX: shineX }] }]}
            />
            <Text style={styles.doneText}>完成</Text>
          </Pressable>
        </View>

        <View style={styles.canvasWrap} onLayout={onWrapLayout}>
          <View
            style={[
              styles.artboard,
              { width: boardBox.w, height: boardBox.h },
              selected ? styles.artboardHasSel : null,
            ]}
            onStartShouldSetResponder={() => true}
            onResponderTerminationRequest={() => true}
            onResponderRelease={() => setSelected(null)}>
            <CollageArtboardBg bg={bg} width={boardBox.w} height={boardBox.h} />
            <View pointerEvents="none" style={styles.cornerTL} />
            <View pointerEvents="none" style={styles.cornerTR} />
            <View pointerEvents="none" style={styles.cornerBR} />
            <View pointerEvents="none" style={styles.cornerBL} />
            <Text style={styles.railMark} pointerEvents="none">
              ATELIER · PERSONAL ARCHIVE · 0286
            </Text>
            <Pressable
              style={styles.ratioChip}
              onPress={() => openTray('background', 'ratio', true)}>
              <Text style={styles.ratioChipText}>{COLLAGE_RATIO_NAMES[ratio]}</Text>
              <Svg width={8} height={8} viewBox="0 0 24 24">
                <Path d="m7 10 5 5 5-5" stroke="#FFF8E9" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </Svg>
            </Pressable>
            {!selected ? (
              <View style={styles.boardTip} pointerEvents="none">
                <Text style={styles.boardTipText}>拖动 · 双指缩放 · 轻点选中</Text>
              </View>
            ) : null}

            {photo.kind !== 'none' ? (
              <DraggableLayer
                dragKey="photo"
                x={photo.x}
                y={photo.y}
                rot={photo.rot}
                scale={photo.scale}
                selected={selected === 'photo'}
                boardW={boardBox.w}
                boardH={boardBox.h}
                onSelect={setSelected}
                onMove={onMove}
                onScale={onScale}
                onRemove={onRemove}
                style={styles.photoCard}
                zIndex={4}>
                {(() => {
                  const pw = boardBox.w * 0.45 - 10;
                  const ph = pw * 1.25;
                  if (photo.kind === 'custom' && photo.uri) {
                    return (
                      <StoredImage
                        uri={photo.uri}
                        style={{ width: pw, height: ph, borderRadius: 3 }}
                        contentFit="cover"
                      />
                    );
                  }
                  if (photo.kind === 'portrait' || photo.kind === 'detail') {
                    return <PhotoSvg kind={photo.kind} w={pw} h={ph} />;
                  }
                  return null;
                })()}
                <View style={styles.pcCaption}>
                  <Text style={styles.pcCaptionB}>
                    {photo.kind === 'detail'
                      ? 'FABRIC / 02'
                      : photo.kind === 'custom'
                        ? 'PHOTO'
                        : 'PORTRAIT / 01'}
                  </Text>
                  <Text style={styles.pcCaptionS}>
                    {photo.kind === 'custom' ? 'IMPORT' : '11 / 02'}
                  </Text>
                </View>
              </DraggableLayer>
            ) : null}

            {pieces.map((piece, index) => {
              const item = itemById(piece.id);
              if (!item) return null;
              const key = `item:${piece.uid}` as DragKey;
              const isCutout = wardrobeItemHasCutout(item);
              return (
                <DraggableLayer
                  key={piece.uid}
                  dragKey={key}
                  x={piece.x}
                  y={piece.y}
                  rot={piece.rot}
                  scale={piece.scale}
                  selected={selected === key}
                  boardW={boardBox.w}
                  boardH={boardBox.h}
                  onSelect={setSelected}
                  onMove={onMove}
                  onScale={onScale}
                  onRemove={onRemove}
                  pure={isCutout}
                  style={isCutout ? styles.pieceCutout : styles.piece}
                  zIndex={5 + index}>
                  <View
                    style={[
                      styles.ciArt,
                      isCutout && styles.ciArtCutout,
                      {
                        backgroundColor: isCutout ? 'transparent' : item.tint,
                      },
                    ]}>
                    <WardrobeGarment
                      item={item}
                      width={isCutout ? 78 : 48}
                      height={isCutout ? 96 : 56}
                    />
                  </View>
                  {!isCutout ? (
                    <View style={styles.ciMeta}>
                      <Text style={styles.ciMetaB}>
                        {pad2(index + 1)} · {item.category}
                      </Text>
                      <Text style={styles.ciMetaS}>{item.fit}</Text>
                    </View>
                  ) : null}
                </DraggableLayer>
              );
            })}

            {caption.text ? (
              <DraggableLayer
                dragKey="caption"
                x={caption.x}
                y={caption.y}
                rot={caption.rot}
                selected={selected === 'caption'}
                boardW={boardBox.w}
                boardH={boardBox.h}
                onSelect={setSelected}
                onMove={onMove}
                onRemove={onRemove}
                style={[styles.caption, { backgroundColor: tone.bg[0] }]}
                zIndex={9}>
                <View style={{ borderLeftWidth: 2, borderLeftColor: CE.gold, paddingLeft: 8 }}>
                  <Text style={[styles.captionText, { color: tone.fg }]} numberOfLines={1}>
                    {caption.text}
                  </Text>
                  <Text style={[styles.captionSub, { color: tone.fg }]}>ATELIER · PERSONAL LOOK</Text>
                </View>
              </DraggableLayer>
            ) : null}

            {stickers.map((sticker) => {
              const key = `sticker:${sticker.uid}` as DragKey;
              return (
                <DraggableLayer
                  key={sticker.uid}
                  dragKey={key}
                  x={sticker.x}
                  y={sticker.y}
                  rot={sticker.rot}
                  selected={selected === key}
                  boardW={boardBox.w}
                  boardH={boardBox.h}
                  onSelect={setSelected}
                  onMove={onMove}
                  onRemove={onRemove}
                  zIndex={12}>
                  <StickerVisual type={sticker.type} />
                </DraggableLayer>
              );
            })}
          </View>
        </View>

        <Animated.View
          style={[
            styles.tray,
            {
              maxHeight: trayH.interpolate({ inputRange: [0, 1], outputRange: [0, 258] }),
              opacity: trayH,
            },
          ]}>
          {trayOpen && tool ? (
            <View style={styles.trayInner}>
              <View style={styles.trayHead}>
                <Text style={styles.trayTitle}>
                  {tool === 'background'
                    ? '画布'
                    : tool === 'items'
                      ? '从衣橱添加'
                      : tool === 'photo'
                        ? '照片'
                        : tool === 'text'
                          ? '文字'
                          : '素材'}
                </Text>
                {tool === 'background' ? (
                  <View style={styles.trayTabs}>
                    <Pressable
                      style={[styles.trayTab, sub === 'bg' && styles.trayTabOn]}
                      onPress={() => openTray('background', 'bg', true)}>
                      <Text style={[styles.trayTabText, sub === 'bg' && styles.trayTabTextOn]}>背景</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.trayTab, sub === 'ratio' && styles.trayTabOn]}
                      onPress={() => openTray('background', 'ratio', true)}>
                      <Text style={[styles.trayTabText, sub === 'ratio' && styles.trayTabTextOn]}>比例</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <Pressable style={styles.trayClose} onPress={closeTray}>
                  <Svg width={10} height={10} viewBox="0 0 24 24">
                    <Path d="m6 15 6-6 6 6" stroke="rgba(246,241,229,0.7)" strokeWidth={1.8} strokeLinecap="round" fill="none" />
                  </Svg>
                </Pressable>
              </View>

              {tool === 'background' && sub === 'bg' ? (
                <>
                  <Text style={styles.ctLabel}>SOLID COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowGap}>
                    {COLLAGE_SWATCHES.map((color) => {
                      const on = bg.toLowerCase() === color.toLowerCase();
                      return (
                        <Pressable
                          key={color}
                          onPress={() => setBg(color)}
                          style={[styles.swatch, { backgroundColor: color }, on && styles.swatchOn]}
                        />
                      );
                    })}
                  </ScrollView>
                  <Text style={styles.ctLabel}>PATTERN</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowGap}>
                    {COLLAGE_PATTERNS.map((p) => {
                      const on = bg === p.key;
                      return (
                        <Pressable
                          key={p.key}
                          onPress={() => setBg(p.key)}
                          style={[styles.pattern, on && styles.patternOn, { overflow: 'hidden' }]}>
                          <CollageArtboardBg bg={p.key} width={54} height={42} />
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              ) : null}

              {tool === 'background' && sub === 'ratio' ? (
                <>
                  <Text style={styles.ctLabel}>CANVAS RATIO</Text>
                  <View style={styles.ratioGrid}>
                    {COLLAGE_RATIOS.map((r) => {
                      const on = ratio === r;
                      const [rw, rh] = r.split(':').map(Number);
                      const boxW = rw >= rh ? 24 : Math.round(24 * (rw / rh));
                      const boxH = rh >= rw ? 24 : Math.round(24 * (rh / rw));
                      return (
                        <Pressable
                          key={r}
                          style={[styles.ratioCell, on && styles.ratioCellOn]}
                          onPress={() => setRatio(r)}>
                          <View
                            style={[
                              styles.ratioIcon,
                              { width: boxW, height: boxH },
                              on && styles.ratioIconOn,
                            ]}
                          />
                          <Text style={[styles.ratioLabel, on && styles.ratioLabelOn]}>
                            {COLLAGE_RATIO_NAMES[r]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              {tool === 'items' ? (
                <>
                  <Text style={styles.ctLabel}>WARDROBE · {items.length} ITEMS</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowGap}>
                    {items.map((item) => {
                      const existing = pieces.find((p) => p.id === item.id);
                      const on = Boolean(existing);
                      return (
                        <Pressable
                          key={item.id}
                          style={styles.ctItem}
                          onPress={() => {
                            if (existing) {
                              setSelected(`item:${existing.uid}`);
                              return;
                            }
                            const index = pieces.length;
                            const layout = {
                              x: 34 + (index % 3) * 16,
                              y: 32 + (index % 2) * 14,
                              rot: index % 2 ? 5 : -5,
                              scale: 0.8,
                            };
                            const fromLayout = [
                              { x: 29, y: 39, rot: -6, scale: 1.02 },
                              { x: 31, y: 75, rot: 4, scale: 0.84 },
                              { x: 70, y: 73, rot: -3, scale: 0.83 },
                              { x: 76, y: 44, rot: 7, scale: 0.72 },
                            ][index];
                            const piece: CollagePiece = {
                              uid: collageUid('p'),
                              id: item.id,
                              ...(fromLayout || layout),
                            };
                            setPieces((list) => [...list, piece]);
                            setSelected(`item:${piece.uid}`);
                            toast.info(`已加入：${item.name}`);
                          }}>
                          <View
                            style={[
                              styles.ctiArt,
                              wardrobeItemHasCutout(item) && styles.ctiArtCutout,
                              {
                                backgroundColor: wardrobeItemHasCutout(item)
                                  ? 'transparent'
                                  : item.tint,
                              },
                              on && styles.ctiArtOn,
                            ]}>
                            <WardrobeGarment
                              item={item}
                              width={wardrobeItemHasCutout(item) ? 44 : 36}
                              height={wardrobeItemHasCutout(item) ? 54 : 42}
                            />
                          </View>
                          <Text style={[styles.ctItemName, on && { color: '#F2E7D4' }]} numberOfLines={1}>
                            {item.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              ) : null}

              {tool === 'photo' ? (
                <>
                  <Text style={styles.ctLabel}>PHOTO · 导入到画布</Text>
                  <View style={styles.photoActions}>
                    <Pressable
                      style={[styles.photoActionBtn, photoBusy && styles.photoActionBtnDisabled]}
                      disabled={photoBusy || busy}
                      onPress={promptPhotoSource}>
                      {photoBusy ? (
                        <ActivityIndicator color="#F2E7D4" size="small" />
                      ) : (
                        <Text style={styles.photoActionText}>拍照 / 相册</Text>
                      )}
                    </Pressable>
                    {photo.kind !== 'none' ? (
                      <Pressable
                        style={styles.photoClearBtn}
                        disabled={photoBusy || busy}
                        onPress={clearPhoto}>
                        <Text style={styles.photoClearText}>清除照片</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {photo.kind === 'custom' && photo.uri ? (
                    <View style={styles.photoTrayPreview}>
                      <StoredImage
                        uri={photo.uri}
                        style={styles.photoTrayThumb}
                        contentFit="cover"
                      />
                      <Text style={styles.photoEmptyHint}>已在画布上 · 可拖动与双指缩放</Text>
                    </View>
                  ) : photo.kind === 'none' ? (
                    <Text style={styles.photoEmptyHint}>从相机或相册选一张图放到拼图画布</Text>
                  ) : (
                    <Text style={styles.photoEmptyHint}>画布上仍有旧预设图，可清除后重新导入</Text>
                  )}
                </>
              ) : null}

              {tool === 'text' ? (
                <>
                  <View style={styles.textbox}>
                    <Svg width={13} height={13} viewBox="0 0 24 24">
                      <Path
                        d="M5 19 12 5l7 14M8 13h8"
                        stroke="rgba(246,241,229,0.48)"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </Svg>
                    <TextInput
                      value={caption.text}
                      onChangeText={(t) => setCaption((c) => ({ ...c, text: t }))}
                      placeholder="写一句今日灵感…"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      maxLength={20}
                      style={styles.textboxInput}
                    />
                  </View>
                  <View style={styles.textMeta}>
                    {COLLAGE_TONES.map((t, index) => (
                      <Pressable
                        key={index}
                        onPress={() => setCaption((c) => ({ ...c, tone: index }))}
                        style={[
                          styles.toneDot,
                          { backgroundColor: t.bg[0] },
                          caption.tone === index && styles.toneDotOn,
                        ]}
                      />
                    ))}
                    <Text style={styles.textNote}>输入后即时预览 · 可拖动</Text>
                  </View>
                </>
              ) : null}

              {tool === 'material' ? (
                <>
                  <Text style={styles.ctLabel}>STICKERS & MARKS</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowGap}>
                    {COLLAGE_STICKER_CATALOG.map((s) => (
                      <Pressable
                        key={s.type}
                        style={styles.stickerOpt}
                        onPress={() => {
                          const entry: CollageSticker = {
                            uid: collageUid('s'),
                            type: s.type,
                            x: 32 + Math.random() * 36,
                            y: 28 + Math.random() * 44,
                            rot: -12 + Math.random() * 24,
                          };
                          setStickers((list) => [...list, entry]);
                          setSelected(`sticker:${entry.uid}`);
                        }}>
                        <View style={styles.ctsVisual}>
                          <StickerVisual type={s.type} preview />
                        </View>
                        <Text style={styles.stickerLabel}>{s.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              ) : null}
            </View>
          ) : null}
        </Animated.View>

        <View style={styles.toolbar}>
          {(
            [
              ['background', '背景', 'M4 4h16v16H4z M4 12h16M12 4v16'],
              ['items', '单品', ''],
              ['photo', '照片', ''],
              ['text', '文字', ''],
              ['material', '素材', ''],
            ] as const
          ).map(([key, label]) => {
            const on = trayOpen && tool === key;
            return (
              <Pressable
                key={key}
                style={[styles.tool, on && styles.toolOn]}
                onPress={() => openTray(key)}>
                <ToolIcon name={key} color={on ? '#F5E7CF' : 'rgba(246,241,229,0.43)'} />
                <Text style={[styles.toolLabel, on && styles.toolLabelOn]}>{label}</Text>
                {on ? <View style={styles.toolUnderline} /> : null}
              </Pressable>
            );
          })}
        </View>

        {editorTip ? (
          <View pointerEvents="none" style={styles.editorTip}>
            <Text style={styles.editorTipText}>{editorTip}</Text>
          </View>
        ) : null}

        {saveOpen ? (
          <Animated.View style={[styles.saveMask, { opacity: saveOp }]} pointerEvents="box-none">
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setSaveOpen(false)}
              pointerEvents={saveBackdropArmed ? 'auto' : 'none'}
            />
            <Animated.View
              style={[
                styles.saveCard,
                {
                  paddingBottom: 16 + insets.bottom,
                  opacity: saveOp,
                  transform: [{ translateY: saveY }],
                },
              ]}>
              <View style={styles.saveHandle} />
              <View style={styles.saveHead}>
                <View>
                  <Text style={styles.saveKicker}>FINALIZE · 保存版式</Text>
                  <Text style={styles.saveTitle}>完成这套搭配</Text>
                </View>
                <Pressable style={styles.saveClose} onPress={() => setSaveOpen(false)}>
                  <Svg width={11} height={11} viewBox="0 0 24 24">
                    <Path d="M6 6l12 12M18 6L6 18" stroke="#627269" strokeWidth={1.8} strokeLinecap="round" />
                  </Svg>
                </Pressable>
              </View>
              <View style={styles.saveField}>
                <Text style={styles.saveFieldLabel}>名称</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="给这套搭配起个名字"
                  placeholderTextColor="#A6AEA5"
                  maxLength={18}
                  style={styles.saveInput}
                />
              </View>
              <View style={styles.saveChoice}>
                <Text style={styles.saveFieldLabel}>场合</Text>
                <View style={styles.saveChips}>
                  {occasions.map((o) => {
                    const on = o.id === occasionId;
                    return (
                      <Pressable
                        key={o.id}
                        style={[styles.saveChip, on && styles.saveChipOn]}
                        onPress={() => setOccasionId(o.id)}>
                        <Text style={[styles.saveChipText, on && styles.saveChipTextOn]}>{o.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.saveChoice}>
                <Text style={styles.saveFieldLabel}>季节</Text>
                <View style={styles.saveChips}>
                  {COLLAGE_SEASONS.map((s) => {
                    const on = seasons.includes(s);
                    return (
                      <Pressable
                        key={s}
                        style={[styles.saveChip, on && styles.saveChipOn]}
                        onPress={() => toggleSeason(s)}>
                        <Text style={[styles.saveChipText, on && styles.saveChipTextOn]}>{s}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.saveField}>
                <Text style={styles.saveFieldLabel}>标签</Text>
                <TextInput
                  value={tagsText}
                  onChangeText={setTagsText}
                  placeholder="通勤, 温柔, 针织"
                  placeholderTextColor="#A6AEA5"
                  style={styles.saveInput}
                />
              </View>
              <View style={[styles.saveField, { alignItems: 'flex-start' }]}>
                <Text style={[styles.saveFieldLabel, { paddingTop: 2 }]}>备注</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="描述这套搭配，可用于关键字搜索"
                  placeholderTextColor="#A6AEA5"
                  multiline
                  style={[styles.saveInput, { minHeight: 40 }]}
                />
              </View>
              <View style={styles.saveActions}>
                <Pressable style={styles.continueBtn} onPress={() => setSaveOpen(false)}>
                  <Text style={styles.continueText}>继续调整</Text>
                </Pressable>
                <Pressable style={styles.commitBtn} onPress={() => void submit()} disabled={busy}>
                  {busy ? (
                    <ActivityIndicator color="#FFF8E8" />
                  ) : (
                    <Text style={styles.commitText}>保存搭配</Text>
                  )}
                </Pressable>
              </View>
            </Animated.View>
          </Animated.View>
        ) : null}
      </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ToolIcon({ name, color }: { name: CollageTool; color: string }) {
  if (name === 'background') {
    return (
      <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
        <Rect x={4} y={4} width={16} height={16} rx={2} stroke={color} strokeWidth={1.4} />
        <Path d="M4 12h16M12 4v16" stroke={color} strokeWidth={1.4} />
        <Path d="M7 7h2v2H7zM15 7h2v2h-2zM7 15h2v2H7zM15 15h2v2h-2z" fill={color} stroke="none" />
      </Svg>
    );
  }
  if (name === 'items') {
    return (
      <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
        <Path
          d="M8.7 5.2 6 6.6l-2 4.8 2.5 1 1.4-2.8V19h8.2V9.6l1.4 2.8 2.5-1-2-4.8-2.7-1.4L12 8.2l-3.3-3Z"
          stroke={color}
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  if (name === 'photo') {
    return (
      <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
        <Rect x={3.5} y={4.5} width={17} height={15} rx={2} stroke={color} strokeWidth={1.4} />
        <Circle cx={8.5} cy={9.5} r={1.5} stroke={color} strokeWidth={1.4} />
        <Path d="m5 17 4.5-4.5 3 3 2.5-2.5L20 18" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      </Svg>
    );
  }
  if (name === 'text') {
    return (
      <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
        <Path d="M5 19 12 5l7 14M8.4 13.2h7.2" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Path
        d="m12 3.8 2.1 5.3 5.7.5-4.4 3.8 1.4 5.6-4.8-3.1-4.8 3.1L8.6 13.4 4.2 9.6l5.7-.5L12 3.8Z"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111210',
  },
  topbar: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 8,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: CE.line,
    backgroundColor: 'rgba(255,255,255,0.045)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { flex: 1, alignItems: 'center', minWidth: 0 },
  headingTitle: {
    fontFamily: wardrobeFonts.serif,
    fontSize: 16,
    letterSpacing: wardrobeEm(0.17, 16),
    color: CE.ink,
  },
  headingSub: {
    marginTop: 3,
    fontFamily: wardrobeFonts.mono,
    fontSize: 6,
    letterSpacing: wardrobeEm(0.22, 6),
    color: CE.muted,
  },
  doneBtn: {
    height: 33,
    paddingHorizontal: 14,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#D6AD70',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 7 },
  },
  doneShine: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    width: 26,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  doneText: {
    fontFamily: wardrobeFonts.sansBold,
    fontSize: 9.5,
    letterSpacing: wardrobeEm(0.08, 9.5),
    color: '#1B2922',
  },
  canvasWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 5,
  },
  artboard: {
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: '#DDEEF1',
    shadowColor: '#000',
    shadowOpacity: 0.48,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 28 },
  },
  artboardHasSel: {},
  cornerTL: {
    position: 'absolute',
    left: 9,
    top: 9,
    width: 15,
    height: 15,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: 'rgba(42,58,50,0.42)',
    zIndex: 20,
  },
  cornerTR: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 15,
    height: 15,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(42,58,50,0.42)',
    zIndex: 20,
  },
  cornerBR: {
    position: 'absolute',
    right: 9,
    bottom: 9,
    width: 15,
    height: 15,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(42,58,50,0.42)',
    zIndex: 20,
  },
  cornerBL: {
    position: 'absolute',
    left: 9,
    bottom: 9,
    width: 15,
    height: 15,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderColor: 'rgba(42,58,50,0.42)',
    zIndex: 20,
  },
  railMark: {
    position: 'absolute',
    left: 8,
    top: '24%',
    width: 12,
    fontFamily: wardrobeFonts.mono,
    fontSize: 5,
    letterSpacing: 1.4,
    color: 'rgba(40,59,49,0.4)',
    zIndex: 20,
  },
  ratioChip: {
    position: 'absolute',
    left: 10,
    top: 10,
    zIndex: 27,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(24,34,29,0.52)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  ratioChipText: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6,
    letterSpacing: wardrobeEm(0.08, 6),
    color: '#FFF8E9',
  },
  boardTip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 9,
    alignItems: 'center',
    zIndex: 28,
  },
  boardTipText: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(25,37,31,0.55)',
    color: 'rgba(255,250,240,0.8)',
    fontSize: 5.8,
    letterSpacing: wardrobeEm(0.08, 5.8),
    fontFamily: wardrobeFonts.sans,
  },
  deleteBtn: {
    position: 'absolute',
    right: -7,
    top: -7,
    zIndex: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1C2922',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCard: {
    width: 120,
    paddingHorizontal: 5,
    paddingTop: 5,
    paddingBottom: 13,
    borderRadius: 3,
    backgroundColor: '#FFFDF8',
  },
  pcCaption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 5,
    paddingHorizontal: 3,
  },
  pcCaptionB: {
    fontFamily: wardrobeFonts.monoBold,
    fontSize: 4.8,
    letterSpacing: 0.4,
    color: '#384A40',
  },
  pcCaptionS: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 4.8,
    color: '#697068',
  },
  piece: {
    width: 96,
    paddingHorizontal: 5,
    paddingTop: 5,
    borderRadius: 7,
    backgroundColor: '#FFFDF8',
  },
  pieceCutout: {
    width: 96,
    padding: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  ciArt: {
    aspectRatio: 1,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ciArtCutout: {
    aspectRatio: undefined,
    width: 96,
    height: 118,
    borderRadius: 0,
    overflow: 'visible',
    backgroundColor: 'transparent',
  },
  ciMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  ciMetaB: {
    fontFamily: wardrobeFonts.monoBold,
    fontSize: 5.1,
    color: '#3D5045',
  },
  ciMetaS: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 5.1,
    color: '#64675F',
  },
  caption: {
    maxWidth: 220,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 2,
  },
  captionText: {
    fontFamily: wardrobeFonts.sansBold,
    fontSize: 9,
    letterSpacing: wardrobeEm(0.08, 9),
  },
  captionSub: {
    marginTop: 2,
    fontFamily: wardrobeFonts.mono,
    fontSize: 4.6,
    letterSpacing: wardrobeEm(0.14, 4.6),
    opacity: 0.56,
  },
  tray: {
    overflow: 'hidden',
    backgroundColor: '#1A1B19',
  },
  trayInner: {
    paddingHorizontal: 17,
    paddingTop: 10,
    paddingBottom: 15,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.075)',
  },
  trayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  trayTitle: {
    fontFamily: wardrobeFonts.serif,
    fontSize: 13,
    letterSpacing: wardrobeEm(0.1, 13),
    color: CE.ink,
  },
  trayTabs: {
    marginLeft: 'auto',
    flexDirection: 'row',
    gap: 2,
    padding: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  trayTab: {
    minWidth: 44,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  trayTabOn: { backgroundColor: '#F2E7D4' },
  trayTabText: {
    fontSize: 6.8,
    letterSpacing: wardrobeEm(0.08, 6.8),
    color: 'rgba(246,241,229,0.48)',
    textAlign: 'center',
    fontFamily: wardrobeFonts.sans,
  },
  trayTabTextOn: { color: '#22342B', fontFamily: wardrobeFonts.sansBold },
  trayClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.055)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctLabel: {
    marginTop: 8,
    marginBottom: 6,
    fontFamily: wardrobeFonts.mono,
    fontSize: 5.8,
    letterSpacing: wardrobeEm(0.17, 5.8),
    color: 'rgba(246,241,229,0.38)',
  },
  rowGap: { gap: 8, paddingVertical: 2 },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
  },
  swatchOn: {
    borderWidth: 2,
    borderColor: '#F2E7D4',
  },
  pattern: {
    width: 54,
    height: 42,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  patternOn: {
    borderWidth: 2,
    borderColor: '#F2E7D4',
  },
  ratioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  ratioCell: {
    width: '15%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    borderRadius: 10,
  },
  ratioCellOn: { backgroundColor: 'rgba(230,188,122,0.12)' },
  ratioIcon: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.33)',
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  ratioIconOn: {
    borderColor: '#E6BC7A',
    backgroundColor: 'rgba(230,188,122,0.14)',
  },
  ratioLabel: {
    fontSize: 6,
    color: 'rgba(246,241,229,0.48)',
    fontFamily: wardrobeFonts.sans,
  },
  ratioLabelOn: { color: '#F2E7D4' },
  ctItem: { width: 58, alignItems: 'center' },
  ctiArt: {
    width: 58,
    height: 64,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  ctiArtCutout: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.12)',
    borderStyle: 'dashed',
    overflow: 'visible',
  },
  ctiArtOn: {
    borderWidth: 2,
    borderColor: '#E6BC7A',
    borderStyle: 'solid',
  },
  ctItemName: {
    marginTop: 5,
    fontSize: 5.5,
    color: 'rgba(246,241,229,0.48)',
    fontFamily: wardrobeFonts.sans,
  },
  photoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  photoActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(230,188,122,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(230,188,122,0.42)',
    minWidth: 108,
    alignItems: 'center',
  },
  photoActionBtnDisabled: { opacity: 0.55 },
  photoActionText: {
    color: '#F2E7D4',
    fontSize: 11,
    fontFamily: wardrobeFonts.sansBold,
  },
  photoEmptyHint: {
    marginTop: 8,
    color: 'rgba(246,241,229,0.42)',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: wardrobeFonts.sans,
  },
  photoClearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  photoClearText: {
    color: '#F2E7D4',
    fontSize: 11,
    fontFamily: wardrobeFonts.sansBold,
  },
  photoTrayPreview: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  photoTrayThumb: {
    width: 42,
    height: 52,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  textbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  textboxInput: {
    flex: 1,
    color: '#FFF8E9',
    fontSize: 9,
    fontFamily: wardrobeFonts.sans,
    padding: 0,
  },
  textMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  toneDot: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  toneDotOn: {
    borderWidth: 2,
    borderColor: '#F2E7D4',
  },
  textNote: {
    marginLeft: 'auto',
    fontSize: 5.6,
    color: 'rgba(246,241,229,0.33)',
    letterSpacing: 0.3,
    fontFamily: wardrobeFonts.sans,
  },
  stickerOpt: {
    width: 62,
    height: 58,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  ctsVisual: { height: 29, alignItems: 'center', justifyContent: 'center' },
  stickerLabel: {
    fontSize: 5.3,
    color: 'rgba(246,241,229,0.66)',
    fontFamily: wardrobeFonts.sans,
  },
  toolbar: {
    height: 76,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: '#0E0F0E',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.055)',
  },
  tool: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 12,
  },
  toolOn: {
    backgroundColor: 'rgba(230,188,122,0.08)',
  },
  toolLabel: {
    fontSize: 7,
    letterSpacing: wardrobeEm(0.08, 7),
    color: 'rgba(246,241,229,0.43)',
    fontFamily: wardrobeFonts.sans,
  },
  toolLabelOn: { color: '#F5E7CF' },
  toolUnderline: {
    position: 'absolute',
    bottom: 1,
    width: 13,
    height: 2,
    borderRadius: 2,
    backgroundColor: CE.gold,
  },
  editorTip: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 78,
    zIndex: 70,
    alignItems: 'center',
  },
  editorTipText: {
    maxWidth: '92%',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(32,48,40,0.94)',
    color: '#F8F3E8',
    fontFamily: wardrobeFonts.sansBold,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: 'center',
  },
  saveMask: {
    ...StyleSheet.absoluteFill,
    zIndex: 88,
    elevation: 88,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(7,10,8,0.56)',
  },
  saveCard: {
    maxHeight: '88%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 16,
    backgroundColor: '#FFFCF5',
  },
  saveHandle: {
    width: 36,
    height: 4,
    borderRadius: 4,
    backgroundColor: '#D5C9B6',
    alignSelf: 'center',
    marginBottom: 12,
  },
  saveHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 13,
  },
  saveKicker: {
    fontFamily: wardrobeFonts.monoBold,
    fontSize: 7.5,
    letterSpacing: wardrobeEm(0.2, 7.5),
    color: '#8B958C',
    marginBottom: 5,
  },
  saveTitle: {
    fontFamily: wardrobeFonts.serif,
    fontSize: 21,
    letterSpacing: wardrobeEm(0.04, 21),
    color: '#1D2A24',
  },
  saveClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(33,69,58,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#EDE6D9',
    backgroundColor: 'rgba(252,249,241,0.66)',
    marginBottom: 7,
  },
  saveFieldLabel: {
    width: 42,
    fontSize: 7.5,
    color: '#8B958C',
    letterSpacing: 0.4,
    fontFamily: wardrobeFonts.sans,
  },
  saveInput: {
    flex: 1,
    fontSize: 9,
    color: '#1D2A24',
    fontFamily: wardrobeFonts.sans,
    padding: 0,
  },
  saveChoice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#EDE6D9',
    backgroundColor: 'rgba(252,249,241,0.52)',
    marginBottom: 7,
  },
  saveChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  saveChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E3DACB',
    backgroundColor: 'rgba(255,252,245,0.72)',
  },
  saveChipOn: { backgroundColor: '#21453A', borderColor: '#21453A' },
  saveChipText: {
    fontSize: 6.5,
    color: '#627269',
    fontFamily: wardrobeFonts.sans,
  },
  saveChipTextOn: { color: '#F8F2E4' },
  saveActions: { flexDirection: 'row', gap: 8, marginTop: 11 },
  continueBtn: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E3DACB',
    backgroundColor: 'rgba(252,249,241,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: {
    fontSize: 9,
    color: '#627269',
    fontFamily: wardrobeFonts.sansBold,
  },
  commitBtn: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    backgroundColor: '#21453A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commitText: {
    fontSize: 9,
    color: '#FFF8E8',
    fontFamily: wardrobeFonts.sansBold,
  },
});
