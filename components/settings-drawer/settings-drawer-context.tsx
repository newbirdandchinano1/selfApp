import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type SettingsSection = 'appearance' | 'dayBoundary' | 'backup' | 'ai';

type SettingsDrawerContextValue = {
  isOpen: boolean;
  initialSection: SettingsSection | null;
  open: (section?: SettingsSection) => void;
  close: () => void;
  registerOnClose: (listener: () => void) => () => void;
};

const SettingsDrawerContext = createContext<SettingsDrawerContextValue | null>(null);

export function SettingsDrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialSection, setInitialSection] = useState<SettingsSection | null>(null);
  const closeListenersRef = useRef(new Set<() => void>());

  const open = useCallback((section?: SettingsSection) => {
    setInitialSection(section ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setInitialSection(null);
    closeListenersRef.current.forEach(l => l());
  }, []);

  const registerOnClose = useCallback((listener: () => void) => {
    closeListenersRef.current.add(listener);
    return () => closeListenersRef.current.delete(listener);
  }, []);

  const value = useMemo(
    () => ({ isOpen, initialSection, open, close, registerOnClose }),
    [isOpen, initialSection, open, close, registerOnClose],
  );

  return <SettingsDrawerContext.Provider value={value}>{children}</SettingsDrawerContext.Provider>;
}

export function useSettingsDrawer(): SettingsDrawerContextValue {
  const ctx = useContext(SettingsDrawerContext);
  if (!ctx) {
    throw new Error('useSettingsDrawer must be used within SettingsDrawerProvider');
  }
  return ctx;
}
