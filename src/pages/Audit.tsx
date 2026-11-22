import { useState } from 'react';
import { ledgerApi } from '../api/services';
import type { ChainIntegrity } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner } from '../components/Feedback';
import { useI18n } from '../i18n';
import { useAsync } from '../useAsync';

export function AuditPage() {
  const { t, locale } = useI18n();
  const { api } = useSession();
  const ledger = ledgerApi(api);
  const [actor, setActor] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [applied, setApplied] = useState({ actor: '', resourceType: '' });
  const [verdict, setVerdict] = useState<ChainIntegrity>();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<Error>();

  const list = useAsync(
    () => ledger.list({ actor: applied.actor.trim() || undefined, resourceType: applied.resourceType.trim() || undefined, limit: 200 }),
    [applied],
  );

  async function verify() {
    setVerifying(true);
    setVerifyError(undefined);
    try {
      setVerdict(await ledger.verify());
    } catch (failure) {
      setVerifyError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <section>
      <h1>{t('nav.audit')}</h1>
      <p className="muted">{t('audit.intro')}</p>

      <div className="filters">
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ actor, resourceType });
          }}
        >
          <input aria-label={t('audit.actor')} placeholder={t('audit.actor')} value={actor} onChange={(e) => setActor(e.target.value)} />
          <input aria-label={t('audit.resourceType')} placeholder={t('audit.resourceTypePlaceholder')} value={resourceType} onChange={(e) => setResourceType(e.target.value)} />
          <button type="submit">{t('audit.filter')}</button>
        </form>
        <button type="button" className="primary" disabled={verifying} onClick={verify}>
          {verifying ? t('audit.verifying') : t('audit.verify')}
        </button>
        <span className="muted">{list.loading ? t('common.loading') : t('audit.shownNewest', { count: list.data?.length ?? 0 })}</span>
      </div>

      <ProblemBanner error={verifyError ?? list.error} />
      {verdict && <Verdict verdict={verdict} />}

      {list.data?.length === 0 && !list.loading && <Empty>{t('audit.none')}</Empty>}
      {(list.data?.length ?? 0) > 0 && (
        <table>
          <thead>
            <tr><th>#</th><th>{t('audit.col.when')}</th><th>{t('audit.actor')}</th><th>{t('audit.col.action')}</th><th>{t('audit.col.resource')}</th><th>{t('audit.col.detail')}</th></tr>
          </thead>
          <tbody>
            {list.data?.map((entry) => (
              <tr key={entry.id} className={verdict && !verdict.valid && entry.sequence === verdict.firstBrokenSequence ? 'selected' : undefined}>
                <td>{entry.sequence}</td>
                <td>{new Date(entry.occurredAt).toLocaleString(locale)}</td>
                <td>{entry.actor}</td>
                <td><code>{entry.action}</code></td>
                <td>{entry.resourceType}{entry.resourceId ? <> <code title={entry.resourceId}>{entry.resourceId.slice(0, 8)}</code></> : null}</td>
                <td>{entry.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Verdict({ verdict }: { verdict: ChainIntegrity }) {
  const { t } = useI18n();
  if (verdict.valid) {
    return (
      <div className="banner banner-ok" role="status">
        <strong>{t('audit.intact')}</strong> {t(verdict.entriesChecked === 1 ? 'audit.checkedOne' : 'audit.checkedMany', { count: verdict.entriesChecked })}
        {verdict.headHash && <> {t('audit.head')} <code title={verdict.headHash}>{verdict.headHash.slice(0, 16)}</code>.</>}
        {verdict.anchorsVerified > 0 && <> {t(verdict.anchorsVerified === 1 ? 'audit.anchorsOne' : 'audit.anchorsMany', { count: verdict.anchorsVerified })}</>}
      </div>
    );
  }
  return (
    <div className="banner banner-error" role="alert">
      <strong>{t('audit.broken', { sequence: verdict.firstBrokenSequence ?? '' })}</strong>
      <p>{verdict.reason}</p>
      <p>{t('audit.trustworthy', { sequence: verdict.headSequence ?? '' })}</p>
    </div>
  );
}
