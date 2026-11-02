import { WARDROBE, wardrobeFonts, wardrobeType } from '@/constants/wardrobe-theme';
import React, { memo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

/**
 * 设计稿 `.page-title .ital`：「自己」「衣橱」斜体 + 琥珀底划。
 * Noto Serif SC 无真正斜体面，各端统一 skewX 模拟斜体，Web 另加 fontStyle。
 */
export const PageTitleItal = memo(function PageTitleItal({ children }: { children: string }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.mark} pointerEvents="none" />
      <Text style={styles.text}>{children}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    alignSelf: 'flex-start',
    paddingRight: 4,
    paddingBottom: 2,
    // skew 后字形外溢，预留一点水平空间
    paddingLeft: 1,
  },
  mark: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 1,
    height: 5,
    borderRadius: 2,
    backgroundColor: 'rgba(211,154,85,0.24)',
    transform: [{ skewX: '-12deg' }],
    zIndex: 0,
  },
  text: {
    ...wardrobeType.pageTitle,
    color: WARDROBE.pine,
    fontFamily: wardrobeFonts.serif,
    fontStyle: Platform.OS === 'web' ? 'italic' : 'normal',
    transform: [{ skewX: '-12deg' }],
    zIndex: 1,
  },
});
