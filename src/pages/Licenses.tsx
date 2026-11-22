import { useState, type FormEvent } from 'react';
import { licenseApi, vendorApi } from '../api/services';
import {
  LICENSE_LEVELS, LICENSE_UNITS, POLICY_STATUSES,
  type AuditEntry, type License, type LicenseLevel, type LicenseUnit, type PolicyStatus, type UsageReport,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n, type Translate } from '../i18n';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value: string | undefined, locale: string) => (value ? new Date(value).toLocaleString(locale) : undefined);

/** How many seats are left, in words: negative is seats too many. */
function seatsLeft(license: License, t: Translate): string {
  if (license.available === undefined) return '-';
  if (license.available < 0) return t('licences.tooMany', { count: -license.available });
  return t('licences.left', { count: license.available });
}

export function LicensesPage() {
  const { t, status: statusLabel, enumValue } = useI18n();
  const { api } = useSession();
  const licenses = licenseApi(api);
  const [levelFilter, setLevelFilter] = useState<LicenseLevel | ''>('');
  const [unitFilter, setUnitFilter] = useState<LicenseUnit | ''>('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const everything = useAsync(() => licenses.list({}), []);
  const list = useAsync(
    () => licenses.list({ level: levelFilter || undefined, unit: unitFilter || undefined, status: statusFilter || undefined }),
    [levelFilter, unitFilter, statusFilter],
  );
  const reloadAll = () => { list.reload(); everything.reload(); };
  const count = (level: LicenseLevel) => everything.data?.filter((license) => license.level === level).length;

  return (
    <section>
      <div className="page-head">
        <h1>{t('nav.licenses')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('licences.new')}</button>
      </div>
      <p className="muted">{t('licences.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {([[t('licences.overLimit'), count('OVER_LIMIT')], [t('licences.nearLimit'), count('NEAR_LIMIT')], ['OK', count('OK')], [t('licences.noCountYet'), count('NO_DATA')], ['Paused', count('PAUSED')], [t('procurement.total'), everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewLicenseForm onCancel={() => setCreating(false)} onCreated={(license) => { setCreating(false); setSelectedId(license.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label={t('ops.level')} value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as LicenseLevel | '')}>
          <option value="">{t('capacity.anyLevel')}</option>
          {LICENSE_LEVELS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('licences.unit')} value={unitFilter} onChange={(e) => setUnitFilter(e.target.value as LicenseUnit | '')}>
          <option value="">{t('licences.anyUnit')}</option>
          {LICENSE_UNITS.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
        </select>
        <select aria-label={t('common.status')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PolicyStatus | '')}>
          <option value="">{t('ops.activePaused')}</option>
          {POLICY_STATUSES.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
        </select>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('licences.noLicences')}</Empty> : (
          <table aria-label={t('licences.licences')}>
            <thead><tr><th>{t('licences.product')}</th><th>{t('licences.unit')}</th><th>{t('ops.level')}</th><th>{t('licences.inUse')}</th><th>{t('licences.seats')}</th></tr></thead>
            <tbody>
              {list.data?.map((license) => (
                <tr key={license.id} className={license.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(license.id)}>{license.product}</button></td>
                  <td>{license.unit}</td>
                  <td><StatusBadge status={license.level} />{license.stale && <span className="stale-note"> {t('licences.noRecentCount')}</span>}</td>
                  <td>{license.lastInUse === undefined ? <span className="muted">-</span> : t('licences.ofEntitled', { used: license.lastInUse, entitled: license.entitled })}</td>
                  <td>{seatsLeft(license, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <LicenseDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={reloadAll} />}
      </div>
    </section>
  );
}

function NewLicenseForm({ onCreated, onCancel }: { onCreated: (license: License) => void; onCancel: () => void }) {
  const { t, enumValue } = useI18n();
  const { api } = useSession();
  const vendors = useAsync(() => vendorApi(api).vendors({ status: 'ACTIVE' }), []);
  const [product, setProduct] = useState('');
  const [unit, setUnit] = useState<LicenseUnit>('USER');
  const [entitled, setEntitled] = useState('');
  const [warn, setWarn] = useState('90');
  const [reportEvery, setReportEvery] = useState('24');
  const [vendorId, setVendorId] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = product.trim() !== '' && [entitled, warn, reportEvery].every((value) => value.trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await licenseApi(api).create({
        product: product.trim(), unit, entitled: Number(entitled), warnPercent: Number(warn), reportEveryHours: Number(reportEvery), vendorId: vendorId || undefined,
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label={t('licences.new')} onSubmit={submit}>
      <h2>{t('licences.new')}</h2>
      <label>{t('licences.product')}<input value={product} maxLength={80} onChange={(e) => setProduct(e.target.value)} /></label>
      <label>{t('licences.aSeatIsOne')}
        <select value={unit} onChange={(e) => setUnit(e.target.value as LicenseUnit)}>{LICENSE_UNITS.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}</select>
      </label>
      <label>{t('licences.seatsBought')}<input inputMode="numeric" value={entitled} onChange={(e) => setEntitled(e.target.value)} /></label>
      <label>{t('licences.warnInput')}<input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
      <label>{t('capacity.reportsInput')}<input inputMode="numeric" value={reportEvery} onChange={(e) => setReportEvery(e.target.value)} /></label>
      <label>{t('licences.vendorOptional')}
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">{t('licences.none')}</option>
          {vendors.data?.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
      </label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('licences.create')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function LicenseDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale, enumValue } = useI18n();
  const { api } = useSession();
  const licenses = licenseApi(api);
  const detail = useAsync<{ license: License; reports: UsageReport[]; trail: AuditEntry[] }>(async () => {
    const [license, reports, trail] = await Promise.all([licenses.retrieve(id), licenses.reports({ licenseId: id }), licenses.auditLog(id)]);
    return { license, reports, trail };
  }, [id]);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const license = detail.data?.license;

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
    <aside className="detail" aria-label={t('licences.detail')}>
      <div className="detail-head">
        <h2>{license?.product ?? t('licences.fallback')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {license && (
        <>
          <p><StatusBadge status={license.level} /> <StatusBadge status={license.status} /></p>
          <dl>
            <dt>{t('licences.bought')}</dt><dd>{t('licences.boughtText', { seats: license.entitled, unit: enumValue(license.unit).toLowerCase(), warn: license.warnPercent })}</dd>
            {license.lastInUse !== undefined && <><dt>{t('licences.latestCount')}</dt><dd>{t('licences.latestText', { used: license.lastInUse, percent: license.usagePercent?.toFixed(1) ?? '', left: seatsLeft(license, t), when: when(license.lastMeasuredAt, locale) ?? '' })}{license.stale ? t('licences.stale') : ''}</dd></>}
            <dt>{t('capacity.reports')}</dt><dd>{t('licences.expectedEvery', { hours: license.reportEveryHours })}</dd>
          </dl>
          <div className="actions" aria-label={t('itsm.actions')}>
            {license.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => licenses.control(id, 'pause'))}>{t('ops.pause')}</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => licenses.control(id, 'resume'))}>{t('ops.resume')}</button>}
          </div>
          <h3>{t('licences.recentCounts')}</h3>
          {detail.data?.reports.length === 0 ? <Empty>{t('licences.noCounts')}</Empty> : (
            <table aria-label={t('licences.recentCounts')}>
              <thead><tr><th>{t('licences.counted')}</th><th>{t('licences.inUse')}</th><th>{t('ops.by')}</th></tr></thead>
              <tbody>
                {detail.data?.reports.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.measuredAt).toLocaleString(locale)}</td>
                    <td>{entry.inUse}</td>
                    <td>{entry.reportedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
