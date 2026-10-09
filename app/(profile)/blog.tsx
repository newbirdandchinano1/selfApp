import { AppText, ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
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
import { WebView, type WebViewNavigation } from 'react-native-webview';

	const BLOG_ORIGIN = 'https://jaxz.xyz';
	const BLOG_FALLBACK = 'https://www.jaxz.xyz';
	const ALLOWED_HOSTS = new Set(['jaxz.xyz', 'www.jaxz.xyz']);
	const LOAD_TIMEOUT_MS = 20000;

function isAllowedBlogUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export default function BlogScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUri, setCurrentUri] = useState(BLOG_ORIGIN);
  const [reloadKey, setReloadKey] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const source = useMemo(() => ({ uri: currentUri }), [currentUri]);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      global.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const handleShouldStart = useCallback((request: { url: string }) => {
    const { url } = request;
    if (!url || url === 'about:blank') return true;
    if (isAllowedBlogUrl(url)) return true;
    void Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  const handleNavChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  }, []);

  const handleBack = useCallback(() => {
    if (canGoBack) {
      webRef.current?.goBack();
      return;
    }
    router.back();
  }, [canGoBack, router]);

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
      // 超时再尝试 www 兜底一次，避免裸域解析/DNS 局部问题被误判为无网
      if (currentUri === BLOG_ORIGIN) {
        setCurrentUri(BLOG_FALLBACK);
        setReloadKey((k) => k + 1);
      } else {
        setLoading(false);
        setErrorDetail('加载超时（20s），可能是网络较慢或站点响应慢');
        setLoadError(true);
      }
    }, LOAD_TIMEOUT_MS);
  }, [clearTimeout, currentUri]);

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
        ) : (
          <>
            <WebView
              key={reloadKey}
              ref={webRef}
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
              onNavigationStateChange={handleNavChange}
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
