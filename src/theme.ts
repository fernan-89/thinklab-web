/** The colour scheme: follow the system (the default), or force light or dark. The choice lives in this browser only. */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

const KEY = 'thinklab.theme';

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // storage unavailable (private window): the choice lasts until the page is closed
  }
}

/** tokens.css and styles.css read data-theme; without it the system setting decides. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}