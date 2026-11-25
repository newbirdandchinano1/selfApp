import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemePreference } from '@/contexts/theme-preference-context';
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { ThemeColors, lightColors, darkColors } from './colors';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  colors: lightColors,
  isDark: false,
  toggle: () => {},
  setMode: () => {},
});

/** 跟随 SelfApp 全局外观偏好（设置里的夜间模式 / 跟随系统） */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const { setPreference } = useThemePreference();
  const mode: ThemeMode = scheme === 'dark' ? 'dark' : 'light';

  const setMode = useCallback(
    (m: ThemeMode) => {
      void setPreference(m);
    },
    [setPreference],
  );

  const toggle = useCallback(() => {
    void setPreference(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      colors: mode === 'dark' ? darkColors : lightColors,
      isDark: mode === 'dark',
      toggle,
      setMode,
    }),
    [mode, toggle, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
