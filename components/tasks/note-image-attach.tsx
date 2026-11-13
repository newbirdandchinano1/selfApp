import { NOTE_IMAGE_MAX_COUNT } from '@/lib/note-image-extra';
import {
  pickNoteImagesFromLibrary,
  resolveStoredImageDisplayUri,
} from '@/lib/note-images';
import { toast } from '@/lib/app-feedback';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type AttachProps = {
  uris: string[];
  onChangeUris: (uris: string[]) => void;
  disabled?: boolean;
  borderColor: string;
  mutedColor: string;
  surfaceColor: string;
  style?: StyleProp<ViewStyle>;
  maxCount?: number;
};

function useResolvedDisplayUri(uri: string) {
  const [displayUri, setDisplayUri] = useState(uri);
  useEffect(() => {
    let cancelled = false;
    void resolveStoredImageDisplayUri(uri).then((resolved) => {
      if (!cancelled) setDisplayUri(resolved ?? uri);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return displayUri;
}

/** 全屏贴图预览：支持左右滑动切换，点击空白或关闭按钮退出。 */
function NoteImageLightbox({
  uris,
  initialIndex,
  visible,
  onClose,
}: {
  uris: string[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const list = uris.map((u) => u.trim()).filter(Boolean);
  const startIndex = Math.max(0, Math.min(initialIndex, Math.max(0, list.length - 1)));
  const [index, setIndex] = useState(startIndex);
  const listRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    if (!visible) return;
    setIndex(startIndex);
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: startIndex, animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [visible, startIndex]);

  if (list.length === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.lightboxRoot}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="关闭贴图预览"
        />
        <FlatList
          ref={listRef}
          data={list}
          keyExtractor={(item, i) => `${item}-${i}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
            setIndex(Math.max(0, Math.min(list.length - 1, next)));
          }}
          onScrollToIndexFailed={() => {
            listRef.current?.scrollToOffset({ offset: width * startIndex, animated: false });
          }}
          renderItem={({ item }) => (
            <LightboxPage uri={item} width={width} height={height} onClose={onClose} />
          )}
        />
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityLabel="关闭"
          style={({ pressed }) => [
            styles.lightboxClose,
            { top: Math.max(12, insets.top + 8), opacity: pressed ? 0.7 : 1 },
          ]}>
          <MaterialIcons name="close" size={22} color="#FFFFFF" />
        </Pressable>
        {list.length > 1 ? (
          <Text style={[styles.lightboxCounter, { bottom: Math.max(20, insets.bottom + 12) }]}>
            {index + 1} / {list.length}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

function LightboxPage({
  uri,
  width,
  height,
  onClose,
}: {
  uri: string;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const displayUri = useResolvedDisplayUri(uri);
  return (
    <Pressable style={{ width, height, justifyContent: 'center' }} onPress={onClose}>
      <Image
        source={{ uri: displayUri }}
        style={{ width, height: height * 0.82 }}
        contentFit="contain"
      />
    </Pressable>
  );
}

function NoteThumb({
  uri,
  borderColor,
  surfaceColor,
  mutedColor,
  disabled,
  onRemove,
  onPress,
}: {
  uri: string;
  borderColor: string;
  surfaceColor: string;
  mutedColor: string;
  disabled?: boolean;
  onRemove: () => void;
  onPress?: () => void;
}) {
  const displayUri = useResolvedDisplayUri(uri);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityLabel="查看备注图片"
        style={({ pressed }) => [
          styles.box,
          {
            borderColor,
            backgroundColor: surfaceColor,
            borderStyle: 'solid',
            opacity: pressed && onPress ? 0.88 : 1,
          },
        ]}>
        <Image source={{ uri: displayUri }} style={styles.thumb} contentFit="cover" />
      </Pressable>
      <Pressable
        onPress={onRemove}
        disabled={disabled}
        hitSlop={8}
        accessibilityLabel="移除备注图片"
        style={({ pressed }) => [
          styles.clearBtn,
          { backgroundColor: surfaceColor, borderColor, opacity: pressed ? 0.75 : 1 },
        ]}>
        <MaterialIcons name="close" size={12} color={mutedColor} />
      </Pressable>
    </View>
  );
}

/** 备注贴图：可多选，缩略图横滑，右侧继续添加。 */
export function NoteImageAttach({
  uris,
  onChangeUris,
  disabled,
  borderColor,
  mutedColor,
  surfaceColor,
  style,
  maxCount = NOTE_IMAGE_MAX_COUNT,
}: AttachProps) {
  const [busy, setBusy] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const limit = Math.max(1, Math.min(NOTE_IMAGE_MAX_COUNT, maxCount));
  const remaining = Math.max(0, limit - uris.length);

  const pick = async () => {
    if (disabled || busy || remaining <= 0) {
      if (remaining <= 0) toast.info(`备注最多贴 ${limit} 张图`);
      return;
    }
    setBusy(true);
    try {
      const picked = await pickNoteImagesFromLibrary(remaining);
      if (!picked.ok) {
        if (picked.reason === 'permission') toast.info('需要相册权限才能贴图');
        return;
      }
      const seen = new Set(uris);
      const next = [...uris];
      for (const uri of picked.uris) {
        if (seen.has(uri)) continue;
        seen.add(uri);
        next.push(uri);
        if (next.length >= limit) break;
      }
      onChangeUris(next);
    } finally {
      setBusy(false);
    }
  };

  const removeAt = (index: number) => {
    if (disabled || busy) return;
    onChangeUris(uris.filter((_, i) => i !== index));
  };

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {uris.map((uri, index) => (
          <NoteThumb
            key={`${uri}-${index}`}
            uri={uri}
            borderColor={borderColor}
            surfaceColor={surfaceColor}
            mutedColor={mutedColor}
            disabled={disabled || busy}
            onRemove={() => removeAt(index)}
            onPress={() => setLightboxIndex(index)}
          />
        ))}
        {remaining > 0 ? (
          <Pressable
            onPress={() => void pick()}
            disabled={disabled || busy}
            accessibilityLabel="在备注中贴图"
            style={({ pressed }) => [
              styles.box,
              {
                borderColor,
                backgroundColor: surfaceColor,
                opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
              },
            ]}>
            {busy ? (
              <ActivityIndicator size="small" color={mutedColor} />
            ) : (
              <MaterialIcons name="add-photo-alternate" size={20} color={mutedColor} />
            )}
          </Pressable>
        ) : null}
      </ScrollView>
      <NoteImageLightbox
        uris={uris}
        initialIndex={lightboxIndex ?? 0}
        visible={lightboxIndex != null}
        onClose={closeLightbox}
      />
    </>
  );
}

type PreviewProps = {
  uris: string[];
  borderColor?: string;
  style?: StyleProp<ViewStyle>;
};

function PreviewItem({ uri, onPress }: { uri: string; onPress: () => void }) {
  const displayUri = useResolvedDisplayUri(uri);
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel="放大查看贴图">
      <Image source={{ uri: displayUri }} style={styles.preview} contentFit="cover" />
    </Pressable>
  );
}

/** 详情页只读预览（多图竖排，点击可放大）。 */
export function NoteImagePreview({ uris, borderColor, style }: PreviewProps) {
  const list = uris.map((u) => u.trim()).filter(Boolean);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  if (list.length === 0) return null;

  return (
    <>
      <View style={[styles.previewList, style]}>
        {list.map((uri, index) => (
          <View
            key={`${uri}-${index}`}
            style={[styles.previewWrap, borderColor ? { borderColor } : null]}>
            <PreviewItem uri={uri} onPress={() => setLightboxIndex(index)} />
          </View>
        ))}
      </View>
      <NoteImageLightbox
        uris={list}
        initialIndex={lightboxIndex ?? 0}
        visible={lightboxIndex != null}
        onClose={closeLightbox}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
    paddingRight: 4,
  },
  wrap: {
    position: 'relative',
    width: 52,
    height: 52,
    flexShrink: 0,
  },
  box: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  clearBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewList: {
    marginTop: 10,
    gap: 8,
  },
  previewWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  preview: {
    width: '100%',
    height: 180,
  },
  lightboxRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  lightboxClose: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  lightboxCounter: {
    position: 'absolute',
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    fontWeight: '600',
    zIndex: 2,
  },
});
