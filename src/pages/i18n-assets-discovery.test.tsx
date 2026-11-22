import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { fakeFetch, renderWithSession, type Handler } from '../test-utils';
import { AssetsPage } from './Assets';
import { AuditPage } from './Audit';
import { DiscoveryPage } from './Discovery';
import { TopologyPage } from './Topology';

const ASSET = { id: 'a1', name: 'Core switch', category: 'NETWORK_DEVICE', serialNumber: 'SN-1', status: 'DEPLOYED', specifications: { cpu: '8' } };
const AUDIT = [{ action: 'deploy', executor: 'tester', fromStatus: 'READY', toStatus: 'DEPLOYED', occurredAt: '2026-11-20T10:00:00Z', detail: 'rack 4' }];

function inPortuguese(page: React.ReactElement, handler: Handler) {
  return renderWithSession(<LanguageProvider initial="pt">{page}</LanguageProvider>, fakeFetch(handler).impl);
}

describe('the assets screen in Portuguese', () => {
  const handler: Handler = ({ url }) => {
    if (url.pathname.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (url.pathname.endsWith('/a1/retrieve')) return { body: ASSET };
    if (url.pathname.endsWith('/retrieve')) return { body: [ASSET] };
    return undefined;
  };

  it('has its headers, filters, status pills and detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<AssetsPage />, handler);
    expect(await screen.findByRole('button', { name: 'Core switch' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ativos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo ativo' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Série' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Todos os status' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'implantado' })).toBeInTheDocument();
    expect(screen.getByText('1 exibidos')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Core switch' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do ativo' });
    expect(within(detail).getByRole('heading', { name: 'Especificações' })).toBeInTheDocument();
    expect(within(detail).getByRole('heading', { name: 'Registro de auditoria' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Iniciar manutenção' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Desativar' })).toBeInTheDocument();
    expect(within(detail).getByText(/por tester/)).toBeInTheDocument();
    expect(within(detail).getByText(/de pronto para implantado/)).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('says nothing matches in Portuguese, and the new asset form is in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<AssetsPage />, ({ url }) => (url.pathname.endsWith('/retrieve') ? { body: [] } : undefined));
    expect(await screen.findByText('Nenhum ativo encontrado.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo ativo' }));
    const form = screen.getByRole('form', { name: 'Novo ativo' });
    expect(within(form).getByLabelText('Número de série')).toBeInTheDocument();
    expect(within(form).getByText('Especificações')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Adicionar especificação' }));
    expect(within(form).getByPlaceholderText('nome (ex.: cpu)')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Registrar ativo' })).toBeDisabled();
    expect(within(form).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });
});

describe('the discovery screen in Portuguese', () => {
  const item = { id: 'd1', name: 'nas-01', status: 'DISCOVERED', source: 'nmap', externalKey: '10.0.0.5', lastSeenAt: '2026-11-20T10:00:00Z', rawAttributes: {} };

  it('shows the intro, the count, the status pill and the review buttons in Portuguese', async () => {
    inPortuguese(<DiscoveryPage />, ({ url }) => (url.pathname.endsWith('/retrieve') ? { body: [item] } : undefined));
    expect(await screen.findByText('nas-01')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Descoberta' })).toBeInTheDocument();
    expect(screen.getByText(/esperam aqui até alguém revisá-los/)).toBeInTheDocument();
    expect(screen.getByText('1 itens')).toBeInTheDocument();
    expect(screen.getAllByText('descoberto').length).toBeGreaterThan(0);
    expect(screen.getByText(/visto pela última vez em/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assumir para revisão' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ignorar' })).toBeInTheDocument();
  });

  it('shows the category and promotion controls of an item under review, and an empty list, in Portuguese', async () => {
    inPortuguese(<DiscoveryPage />, ({ url }) => (url.pathname.endsWith('/retrieve') ? { body: [{ ...item, status: 'UNDER_REVIEW' }] } : undefined));
    expect(await screen.findByRole('button', { name: 'Salvar categoria' })).toBeInTheDocument();
    const promote = screen.getByRole('button', { name: 'Promover a ativo' });
    expect(promote).toHaveAttribute('title', 'Salve uma categoria antes');
  });

  it('says there is nothing to review', async () => {
    inPortuguese(<DiscoveryPage />, ({ url }) => (url.pathname.endsWith('/retrieve') ? { body: [] } : undefined));
    expect(await screen.findByText('Nada para revisar.')).toBeInTheDocument();
  });
});

describe('the topology screen in Portuguese', () => {
  it('says what to do and shows the blast radius panel in Portuguese', async () => {
    inPortuguese(<TopologyPage />, ({ url }) => {
      if (url.pathname.endsWith('/edge/retrieve')) return { body: [] };
      if (url.pathname.endsWith('/retrieve')) return { body: [{ id: 'n1', label: 'core', nodeType: 'NETWORK_DEVICE', status: 'ACTIVE' }] };
      return undefined;
    });
    expect(await screen.findByRole('complementary', { name: 'Raio de impacto' })).toBeInTheDocument();
    expect(screen.getByText('Selecione um nó para ver o que uma falha nele atingiria.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum nó selecionado.')).toBeInTheDocument();
  });

  it('says the graph is empty', async () => {
    inPortuguese(<TopologyPage />, () => ({ body: [] }));
    expect(await screen.findByText(/O grafo está vazio/)).toBeInTheDocument();
  });
});

describe('the audit screen in Portuguese', () => {
  const entries = [
    { id: 'e1', sequence: 1, occurredAt: '2026-11-20T10:00:00Z', actor: 'tester', action: 'asset.deploy', resourceType: 'it-asset-registry', resourceId: '12345678-aaaa', detail: 'ok' },
  ];

  it('has its headers and filters in Portuguese and verifies the chain in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<AuditPage />, ({ url }) => {
      if (url.pathname.endsWith('/integrity-check/evaluate')) return { body: { valid: true, entriesChecked: 3, headHash: 'abcdef0123456789abcdef', anchorsVerified: 1 } };
      if (url.pathname.endsWith('/retrieve')) return { body: entries };
      return undefined;
    });
    expect(await screen.findByText('asset.deploy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Auditoria' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Quando' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Ator' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tipo de recurso (ex.: it-asset-registry)')).toBeInTheDocument();
    expect(screen.getByText('1 exibidos (mais novos primeiro)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verificar integridade' }));
    const verdict = await screen.findByRole('status');
    expect(verdict).toHaveTextContent('Íntegra.');
    expect(verdict).toHaveTextContent('3 registros verificados.');
    expect(verdict).toHaveTextContent('Topo');
    expect(verdict).toHaveTextContent('Confirmada contra 1 âncora publicada fora do banco de dados.');
  });

  it('says where a broken chain breaks, in Portuguese, and has the singular forms', async () => {
    const user = userEvent.setup();
    inPortuguese(<AuditPage />, ({ url }) => {
      if (url.pathname.endsWith('/integrity-check/evaluate')) return { body: { valid: false, firstBrokenSequence: 7, headSequence: 6, reason: 'hash mismatch' } };
      if (url.pathname.endsWith('/retrieve')) return { body: [] };
      return undefined;
    });
    expect(await screen.findByText('Nenhum registro.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verificar integridade' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cadeia quebrada no registro #7.');
    expect(alert).toHaveTextContent('Tudo até #6 continua confiável.');
    expect(alert).toHaveTextContent('hash mismatch');
  });
});
