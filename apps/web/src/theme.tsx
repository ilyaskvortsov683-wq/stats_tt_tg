import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import palettes from '@stats/design-tokens/palettes';

export type Mode = 'light' | 'dark' | 'system';
export interface Palette { id: string; title: string; note: string; preview: string[] }
export const PALETTES = palettes as Palette[];

interface ThemeState { mode: Mode; palette: string; setMode: (m: Mode) => void; setPalette: (p: string) => void }
const Ctx = createContext<ThemeState | null>(null);

function read(): { mode: Mode; palette: string } {
  try {
    const t = JSON.parse(localStorage.getItem('theme') || '{}');
    return { mode: t.mode ?? 'system', palette: t.palette ?? 'paper' };
  } catch {
    return { mode: 'system', palette: 'paper' };
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(read);

  useEffect(() => {
    const apply = () => {
      const dark = state.mode === 'dark' || (state.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-mode', dark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-palette', state.palette);
    };
    apply();
    try { localStorage.setItem('theme', JSON.stringify(state)); } catch { /* приватный режим */ }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [state]);

  return (
    <Ctx.Provider value={{
      ...state,
      setMode: (mode) => setState((s) => ({ ...s, mode })),
      setPalette: (palette) => setState((s) => ({ ...s, palette })),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('ThemeProvider missing');
  return v;
}

/** Параметры темы для открытия отчёта в той же палитре. */
export function themeQuery(): string {
  const mode = document.documentElement.getAttribute('data-mode') ?? 'light';
  const palette = document.documentElement.getAttribute('data-palette') ?? 'paper';
  return `?mode=${mode}&palette=${palette}`;
}
