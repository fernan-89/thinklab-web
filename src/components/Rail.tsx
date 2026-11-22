import { useState } from 'react';
import { LANGUAGES, useI18n, type Language } from '../i18n';
import { applyTheme, readTheme, saveTheme, THEMES, type ThemeChoice } from '../theme';

const THEME_LABELS: Record<ThemeChoice, string> = { system: 'SYS', light: 'LIGHT', dark: 'DARK' };
const LANGUAGE_LABELS: Record<Language, string> = { pt: 'PT', en: 'EN' };

/** The vertical pill of the design pack: the language switch, the red dot and the theme switch. */
export function Rail() {
  const { language, setLanguage, t } = useI18n();
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);

  function chooseTheme(choice: ThemeChoice) {
    setTheme(choice);
    saveTheme(choice);
    applyTheme(choice);
  }

  return (
    <div className="rail">
      <div className="rail-group" role="group" aria-label={t('rail.language')}>
        {LANGUAGES.map((choice) => (
          <button key={choice} type="button" lang={choice} aria-pressed={language === choice} className={language === choice ? 'on' : undefined} onClick={() => setLanguage(choice)}>
            {LANGUAGE_LABELS[choice]}
          </button>
        ))}
      </div>
      <i aria-hidden="true" />
      <div className="rail-group" role="group" aria-label={t('rail.theme')}>
        {THEMES.map((choice) => (
          <button key={choice} type="button" aria-pressed={theme === choice} className={theme === choice ? 'on' : undefined} onClick={() => chooseTheme(choice)}>
            {THEME_LABELS[choice]}
          </button>
        ))}
      </div>
    </div>
  );
}