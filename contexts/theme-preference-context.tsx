import {
  loadThemePreference,
  resolveColorScheme,
  saveThemePreference,
  subscribeThemePreference,
  type ThemePreference,
} from '@/lib/theme-preference';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  colorScheme: 'light' | 'dark';
  setPreference: (pref: ThemePreference) => Promise<void>;
  isReady: boolean;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [isReady, setIsReady] = useState(false);
  const [systemScheme, setSystemScheme] = useState<'light' | 'dark'>(() =>
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );

  useEffect(() => {
    let mounted = true;
    void loadThemePreference().then(pref => {
      if (mounted) {
        setPreferenceState(pref);
        setIsReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return subscribeThemePreference(() => {
      void loadThemePreference().then(setPreferenceState);
    });
  }, []);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, []);

  const colorScheme = useMemo(() => {
    if (preference === 'system') return systemScheme;
    return resolveColorScheme(preference);
  }, [preference, systemScheme]);

  const setPreference = useCallback(async (pref: ThemePreference) => {
    await saveThemePreference(pref);
    setPreferenceState(pref);
  }, []);

  const value = useMemo(
    () => ({ preference, colorScheme, setPreference, isReady }),
    [preference, colorScheme, setPreference, isReady],
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useThemePreference(): ThemePreferenceContextValue {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) {
    return {
      preference: 'system',
      colorScheme: resolveColorScheme('system'),
      setPreference: async () => {},
      isReady: true,
    };
  }
  return ctx;
}
