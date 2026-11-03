import { NOTE_IMAGE_MAX_COUNT } from '@/lib/note-image-extra';
import {
  pickNoteImagesFromLibrary,
  resolveStoredImageDisplayUri,
} from '@/lib/note-images';
import { toast } from '@/lib/app-feedback';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

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

function NoteThumb({
  uri,
  borderColor,
  surfaceColor,
  mutedColor,
  disabled,
  onRemove,
}: {
  uri: string;
  borderColor: string;
  surfaceColor: string;
  mutedColor: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
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

  return (
    <View style={styles.wrap}>
      <View style={[styles.box, { borderColor, backgroundColor: surfaceColor, borderStyle: 'solid' }]}>
        <Image source={{ uri: displayUri }} style={styles.thumb} contentFit="cover" />
      </View>
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

  return (
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
  );
}

type PreviewProps = {
  uris: string[];
  borderColor?: string;
  style?: StyleProp<ViewStyle>;
};

function PreviewItem({ uri }: { uri: string }) {
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
  return <Image source={{ uri: displayUri }} style={styles.preview} contentFit="cover" />;
}

/** 详情页只读预览（多图竖排）。 */
export function NoteImagePreview({ uris, borderColor, style }: PreviewProps) {
  const list = uris.map((u) => u.trim()).filter(Boolean);
  if (list.length === 0) return null;

  return (
    <View style={[styles.previewList, style]}>
      {list.map((uri, index) => (
        <View
          key={`${uri}-${index}`}
          style={[styles.previewWrap, borderColor ? { borderColor } : null]}>
          <PreviewItem uri={uri} />
        </View>
      ))}
    </View>
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
});
