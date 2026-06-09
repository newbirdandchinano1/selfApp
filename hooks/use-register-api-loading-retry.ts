import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';

import { registerApiLoadingRetryTarget } from '@/lib/api-loading-tracker';

/** 当前聚焦页面注册重试回调，加载超时后点「重试」会重新执行 reload */
export function useRegisterApiLoadingRetry(reload: (forceApi?: boolean) => void | Promise<void>) {
  useFocusEffect(
    useCallback(() => {
      const invoke = () => {
        void reload(true);
      };
      return registerApiLoadingRetryTarget(invoke);
    }, [reload]),
  );
}
