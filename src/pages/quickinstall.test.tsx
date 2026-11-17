import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { SYSTEMS } from '../quickinstall/kits';
import { fakeFetch, renderWithSession } from '../test-utils';
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
