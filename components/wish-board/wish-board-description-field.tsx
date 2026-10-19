import { AppInput } from '@/components/ui';
import { StoredImage } from '@/components/stored-image';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  assertWishDescriptionParts,
  parseWishDescription,
  serializeWishDescription,
  WISH_DESCRIPTION_IMAGE_MAX,
  WISH_DESCRIPTION_TEXT_MAX,
  type WishDescriptionParts,
} from '@/lib/wish-description';
import { uploadWishImage } from '@/lib/wish-images';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Props = {
  value: string;
  onChange: (next: string) => void;
  onUploadedUri?: (uri: string) => void;
  wishId?: string | null;
  editable?: boolean;
  label?: string;
  placeholder?: string;
  textColor: string;
  mutedColor: string;
  outline: string;
  primary: string;
  surfaceSubtle: string;
};

export function WishBoardDescriptionField({
  value,
  onChange,
  onUploadedUri,
  wishId,
  editable = true,
  label = '描述（可选）',
  placeholder = '补充说明或兑换规则',
  textColor,
  mutedColor,
  outline,
  primary,
  surfaceSubtle,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const parts = useMemo(() => parseWishDescription(value), [value]);

  const commit = useCallback(
    (next: WishDescriptionParts) => {
      try {
        assertWishDescriptionParts(next);
      } catch (e) {
        toast.warn(e instanceof Error ? e.message : '描述无效');
        return;
      }
      onChange(serializeWishDescription(next) ?? '');
    },
    [onChange],
  );

  const onTextChange = useCallback(
    (text: string) => {
      commit({ text, imageUris: parts.imageUris });
    },
    [commit, parts.imageUris],
  );

  const onRemoveImage = useCallback(
    (uri: string) => {
      commit({
        text: parts.text,
        imageUris: parts.imageUris.filter((u) => u !== uri),
      });
    },
    [commit, parts.imageUris, parts.text],
  );

  const onInsertImage = useCallback(async () => {
    if (!editable || uploading) return;
    if (parts.imageUris.length >= WISH_DESCRIPTION_IMAGE_MAX) {
      toast.warn(`描述最多插入 ${WISH_DESCRIPTION_IMAGE_MAX} 张图片`);
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.warn('需要相册权限才能插入图片');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.88,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    setUploading(true);
    try {
      const saved = await uploadWishImage({
        localUri: result.assets[0].uri,
        wishId,
      });
      onUploadedUri?.(saved.uri);
      commit({
        text: parts.text,
        imageUris: [...parts.imageUris, saved.uri],
      });
    } catch (e) {
      toast.error(toUserMessage(e, '图片上传失败'));
    } finally {
      setUploading(false);
    }
  }, [
    commit,
    editable,
    onUploadedUri,
    parts.imageUris,
    parts.text,
    uploading,
    wishId,
  ]);

  return (
    <View style={styles.root}>
      <AppInput
        label={label}
        value={parts.text}
        onChangeText={onTextChange}
        editable={editable}
        placeholder={placeholder}
        multiline
        maxLength={WISH_DESCRIPTION_TEXT_MAX}
        inputStyle={{ minHeight: 72, textAlignVertical: 'top' }}
      />

      {parts.imageUris.length > 0 ? (
        <View style={styles.imageRow}>
          {parts.imageUris.map((uri) => (
            <View
              key={uri}
              style={[styles.thumbWrap, { borderColor: outline, backgroundColor: surfaceSubtle }]}>
              <StoredImage uri={uri} style={styles.thumb} contentFit="cover" />
              {editable ? (
                <Pressable
                  onPress={() => onRemoveImage(uri)}
                  style={[styles.removeBtn, { backgroundColor: 'rgba(15,23,42,0.72)' }]}
                  hitSlop={6}
                  accessibilityLabel="移除图片">
                  <MaterialIcons name="close" size={14} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {editable ? (
        <Pressable
          onPress={() => void onInsertImage()}
          disabled={uploading}
          style={({ pressed }) => [
            styles.insertBtn,
            {
              borderColor: outline,
              opacity: pressed || uploading ? 0.7 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="插入图片">
          {uploading ? (
            <ActivityIndicator size="small" color={primary} />
          ) : (
            <MaterialIcons name="image" size={18} color={primary} />
          )}
          <Text style={[styles.insertLabel, { color: textColor }]}>
            {uploading ? '上传中…' : '插入图片'}
          </Text>
          <Text style={[styles.insertHint, { color: mutedColor }]}>
            {parts.imageUris.length}/{WISH_DESCRIPTION_IMAGE_MAX}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.md,
  },
  imageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  thumbWrap: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    alignSelf: 'flex-start',
  },
  insertLabel: {
    ...Typography.bodyStrong,
    fontSize: 14,
  },
  insertHint: {
    ...Typography.caption,
  },
});
