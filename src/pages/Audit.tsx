import { useState } from 'react';
import { ledgerApi } from '../api/services';
import type { ChainIntegrity } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner } from '../components/Feedback';
import { useAsync } from '../useAsync';

export function AuditPage() {
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
      <h1>Audit</h1>
      <p className="muted">
        Every change made through the platform, in the order it was recorded. Entries are chained by hash: if one is altered or
        removed afterwards, verification points at it.
      </p>

      <div className="filters">
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ actor, resourceType });
          }}
        >
          <input aria-label="Actor" placeholder="Actor" value={actor} onChange={(e) => setActor(e.target.value)} />
          <input aria-label="Resource type" placeholder="Resource type (e.g. it-asset-registry)" value={resourceType} onChange={(e) => setResourceType(e.target.value)} />
          <button type="submit">Filter</button>
        </form>
        <button type="button" className="primary" disabled={verifying} onClick={verify}>
          {verifying ? 'Verifying...' : 'Verify integrity'}
        </button>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown (newest first)`}</span>
      </div>

      <ProblemBanner error={verifyError ?? list.error} />
      {verdict && <Verdict verdict={verdict} />}

      {list.data?.length === 0 && !list.loading && <Empty>No entries.</Empty>}
      {(list.data?.length ?? 0) > 0 && (
        <table>
          <thead>
            <tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Resource</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {list.data?.map((entry) => (
              <tr key={entry.id} className={verdict && !verdict.valid && entry.sequence === verdict.firstBrokenSequence ? 'selected' : undefined}>
                <td>{entry.sequence}</td>
                <td>{new Date(entry.occurredAt).toLocaleString()}</td>
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
  if (verdict.valid) {
    return (
      <div className="banner banner-ok" role="status">
        <strong>Intact.</strong> {verdict.entriesChecked} {verdict.entriesChecked === 1 ? 'entry' : 'entries'} checked.
        {verdict.headHash && <> Head <code title={verdict.headHash}>{verdict.headHash.slice(0, 16)}</code>.</>}
        {verdict.anchorsVerified > 0 && <> Confirmed against {verdict.anchorsVerified} {verdict.anchorsVerified === 1 ? 'anchor' : 'anchors'} published outside the database.</>}
      </div>
    );
  }
  return (
    <div className="banner banner-error" role="alert">
      <strong>Chain broken at entry #{verdict.firstBrokenSequence}.</strong>
      <p>{verdict.reason}</p>
      <p>Everything up to #{verdict.headSequence} is still trustworthy.</p>
    </div>
  );
}
