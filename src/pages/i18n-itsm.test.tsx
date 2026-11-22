import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { IncidentsPage, parseIds } from './Incidents';
import { IntegrationsPage } from './Integrations';
import { KnowledgePage } from './Knowledge';
import { ProblemsPage } from './Problems';
import { parseFields, ServiceRequestsPage } from './ServiceRequests';

beforeEach(() => sessionStorage.clear());

const ME = '0a0a0a0a-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const me = { organisationId: ORG, executor: ME };
const AUDIT = [{ occurredAt: '2026-10-04T10:00:00Z', action: 'INITIATED', executor: 'x', detail: 'opened' }];

function inPortuguese(page: React.ReactElement, handler: Handler) {
  return renderWithSession(<LanguageProvider initial="pt">{page}</LanguageProvider>, fakeFetch(handler).impl, me);
}

/** Words an English sentence has and a Portuguese one does not: if one is on screen, some text was not translated. */
const ENGLISH = /\b(the|with|from|yet|none|never|shown|loading|your|there|please|assigned|unassigned|comments?|history|close|cancel|resolve|reopen|apply|never mind|title|priority)\b/i;
function expectNoEnglish() {
  const text = document.body.textContent ?? '';
  expect(text.match(ENGLISH)?.[0], `English text on screen: ${text.slice(0, 400)}`).toBeUndefined();
}

const incident = (over: Record<string, unknown> = {}) => ({
  id: 'i1', organisationId: ORG, requesterId: OTHER, title: 'Switch do núcleo fora', description: 'Sem link no andar 3', impact: 'HIGH', urgency: 'HIGH', priority: 'P1',
  status: 'IN_PROGRESS', affectedAssetIds: [ID], relatedChangeIds: [], reopenCount: 0, response: { dueAt: '2026-10-04T10:15:00Z', state: 'PENDING' },
  resolution: { dueAt: '2026-10-04T14:00:00Z', state: 'PENDING' }, comments: [{ commentId: 'c1', author: ME, text: 'olhando', internal: true, createdAt: '2026-10-04T11:00:00Z' }],
  createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z', ...over,
});

function listAndDetail(item: Record<string, unknown>, audit: unknown = AUDIT): Handler {
  return ({ url }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: audit };
    if (path.endsWith('/retrieve') && path.split('/').length === 6) return { body: item };
    if (path.endsWith('/retrieve')) return { body: [item] };
    return undefined;
  };
}

describe('incidents in Portuguese', () => {
  it('has the list, the form, the detail and the action forms in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<IncidentsPage />, listAndDetail(incident()));
    expect(await screen.findByRole('button', { name: 'Switch do núcleo fora' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Incidentes' })).toBeInTheDocument();
    expect(screen.getByText(/A prioridade vem do impacto e da urgência/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Todas as prioridades' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Responsável' })).toBeInTheDocument();
    expect(screen.getByText('sem responsável')).toBeInTheDocument();
    expect(screen.getByText('1 exibidos')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo incidente' }));
    const form = screen.getByRole('form', { name: 'Novo incidente' });
    expect(within(form).getByText(/A prioridade será/)).toBeInTheDocument();
    expect(within(form).getByLabelText('Reportado por (id do usuário)')).toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Ids dos ativos afetados/), 'nope');
    await user.type(within(form).getByLabelText('Título'), 'x');
    await user.type(within(form).getByLabelText('Descrição (sem dados pessoais)'), 'y');
    await user.click(within(form).getByRole('button', { name: 'Abrir incidente' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('"nope" não é um id.');
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Switch do núcleo fora' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do incidente' });
    expect(within(detail).getByRole('button', { name: 'Pôr em espera' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Resolver' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Mudar impacto ou urgência' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(within(detail).getByText('Comentários')).toBeInTheDocument();
    expect(within(detail).getByText('Histórico')).toBeInTheDocument();
    expect(within(detail).getByText('interna')).toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Pôr em espera' }));
    const action = await within(detail).findByRole('form', { name: 'Ação do incidente' });
    expect(within(action).getByText('Por que está em espera?')).toBeInTheDocument();
    expect(within(action).getByRole('button', { name: 'Aplicar' })).toBeInTheDocument();
    expect(within(action).getByRole('button', { name: 'Deixar para lá' })).toBeInTheDocument();
    expectNoEnglish();
  });

  it('says a pasted id is not an id in Portuguese', () => {
    expect(parseIds('nope', (bad) => `"${bad}" não é um id.`).error).toBe('"nope" não é um id.');
    expect(parseIds('nope').error).toBe('"nope" is not an id.');
  });
});

describe('problems in Portuguese', () => {
  const problem = { id: 'p1', organisationId: ORG, title: 'Perda de pacotes', description: 'intermitente', priority: 'P2', status: 'UNDER_INVESTIGATION', relatedIncidentIds: [ID], relatedChangeIds: [], affectedAssetIds: [ID], reopenCount: 0, comments: [], createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z' };

  it('has the list and the detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<ProblemsPage />, listAndDetail(problem));
    expect(await screen.findByRole('button', { name: 'Perda de pacotes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Problemas' })).toBeInTheDocument();
    expect(screen.getByText(/Um erro conhecido é entendido/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Explica o incidente (id)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Perda de pacotes' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do problema' });
    expect(within(detail).getByRole('button', { name: 'Declarar erro conhecido' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Registrar análise' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Mudar prioridade' })).toBeInTheDocument();
    expect(within(detail).getByText('Causa raiz')).toBeInTheDocument();
    expect(within(detail).getByText('ainda não conhecida')).toBeInTheDocument();
    expect(within(detail).getByText('Solução de contorno')).toBeInTheDocument();
    expect(within(detail).getByText('nenhuma ainda')).toBeInTheDocument();
    expectNoEnglish();
  });
});

describe('the knowledge base in Portuguese', () => {
  const article = { id: 'a1', organisationId: ORG, articleKey: 'a1', version: 1, title: 'Switch cai', body: 'Reinicie', category: 'REDE', keywords: ['switch'], visibility: 'PUBLIC', status: 'DRAFT', authorId: ME, relatedProblemIds: [], relatedIncidentIds: [], createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z' };

  it('has the list, the form and the detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<KnowledgePage />, ({ url }) => (url.pathname.endsWith('/versions/retrieve') ? { body: [article, { ...article, id: 'a2', version: 2 }] } : listAndDetail(article)({ url } as never)));
    expect(await screen.findByRole('button', { name: 'Switch cai' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conhecimento' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Buscar nos artigos')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer público' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Versão' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo artigo' }));
    const form = screen.getByRole('form', { name: 'Novo artigo' });
    expect(within(form).getByLabelText(/Texto \(sem dados pessoais/)).toBeInTheDocument();
    expect(within(form).getByRole('option', { name: 'PÚBLICO (equipe e solicitantes)' })).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Switch cai' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do artigo' });
    expect(within(detail).getByRole('button', { name: 'Enviar para revisão' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(within(detail).getByText('Escrito por')).toBeInTheDocument();
    expect(within(detail).getByText('Versões')).toBeInTheDocument();
    expectNoEnglish();
  });
});

describe('service requests in Portuguese', () => {
  const catalogItem = { id: 'k1', organisationId: ORG, code: 'LAPTOP', name: 'Notebook novo', description: 'padrão', category: 'HARDWARE', fields: [{ key: 'model', label: 'Qual modelo?', required: true }], fulfilmentTargetHours: 72, status: 'PUBLISHED', createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z' };
  const request = { id: 'r1', organisationId: ORG, requesterId: OTHER, catalogItemId: 'k1', catalogItemCode: 'LAPTOP', catalogItemName: 'Notebook novo', answers: { model: 'X1' }, status: 'SUBMITTED', fulfilment: { dueAt: '2026-10-07T10:00:00Z', state: 'PENDING' }, comments: [], createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z' };
  const handler: Handler = ({ url }) => {
    const path = url.pathname;
    if (path.includes('/catalog/')) return path.split('/').length === 7 ? { body: catalogItem } : { body: [catalogItem] };
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.endsWith('/retrieve') && path.split('/').length === 6) return { body: request };
    if (path.endsWith('/retrieve')) return { body: [request] };
    return undefined;
  };

  it('has the requests, the new request form, the detail and the catalog in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<ServiceRequestsPage />, handler);
    expect(await screen.findByRole('button', { name: 'Notebook novo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pedidos de serviço' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Catálogo' })).toBeInTheDocument();
    expect(screen.getByText(/Algo que uma pessoa pede à TI pelo catálogo/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Notebook novo' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do pedido' });
    expect(within(detail).getByRole('button', { name: 'Iniciar atendimento' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo pedido' }));
    const form = screen.getByRole('form', { name: 'Novo pedido' });
    await user.selectOptions(within(form).getByRole('combobox'), 'k1');
    expect(within(form).getByText(/Meta de 72 h; não precisa de aprovação\./)).toBeInTheDocument();
    expect(within(form).getByLabelText('Para (id do usuário)')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Catálogo' }));
    expect(await screen.findByText(/O que pode ser pedido/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Meta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo item do catálogo' })).toBeInTheDocument();
    expectNoEnglish();
  });

  it('reports a bad question line in Portuguese when it is given the Portuguese messages', () => {
    const portuguese = (kind: 'key' | 'label' | 'duplicate', line: number, key: string) => `L${line}:${kind}:${key}`;
    expect(parseFields('1bad | x', portuguese).error).toBe('L1:key:1bad');
    expect(parseFields('ok |', portuguese).error).toBe('L1:label:ok');
    expect(parseFields('a | A\na | B', portuguese).error).toBe('L2:duplicate:a');
    expect(parseFields('1bad | x').error).toMatch(/^Line 1: a key is a letter/);
  });
});

describe('integrations in Portuguese', () => {
  const connection = { id: 'c1', organisationId: ORG, name: 'Jira prod', provider: 'JIRA', baseUrl: 'https://acme.atlassian.net', secretRef: 'JIRA_AUTH', secretConfigured: true, webhookSecretRef: 'JIRA_HOOK', webhookSecretConfigured: false, integrationActor: 'svc', projectKey: 'ITSM', outboundStatus: {}, inboundActions: {}, status: 'ACTIVE', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z' };
  const link = { id: 'l1', organisationId: ORG, connectionId: 'c1', subjectType: 'INCIDENT', subjectId: ID, externalId: 'ITSM-1', externalUrl: 'https://acme.atlassian.net/browse/ITSM-1', status: 'LINKED', lastPushedStatus: 'NEW', syncedComments: 2, lastSyncedAt: '2026-10-05T11:00:00Z', lastDirection: 'OUTBOUND', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T11:00:00Z' };
  const handler: Handler = ({ method, url }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (method === 'GET' && path.endsWith('/connection/retrieve')) return { body: [connection] };
    if (method === 'PUT' && path.endsWith('/check/execute')) return { body: { secretConfigured: true, webhookSecretConfigured: true, reachable: false, problem: 'timeout' } };
    if (method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 6) return { body: link };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: [link] };
    return undefined;
  };

  it('has the connections, the linked tickets and the details in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<IntegrationsPage />, handler);
    expect((await screen.findAllByText('Jira prod')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Integrações' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Provedor' })).toBeInTheDocument();
    expect(screen.getByText('definida')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Última sincronização' })).toBeInTheDocument();
    expect(await screen.findByText(/para o provedor/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova conexão' }));
    const form = screen.getByRole('form', { name: 'Nova conexão' });
    expect(within(form).getByText(/Segredos nunca são digitados aqui/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getAllByRole('button', { name: 'Jira prod' })[0]);
    const detail = await screen.findByRole('complementary', { name: 'Detalhe da conexão' });
    expect(within(detail).getByRole('button', { name: 'Verificar conexão' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Desabilitar' })).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Verificar conexão' }));
    expect(await within(detail).findByText('Inalcançável: timeout')).toBeInTheDocument();
    expectNoEnglish();
  });
});
