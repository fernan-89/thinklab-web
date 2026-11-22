import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { Rail } from './Rail';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('data-theme');
});

describe('Rail', () => {
  it('starts on the system theme, switches the page and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<Rail />);
    expect(screen.getByRole('button', { name: 'SYS' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'DARK' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'DARK' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'SYS' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('thinklab.theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'LIGHT' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: 'SYS' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('thinklab.theme')).toBeNull();
  });

  it('opens on the theme saved earlier', () => {
    localStorage.setItem('thinklab.theme', 'light');
    render(<Rail />);
    expect(screen.getByRole('button', { name: 'LIGHT' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches the language, names its groups in that language and remembers the choice', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider initial="en">
        <Rail />
      </LanguageProvider>,
    );
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'PT' }));
    expect(screen.getByRole('button', { name: 'PT' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Idioma' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tema' })).toBeInTheDocument();
    expect(localStorage.getItem('thinklab.language')).toBe('pt');
  });
});