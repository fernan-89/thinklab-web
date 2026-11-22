import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { ApprovalsPage, parseStages, stageText } from './Approvals';
import { CloudCostsPage } from './CloudCosts';
import { CloudInventoryPage } from './CloudInventory';
import { LicensesPage } from './Licenses';
import { NetworkPage } from './Network';
import { ProcurementPage } from './Procurement';
import { StockPage } from './Stock';
import { VendorsPage } from './Vendors';

beforeEach(() => sessionStorage.clear());

const LEAD = '0a0a0a0a-0000-4000-8000-000000000001';
const SEC = '0b0b0b0b-0000-4000-8000-000000000002';
const me = { organisationId: ORG, executor: LEAD };
const AUDIT = [{ occurredAt: '2026-10-01T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: 'criado' }];

function inPortuguese(page: React.ReactElement, handler: Handler) {
  return renderWithSession(<LanguageProvider initial="pt">{page}</LanguageProvider>, fakeFetch(handler).impl, me);
}

/** Words an English sentence has and a Portuguese one does not: if one is on screen, some text was not translated. */
const ENGLISH = /\b(the|with|from|yet|none|never|shown|loading|your|there|please|within|over|every|until|after|left|spent|heading|budget|seats|bought|notice|stage|approvers?|approvals?|nothing|waiting|received|expected|retire|release|subnet|addresses|free|vendor|agreement|licen[cs]e|policy|reorder|on hand)\b/i;
function expectNoEnglish(allowed: RegExp[] = []) {
  let text = document.body.textContent ?? '';
  for (const pattern of allowed) text = text.replace(pattern, '');
  expect(text.match(ENGLISH)?.[0], `English text on screen: ${text.slice(0, 500)}`).toBeUndefined();
}

describe('vendors in Portuguese', () => {
  const vendor = { id: 'v1', organisationId: ORG, name: 'Dell', category: 'HARDWARE', status: 'ACTIVE', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' };
  const agreement = { id: 'g1', organisationId: ORG, vendorId: 'v1', kind: 'WARRANTY', reference: 'WTY-1', assetId: 'a1', startsOn: '2026-01-01', endsOn: '2026-12-31', noticeDays: 30, autoRenew: true, status: 'ACTIVE', standing: 'IN_FORCE', daysToEnd: 74, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' };
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (method === 'GET' && path.endsWith('/agreement/retrieve')) return { body: [agreement] };
    if (method === 'GET' && path.includes('/agreement/') && path.endsWith('/retrieve')) return { body: agreement };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: [vendor] };
    return undefined;
  };

  it('has the lists, the forms and the agreement detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<VendorsPage />, handler);
    expect(await screen.findByRole('button', { name: 'WTY-1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fornecedores', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Quem a organização compra e o que cada um deve/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tempo restante' })).toBeInTheDocument();
    expect(screen.getByText('faltam 74 dias')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer situação' })).toBeInTheDocument();
    expect(screen.getAllByText('em vigor').length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: 'garantia' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo fornecedor' }));
    const vendorForm = screen.getByRole('form', { name: 'Novo fornecedor' });
    expect(within(vendorForm).getByText(/Só a empresa/)).toBeInTheDocument();
    await user.click(within(vendorForm).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Novo contrato' }));
    const agreementForm = screen.getByRole('form', { name: 'Novo contrato' });
    expect(within(agreementForm).getByLabelText('Referência (o número no papel)')).toBeInTheDocument();
    await user.click(within(agreementForm).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'WTY-1' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do contrato' });
    expect(within(detail).getByText(/30 dias antes do fim; renova sozinho/)).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
    expectNoEnglish([/WTY-1/g, /Dell/g]);
  });
});

describe('licences in Portuguese', () => {
  const license = { id: 'l1', organisationId: ORG, product: 'Office 365 E3', unit: 'USER', entitled: 100, warnPercent: 90, reportEveryHours: 24, status: 'ACTIVE', level: 'OK', usagePercent: 60, available: 40, stale: true, lastInUse: 60, lastMeasuredAt: '2026-10-18T12:00:00Z', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-18T12:00:00Z' };
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.includes('/it-vendor-registry/')) return { body: [{ id: 'v1', name: 'Microsoft' }] };
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.endsWith('/usage/retrieve')) return { body: [{ id: 'r2', licenseId: 'l1', inUse: 60, measuredAt: '2026-10-18T12:00:00Z', reportedBy: 'inventory-1', reportedAt: '2026-10-18T12:00:01Z' }] };
    if (method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: [license] };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: license };
    return undefined;
  };

  it('has the list, the form and the detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<LicensesPage />, handler);
    expect(await screen.findByRole('button', { name: 'Office 365 E3' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Licenças', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('restam 40')).toBeInTheDocument();
    expect(screen.getByText('60 de 100')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer unidade' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'usuário' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova licença' }));
    const form = screen.getByRole('form', { name: 'Nova licença' });
    expect(within(form).getByLabelText('Assentos comprados')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Office 365 E3' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe da licença' });
    expect(within(detail).getByText('100 assentos, um por usuário, avisa em 90%')).toBeInTheDocument();
    expect(within(detail).getByText(/60 em uso \(60\.0%, restam 40\) em .*, mais antiga que o dobro do intervalo esperado/)).toBeInTheDocument();
    expect(within(detail).getByText('esperada a cada 24 h')).toBeInTheDocument();
    expect(within(detail).getByText('Contagens recentes')).toBeInTheDocument();
    expectNoEnglish([/Office 365 E3/g]);
  });
});

describe('procurement in Portuguese', () => {
  const order = { id: 'o1', organisationId: ORG, reference: 'PO-2026-001', vendorId: 'v1', requesterId: 'u1', currency: 'BRL', total: 15100, expectedOn: '2026-11-30', status: 'DRAFT', fulfilment: 'NONE', late: false, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z',
    lines: [{ lineNo: 1, category: 'HARDWARE', item: 'LAP-14', quantity: 10, unitPrice: 1500, received: 0, remaining: 10 }] };
  const band = { id: 'b1', organisationId: ORG, currency: 'BRL', fromAmount: 0, policyId: 'p-0001', status: 'ACTIVE', createdAt: '2026-11-11T10:00:00Z', createdBy: 'admin' };
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (method === 'GET' && path.endsWith('/band/retrieve')) return { body: [band] };
    if (path.endsWith('/receipt/retrieve')) return { body: [] };
    if (method === 'GET' && path.split('/').length === 5 && path.endsWith('/retrieve')) return { body: [order] };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: order };
    return undefined;
  };

  it('has the list, the bands, the forms and the order detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<ProcurementPage />, handler);
    expect(await screen.findByRole('button', { name: 'PO-2026-001' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Compras', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Pedidos de compra a um fornecedor, numa moeda/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer moeda' })).toBeInTheDocument();
    expect(screen.getByLabelText('Só atrasados')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Faixas de aprovação' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aposentar BRL a partir de 0.00' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo pedido' }));
    const form = screen.getByRole('form', { name: 'Novo pedido' });
    expect(within(form).getByLabelText('Fornecedor (id)')).toBeInTheDocument();
    expect(within(form).getByLabelText('Categoria 1')).toBeInTheDocument();
    expect(within(form).getByLabelText('Preço unitário 1')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Adicionar uma linha' })).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'PO-2026-001' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do pedido' });
    expect(within(detail).getByRole('button', { name: 'Enviar para aprovação' })).toBeInTheDocument();
    expect(within(detail).getByRole('columnheader', { name: 'Falta' })).toBeInTheDocument();
    expect(within(detail).getByText('Nada recebido ainda.')).toBeInTheDocument();
    expect(within(detail).getByText('Recebimentos')).toBeInTheDocument();
    expectNoEnglish([/PO-2026-001/g, /LAP-14/g]);
  });
});

describe('network in Portuguese', () => {
  const subnet = { id: 's1', organisationId: ORG, name: 'LAN do escritório', cidr: '10.20.0.0/24', network: '10.20.0.0', broadcast: '10.20.0.255', prefix: 24, vlan: 120, warnPercent: 80, status: 'ACTIVE', level: 'OK', used: 3, usable: 254, free: 251, usedPercent: 1.18, createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:00:00Z' };
  const allocations = [{ id: 'a1', organisationId: ORG, subnetId: 's1', ip: '10.20.0.1', hostname: 'gw', status: 'ALLOCATED', createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:00:00Z' }];
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.endsWith('/allocation/retrieve')) return { body: allocations };
    if (method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: [subnet] };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: subnet };
    return undefined;
  };

  it('has the list, the form and the detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<NetworkPage />, handler);
    expect(await screen.findByRole('button', { name: 'LAN do escritório' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rede', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ativas e aposentadas' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Livres' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova sub-rede' }));
    const form = screen.getByRole('form', { name: 'Nova sub-rede' });
    expect(within(form).getByLabelText(/Intervalo \(CIDR/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'LAN do escritório' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe da sub-rede' });
    expect(within(detail).getByText('(10.20.0.0 a 10.20.0.255, VLAN 120)')).toBeInTheDocument();
    expect(within(detail).getByText('3 de 254 endereços usados, 251 livres (1.2%); quase cheia em 80%')).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Aposentar' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Liberar' })).toBeInTheDocument();
    expectNoEnglish([/VLAN/g]);
  });
});

describe('cloud costs in Portuguese', () => {
  const account = { id: 'a1', organisationId: ORG, name: 'Produção', provider: 'AWS', externalId: '123456789012', currency: 'USD', monthlyBudget: 3100, warnPercent: 80, reportEveryHours: 24, status: 'ACTIVE', month: '2026-10', level: 'OK', spent: 1240.5, projected: 2100, usedPercent: 40.016, stale: false, lastReportedAt: '2026-10-18T02:00:00Z', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-18T02:00:00Z' };
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.includes('/it-vendor-registry/')) return { body: [{ id: 'v1', name: 'Amazon' }] };
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.endsWith('/cost/retrieve')) return { body: [{ id: 'r2', accountId: 'a1', day: '2026-10-18', amount: 102.37, reportedBy: 'billing-export', reportedAt: '2026-10-18T02:00:00Z' }] };
    if (method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: [account] };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: account };
    return undefined;
  };

  it('has the list, the form and the detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<CloudCostsPage />, handler);
    expect(await screen.findByRole('button', { name: 'Produção' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Custos de nuvem', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('1240.50 USD de 3100.00')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer provedor' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova conta' }));
    const form = screen.getByRole('form', { name: 'Nova conta' });
    expect(within(form).getByLabelText('Orçamento mensal')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Produção' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe da conta' });
    expect(within(detail).getByText('3100.00 USD por mês, avisa em 80%')).toBeInTheDocument();
    expect(within(detail).getByText('1240.50 USD gastos (40.0%), caminhando para 2100.00 USD')).toBeInTheDocument();
    expect(within(detail).getByText(/esperada a cada 24 h, última em/)).toBeInTheDocument();
    expect(within(detail).getByText('Dias recentes')).toBeInTheDocument();
    expectNoEnglish([/USD/g]);
  });
});

describe('cloud inventory in Portuguese', () => {
  const resource = { id: 'r1', organisationId: ORG, accountId: 'a1', provider: 'AWS', externalId: 'arn:aws:ec2:i-0abc', name: 'web-1', kind: 'COMPUTE', region: 'us-east-1', state: 'RUNNING', tags: { environment: 'prod' }, presence: 'MISSING', firstSeenAt: '2026-10-01T10:00:00Z', lastSeenAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-10T09:00:00Z' };
  const handler: Handler = ({ url }) => {
    const path = url.pathname;
    if (path.endsWith('/summary/retrieve')) return { body: { total: 1, byProvider: { AWS: 1 }, byKind: { COMPUTE: 1 }, byState: { RUNNING: 1 }, byPresence: { MISSING: 1 } } };
    if (path.split('/').length === 5 && path.endsWith('/retrieve')) return { body: [resource] };
    if (path.endsWith('/retrieve')) return { body: resource };
    return undefined;
  };

  it('has the list and the detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<CloudInventoryPage />, handler);
    expect(await screen.findByRole('button', { name: 'web-1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inventário de nuvem', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer presença' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'em execução' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Região' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'web-1' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do recurso' });
    expect(within(detail).getByText('Id no provedor')).toBeInTheDocument();
    expect(within(detail).getByText('Etiquetas')).toBeInTheDocument();
    expect(within(detail).getByText('Visto pela primeira vez')).toBeInTheDocument();
    expectNoEnglish([/web-1/g, /us-east-1/g]);
  });
});

describe('approvals in Portuguese', () => {
  const request = { id: 'r1', organisationId: ORG, subjectType: 'ChangeRequest', subjectId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', requesterId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', policyId: 'p1', requiredApprovals: 1, eligibleApproverIds: [LEAD], currentStage: 1,
    stages: [{ requiredApprovals: 1, eligibleApproverIds: [LEAD] }, { requiredApprovals: 2, eligibleApproverIds: [SEC, LEAD] }], status: 'PENDING', decisions: [{ stage: 1, approverId: LEAD, outcome: 'APPROVE', decidedAt: '2026-10-03T11:00:00Z' }], createdAt: '2026-10-03T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z' };
  const policy = { id: 'p1', organisationId: ORG, name: 'Mudança em produção', requiredApprovals: 1, eligibleApproverIds: [LEAD], stages: request.stages, createdAt: '2026-10-03T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z' };
  const handler: Handler = ({ url }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.includes('/policy/')) return { body: [policy] };
    if (path.endsWith('/retrieve') && path.split('/').length === 6) return { body: request };
    if (path.endsWith('/retrieve')) return { body: [request] };
    return undefined;
  };

  it('has the inbox, the requests, the detail and the policies in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<ApprovalsPage />, handler);
    const card = await screen.findByLabelText('Aprovação ChangeRequest aaaaaaaa');
    expect(screen.getByText(/Aprovações que percorrem uma cadeia de etapas/)).toBeInTheDocument();
    expect(within(card).getByText(/Etapa 1 de 2/)).toBeInTheDocument();
    expect(within(card).getByText(/1 aprovação necessária nesta etapa/)).toBeInTheDocument();
    expect(within(card).getByPlaceholderText('Comentário (opcional)')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Rejeitar' })).toBeInTheDocument();
    expect(within(card).getByText(/Etapa 2: 0\/2/)).toBeInTheDocument();
    expect(within(card).getByText('(2 aprovadores)')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Todos os pedidos' }));
    expect(await screen.findByRole('columnheader', { name: 'Progresso' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Políticas' }));
    expect(await screen.findByLabelText('Política Mudança em produção')).toBeInTheDocument();
    expect(screen.getByText('(2 etapas)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nova política' }));
    expect(screen.getByLabelText('Aprovações necessárias, etapa 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Aprovadores, etapa 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar etapa' })).toBeInTheDocument();
    expectNoEnglish([/ChangeRequest/g]);
  });

  it('words the progress and the chain errors through the translator, and keeps the English without it', () => {
    const t = (key: string, params?: Record<string, string | number>) => `${key}:${JSON.stringify(params)}`;
    expect(stageText({ status: 'PENDING', currentStage: 1, stages: [{ requiredApprovals: 1, eligibleApproverIds: [] }] } as never, t as never)).toContain('approvals.stageOf');
    expect(stageText({ status: 'APPROVED', currentStage: 1, stages: [{ requiredApprovals: 1, eligibleApproverIds: [] }] } as never, t as never)).toContain('approvals.stagesOne');
    expect(parseStages([{ required: '1', approvers: ' ' }], t as never).error).toContain('approvals.stageNoApprover');
    expect(parseStages([{ required: '1', approvers: `${LEAD} alice` }], t as never).error).toContain('approvals.stageBadId');
    expect(parseStages([{ required: '3', approvers: LEAD }], t as never).error).toContain('approvals.stageRange');
  });
});

describe('stock in Portuguese', () => {
  const item = { id: 's1', organisationId: ORG, sku: 'TONER-85A', name: 'Toner HP 85A', unit: 'un', onHand: 2, reorderLevel: 3, belowReorderLevel: true, status: 'ACTIVE', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' };
  const handler: Handler = ({ url }) => {
    const path = url.pathname;
    if (path.endsWith('/history/retrieve')) return { body: [{ occurredAt: '2026-10-03T12:00:00Z', action: 'ISSUED', executor: 'tester', quantity: -2, balanceAfter: 8, reason: 'impressoras' }] };
    if (path.endsWith('/retrieve') && path.split('/').length === 6) return { body: item };
    if (path.endsWith('/retrieve')) return { body: [item] };
    return undefined;
  };

  it('has the list, the form and the detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<StockPage />, handler);
    expect(await screen.findByRole('button', { name: 'TONER-85A' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Estoque', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Consumíveis e peças de reposição/)).toBeInTheDocument();
    expect(screen.getByLabelText('Só estoque baixo')).toBeInTheDocument();
    expect(screen.getByText('baixo')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Em estoque' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo item' }));
    const form = screen.getByRole('form', { name: 'Novo item de estoque' });
    expect(within(form).getByLabelText('Nível de reposição')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Registrar item' })).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'TONER-85A' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do item de estoque' });
    expect(within(detail).getByText(/\(no nível de reposição ou abaixo\)/)).toBeInTheDocument();
    expect(within(detail).getByText('Movimento')).toBeInTheDocument();
    expect(within(detail).getByRole('option', { name: 'Receber' })).toBeInTheDocument();
    expect(within(detail).getByRole('option', { name: 'Retirar' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Descontinuar' })).toBeInTheDocument();
    expect(within(detail).getByText(/\(saldo 8\)/)).toBeInTheDocument();
    expectNoEnglish([/TONER-85A/g]);
  });
});
