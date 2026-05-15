import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

function matchesScreenshotDeepLink(url: string): boolean {
  const { hostname, path } = Linking.parse(url);
  const normalizedPath = (path ?? '').replace(/^\/+|\/+$/g, '');
  return (
    hostname === 'screenshot' ||
    normalizedPath === 'screenshot' ||
    /:\/\/screenshot(\/|\?|$)/i.test(url)
  );
}

/**
 * 在数据库就绪后挂载：处理冷启动 `getInitialURL` 与后台唤起 `url` 事件，
 * 确保 `zheng://screenshot` 会进入剪贴板截图页。
 */
export function ScreenshotDeepLinkListener() {
  const router = useRouter();

  useEffect(() => {
    const go = (url: string) => {
      if (matchesScreenshotDeepLink(url)) {
        router.replace('/screenshot');
      }
    };

    void Linking.getInitialURL().then((initial) => {
      if (initial) go(initial);
    });

    const sub = Linking.addEventListener('url', ({ url }) => go(url));
    return () => sub.remove();
  }, [router]);

  return null;
}
