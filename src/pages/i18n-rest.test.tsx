import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { limitText, PlanPage } from './Plan';
import { QuickInstallPage } from './QuickInstall';
import { SsoCompletePage } from './SsoComplete';
import { TopologyPage } from './Topology';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };

function inPortuguese(page: React.ReactElement, handler: Handler) {
  return renderWithSession(<LanguageProvider initial="pt">{page}</LanguageProvider>, fakeFetch(handler).impl, me);
}

/** Words an English sentence has and a Portuguese one does not: if one is on screen, some text was not translated. */
const ENGLISH = /\b(the|with|from|yet|none|never|shown|loading|your|there|please|within|over|every|until|after|installs?|stick|unattended|includes?|known|limits?|rules?|how it works|subscription|entitlements?|included|unlimited|available|plans?)\b/i;
function expectNoEnglish(allowed: RegExp[] = []) {
  let text = document.body.textContent ?? '';
  for (const pattern of allowed) text = text.replace(pattern, '');
  expect(text.match(ENGLISH)?.[0], `English text on screen: ${text.slice(0, 600)}`).toBeUndefined();
}

describe('the plan in Portuguese', () => {
  const subscription = { id: 's1', organisationId: ORG, planCode: 'pro', status: 'PAST_DUE', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' };
  const entitlement = (feature: string, over: Record<string, unknown> = {}) => ({ feature, allowed: true, source: 'SUBSCRIPTION', planCode: 'pro', ...over });
  const handler: Handler = ({ url }) => {
    const path = url.pathname;
    if (path.endsWith('/current/retrieve')) return { body: subscription };
    if (path.endsWith('/entitlement/evaluate')) {
      const feature = url.searchParams.get('feature') ?? '';
      if (feature === 'assets') return { body: entitlement(feature, { limit: 100 }) };
      if (feature === 'sso') return { body: entitlement(feature, { allowed: false, source: 'DEFAULT_PLAN' }) };
      if (feature === 'sites') return { body: entitlement(feature, { source: 'UNMANAGED' }) };
      return { body: entitlement(feature) };
    }
    if (path.endsWith('/plan/retrieve')) return { body: [{ id: 'p1', code: 'pro', name: 'Pro', status: 'ACTIVE', entitlements: { assets: 100, sso: 0, audit: 1 } }] };
    return undefined;
  };

  it('has the subscription, the entitlements and the plans in Portuguese', async () => {
    inPortuguese(<PlanPage />, handler);
    expect(await screen.findByRole('table', { name: 'Direitos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plano', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/A edição em que esta organização está/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'O que inclui' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Decidido por' })).toBeInTheDocument();
    const card = screen.getByLabelText('Assinatura atual');
    expect(within(card).getByText(/no plano/)).toBeInTheDocument();
    expect(within(card).getByText(/desde/)).toBeInTheDocument();
    expect(within(card).getByText('O pagamento está atrasado. Tudo ainda funciona por enquanto.')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Direitos' });
    expect(within(table).getByText('Livro de auditoria')).toBeInTheDocument();
    expect(within(table).getByText('Login único')).toBeInTheDocument();
    expect(within(table).getByText('Não incluído')).toBeInTheDocument();
    expect(within(table).getByText('Plano padrão (sem assinatura)')).toBeInTheDocument();
    expect(within(table).getByText('Nenhum plano configurado: tudo é permitido')).toBeInTheDocument();
    expect(within(table).getAllByText('Sim').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Planos disponíveis' })).toBeInTheDocument();
    const plan = await screen.findByLabelText('Plano pro');
    expect(within(plan).getByText('(o seu)')).toBeInTheDocument();
    expect(within(plan).getByText(/Ativos: 100/)).toBeInTheDocument();
    expectNoEnglish([/\bpro\b/gi]);
  });

  it('words a limit through the translator and keeps the English without it', () => {
    const t = ((key: string) => key) as never;
    expect(limitText({ allowed: false }, true, t)).toBe('plan.notIncluded');
    expect(limitText({ allowed: true }, false, t)).toBe('plan.includedText');
    expect(limitText({ allowed: true }, true, t)).toBe('plan.unlimited');
    expect(limitText({ allowed: true, limit: 5 }, true, t)).toBe('5');
    expect(limitText({ allowed: false })).toBe('Not included');
  });
});

describe('Quick Install in Portuguese', () => {
  it('has the catalog of the stick, its filters, rules and limits in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<QuickInstallPage />, ({ url }) => (url.pathname.endsWith('/retrieve') ? { body: [] } : undefined));
    expect(await screen.findByText('Nenhum kit registrado ainda.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quick Install', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Um pen-drive Ventoy que instala Windows, Linux e ferramentas de recuperação/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add-on v1\.2\.2/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer família' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Estação de trabalho' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Português (PT-BR)' })).toBeInTheDocument();
    expect(screen.getAllByText(/Office correspondente; Drivers da máquina/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aparece no menu só quando a ISO está no pen-drive.').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Como funciona' })).toBeInTheDocument();
    expect(screen.getByText(/A escolha do disco é sempre manual/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Limites conhecidos' })).toBeInTheDocument();
    expect(screen.getByText(/não pode ser instalado em modo silencioso/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Família'), 'Recovery');
    expect(screen.getAllByText('Teste de memória').length).toBeGreaterThan(0);
    expectNoEnglish([/Hiren's BootCD PE/g, /SystemRescue, GParted Live, Clonezilla/g, /Kickstart/g, /Autoinstall/g]);
  });
});

describe('the topology graph and the SSO landing page in Portuguese', () => {
  it('names the graph and its nodes in Portuguese', async () => {
    inPortuguese(<TopologyPage />, ({ url }) => {
      if (url.pathname.endsWith('/edge/retrieve')) return { body: [] };
      if (url.pathname.endsWith('/retrieve')) return { body: [{ id: 'n1', label: 'core', nodeType: 'NETWORK_DEVICE', status: 'ACTIVE' }] };
      return undefined;
    });
    expect(await screen.findByRole('button', { name: 'core, NETWORK_DEVICE' })).toBeInTheDocument();
    expect(document.querySelector('svg[aria-label="Gráfico da topologia"]')).not.toBeNull();
  });

  it('says it is signing you in', () => {
    inPortuguese(<SsoCompletePage />, () => undefined);
    expect(screen.getByText('Entrando...')).toBeInTheDocument();
  });
});
