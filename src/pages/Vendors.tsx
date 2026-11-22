import { useState, type FormEvent } from 'react';
import { vendorApi } from '../api/services';
import {
  AGREEMENT_KINDS, AGREEMENT_STANDINGS, VENDOR_CATEGORIES,
  type Agreement, type AgreementKind, type AgreementStanding, type AuditEntry, type Vendor, type VendorCategory,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n, type Translate } from '../i18n';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

/** What the days to the end say, in words a person can read. */
function timeLeft(agreement: Agreement, t: Translate): string {
  if (agreement.daysToEnd === undefined) return '-';
  if (agreement.daysToEnd < 0) return t('vendors.endedAgo', { days: -agreement.daysToEnd });
  if (agreement.daysToEnd === 0) return t('vendors.endsToday');
  return t('vendors.daysLeft', { days: agreement.daysToEnd });
}

export function VendorsPage() {
  const { t, status: statusLabel, enumValue } = useI18n();
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
        <h1>{t('nav.vendors')}</h1>
        <div className="actions">
          <button type="button" onClick={() => setCreatingVendor(true)} disabled={creatingVendor}>{t('vendors.newVendor')}</button>
          <button type="button" className="primary" onClick={() => setCreatingAgreement(true)} disabled={creatingAgreement || !vendors.data?.some((vendor) => vendor.status === 'ACTIVE')}>{t('vendors.newAgreement')}</button>
        </div>
      </div>
      <p className="muted">{t('vendors.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {([['Expiring', count('EXPIRING')], ['Expired', count('EXPIRED')], [t('vendors.inForce'), count('IN_FORCE')], [t('vendors.notStarted'), count('NOT_STARTED')], ['Paused', count('PAUSED')], [t('procurement.total'), everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error ?? actionError} />
      {creatingVendor && <NewVendorForm onCancel={() => setCreatingVendor(false)} onCreated={() => { setCreatingVendor(false); vendors.reload(); }} />}
      {creatingAgreement && (
        <NewAgreementForm vendors={vendors.data?.filter((vendor) => vendor.status === 'ACTIVE') ?? []} onCancel={() => setCreatingAgreement(false)}
          onCreated={(agreement) => { setCreatingAgreement(false); setSelectedId(agreement.id); reloadAgreements(); }} />
      )}
      <h2>{t('vendors.agreements')}</h2>
      <div className="filters">
        <select aria-label={t('vendors.standing')} value={standingFilter} onChange={(e) => setStandingFilter(e.target.value as AgreementStanding | '')}>
          <option value="">{t('vendors.anyStanding')}</option>
          {AGREEMENT_STANDINGS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('ops.kind')} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as AgreementKind | '')}>
          <option value="">{t('vendors.anyKind')}</option>
          {AGREEMENT_KINDS.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
        </select>
        <select aria-label={t('vendors.vendor')} value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
          <option value="">{t('vendors.anyVendor')}</option>
          {vendors.data?.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('vendors.noAgreements')}</Empty> : (
          <table aria-label={t('vendors.agreements')}>
            <thead><tr><th>{t('vendors.reference')}</th><th>{t('vendors.vendor')}</th><th>{t('ops.kind')}</th><th>{t('vendors.standing')}</th><th>{t('vendors.ends')}</th><th>{t('vendors.timeLeft')}</th></tr></thead>
            <tbody>
              {list.data?.map((agreement) => (
                <tr key={agreement.id} className={agreement.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(agreement.id)}>{agreement.reference}</button></td>
                  <td>{vendorName(agreement.vendorId)}</td>
                  <td>{agreement.kind}</td>
                  <td><StatusBadge status={agreement.standing} /></td>
                  <td>{agreement.endsOn}</td>
                  <td>{timeLeft(agreement, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <AgreementDetail key={selectedId} id={selectedId} vendorName={vendorName} onClose={() => setSelectedId(undefined)} onChanged={reloadAgreements} />}
      </div>
      <h2>{t('nav.vendors')}</h2>
      <ProblemBanner error={vendors.error} />
      {vendors.data?.length === 0 && !vendors.loading ? <Empty>{t('vendors.noVendors')}</Empty> : (
        <table aria-label={t('nav.vendors')}>
          <thead><tr><th>{t('vendors.vendor')}</th><th>{t('common.category')}</th><th>{t('common.status')}</th><th /></tr></thead>
          <tbody>
            {vendors.data?.map((vendor) => (
              <tr key={vendor.id}>
                <td>{vendor.name}</td>
                <td>{vendor.category}</td>
                <td><StatusBadge status={vendor.status} /></td>
                <td>
                  <button type="button" disabled={busy} onClick={() => void control(vendor)}>{vendor.status === 'ACTIVE' ? t('vendors.deactivate') : t('vendors.activate')}</button>
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
  const { t, enumValue } = useI18n();
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
    <form className="card form" aria-label={t('vendors.newVendor')} onSubmit={submit}>
      <h2>{t('vendors.newVendor')}</h2>
      <label>{t('common.name')}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('common.category')}
        <select value={category} onChange={(e) => setCategory(e.target.value as VendorCategory)}>{VENDOR_CATEGORIES.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}</select>
      </label>
      <p className="muted">{t('vendors.onlyCompany')}</p>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('vendors.createVendor')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function NewAgreementForm({ vendors, onCreated, onCancel }: { vendors: Vendor[]; onCreated: (agreement: Agreement) => void; onCancel: () => void }) {
  const { t, enumValue } = useI18n();
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
    <form className="card form" aria-label={t('vendors.newAgreement')} onSubmit={submit}>
      <h2>{t('vendors.newAgreement')}</h2>
      <label>{t('vendors.vendor')}
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select>
      </label>
      <label>{t('ops.kind')}
        <select value={kind} onChange={(e) => setKind(e.target.value as AgreementKind)}>{AGREEMENT_KINDS.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}</select>
      </label>
      <label>{t('vendors.referenceInput')}<input value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} /></label>
      <label>{t('vendors.assetOptional')}<input value={assetId} onChange={(e) => setAssetId(e.target.value)} /></label>
      <label>{t('vendors.firstDay')}<input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></label>
      <label>{t('vendors.lastDay')}<input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></label>
      <label>{t('vendors.noticeInput')}<input inputMode="numeric" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> {t('vendors.renewsInput')}</label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('vendors.createAgreement')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function AgreementDetail({ id, vendorName, onClose, onChanged }: { id: string; vendorName: (id: string) => string; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
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
    <aside className="detail" aria-label={t('vendors.detail')}>
      <div className="detail-head">
        <h2>{agreement?.reference ?? t('vendors.agreementFallback')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {agreement && (
        <>
          <p><StatusBadge status={agreement.standing} /> <StatusBadge status={agreement.status} /></p>
          <dl>
            <dt>{t('vendors.vendor')}</dt><dd>{vendorName(agreement.vendorId)}</dd>
            <dt>{t('ops.kind')}</dt><dd>{agreement.kind}</dd>
            <dt>{t('vendors.inForce')}</dt><dd>{agreement.startsOn} to {agreement.endsOn} ({timeLeft(agreement, t)})</dd>
            <dt>{t('vendors.notice')}</dt><dd>{t('vendors.noticeText', { days: agreement.noticeDays })}{agreement.autoRenew ? t('vendors.autoRenewNote') : ''}</dd>
            {agreement.assetId && <><dt>{t('ops.asset')}</dt><dd><code>{agreement.assetId}</code></dd></>}
          </dl>
          <div className="actions" aria-label={t('itsm.actions')}>
            {agreement.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => registry.controlAgreement(id, 'pause'))}>{t('ops.pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => registry.controlAgreement(id, 'resume'))}>{t('ops.resume')}</button>}
          </div>
          <form className="form" aria-label={t('vendors.renew')} onSubmit={(event) => {
            event.preventDefault();
            if (newEnd === '') return;
            void run(async () => {
              await registry.updateAgreement(id, {
                kind: agreement.kind, assetId: agreement.assetId, startsOn: agreement.startsOn, endsOn: newEnd, noticeDays: agreement.noticeDays, autoRenew: agreement.autoRenew,
              });
              setNewEnd('');
            });
          }}>
            <label>{t('vendors.renewNewLast')}<input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></label>
            <button type="submit" disabled={busy || newEnd === ''}>{t('vendors.renew')}</button>
          </form>
          <h3>{t('itsm.history')}</h3>
          <ol className="audit">
            {detail.data?.trail.map((entry) => (
              <li key={`${entry.occurredAt}-${entry.action}`}>
                <strong>{entry.action}</strong> by {entry.executor}
                <div className="muted small">{new Date(entry.occurredAt).toLocaleString(locale)}{entry.detail ? ` - ${entry.detail}` : ''}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
