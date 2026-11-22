import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { actionPt } from './actions';
import { labelPt } from './labels';
import { pt } from './pt';
import { statusPt } from './status';

export type Language = 'en' | 'pt';

/** In the order the rail shows them. */
export const LANGUAGES: readonly Language[] = ['pt', 'en'];

const KEY = 'thinklab.language';
const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, pt };
const LOCALES: Record<Language, string> = { en: 'en-GB', pt: 'pt-BR' };

type Params = Record<string, string | number>;

/** The 	 function, for helpers outside a component that take it as a parameter. */
export type Translate = (key: MessageKey, params?: Params) => string;

/** Fills each `{name}` of a message; a name with no value is left as written, so a missing one is visible. */
export function fill(message: string, params?: Params): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export function hasMessage(key: string): key is MessageKey {
  return key in en;
}

/** The saved choice; without one, Portuguese for a Portuguese browser and English for everything else. */
export function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'pt' || stored === 'en') return stored;
  } catch {
    // storage unavailable: fall through to the browser's language
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

function saveLanguage(language: Language): void {
  try {
    localStorage.setItem(KEY, language);
  } catch {
    // storage unavailable (private window): the choice lasts until the page is closed
  }
}

interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  /** A message of the dictionary, with its `{name}` values filled in. */
  t: (key: MessageKey, params?: Params) => string;
  /** The label of a status pill: Portuguese when known, otherwise the value as the backend sends it with the underscores as spaces. */
  status: (value: string) => string;
  /** An enum value shown as the API sends it (English) or in Portuguese when known: VENDOR_NO_FIX stays itself in English. */
  enumValue: (value: string) => string;
  /** The text of an action button: Portuguese when known, otherwise the English label. */
  action: (label: string) => string;
  /** The text of an option the API types define in English (a class, a source, a strategy): Portuguese when known, otherwise the English text. */
  label: (text: string) => string;
  /** The locale for dates and numbers: `new Date(x).toLocaleString(locale)`. */
  locale: string;
}

function build(language: Language, setLanguage: (language: Language) => void): I18n {
  const dictionary = DICTIONARIES[language];
  return {
    language,
    setLanguage,
    t: (key, params) => fill(dictionary[key], params),
    status: (value) => {
      const plain = value.replace(/_/g, ' ');
      return language === 'pt' ? (statusPt[value.toLowerCase()] ?? plain) : plain;
    },
    enumValue: (value) => (language === 'pt' ? (statusPt[value.toLowerCase()] ?? value) : value),
    action: (label) => (language === 'pt' ? (actionPt[label] ?? label) : label),
    label: (text) => (language === 'pt' ? (labelPt[text] ?? text) : text),
    locale: LOCALES[language],
  };
}

/** Without a provider (a test, a component on its own) the app speaks English. */
const I18nContext = createContext<I18n>(build('en', () => undefined));

export function LanguageProvider({ children, initial }: { children: ReactNode; initial?: Language }) {
  const [language, setLanguageState] = useState<Language>(() => initial ?? detectLanguage());
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    saveLanguage(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo(() => build(language, setLanguage), [language, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

export function useT(): I18n['t'] {
  return useContext(I18nContext).t;
}