import { useState } from 'react';
import { applyTheme, readTheme, saveTheme, THEMES, type ThemeChoice } from '../theme';

const LABELS: Record<ThemeChoice, string> = { system: 'SYS', light: 'LIGHT', dark: 'DARK' };

/** The vertical pill of the design pack: the theme switch and the red dot. (The language switch joins it with PT/EN.) */
export function Rail() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);

  function choose(choice: ThemeChoice) {
    setTheme(choice);
    saveTheme(choice);
    applyTheme(choice);
  }

  return (
    <div className="rail" role="group" aria-label="Theme">
      {THEMES.map((choice) => (
        <button key={choice} type="button" aria-pressed={theme === choice} className={theme === choice ? 'on' : undefined} onClick={() => choose(choice)}>
          {LABELS[choice]}
        </button>
      ))}
      <i aria-hidden="true" />
    </div>
  );
}