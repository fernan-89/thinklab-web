import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { AlertsPage } from './Alerts';
import { BackupsPage } from './Backups';
import { CapacityPage } from './Capacity';
import { HealthPage } from './Health';
import { PatchesPage } from './Patches';
import { RecoveryPage } from './Recovery';

beforeEach(() => sessionStorage.clear());

const me = { organisationId: ORG, executor: '0a0a0a0a-0000-4000-8000-000000000001' };
const AUDIT = [{ occurredAt: '2026-10-06T10:00:00Z', action: 'INITIATED', executor: 'x', toStatus: 'ACTIVE', detail: 'criado' }];

function inPortuguese(page: React.ReactElement, handler: Handler) {
  return renderWithSession(<LanguageProvider initial="pt">{page}</LanguageProvider>, fakeFetch(handler).impl, me);
}

/** Words an English sentence has and a Portuguese one does not: if one is on screen, some text was not translated. */
const ENGLISH = /\b(the|with|from|yet|none|never|shown|loading|your|there|please|within|over|every|until|after|critical|high|medium|low|objective|runs? out|running|samples?|probes?|failures?|successes?|waive[ds]?|overdue|policy|policies|plan|asset|backup every)\b/i;
function expectNoEnglish(allowed: RegExp[] = []) {
  let text = document.body.textContent ?? '';
  for (const pattern of allowed) text = text.replace(pattern, '');
  expect(text.match(ENGLISH)?.[0], `English text on screen: ${text.slice(0, 500)}`).toBeUndefined();
}

describe('health in Portuguese', () => {
  const check = { id: 'k1', organisationId: ORG, name: 'Intranet', type: 'HTTP', target: 'https://intranet.acme.test/health', intervalSeconds: 60, timeoutMillis: 5000, failureThreshold: 3, successThreshold: 1, status: 'ACTIVE', health: 'DOWN', consecutiveFailures: 2, lastCheckedAt: '2026-10-06T12:00:00Z', lastLatencyMillis: 14, createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T12:00:00Z' };
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.endsWith('/summary/retrieve')) return { body: { total: 3, up: 1, down: 1, unknown: 0, paused: 1 } };
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.endsWith('/results/retrieve')) return { body: [{ at: '2026-10-06T12:00:00Z', ok: false, latencyMillis: 5000, error: 'timeout' }] };
    if (method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: [check] };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: check };
    return undefined;
  };

  it('has the list, the form and the detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<HealthPage />, handler);
    expect(await screen.findByRole('button', { name: 'Intranet' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Saúde' })).toBeInTheDocument();
    expect(screen.getByText(/Coisas que a plataforma vigia sozinha/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer saúde' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'fora do ar' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Última sondagem' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova verificação' }));
    const form = screen.getByRole('form', { name: 'Nova verificação' });
    expect(within(form).getByLabelText(/A cada \(segundos/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Começar a vigiar' })).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Intranet' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe da verificação' });
    expect(within(detail).getByText('a cada 60 s, limite de 5000 ms')).toBeInTheDocument();
    expect(within(detail).getByText('3 falha(s) seguida(s); volta após 1 sucesso(s)')).toBeInTheDocument();
    expect(within(detail).getByText('2 sondagem(ns) seguida(s)')).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Sondar agora' })).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
    expect(within(detail).getAllByText('Sondagens recentes').length).toBeGreaterThan(0);
    expectNoEnglish();
  });
});

describe('alerts in Portuguese', () => {
  const rule = { id: 'r1', organisationId: ORG, name: 'Tudo', impact: 'HIGH', urgency: 'MEDIUM', requesterId: 'u1', status: 'ACTIVE', source: 'BACKUP', reopenWithinMinutes: 30, escalateTarget: 'HOOK', escalateAfterMinutes: 15, createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z' };
  const windowItem = { id: 'w1', organisationId: ORG, name: 'Patching', status: 'ACTIVE', startsAt: '2026-10-07T10:00:00Z', endsAt: '2026-10-07T12:00:00Z', createdAt: '2026-10-07T09:00:00Z', updatedAt: '2026-10-07T09:00:00Z' };
  const alert = { id: 'a1', organisationId: ORG, ruleId: 'r1', checkId: 'k1', checkName: 'Intranet', status: 'OPEN', openedAt: '2026-10-06T12:00:00Z', incidentId: 'i1', lastError: 'timeout', updatedAt: '2026-10-06T12:00:00Z', reopenCount: 2, notices: [{ notice: 'OPENED', sentAt: '2026-10-06T12:00:00Z', attempts: 1 }, { notice: 'ESCALATED', attempts: 3 }] };
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.includes('/it-health-monitoring/')) return { body: [{ id: 'k1', name: 'Intranet' }] };
    if (method === 'PUT' && path.endsWith('/evaluation/execute')) return { body: { opened: 1, resolved: 2, incidentsOpened: 1, reopened: 3, notified: 4 } };
    if (path.endsWith('/window/retrieve')) return { body: [windowItem] };
    if (path.endsWith('/rule/retrieve')) return { body: [rule] };
    if (path.endsWith('/retrieve')) return { body: [alert] };
    return undefined;
  };

  it('has the rules, windows, alerts, forms and the evaluation result in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<AlertsPage />, handler);
    expect(await screen.findByText('Intranet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alertas', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('A regra ativa mais antiga que cobre uma verificação decide o incidente.')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Reabre em até' })).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByText(/após 15 min/)).toBeInTheDocument();
    expect(screen.getByText(/reaberto 2x/)).toBeInTheDocument();
    expect(screen.getByText(/OPENED enviado/)).toBeInTheDocument();
    expect(screen.getByText(/ESCALATED falhou \(3\)/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Abertos e resolvidos' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Disponibilidade' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Avaliar agora' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Olhei agora: 1 alerta(s) aberto(s), 2 resolvido(s), 1 incidente(s) criado(s), 3 reaberto(s), 4 aviso(s) enviado(s).');

    await user.click(screen.getByRole('button', { name: 'Nova regra' }));
    const form = screen.getByRole('form', { name: 'Nova regra' });
    expect(within(form).getByRole('option', { name: 'Verificações de saúde' })).toBeInTheDocument();
    expect(within(form).getByRole('option', { name: 'Cada verificação' })).toBeInTheDocument();
    expect(within(form).getByRole('option', { name: /O mesmo do que vigia/ })).toBeInTheDocument();
    expect(within(form).getByLabelText(/Escalar para/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Planejar janela' }));
    const windowForm = screen.getByRole('form', { name: 'Planejar janela' });
    expect(within(windowForm).getByText(/No máximo 30 dias/)).toBeInTheDocument();
    expectNoEnglish([/Patching/g, /THINKLAB_ALERT_HOOK_\w+/g]);
  });
});

describe('backups in Portuguese', () => {
  const policy = { id: 'p1', organisationId: ORG, name: 'Banco noturno', assetId: 'a1', frequencyHours: 24, rpoHours: 48, rtoMinutes: 120, retentionDays: 30, status: 'ACTIVE', protection: 'RPO_BREACHED', protectedUntil: '2026-10-09T02:00:00Z', restoreTest: 'OVERDUE', restoreTestEveryDays: 90, restoreTestDueAt: '2026-10-09T02:00:00Z', lastSuccessAt: '2026-10-07T02:00:00Z', lastRestoreMinutes: 45, rtoMet: true, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-07T02:00:00Z' };
  const runs = [{ id: 'r1', policyId: 'p1', kind: 'BACKUP', outcome: 'SUCCEEDED', startedAt: '2026-10-07T01:40:00Z', finishedAt: '2026-10-07T02:00:00Z', durationMinutes: 20, reportedBy: 'agent-1', reportedAt: '2026-10-07T02:00:01Z' }];
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.endsWith('/run/retrieve')) return { body: runs };
    if (method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: [policy] };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: policy };
    return undefined;
  };

  it('has the list, the form and the detail in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<BackupsPage />, handler);
    expect(await screen.findByRole('button', { name: 'Banco noturno' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Backups', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/O que é prometido sobre cada ativo/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer proteção' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Protegido até' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova política' }));
    const form = screen.getByRole('form', { name: 'Nova política' });
    expect(within(form).getByLabelText(/Ativo que protege/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Criar política' })).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Banco noturno' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe da política' });
    expect(within(detail).getByText('Promessa')).toBeInTheDocument();
    expect(within(detail).getByText(/um backup a cada 24 h, no máximo 48 h de dados perdidos/)).toBeInTheDocument();
    expect(within(detail).getByText(/a cada 90 dias/)).toBeInTheDocument();
    expect(within(detail).getByText('45 min, dentro da meta')).toBeInTheDocument();
    expect(within(detail).getByText('Execuções recentes')).toBeInTheDocument();
    expect(within(detail).getByText('20 min')).toBeInTheDocument();
    expectNoEnglish();
  });
});

describe('recovery in Portuguese', () => {
  const plan = { id: 'p1', organisationId: ORG, name: 'Failover de pedidos', assetId: 'a1', strategy: 'WARM_STANDBY', rtoMinutes: 120, rpoMinutes: 30, testEveryDays: 90, status: 'ACTIVE', readiness: 'TEST_OVERDUE', nextExerciseDueAt: '2027-01-10T00:00:00Z', lastExerciseAt: '2026-10-10T00:00:00Z', lastOutcome: 'SUCCEEDED', lastMeasuredMinutes: 60, rtoMet: true, lastMeasuredDataLossMinutes: 5, rpoMet: false, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-10T00:00:00Z' };
  const exercises = [{ id: 'e1', planId: 'p1', kind: 'FAILOVER', outcome: 'PARTIAL', startedAt: '2026-10-10T00:00:00Z', finishedAt: '2026-10-10T01:00:00Z', durationMinutes: 60, dataLossMinutes: 5, failureReason: 'RUNBOOK_OUTDATED', reportedBy: 'drill-1', reportedAt: '2026-10-10T01:00:01Z' }];
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.endsWith('/exercise/retrieve')) return { body: exercises };
    if (method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: [plan] };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: plan };
    return undefined;
  };

  it('has the list, the forms and the detail in Portuguese, with the strategy in plain words', async () => {
    const user = userEvent.setup();
    inPortuguese(<RecoveryPage />, handler);
    expect(await screen.findByRole('button', { name: 'Failover de pedidos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recuperação', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Warm standby')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer prontidão' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'teste vencido' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo plano' }));
    const form = screen.getByRole('form', { name: 'Novo plano' });
    expect(within(form).getByRole('option', { name: 'Restaurar de um backup' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Criar plano' })).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Failover de pedidos' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe do plano' });
    expect(within(detail).getByText(/warm standby, recuperado em até 120 min, no máximo 30 min de dados perdidos, provado a cada 90 dias/)).toBeInTheDocument();
    expect(within(detail).getByText(/60 min, dentro da meta; 5 min de dados perdidos, acima da meta/)).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Informar um exercício' })).toBeInTheDocument();
    expect(within(detail).getByText('Exercícios recentes')).toBeInTheDocument();

    await user.click(within(detail).getByRole('button', { name: 'Informar um exercício' }));
    const report = await screen.findByRole('form', { name: 'Informar um exercício' });
    expect(within(report).getByRole('option', { name: 'Passo a passo do runbook' })).toBeInTheDocument();
    expect(within(report).getByRole('option', { name: 'bem-sucedido' })).toBeInTheDocument();
    await user.selectOptions(within(report).getByLabelText('Resultado do exercício'), 'PARTIAL');
    expect(await within(report).findByRole('option', { name: 'runbook desatualizado' })).toBeInTheDocument();
    expectNoEnglish();
  });
});

describe('patches in Portuguese', () => {
  const policy = { id: 'p1', organisationId: ORG, name: 'Servidores', assetId: 'a1', criticalDays: 2, highDays: 7, mediumDays: 30, lowDays: 90, status: 'ACTIVE', compliance: 'OVERDUE', openFindings: 3, overdueFindings: 2, waivedFindings: 1, oldestOverdueSince: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-07T02:00:00Z' };
  const findings = [
    { id: 'f1', policyId: 'p1', patchRef: 'KB5030211', severity: 'HIGH', announcedAt: '2026-10-06T00:00:00Z', status: 'PENDING', dueAt: '2026-10-13T00:00:00Z', overdue: true, reportedBy: 'scanner-1', reportedAt: '2026-10-06T00:00:01Z' },
    { id: 'f2', policyId: 'p1', patchRef: 'KB5030212', severity: 'LOW', announcedAt: '2026-10-06T00:00:00Z', status: 'WAIVED', waiverReason: 'ACCEPTED_RISK', waivedUntil: '2026-12-01T00:00:00Z', dueAt: '2026-10-13T00:00:00Z', overdue: false, reportedBy: 'scanner-1', reportedAt: '2026-10-06T00:00:01Z' },
  ];
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.endsWith('/finding/retrieve')) return { body: findings };
    if (method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: [policy] };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: policy };
    return undefined;
  };

  it('has the list, the form, the detail and the waiver form in Portuguese', async () => {
    const user = userEvent.setup();
    inPortuguese(<PatchesPage />, handler);
    expect(await screen.findByRole('button', { name: 'Servidores' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Dias (C/A/M/B)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer conformidade' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova política' }));
    const form = screen.getByRole('form', { name: 'Nova política' });
    expect(within(form).getByLabelText('Dias para um patch crítico')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Servidores' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe da política' });
    expect(within(detail).getByText('crítico 2 d, alto 7 d, médio 30 d, baixo 90 d depois de anunciado')).toBeInTheDocument();
    expect(within(detail).getByText('3 abertos, 2 vencidos, 1 dispensados')).toBeInTheDocument();
    expect(within(detail).getByText(/ACCEPTED_RISK até/)).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Retirar dispensa' })).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Dispensar' }));
    const waive = await screen.findByRole('form', { name: 'Dispensar patch' });
    expect(within(waive).getByLabelText('Por quantos dias (de 1 a 365)')).toBeInTheDocument();
    expect(within(waive).getByRole('option', { name: 'risco aceito' })).toBeInTheDocument();
    expectNoEnglish([/ACCEPTED_RISK/g, /KB\d+/g]);
  });
});

describe('capacity in Portuguese', () => {
  const policy = { id: 'p1', organisationId: ORG, name: 'Disco de pedidos', assetId: 'a1', metric: 'DISK', limit: 100, warnPercent: 70, criticalPercent: 90, windowDays: 30, horizonDays: 30, reportEveryHours: 24, status: 'ACTIVE', level: 'WARNING', utilisationPercent: 75, stale: false, forecast: 'WITHIN_HORIZON', daysToLimit: 4, projectedExhaustionAt: '2026-10-22T12:00:00Z', lastValue: 75, lastMeasuredAt: '2026-10-18T12:00:00Z', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-18T12:00:00Z' };
  const samples = [{ id: 's1', policyId: 'p1', value: 75, measuredAt: '2026-10-18T12:00:00Z', reportedBy: 'agent-1', reportedAt: '2026-10-18T12:00:01Z' }];
  const handler: Handler = ({ url, method }) => {
    const path = url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: AUDIT };
    if (path.endsWith('/sample/retrieve')) return { body: samples };
    if (method === 'GET' && path.endsWith('/retrieve') && path.split('/').length === 5) return { body: [policy] };
    if (method === 'GET' && path.endsWith('/retrieve')) return { body: policy };
    return undefined;
  };

  it('has the list, the form and the detail in Portuguese, with where the trend leads', async () => {
    const user = userEvent.setup();
    inPortuguese(<CapacityPage />, handler);
    expect(await screen.findByRole('button', { name: 'Disco de pedidos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Capacidade', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qualquer previsão' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'dentro do horizonte' })).toBeInTheDocument();
    expect(screen.getByText('em 4.0 dias')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova política' }));
    const form = screen.getByRole('form', { name: 'Nova política' });
    expect(within(form).getByLabelText(/Limite \(na unidade/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Disco de pedidos' }));
    const detail = await screen.findByRole('complementary', { name: 'Detalhe da política' });
    expect(within(detail).getByText('disco de 100, avisa em 70%, crítico em 90%')).toBeInTheDocument();
    expect(within(detail).getByText(/uma reta pelos últimos 30 dias; esgota em 4.0 dias, por volta de/)).toBeInTheDocument();
    expect(within(detail).getByText('esperada a cada 24 h, avisa quando esgotaria em até 30 dias')).toBeInTheDocument();
    expect(within(detail).getByText('Amostras recentes')).toBeInTheDocument();
    expectNoEnglish();
  });
});
