import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from './en';
import { detectLanguage, fill, hasMessage, LanguageProvider, useI18n } from './index';
import { pt } from './pt';
import { statusPt } from './status';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
  vi.restoreAllMocks();
});

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the dictionaries', () => {
  it('have the same keys, no empty text, and the same {placeholders} in both languages', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(pt[key].trim(), key).not.toBe('');
      expect(placeholders(pt[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('give Portuguese to every status the stylesheet colours', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const statuses = new Set([...css.matchAll(/\.badge-([a-z0-9_]+)/g)].map((m) => m[1]));
    expect(statuses.size).toBeGreaterThan(80);
    expect([...statuses].filter((status) => !statusPt[status])).toEqual([]);
  });
});

describe('fill', () => {
  it('replaces each {name} and leaves one with no value as written', () => {
    expect(fill('{a} of {b}', { a: 2, b: 'five' })).toBe('2 of five');
    expect(fill('{a} of {b}', { a: 2 })).toBe('2 of {b}');
    expect(fill('plain')).toBe('plain');
  });

  it('knows which keys exist', () => {
    expect(hasMessage('nav.assets')).toBe(true);
    expect(hasMessage('login.sso.ERR-FED-00403')).toBe(true);
    expect(hasMessage('login.sso.ERR-NOPE')).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('is English for an English browser and Portuguese for a Portuguese one', () => {
    expect(detectLanguage()).toBe('en');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-BR');
    expect(detectLanguage()).toBe('pt');
  });

  it('prefers the saved choice, ignores one it does not know, and survives blocked storage', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-PT');
    localStorage.setItem('thinklab.language', 'en');
    expect(detectLanguage()).toBe('en');
    localStorage.setItem('thinklab.language', 'fr');
    expect(detectLanguage()).toBe('pt');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(detectLanguage()).toBe('pt');
  });
});

function Probe() {
  const { language, setLanguage, t, status, locale } = useI18n();
  return (
    <div>
      <p data-testid="out">{`${language}|${t('nav.assets')}|${status('known_error')}|${status('SOMETHING_NEW')}|${locale}`}</p>
      <button onClick={() => setLanguage('pt')}>to pt</button>
      <button onClick={() => setLanguage('en')}>to en</button>
    </div>
  );
}

describe('LanguageProvider', () => {
  it('speaks English without a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('out')).toHaveTextContent('en|Assets|known error|SOMETHING NEW|en-GB');
  });

  it('switches the text, the status labels, the locale and the page language, and remembers the choice', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider initial="en">
        <Probe />
      </LanguageProvider>,
    );
    expect(document.documentElement.lang).toBe('en');
    await user.click(screen.getByText('to pt'));
    expect(screen.getByTestId('out')).toHaveTextContent('pt|Ativos|erro conhecido|SOMETHING NEW|pt-BR');
    expect(document.documentElement.lang).toBe('pt');
    expect(localStorage.getItem('thinklab.language')).toBe('pt');
    await user.click(screen.getByText('to en'));
    expect(screen.getByTestId('out')).toHaveTextContent('en|Assets|known error');
  });

  it('still switches when the browser refuses storage', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <LanguageProvider initial="en">
        <Probe />
      </LanguageProvider>,
    );
    await user.click(screen.getByText('to pt'));
    expect(screen.getByTestId('out')).toHaveTextContent('pt|Ativos');
  });
});