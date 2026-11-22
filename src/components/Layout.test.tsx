import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { fakeFetch, renderWithSession } from '../test-utils';
import { Layout } from './Layout';

describe('Layout', () => {
  it('shows the menu, the product label and the sign-out button in English', () => {
    renderWithSession(<Layout />, fakeFetch(() => undefined).impl);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cloud inventory' })).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows all of it in Portuguese, with every one of the 25 links', () => {
    renderWithSession(
      <LanguageProvider initial="pt">
        <Layout />
      </LanguageProvider>,
      fakeFetch(() => undefined).impl,
    );
    expect(screen.getByRole('navigation', { name: 'Principal' }).querySelectorAll('a')).toHaveLength(25);
    expect(screen.getByRole('link', { name: 'Ativos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inventário de nuvem' })).toBeInTheDocument();
    expect(screen.getByText('Plataforma')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Assets' })).not.toBeInTheDocument();
  });
});