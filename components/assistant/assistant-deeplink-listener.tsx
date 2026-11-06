/**
 * P3：助手 / Widget 深链监听。
 * Widget 只深链打开 App；进 App 后再 brief / 开助手；不在此调 LLM 热路径以外的写库。
 */
import { openGlobalAssistant } from '@/lib/assistant/host-controller';
import { readClipboardForAssistant } from '@/lib/assistant/clipboard';
import { parseAssistantDeepLink } from '@/lib/assistant/deeplink';
import {
  clearShortcutAssistantArtifacts,
  consumeShortcutAssistantClipboardMarker,
  consumeShortcutAssistantPendingImage,
  getShortcutAssistantHandoffKey,
} from '@/lib/assistant/shortcut-handoff';
import { toast } from '@/lib/app-feedback';
import * as Linking from 'expo-linking';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

async function openAssistantFromClipboard(): Promise<void> {
  const payload = await readClipboardForAssistant();
  if (!payload) {
    toast.info('剪贴板没有可用的文字或图片');
    openGlobalAssistant({ openOnly: true });
    return;
  }
  openGlobalAssistant({
    text: payload.text,
    imageDataUri: payload.imageDataUri,
    autoSubmit: true,
  });
}

async function consumeAssistantShortcutHandoff(): Promise<boolean> {
  const key = getShortcutAssistantHandoffKey();
  if (!key) return false;
  if (key === 'assistant:image') {
    const uri = await consumeShortcutAssistantPendingImage();
    if (uri) {
      openGlobalAssistant({ imageDataUri: uri, autoSubmit: true });
      return true;
    }
  }
  if (key === 'assistant:clipboard' || consumeShortcutAssistantClipboardMarker()) {
    await openAssistantFromClipboard();
    return true;
  }
  return false;
}

function hrefForKind(
  kind: ReturnType<typeof parseAssistantDeepLink>['kind'],
  query: Record<string, string>,
): string | null {
  switch (kind) {
    case 'tab_finance':
      return '/(tabs)/finance';
    case 'tab_tasks':
      return '/(tabs)/tasks';
    case 'tab_health':
    case 'assistant_brief':
      return '/(tabs)/';
    case 'tab_profile':
      return '/(tabs)/profile';
    case 'tab_review':
      return '/(tabs)/review';
    case 'wardrobe':
      return '/my-wardrobe';
    default:
      return null;
  }
}

export function AssistantDeepLinkListener() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const navReady = rootNavigationState?.key != null;
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !navReady) return;

    clearShortcutAssistantArtifacts();

    const handleUrl = (url: string) => {
      const parsed = parseAssistantDeepLink(url);
      if (parsed.kind === 'unknown') return;

      const dedupe = `${parsed.kind}:${url}`;
      if (lastKeyRef.current === dedupe) return;
      lastKeyRef.current = dedupe;

      const run = () => {
        if (parsed.kind === 'assistant_open') {
          openGlobalAssistant({ openOnly: true });
          return;
        }
        if (parsed.kind === 'assistant_clipboard') {
          void openAssistantFromClipboard();
          return;
        }
        if (parsed.kind === 'assistant_brief') {
          const href = hrefForKind(parsed.kind, parsed.query);
          if (href) router.push(href as never);
          // 首页 DailyBriefPanel 会因 focus 自动加载；再开助手提示
          openGlobalAssistant({ focusBrief: true, openOnly: true });
          return;
        }
        const href = hrefForKind(parsed.kind, parsed.query);
        if (href) {
          router.push(href as never);
        }
      };
      requestAnimationFrame(run);
    };

    const handoff = () => {
      void consumeAssistantShortcutHandoff().then(ok => {
        if (ok) lastKeyRef.current = getShortcutAssistantHandoffKey() || 'assistant:done';
      });
    };

    handoff();

    void Linking.getInitialURL().then(initial => {
      if (initial) handleUrl(initial);
    });

    const linkingSub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') handoff();
    });

    return () => {
      linkingSub.remove();
      appStateSub.remove();
    };
  }, [navReady, router]);

  return null;
}
