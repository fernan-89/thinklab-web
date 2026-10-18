import { useState, type FormEvent } from 'react';
import { vendorApi } from '../api/services';
import {
  AGREEMENT_KINDS, AGREEMENT_STANDINGS, VENDOR_CATEGORIES,
  type Agreement, type AgreementKind, type AgreementStanding, type AuditEntry, type Vendor, type VendorCategory,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/** What the days to the end say, in words a person can read. */
function timeLeft(agreement: Agreement): string {
  if (agreement.daysToEnd === undefined) return '-';
  if (agreement.daysToEnd < 0) return `ended ${-agreement.daysToEnd} days ago`;
  if (agreement.daysToEnd === 0) return 'ends today';
  return `${agreement.daysToEnd} days left`;
}

export function VendorsPage() {
  const { api } = useSession();
  const registry = vendorApi(api);
  const [standingFilter, setStandingFilter] = useState<AgreementStanding | ''>('');
  const [kindFilter, setKindFilter] = useState<AgreementKind | ''>('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [creatingAgreement, setCreatingAgreement] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const vendors = useAsync(() => registry.vendors({}), []);
  const everything = useAsync(() => registry.agreements({}), []);
  const list = useAsync(
    () => registry.agreements({ standing: standingFilter || undefined, kind: kindFilter || undefined, vendorId: vendorFilter || undefined }),
    [standingFilter, kindFilter, vendorFilter],
  );
  const reloadAgreements = () => { list.reload(); everything.reload(); };
  const count = (standing: AgreementStanding) => everything.data?.filter((agreement) => agreement.standing === standing).length;
  const vendorName = (id: string) => vendors.data?.find((vendor) => vendor.id === id)?.name ?? id;

  async function control(vendor: Vendor) {
    setBusy(true);
    setActionError(undefined);
    try {
      await registry.controlVendor(vendor.id, vendor.status === 'ACTIVE' ? 'deactivate' : 'activate');
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
      vendors.reload();
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>Vendors</h1>
        <div className="actions">
          <button type="button" onClick={() => setCreatingVendor(true)} disabled={creatingVendor}>New vendor</button>
          <button type="button" className="primary" onClick={() => setCreatingAgreement(true)} disabled={creatingAgreement || !vendors.data?.some((vendor) => vendor.status === 'ACTIVE')}>New agreement</button>
        </div>
      </div>
      <p className="muted">Who the organisation buys from and what each one owes: contracts, warranties, support plans and licence terms. Whether an agreement is about to end is worked out on the day you look, from its dates; nobody has to keep it up to date. A renewal is a new last day.</p>
      <div className="tiles" aria-label="Summary">
        {([['Expiring', count('EXPIRING')], ['Expired', count('EXPIRED')], ['In force', count('IN_FORCE')], ['Not started', count('NOT_STARTED')], ['Paused', count('PAUSED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error ?? actionError} />
      {creatingVendor && <NewVendorForm onCancel={() => setCreatingVendor(false)} onCreated={() => { setCreatingVendor(false); vendors.reload(); }} />}
      {creatingAgreement && (
        <NewAgreementForm vendors={vendors.data?.filter((vendor) => vendor.status === 'ACTIVE') ?? []} onCancel={() => setCreatingAgreement(false)}
          onCreated={(agreement) => { setCreatingAgreement(false); setSelectedId(agreement.id); reloadAgreements(); }} />
      )}
      <h2>Agreements</h2>
      <div className="filters">
        <select aria-label="Standing" value={standingFilter} onChange={(e) => setStandingFilter(e.target.value as AgreementStanding | '')}>
          <option value="">Any standing</option>
          {AGREEMENT_STANDINGS.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
        </select>
        <select aria-label="Kind" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as AgreementKind | '')}>
          <option value="">Any kind</option>
          {AGREEMENT_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Vendor" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
          <option value="">Any vendor</option>
          {vendors.data?.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No agreements match.</Empty> : (
          <table aria-label="Agreements">
            <thead><tr><th>Reference</th><th>Vendor</th><th>Kind</th><th>Standing</th><th>Ends</th><th>Time left</th></tr></thead>
            <tbody>
              {list.data?.map((agreement) => (
                <tr key={agreement.id} className={agreement.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(agreement.id)}>{agreement.reference}</button></td>
                  <td>{vendorName(agreement.vendorId)}</td>
                  <td>{agreement.kind}</td>
                  <td><StatusBadge status={agreement.standing} /></td>
                  <td>{agreement.endsOn}</td>
                  <td>{timeLeft(agreement)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <AgreementDetail key={selectedId} id={selectedId} vendorName={vendorName} onClose={() => setSelectedId(undefined)} onChanged={reloadAgreements} />}
      </div>
      <h2>Vendors</h2>
      <ProblemBanner error={vendors.error} />
      {vendors.data?.length === 0 && !vendors.loading ? <Empty>No vendors yet.</Empty> : (
        <table aria-label="Vendors">
          <thead><tr><th>Vendor</th><th>Category</th><th>Status</th><th /></tr></thead>
          <tbody>
            {vendors.data?.map((vendor) => (
              <tr key={vendor.id}>
                <td>{vendor.name}</td>
                <td>{vendor.category}</td>
                <td><StatusBadge status={vendor.status} /></td>
                <td>
                  <button type="button" disabled={busy} onClick={() => void control(vendor)}>{vendor.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewVendorForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<VendorCategory>('HARDWARE');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await vendorApi(api).createVendor({ name: name.trim(), category });
      onCreated();
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New vendor" onSubmit={submit}>
      <h2>New vendor</h2>
      <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Category
        <select value={category} onChange={(e) => setCategory(e.target.value as VendorCategory)}>{VENDOR_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <p className="muted">Only the company: no contact person, e-mail, phone or price is kept here.</p>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create vendor'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function NewAgreementForm({ vendors, onCreated, onCancel }: { vendors: Vendor[]; onCreated: (agreement: Agreement) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? '');
  const [kind, setKind] = useState<AgreementKind>('CONTRACT');
  const [reference, setReference] = useState('');
  const [assetId, setAssetId] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [noticeDays, setNoticeDays] = useState('30');
  const [autoRenew, setAutoRenew] = useState(false);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = vendorId !== '' && reference.trim() !== '' && startsOn !== '' && endsOn !== '' && noticeDays.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await vendorApi(api).createAgreement({
        vendorId, kind, reference: reference.trim(), assetId: assetId.trim() || undefined, startsOn, endsOn, noticeDays: Number(noticeDays), autoRenew,
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New agreement" onSubmit={submit}>
      <h2>New agreement</h2>
      <label>Vendor
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select>
      </label>
      <label>Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as AgreementKind)}>{AGREEMENT_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <label>Reference (the number on the paper)<input value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} /></label>
      <label>Asset it covers (identifier, optional)<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>First day<input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></label>
      <label>Last day<input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></label>
      <label>Tell us this many days before the end<input inputMode="numeric" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> It renews itself (a note only: the last day does not move until you renew it here)</label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create agreement'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function AgreementDetail({ id, vendorName, onClose, onChanged }: { id: string; vendorName: (id: string) => string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const registry = vendorApi(api);
  const detail = useAsync<{ agreement: Agreement; trail: AuditEntry[] }>(async () => {
    const [agreement, trail] = await Promise.all([registry.agreement(id), registry.agreementAuditLog(id)]);
    return { agreement, trail };
  }, [id]);
  const [newEnd, setNewEnd] = useState('');
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const agreement = detail.data?.agreement;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
      detail.reload();
      onChanged();
    }
  }

  return (
    <aside className="detail" aria-label="Agreement detail">
      <div className="detail-head">
        <h2>{agreement?.reference ?? 'Agreement'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {agreement && (
        <>
          <p><StatusBadge status={agreement.standing} /> <StatusBadge status={agreement.status} /></p>
          <dl>
            <dt>Vendor</dt><dd>{vendorName(agreement.vendorId)}</dd>
            <dt>Kind</dt><dd>{agreement.kind}</dd>
            <dt>In force</dt><dd>{agreement.startsOn} to {agreement.endsOn} ({timeLeft(agreement)})</dd>
            <dt>Notice</dt><dd>{agreement.noticeDays} days before the end{agreement.autoRenew ? '; renews itself (not followed here)' : ''}</dd>
            {agreement.assetId && <><dt>Asset</dt><dd><code>{agreement.assetId}</code></dd></>}
          </dl>
          <div className="actions" aria-label="Actions">
            {agreement.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => registry.controlAgreement(id, 'pause'))}>Pause</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => registry.controlAgreement(id, 'resume'))}>Resume</button>}
          </div>
          <form className="form" aria-label="Renew" onSubmit={(event) => {
            event.preventDefault();
            if (newEnd === '') return;
            void run(async () => {
              await registry.updateAgreement(id, {
                kind: agreement.kind, assetId: agreement.assetId, startsOn: agreement.startsOn, endsOn: newEnd, noticeDays: agreement.noticeDays, autoRenew: agreement.autoRenew,
              });
              setNewEnd('');
            });
          }}>
            <label>Renew: new last day<input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></label>
            <button type="submit" disabled={busy || newEnd === ''}>Renew</button>
          </form>
          <h3>History</h3>
          <ol className="audit">
            {detail.data?.trail.map((entry) => (
              <li key={`${entry.occurredAt}-${entry.action}`}>
                <strong>{entry.action}</strong> by {entry.executor}
                <div className="muted small">{new Date(entry.occurredAt).toLocaleString()}{entry.detail ? ` - ${entry.detail}` : ''}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
