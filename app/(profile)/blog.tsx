import { AppText, ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

/** 统一走 www，避免 apex/www 双 origin 导致 cookie/storage 隔离 */
const BLOG_ORIGIN = 'https://www.jaxz.xyz';
const BLOG_FALLBACK = 'https://jaxz.xyz';
const ALLOWED_HOSTS = new Set(['jaxz.xyz', 'www.jaxz.xyz']);
const LOAD_TIMEOUT_MS = 20000;
/** 博客站把 token 放在 sessionStorage，WebView 销毁即丢；由 App 侧持久化 */
const BLOG_AUTH_STORAGE_KEY = '@selfapp/blog-auth-v1';

type BlogAuthCache = {
  token?: string;
  userInfo?: string;
};

/** App 内嵌禁止双击 / 双指缩放（viewport + 手势拦截） */
const DISABLE_ZOOM_JS = `(function(){
  var content = 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover';
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    meta.setAttribute('content', content);
  } else {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    meta.setAttribute('content', content);
    (document.head || document.documentElement).appendChild(meta);
  }
  var style = document.getElementById('selfapp-no-zoom');
  if (!style) {
    style = document.createElement('style');
    style.id = 'selfapp-no-zoom';
    style.textContent = 'html,body{-ms-touch-action:pan-x pan-y;touch-action:pan-x pan-y;}';
    (document.head || document.documentElement).appendChild(style);
  }
  if (!window.__selfappNoZoomBound) {
    window.__selfappNoZoomBound = true;
    var block = function(e){ e.preventDefault(); };
    document.addEventListener('gesturestart', block, {passive:false});
    document.addEventListener('gesturechange', block, {passive:false});
    document.addEventListener('gestureend', block, {passive:false});
    document.addEventListener('touchmove', function(e){
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, {passive:false});
    var lastTap = 0;
    document.addEventListener('touchend', function(e){
      var now = Date.now();
      if (now - lastTap < 300) e.preventDefault();
      lastTap = now;
    }, {passive:false});
  }
  true;
})();`;

/**
 * 博客站会把 localStorage 的 token/userInfo 迁到 sessionStorage。
 * 在文档脚本跑之前写入 localStorage，即可恢复登录态。
 */
function buildRestoreAuthJs(cache: BlogAuthCache | null): string {
  if (!cache?.token && !cache?.userInfo) return 'true;';
  const payload = JSON.stringify({
    token: cache.token ?? null,
    userInfo: cache.userInfo ?? null,
  });
  return `(function(){
  try {
    var data = ${payload};
    var ls = window.localStorage;
    if (!ls) return;
    if (data.token) ls.setItem('token', String(data.token));
    if (data.userInfo) ls.setItem('userInfo', String(data.userInfo));
  } catch (e) {}
  true;
})();`;
}

/** 监听博客登录态变化，回传给 App 做持久化 */
const SYNC_AUTH_JS = `(function(){
  if (window.__selfappBlogAuthSync) return true;
  window.__selfappBlogAuthSync = true;
  var KEYS = ['token', 'userInfo'];
  function readAuth() {
    var out = {};
    try {
      var ss = window.sessionStorage;
      var ls = window.localStorage;
      for (var i = 0; i < KEYS.length; i++) {
        var k = KEYS[i];
        var v = null;
        try { if (ss) v = ss.getItem(k); } catch (e1) {}
        if (!v) { try { if (ls) v = ls.getItem(k); } catch (e2) {} }
        if (v) out[k] = v;
      }
    } catch (e) {}
    return out;
  }
  function post(type, data) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data || {} }));
      }
    } catch (e) {}
  }
  function sync() {
    var auth = readAuth();
    if (auth.token || auth.userInfo) post('blog-auth', auth);
    else post('blog-auth-clear', {});
  }
  function patch(storage) {
    if (!storage || storage.__selfappPatched) return;
    try {
      var rawSet = storage.setItem.bind(storage);
      var rawRemove = storage.removeItem.bind(storage);
      var rawClear = storage.clear.bind(storage);
      storage.setItem = function(k, v) {
        rawSet(k, v);
        if (KEYS.indexOf(k) >= 0) sync();
      };
      storage.removeItem = function(k) {
        rawRemove(k);
        if (KEYS.indexOf(k) >= 0) sync();
      };
      storage.clear = function() {
        rawClear();
        sync();
      };
      storage.__selfappPatched = true;
    } catch (e) {}
  }
  try {
    patch(window.sessionStorage);
    patch(window.localStorage);
  } catch (e) {}
  sync();
  setInterval(sync, 2500);
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'hidden') sync();
  });
  window.addEventListener('pagehide', sync);
  true;
})();`;

function isAllowedBlogUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseBlogAuthCache(raw: string | null): BlogAuthCache | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    const token = typeof o.token === 'string' && o.token ? o.token : undefined;
    const userInfo = typeof o.userInfo === 'string' && o.userInfo ? o.userInfo : undefined;
    if (!token && !userInfo) return null;
    return { token, userInfo };
  } catch {
    return null;
  }
}

export default function BlogScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');
  const [currentUri, setCurrentUri] = useState(BLOG_ORIGIN);
  const [reloadKey, setReloadKey] = useState(0);
  const [authCache, setAuthCache] = useState<BlogAuthCache | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedAuthRef = useRef<string>('');

  const source = useMemo(() => ({ uri: currentUri }), [currentUri]);

  const beforeContentJs = useMemo(
    () => `${DISABLE_ZOOM_JS}\n${buildRestoreAuthJs(authCache)}`,
    [authCache],
  );
  const injectedJs = useMemo(() => `${DISABLE_ZOOM_JS}\n${SYNC_AUTH_JS}`, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(BLOG_AUTH_STORAGE_KEY);
        const cache = parseBlogAuthCache(raw);
        if (!cancelled) {
          setAuthCache(cache);
          lastSavedAuthRef.current = raw ?? '';
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      global.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const persistAuth = useCallback(async (cache: BlogAuthCache | null) => {
    try {
      if (!cache?.token && !cache?.userInfo) {
        if (lastSavedAuthRef.current !== '') {
          lastSavedAuthRef.current = '';
          await AsyncStorage.removeItem(BLOG_AUTH_STORAGE_KEY);
        }
        setAuthCache(null);
        return;
      }
      const next: BlogAuthCache = {};
      if (cache.token) next.token = cache.token;
      if (cache.userInfo) next.userInfo = cache.userInfo;
      const serialized = JSON.stringify(next);
      if (serialized === lastSavedAuthRef.current) return;
      lastSavedAuthRef.current = serialized;
      setAuthCache(next);
      await AsyncStorage.setItem(BLOG_AUTH_STORAGE_KEY, serialized);
    } catch {
      /* ignore */
    }
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const raw = event.nativeEvent.data;
      if (!raw) return;
      try {
        const msg = JSON.parse(raw) as { type?: string; data?: BlogAuthCache };
        if (msg.type === 'blog-auth') {
          void persistAuth(msg.data ?? null);
          return;
        }
        if (msg.type === 'blog-auth-clear') {
          void persistAuth(null);
        }
      } catch {
        /* ignore non-json messages */
      }
    },
    [persistAuth],
  );

  const handleShouldStart = useCallback((request: { url: string }) => {
    const { url } = request;
    if (!url || url === 'about:blank') return true;
    if (isAllowedBlogUrl(url)) return true;
    void Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  /** 左上角返回始终退出博客页，不走 WebView 历史 */
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/profile');
  }, [router]);

  const handleRetry = useCallback(() => {
    setLoadError(false);
    setErrorDetail('');
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const handleOpenExternal = useCallback(() => {
    void Linking.openURL(currentUri).catch(() => {});
  }, [currentUri]);

  const armTimeout = useCallback(() => {
    clearTimer();
    timeoutRef.current = global.setTimeout(() => {
      // 超时再尝试裸域兜底一次，避免 www 解析/DNS 局部问题被误判为无网
      if (currentUri === BLOG_ORIGIN) {
        setCurrentUri(BLOG_FALLBACK);
        setReloadKey((k) => k + 1);
      } else {
        setLoading(false);
        setErrorDetail('加载超时（20s），可能是网络较慢或站点响应慢');
        setLoadError(true);
      }
    }, LOAD_TIMEOUT_MS);
  }, [clearTimer, currentUri]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title="博客"
        onBack={handleBack}
        right={
          <ScreenHeaderIconAction
            icon="refresh"
            onPress={handleRetry}
            accessibilityLabel="刷新博客"
          />
        }
      />

      <View style={styles.body}>
        {loadError ? (
          <View style={styles.center}>
            <AppText variant="body" style={{ color: colors.textSecondary, textAlign: 'center' }}>
              博客暂时打不开（本站在浏览器可正常访问，多为 App 内嵌网页被拦截或网络较慢）
              {errorDetail ? `\n${errorDetail}` : ''}
            </AppText>
            <View style={styles.retryRow}>
            <Pressable
              onPress={handleRetry}
              accessibilityRole="button"
              accessibilityLabel="重试加载博客"
              style={({ pressed }) => [
                styles.retryBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <AppText variant="bodyStrong" chrome style={{ color: colors.onPrimary }}>
                重试
              </AppText>
            </Pressable>
            <Pressable
              onPress={handleOpenExternal}
              accessibilityRole="button"
              accessibilityLabel="用浏览器打开博客"
              style={({ pressed }) => [
                styles.retryBtn,
                styles.ghostBtn,
                {
                  borderColor: colors.primary,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <AppText variant="bodyStrong" style={{ color: colors.primary }}>
                用浏览器打开
              </AppText>
            </Pressable>
            </View>
          </View>
        ) : !authReady ? (
          <View style={[styles.center, { backgroundColor: colors.background }]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <WebView
              key={reloadKey}
              source={source}
              style={styles.webview}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              mixedContentMode="always"
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              allowsBackForwardNavigationGestures
              setSupportMultipleWindows={false}
              startInLoadingState={false}
              cacheEnabled
              incognito={false}
              scalesPageToFit={false}
              setBuiltInZoomControls={false}
              setDisplayZoomControls={false}
              textZoom={100}
              injectedJavaScriptBeforeContentLoaded={beforeContentJs}
              injectedJavaScript={injectedJs}
              onMessage={handleMessage}
              userAgent="Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 SelfApp"
              renderError={(domain, code, desc) => {
                setLoading(false);
                setErrorDetail(`${domain} ${code}：${desc}`);
                setLoadError(true);
              }}
              onLoadStart={() => {
                setLoading(true);
                setLoadError(false);
                setErrorDetail('');
                armTimeout();
              }}
              onLoadEnd={() => {
                clearTimer();
                setLoading(false);
              }}
              onError={(e) => {
                clearTimer();
                setLoading(false);
                const { domain, code, description } = e.nativeEvent;
                setErrorDetail(`${domain ?? ''} ${code ?? ''}：${description ?? '加载失败'}`.trim());
                setLoadError(true);
              }}
              onHttpError={(e) => {
                // 仅主文档 >=400 才判错，子资源（favicon/统计/js）的 404 不能整页报错
                const { statusCode, url } = e.nativeEvent;
                if (statusCode >= 400 && (!url || url === currentUri || url.startsWith(currentUri))) {
                  clearTimer();
                  setLoading(false);
                  setErrorDetail(`HTTP ${statusCode}`);
                  setLoadError(true);
                }
              }}
              onShouldStartLoadWithRequest={handleShouldStart}
            />
            {loading ? (
              <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]} pointerEvents="none">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  webview: { flex: 1, backgroundColor: 'transparent' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['5xl'],
    gap: Spacing['3xl'],
  },
  retryBtn: {
    paddingHorizontal: Spacing['4xl'],
    paddingVertical: Spacing.lg,
    borderRadius: 10,
  },
  retryRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'center',
  },
  ghostBtn: {
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
});
