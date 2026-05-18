import { useThemePreference } from '@/contexts/theme-preference-context';

export function useColorScheme(): 'light' | 'dark' {
  const { colorScheme } = useThemePreference();
  return colorScheme;
}
