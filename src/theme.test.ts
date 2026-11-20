import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readTheme, saveTheme } from './theme';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('follows the system until a theme is chosen, and remembers a forced one', () => {
    expect(readTheme()).toBe('system');
    saveTheme('dark');
    expect(readTheme()).toBe('dark');
    saveTheme('light');
    expect(readTheme()).toBe('light');
    saveTheme('system');
    expect(readTheme()).toBe('system');
    expect(localStorage.getItem('thinklab.theme')).toBeNull();
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem('thinklab.theme', 'sepia');
    expect(readTheme()).toBe('system');
  });

  it('sets data-theme for a forced theme and removes it for the system', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('still works when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readTheme()).toBe('system');
    expect(() => saveTheme('dark')).not.toThrow();
    expect(() => saveTheme('system')).not.toThrow();
  });
});