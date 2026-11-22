import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { fakeFetch, renderWithSession } from '../test-utils';
import { LoginPage } from './Login';

function renderLogin(language: 'en' | 'pt', route = '/login') {
  return renderWithSession(
    <LanguageProvider initial={language}>
      <LoginPage />
    </LanguageProvider>,
    fakeFetch(() => undefined).impl,
    null,
    route,
  );
}

describe('the sign-in page in Portuguese', () => {
  it('has its tabs, labels and help in Portuguese, and the help follows the tab', async () => {
    const user = userEvent.setup();
    renderLogin('pt');
    expect(screen.getByText('Operações de ativos de TI da sua organização.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Stack local' })).toBeInTheDocument();
    expect(screen.getByLabelText('ID da organização')).toBeInTheDocument();
    expect(screen.getByLabelText('Seu nome (gravado em cada registro de auditoria)')).toBeInTheDocument();
    expect(screen.getByText(/stack com a segurança desligada/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Conta' }));
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(screen.getByText(/stack com a segurança ligada/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'SSO' }));
    expect(screen.getByRole('button', { name: 'Entrar com SSO' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('ID da organização'), 'abc');
    expect(screen.getByText('Isso não é um UUID válido.')).toBeInTheDocument();
  });

  it('says a failed federated sign-in in Portuguese, with the code, and has a Portuguese fallback', () => {
    renderLogin('pt', '/login?sso_error=ERR-FED-00403');
    expect(screen.getByRole('alert')).toHaveTextContent('não está vinculada a um usuário desta organização');
    expect(screen.getByRole('alert')).toHaveTextContent('ERR-FED-00403');
  });

  it('uses the fallback text for a code it does not know', () => {
    renderLogin('pt', '/login?sso_error=ERR-FED-00999');
    expect(screen.getByRole('alert')).toHaveTextContent('O provedor de identidade não confirmou o seu login.');
  });
});