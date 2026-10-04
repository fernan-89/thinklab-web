import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fakeFetch, ORG, renderWithSession, type Handler } from '../test-utils';
import { KnowledgePage, parseKeywords } from './Knowledge';

beforeEach(() => sessionStorage.clear());

const ME = '0a0a0a0a-0000-4000-8000-000000000001';
const PROBLEM = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const me = { organisationId: ORG, executor: ME };

const article = (over: Record<string, unknown> = {}) => ({
  id: 'a1', organisationId: ORG, articleKey: 'a1', version: 1, title: 'Switch drops packets', body: 'Reboot the switch\nevery Sunday', category: 'NETWORK',
  keywords: ['switch', 'firmware'], visibility: 'PUBLIC', status: 'DRAFT', authorId: 'author-1', relatedProblemIds: [PROBLEM], relatedIncidentIds: [],
  createdAt: '2026-10-04T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z', ...over,
});

/** A tiny knowledge-base server: one article that changes as actions are applied. */
function server(initial: Record<string, unknown> = {}, extra: Handler = () => undefined) {
  let current: Record<string, unknown> = article(initial);
  const handler: Handler = (r) => {
    const custom = extra(r);
    if (custom) return custom;
    const path = r.url.pathname;
    if (path.endsWith('/audit-log/retrieve')) return { body: [{ occurredAt: '2026-10-04T10:00:00Z', action: 'INITIATED', executor: 'author-1', detail: 'Article drafted.' }] };
    if (path.endsWith('/versions/retrieve')) return { body: [current, article({ id: 'a2', version: 2, status: 'DRAFT' })] };
    if (r.method === 'POST' && path.endsWith('/version/initiate')) return { status: 201, body: article({ id: 'a2', version: 2, status: 'DRAFT', title: 'Switch drops packets' }) };
    if (r.method === 'POST' && path.endsWith('/initiate')) return { status: 201, body: article({ id: 'a3', title: (r.body as { title: string }).title }) };
    if (r.method === 'PUT') {
      const action = path.split('/').pop() as string;
      const next: Record<string, string> = { submit: 'IN_REVIEW', publish: 'PUBLISHED', retire: 'RETIRED', return: 'DRAFT' };
      if (next[action]) current = { ...current, status: next[action], reviewComment: action === 'return' ? (r.body as { comment: string }).comment : undefined };
      if (action === 'update') current = { ...current, title: (r.body as { title: string }).title };
      return { status: 204 };
    }
    if (path.endsWith('/retrieve') && path.split('/').length === 6) return { body: current };
    if (path.endsWith('/retrieve')) return { body: [current] };
    return undefined;
  };
  return handler;
}

describe('helpers', () => {
  it('splits keywords on commas and lines and drops the empty ones', () => {
    expect(parseKeywords('switch, Firmware\n network ,, ')).toEqual(['switch', 'Firmware', 'network']);
    expect(parseKeywords('')).toEqual([]);
  });
});

describe('the list and the search', () => {
  it('shows articles with status, audience, version and category', async () => {
    const { impl } = fakeFetch(server({ status: 'PUBLISHED' }));
    renderWithSession(<KnowledgePage />, impl, me);

    const row = (await screen.findByRole('button', { name: 'Switch drops packets' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('PUBLISHED')).toBeInTheDocument();
    expect(within(row).getByText('PUBLIC')).toBeInTheDocument();
    expect(within(row).getByText('1')).toBeInTheDocument();
    expect(within(row).getByText('NETWORK')).toBeInTheDocument();
  });

  it('sends the text search, the filters and the problem (only when it is an id), and says when nothing matches', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<KnowledgePage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Switch drops packets' });

    await user.type(screen.getByLabelText('Search'), ' firmware ');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('q')).toBe('firmware'));
    await user.selectOptions(screen.getByLabelText('Status'), 'PUBLISHED');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('status')).toBe('PUBLISHED'));
    await user.selectOptions(screen.getByLabelText('Visibility'), 'INTERNAL');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('visibility')).toBe('INTERNAL'));
    await user.type(screen.getByLabelText('Keyword'), 'switch');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('keyword')).toBe('switch'));
    await user.type(screen.getByLabelText('About problem'), 'not an id');
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('problemId')).toBeNull());
    await user.clear(screen.getByLabelText('About problem'));
    await user.type(screen.getByLabelText('About problem'), PROBLEM);
    await waitFor(() => expect(calls.at(-1)!.url.searchParams.get('problemId')).toBe(PROBLEM));
  });

  it('says when nothing matches and shows a problem from the service', async () => {
    const empty = fakeFetch((r) => (r.url.pathname.endsWith('/retrieve') ? { body: [] } : undefined));
    const first = renderWithSession(<KnowledgePage />, empty.impl, me);
    expect(await screen.findByText('No articles match.')).toBeInTheDocument();
    first.unmount();

    const failing = fakeFetch(() => ({ status: 500, body: { title: 'Internal', error_code: 'ERR-INTERNAL-00500' } }));
    renderWithSession(<KnowledgePage />, failing.impl, me);
    expect(await screen.findByText('ERR-INTERNAL-00500')).toBeInTheDocument();
  });
});

describe('writing an article', () => {
  it('sends the text, the keywords, the audience and the links, and opens the new article', async () => {
    const { impl, calls } = fakeFetch(server());
    renderWithSession(<KnowledgePage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Switch drops packets' });

    await user.click(screen.getByRole('button', { name: 'New article' }));
    const form = await screen.findByRole('form', { name: 'New article' });
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Title'), '  Printer queue stalls ');
    await user.type(within(form).getByLabelText('Text (no personal data or credentials)'), 'Restart the spooler');
    await user.type(within(form).getByLabelText('Category'), 'PRINTING');
    await user.type(within(form).getByLabelText('Keywords (separate with commas)'), 'printer, spooler');
    await user.selectOptions(within(form).getByLabelText('Who can read it once published'), 'INTERNAL');
    await user.type(within(form).getByLabelText('Problems it relates to (ids, optional)'), `${PROBLEM}, nope`);
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('"nope" is not an id.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    const problems = within(form).getByLabelText('Problems it relates to (ids, optional)');
    await user.clear(problems);
    await user.type(problems, PROBLEM);
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    const post = await waitFor(() => {
      const call = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/initiate'));
      expect(call).toBeDefined();
      return call!;
    });
    expect(post.body).toEqual({
      title: 'Printer queue stalls', body: 'Restart the spooler', category: 'PRINTING', keywords: ['printer', 'spooler'], visibility: 'INTERNAL',
      relatedProblemIds: [PROBLEM], relatedIncidentIds: [],
    });
    expect(await screen.findByRole('complementary', { name: 'Article detail' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New article' })).not.toBeInTheDocument();
  });

  it('can be cancelled and shows the problem when the service refuses', async () => {
    const { impl } = fakeFetch(server({}, (r) => (r.method === 'POST' && r.url.pathname.endsWith('/initiate')
      ? { status: 403, body: { title: 'Forbidden', error_code: 'ERR-KNB-00403', detail: 'Staff only.' } } : undefined)));
    renderWithSession(<KnowledgePage />, impl, me);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Switch drops packets' });

    await user.click(screen.getByRole('button', { name: 'New article' }));
    const form = await screen.findByRole('form', { name: 'New article' });
    await user.type(within(form).getByLabelText('Title'), 'T');
    await user.type(within(form).getByLabelText('Text (no personal data or credentials)'), 'B');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('ERR-KNB-00403')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New article' })).not.toBeInTheDocument();
  });
});

describe('an article', () => {
  async function open(initial: Record<string, unknown>, extra: Handler = () => undefined) {
    const fake = fakeFetch(server(initial, extra));
    renderWithSession(<KnowledgePage />, fake.impl, me);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Switch drops packets' }));
    const detail = await screen.findByRole('complementary', { name: 'Article detail' });
    await within(detail).findByText('Keywords');
    return { ...fake, user, detail };
  }
  const actionsOf = (detail: HTMLElement) => within(detail).getByLabelText('Actions');

  it('shows the text with its line breaks, the people and links for staff, and submits a draft for review', async () => {
    const { user, detail, calls } = await open({});

    expect(within(detail).getByText(/Reboot the switch/)).toHaveClass('article-body');
    expect(within(detail).getByText('author-1')).toBeInTheDocument();
    expect(within(detail).getByText(PROBLEM.slice(0, 8))).toBeInTheDocument();
    expect(within(detail).getByText('switch, firmware')).toBeInTheDocument();
    expect(within(detail).getByText(/INITIATED/)).toBeInTheDocument();
    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/control/submit'))).toBe(true));
    await waitFor(() => expect(within(actionsOf(detail)).getByRole('button', { name: 'Publish' })).toBeInTheDocument());
  });

  it('the reviewer returns an article with a comment that is required, and the comment is then shown to the author', async () => {
    const { user, detail, calls } = await open({ status: 'IN_REVIEW' });

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Return for changes' }));
    const form = within(detail).getByRole('form', { name: 'Return article' });
    expect(within(form).getByRole('button', { name: 'Return' })).toBeDisabled();
    await user.click(within(form).getByRole('button', { name: 'Never mind' }));
    expect(within(detail).queryByRole('form', { name: 'Return article' })).not.toBeInTheDocument();
    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Return for changes' }));
    const again = within(detail).getByRole('form', { name: 'Return article' });
    await user.type(within(again).getByLabelText('What should the author change?'), 'Say which firmware');
    await user.click(within(again).getByRole('button', { name: 'Return' }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname.endsWith('/control/return'))?.body).toEqual({ comment: 'Say which firmware' }));
    expect(await within(detail).findByRole('status')).toHaveTextContent('Say which firmware');
    expect(within(actionsOf(detail)).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('publishes an article in review and retires a published one', async () => {
    const { user, detail, calls } = await open({ status: 'IN_REVIEW' });

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/control/publish'))).toBe(true));
    await user.click(await within(actionsOf(detail)).findByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith('/control/retire'))).toBe(true));
  });

  it('edits a draft keeping its content, and "cancel" closes the form', async () => {
    const { user, detail, calls } = await open({});

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Edit' }));
    const form = within(detail).getByRole('form', { name: 'Edit article' });
    expect(within(form).getByLabelText('Keywords (separate with commas)')).toHaveValue('switch, firmware');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(within(detail).queryByRole('form', { name: 'Edit article' })).not.toBeInTheDocument();
    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Edit' }));
    const again = within(detail).getByRole('form', { name: 'Edit article' });
    const title = within(again).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Switch drops packets (floor 3)');
    await user.click(within(again).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url.pathname.endsWith('/update'))?.body).toMatchObject({
      title: 'Switch drops packets (floor 3)', keywords: ['switch', 'firmware'], visibility: 'PUBLIC', relatedProblemIds: [PROBLEM],
    }));
    await waitFor(() => expect(within(detail).queryByRole('form', { name: 'Edit article' })).not.toBeInTheDocument());
  });

  it('starts a new version of a published article and opens it; the versions are listed and can be opened', async () => {
    const { user, detail, calls } = await open({ status: 'PUBLISHED' });

    expect(await within(detail).findByText('Versions')).toBeInTheDocument();
    expect(within(detail).getByText('Version 1')).toBeInTheDocument();
    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'New version' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.pathname.endsWith('/version/initiate'))).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.includes('/a2/retrieve'))).toBe(true));
  });

  it('a version in the list can be opened', async () => {
    const { user, detail, calls } = await open({ status: 'PUBLISHED' });

    await user.click(await within(detail).findByRole('button', { name: 'Version 2' }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.includes('/a2/retrieve'))).toBe(true));
  });

  it('a requester gets the text only: no people, no links, no versions, no history and no actions (their 403s are not errors)', async () => {
    const forbidden = { status: 403, body: { title: 'Forbidden', error_code: 'ERR-KNB-00403' } };
    const { detail } = await open({ status: 'PUBLISHED', authorId: undefined, reviewerId: undefined, relatedProblemIds: undefined, relatedIncidentIds: undefined },
      (r) => (r.url.pathname.endsWith('/versions/retrieve') || r.url.pathname.endsWith('/audit-log/retrieve') ? forbidden : undefined));

    expect(within(detail).getByText(/Reboot the switch/)).toBeInTheDocument();
    expect(within(detail).queryByText('Written by')).not.toBeInTheDocument();
    expect(within(detail).queryByText('Problems')).not.toBeInTheDocument();
    expect(within(detail).queryByText('History')).not.toBeInTheDocument();
    expect(within(detail).queryByText('Versions')).not.toBeInTheDocument();
    expect(within(detail).queryByLabelText('Actions')).not.toBeInTheDocument();
    expect(within(detail).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the problem when an action is refused, and can be closed', async () => {
    const { user, detail } = await open({}, (r) => (r.method === 'PUT' && r.url.pathname.endsWith('/control/submit')
      ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-KNB-00409', detail: 'Changed by someone else.' } } : undefined));

    await user.click(within(actionsOf(detail)).getByRole('button', { name: 'Submit for review' }));
    expect(await within(detail).findByText('ERR-KNB-00409')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Article detail' })).not.toBeInTheDocument();
  });

  it('shows a failure to start a version', async () => {
    const { user, detail } = await open({ status: 'PUBLISHED' }, (r) => (r.method === 'POST' && r.url.pathname.endsWith('/version/initiate')
      ? { status: 409, body: { title: 'Conflict', error_code: 'ERR-KNB-00409', detail: 'Version 2 already exists.' } } : undefined));

    await user.click(await within(actionsOf(detail)).findByRole('button', { name: 'New version' }));
    expect(await within(detail).findByText('Version 2 already exists.')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('has a Knowledge link that opens the page', async () => {
    const { impl } = fakeFetch(server());
    renderWithSession(<App />, impl, me, '/knowledge');
    expect(await screen.findByRole('heading', { name: 'Knowledge' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Knowledge' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Switch drops packets' })).toBeInTheDocument();
  });
});
