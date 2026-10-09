import {
  buildMemoEditorDocument,
  memoModelToEditorHtml,
  stylesKey,
} from '@/lib/memo-visual-html';
import {
  applyMemoFormatToModel,
  type MemoEditModel,
  type MemoFormatAction,
} from '@/lib/memo-format';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

type Props = {
  model: MemoEditModel;
  onChangeModel: (model: MemoEditModel) => void;
  onSelectionChange: (selection: { start: number; end: number }) => void;
  onNeedSelection?: () => void;
  placeholder?: string;
  textColor: string;
  placeholderColor: string;
  caretColor: string;
  backgroundColor?: string;
  containerStyle?: StyleProp<ViewStyle>;
  minHeight?: number;
};

export type MemoRichBodyInputHandle = {
  applyFormat: (action: MemoFormatAction, extras?: { imageUri?: string }) => void;
};

type BridgeMsg =
  | { type: 'ready' }
  | { type: 'change'; model: MemoEditModel }
  | { type: 'selection'; selection: { start: number; end: number } }
  | { type: 'height'; height: number }
  | { type: 'needSelection' }
  | {
      type: 'formatContext';
      token: string;
      selection: { start: number; end: number };
      model: MemoEditModel;
    };

const INLINE_CMD: Partial<Record<MemoFormatAction, string>> = {
  bold: 'bold',
  italic: 'italic',
  strike: 'strikeThrough',
};

/**
 * WebView contentEditable：行内格式走 execCommand（即时可见），
 * 块级格式用缓存选区 + 模型重刷 HTML。
 */
export const MemoRichBodyInput = forwardRef<MemoRichBodyInputHandle, Props>(
  function MemoRichBodyInput(
    {
      model,
      onChangeModel,
      onSelectionChange,
      onNeedSelection,
      placeholder = '写下想法…',
      textColor,
      placeholderColor,
      caretColor,
      backgroundColor = 'transparent',
      containerStyle,
      minHeight = 280,
    },
    ref,
  ) {
    const webRef = useRef<WebView>(null);
    const readyRef = useRef(false);
    const lastPlainRef = useRef(model.plain);
    const lastStylesKeyRef = useRef(stylesKey(model));
    const suppressEchoRef = useRef(false);
    const pendingFormatRef = useRef<{
      token: string;
      action: MemoFormatAction;
      extras?: { imageUri?: string };
    } | null>(null);
    const [height, setHeight] = useState(minHeight);

    const documentHtml = useMemo(
      () =>
        buildMemoEditorDocument({
          textColor,
          placeholderColor,
          caretColor,
          backgroundColor,
          placeholder,
        }),
      [backgroundColor, caretColor, placeholder, placeholderColor, textColor],
    );

    const pushHtml = useCallback(
      (next: MemoEditModel, selection?: { start: number; end: number }) => {
        const html = memoModelToEditorHtml(next);
        const htmlLit = JSON.stringify(html);
        const selLit = selection ? JSON.stringify(selection) : 'null';
        suppressEchoRef.current = true;
        webRef.current?.injectJavaScript(`
          (function(){
            if (!window.__memoEditor) return true;
            window.__memoEditor.setHtml(${htmlLit});
            if (${selLit}) window.__memoEditor.setSelection(${selLit});
            true;
          })();
        `);
        lastPlainRef.current = next.plain;
        lastStylesKeyRef.current = stylesKey(next);
        setTimeout(() => {
          suppressEchoRef.current = false;
        }, 120);
      },
      [],
    );

    const applyFormat = useCallback(
      (action: MemoFormatAction, extras?: { imageUri?: string }) => {
        const inline = INLINE_CMD[action];
        if (inline) {
          webRef.current?.injectJavaScript(`
            (function(){
              if (window.__memoEditor) window.__memoEditor.applyInline(${JSON.stringify(inline)});
              true;
            })();
          `);
          return;
        }
        const token = `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        pendingFormatRef.current = { token, action, extras };
        webRef.current?.injectJavaScript(`
          (function(){
            if (window.__memoEditor) window.__memoEditor.queryFormatContext(${JSON.stringify(token)});
            true;
          })();
        `);
      },
      [],
    );

    useImperativeHandle(ref, () => ({ applyFormat }), [applyFormat]);

    const onMessage = useCallback(
      (e: WebViewMessageEvent) => {
        let msg: BridgeMsg;
        try {
          msg = JSON.parse(e.nativeEvent.data) as BridgeMsg;
        } catch {
          return;
        }

        if (msg.type === 'ready') {
          readyRef.current = true;
          pushHtml(model);
          return;
        }
        if (msg.type === 'height') {
          setHeight(Math.max(minHeight, Math.ceil(msg.height)));
          return;
        }
        if (msg.type === 'needSelection') {
          onNeedSelection?.();
          return;
        }
        if (msg.type === 'selection') {
          onSelectionChange(msg.selection);
          return;
        }
        if (msg.type === 'formatContext') {
          const pending = pendingFormatRef.current;
          if (!pending || pending.token !== msg.token) return;
          pendingFormatRef.current = null;
          const base: MemoEditModel = {
            plain: msg.model?.plain ?? '',
            styles: Array.isArray(msg.model?.styles) ? msg.model.styles : [],
          };
          const result = applyMemoFormatToModel(base, msg.selection, pending.action, pending.extras);
          lastPlainRef.current = result.model.plain;
          lastStylesKeyRef.current = stylesKey(result.model);
          onChangeModel(result.model);
          onSelectionChange(result.selection);
          pushHtml(result.model, result.selection);
          return;
        }
        if (msg.type === 'change') {
          if (suppressEchoRef.current) return;
          const next = msg.model ?? { plain: '', styles: [] };
          lastPlainRef.current = next.plain;
          lastStylesKeyRef.current = stylesKey(next);
          onChangeModel({
            plain: next.plain ?? '',
            styles: Array.isArray(next.styles) ? next.styles : [],
          });
        }
      },
      [minHeight, model, onChangeModel, onNeedSelection, onSelectionChange, pushHtml],
    );

    // 外部加载/同步模型时刷 DOM（跳过编辑器自己 emit 的回声）
    useEffect(() => {
      if (!readyRef.current) return;
      const key = stylesKey(model);
      if (model.plain === lastPlainRef.current && key === lastStylesKeyRef.current) {
        return;
      }
      pushHtml(model);
    }, [model, pushHtml]);

    return (
      <View style={[styles.wrap, { minHeight }, containerStyle]}>
        <WebView
          ref={webRef}
          originWhitelist={['*']}
          source={{ html: documentHtml }}
          onMessage={onMessage}
          style={[styles.web, { height: Math.max(minHeight, height) }]}
          scrollEnabled={false}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          javaScriptEnabled
          domStorageEnabled={false}
          automaticallyAdjustContentInsets={false}
          mixedContentMode="always"
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
  },
  web: {
    backgroundColor: 'transparent',
    width: '100%',
  },
});
