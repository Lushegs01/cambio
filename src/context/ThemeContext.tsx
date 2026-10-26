import React, { createContext, useContext, useEffect, useState } from 'react';
import { appKit } from '../config/walletConnect';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
}

function savedTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem('cambio_theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch { /* Browser storage is optional. */ }
  return 'light';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemePreference>(savedTheme);

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => savedTheme() === 'dark' || (savedTheme() === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const applyTheme = () => {
      let active: ResolvedTheme = 'light';
      if (theme === 'system') {
        active = mediaQuery.matches ? 'dark' : 'light';
      } else {
        active = theme;
      }

      setResolvedTheme(active);

      const root = document.documentElement;
      if (active === 'dark') {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
      }

      // Sync Reown AppKit / WalletConnect modal theme seamlessly
      try {
        if (appKit && typeof (appKit as any).setThemeMode === 'function') {
          (appKit as any).setThemeMode(active);
        }
      } catch {
        // AppKit may still be initializing
      }
    };

    applyTheme();

    const handleChange = () => {
      if (theme === 'system') {
        applyTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = (newTheme: ThemePreference) => {
    setThemeState(newTheme);
    try { localStorage.setItem('cambio_theme', newTheme); } catch { /* Keep the preference for this session. */ }
  };

  const toggleTheme = () => {
    const nextTheme: ThemePreference = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
