import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { SYSTEMS } from '../quickinstall/kits';
import { fakeFetch, ORG, renderWithSession } from '../test-utils';
import { QuickInstallPage } from './QuickInstall';

beforeEach(() => sessionStorage.clear());
const noApi = () => fakeFetch(() => undefined).impl;

describe('the Quick Install catalog', () => {
  it('keeps the add-on rules: servers are English only and Windows workstations have both languages', () => {
    for (const s of SYSTEMS.filter((x) => x.role === 'Server')) expect(s.languages).toEqual(['EN']);
    for (const s of SYSTEMS.filter((x) => x.family === 'Windows' && x.role === 'Workstation')) expect(s.languages).toEqual(['EN', 'PT']);
  });

  it('holds nothing that identifies a machine or a person', () => {
    const text = JSON.stringify(SYSTEMS);
    expect(text).not.toMatch(/@|serial|password|[A-Z0-9]{5}-[A-Z0-9]{5}-/i);
  });
});

describe('the page', () => {
  it('lists every system and counts them by family', () => {
    renderWithSession(<QuickInstallPage />, noApi());
    expect(screen.getByRole('heading', { name: 'Quick Install' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(SYSTEMS.length + 1);
    const tiles = within(screen.getByLabelText('Summary'));
    expect(tiles.getByText('Windows').previousSibling).toHaveTextContent(String(SYSTEMS.filter((s) => s.family === 'Windows').length));
  });

  it('filters by role and language', async () => {
    renderWithSession(<QuickInstallPage />, noApi());
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'Server');
    expect(screen.getByText('Windows Server 2019')).toBeInTheDocument();
    expect(screen.queryByText('Windows 11 26H2')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Role'), '');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'PT');
    expect(screen.queryByText('Windows Server 2019')).not.toBeInTheDocument();
    expect(screen.getByText('Windows 11 26H2')).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    renderWithSession(<QuickInstallPage />, noApi());
    await userEvent.selectOptions(screen.getByLabelText('Family'), 'Recovery');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'PT');
    expect(screen.getByText('No system matches these filters.')).toBeInTheDocument();
  });
});

describe('what this organisation has registered', () => {
  const kit = (over: Record<string, unknown> = {}) => ({
    id: 'k1', organisationId: ORG, name: 'Windows 11 EN BASE', family: 'WINDOWS', role: 'WORKSTATION', language: 'EN', systemId: 'W11', machineClass: 'BASE', revision: 2, status: 'ACTIVE',
    createdAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:00:00Z', ...over,
  });
  const report = { id: 'r1', organisationId: ORG, kitId: 'k1', kitRevision: 2, addOnVersion: '1.2.2', outcome: 'PARTIAL', warnings: 3, occurredAt: '2026-11-17T12:00:00Z', createdAt: '2026-11-17T12:00:01Z', reportedBy: 'op' };
  const definition = { organisationId: ORG, kitCount: 1, systems: [{ systemId: 'W11', family: 'WINDOWS', role: 'WORKSTATION', kits: [{ kitId: 'k1', name: 'Windows 11 EN BASE', language: 'EN', machineClass: 'BASE', revision: 2 }] }] };

  it('lists the kits, the stick they make up and the latest reports, naming the kit that ran', async () => {
    const { impl } = fakeFetch((r) => {
      if (r.url.pathname.endsWith('/stick-definition/retrieve')) return { body: definition };
      if (r.url.pathname.endsWith('/install-report/retrieve')) return { body: [report] };
      if (r.url.pathname.endsWith('/retrieve')) return { body: [kit(), kit({ id: 'k2', name: 'Old kit', status: 'RETIRED' })] };
      return undefined;
    });
    renderWithSession(<QuickInstallPage />, impl);

    const kits = await screen.findByRole('table', { name: 'Registered kits' });
    expect(within(kits).getByText('Windows 11 EN BASE')).toBeInTheDocument();
    expect(within(kits).getByText('RETIRED')).toBeInTheDocument();
    expect(await screen.findByText('1 active kit(s) in the stick definition, across 1 system(s).')).toBeInTheDocument();
    const reports = await screen.findByRole('table', { name: 'Install reports' });
    expect(within(reports).getByText('Windows 11 EN BASE')).toBeInTheDocument();
    expect(within(reports).getByText('PARTIAL')).toBeInTheDocument();
    expect(within(reports).getByText('3')).toBeInTheDocument();
  });

  it('says so when nothing is registered yet, and shows no report table', async () => {
    const { impl } = fakeFetch((r) => (r.url.pathname.endsWith('/stick-definition/retrieve') ? { body: { organisationId: ORG, kitCount: 0, systems: [] } } : { body: [] }));
    renderWithSession(<QuickInstallPage />, impl);
    expect(await screen.findByText('No kit is registered yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Install reports' })).not.toBeInTheDocument();
  });

  it('keeps the catalog when the service is not there', async () => {
    renderWithSession(<QuickInstallPage />, noApi());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(SYSTEMS.length + 1);
  });
});
