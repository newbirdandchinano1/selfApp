import { resolveStoredImageDisplayUri } from '@/lib/stored-images';
import { Image, type ImageContentFit } from 'expo-image';
import React, { useEffect, useState } from 'react';
import type { ImageStyle, StyleProp } from 'react-native';

type Props = {
  uri: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  onError?: () => void;
};

/** 展示统一库路径或本地 URI。`/uploads/...` 会拼上后端 origin。 */
export function StoredImage({ uri, style, contentFit = 'cover', onError }: Props) {
  const immediate = uri.startsWith('/uploads/') ? null : uri;
  const [resolved, setResolved] = useState<string | null>(immediate);

  useEffect(() => {
    let alive = true;
    if (!uri.startsWith('/uploads/')) {
      setResolved(uri);
      return () => {
        alive = false;
      };
    }
    setResolved(null);
    void resolveStoredImageDisplayUri(uri).then((next) => {
      if (alive) setResolved(next);
    });
    return () => {
      alive = false;
    };
  }, [uri]);

  if (!resolved) return null;
  return <Image source={{ uri: resolved }} style={style} contentFit={contentFit} onError={onError} />;
}
