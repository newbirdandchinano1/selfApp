import { WishFormLabel } from '@/components/wish-board/wish-board-form-ui';
import { StoredImage } from '@/components/stored-image';
import type { WishBoxPalette, WishBoxShadowSet } from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
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
  TextInput,
  View,
} from 'react-native';

type Props = {
  value: string;
  onChange: (next: string) => void;
  onUploadedUri?: (uri: string) => void;
  wishId?: string | null;
  editable?: boolean;
};

/** 心愿描述：文本 + 配图（设计稿 05「描述与配图同排」） */
export function WishBoardDescriptionField({
  value,
  onChange,
  onUploadedUri,
  wishId,
  editable = true,
}: Props) {
  const { c } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
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
      commit({ text: parts.text, imageUris: parts.imageUris.filter(u => u !== uri) });
    },
    [commit, parts],
  );

  const onInsertImage = useCallback(async () => {
    if (parts.imageUris.length >= WISH_DESCRIPTION_IMAGE_MAX) {
      toast.warn(`最多插入 ${WISH_DESCRIPTION_IMAGE_MAX} 张图片`);
      return;
    }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toast.warn('未获得相册权限');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: WISH_DESCRIPTION_IMAGE_MAX - parts.imageUris.length,
        quality: 0.85,
      });
      if (result.canceled || result.assets.length === 0) return;
      setUploading(true);
      const nextUris = [...parts.imageUris];
      for (const asset of result.assets) {
        if (nextUris.length >= WISH_DESCRIPTION_IMAGE_MAX) break;
        const uploaded = await uploadWishImage({ localUri: asset.uri, wishId });
        nextUris.push(uploaded.uri);
        onUploadedUri?.(uploaded.uri);
      }
      commit({ text: parts.text, imageUris: nextUris });
    } catch (e) {
      toast.error(toUserMessage(e, '图片上传失败，请稍后再试'));
    } finally {
      setUploading(false);
    }
  }, [commit, onUploadedUri, parts, wishId]);

  return (
    <View>
      <WishFormLabel label="心愿描述" hint="可选 · 支持配图" />
      <View style={styles.row}>
        <TextInput
          value={parts.text}
          onChangeText={onTextChange}
          editable={editable}
          multiline
          textAlignVertical="top"
          maxLength={WISH_DESCRIPTION_TEXT_MAX}
          placeholder="写点来龙去脉，或兑换规则…"
          placeholderTextColor={c.muted}
          style={styles.textarea}
        />
        {parts.imageUris.length < WISH_DESCRIPTION_IMAGE_MAX ? (
          <Pressable
            onPress={() => void onInsertImage()}
            disabled={uploading || !editable}
            style={({ pressed }) => [styles.upload, { opacity: pressed || uploading ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="添加配图">
            {uploading ? (
              <ActivityIndicator size="small" color={c.pri} />
            ) : (
              <>
                <Text style={styles.uploadPlus}>＋</Text>
                <Text style={styles.uploadLabel}>配图</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>

      {parts.imageUris.length > 0 ? (
        <View style={styles.thumbRow}>
          {parts.imageUris.map(uri => (
            <View key={uri} style={styles.thumbWrap}>
              <StoredImage uri={uri} style={styles.thumb} contentFit="cover" />
              {editable ? (
                <Pressable
                  onPress={() => onRemoveImage(uri)}
                  hitSlop={6}
                  style={styles.removeBtn}
                  accessibilityRole="button"
                  accessibilityLabel="移除配图">
                  <MaterialIcons name="close" size={12} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          ))}
          <Text style={styles.countHint}>
            {parts.imageUris.length}/{WISH_DESCRIPTION_IMAGE_MAX}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 9,
  },
  textarea: {
    flex: 1,
    minHeight: 76,
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    borderRadius: 15,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 13.5,
    lineHeight: 21,
    color: c.ink,
  },
  upload: {
    width: 64,
    minHeight: 76,
    borderRadius: 15,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.uploadLine,
    backgroundColor: c.fieldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  uploadPlus: {
    fontSize: 20,
    fontWeight: '700',
    color: c.uploadText,
  },
  uploadLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: c.uploadText,
  },
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 9,
    marginTop: 9,
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: c.graySoft,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  removeBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: 'rgba(46,35,32,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countHint: {
    fontSize: 10.5,
    color: c.muted,
    fontWeight: '700',
  },
  });
}
