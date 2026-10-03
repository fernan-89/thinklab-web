import { ProblemError } from '../api/client';
import { billingApi } from '../api/services';
import type { Entitlement, EntitlementSource, Plan, Subscription } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

/** The features the product gates today, in the order they are shown. */
/** A quota is counted (assets, sites); a switch is simply in the plan or not (its limit is 1). */
export const FEATURES: { key: string; label: string; quota: boolean }[] = [
  { key: 'assets', label: 'Assets', quota: true },
  { key: 'sites', label: 'Sites', quota: true },
  { key: 'discovery', label: 'Discovery', quota: false },
  { key: 'audit', label: 'Audit ledger', quota: false },
  { key: 'sso', label: 'Single sign-on', quota: false },
];

const SOURCES: Record<EntitlementSource, string> = {
  SUBSCRIPTION: 'Your subscription',
  DEFAULT_PLAN: 'Default plan (no subscription)',
  SUSPENDED: 'Subscription suspended',
  UNMANAGED: 'No plans configured: everything is allowed',
};

export function limitText(entitlement: { allowed: boolean; limit?: number }, quota = true): string {
  if (!entitlement.allowed) return 'Not included';
  if (!quota) return 'Included';
  return typeof entitlement.limit === 'number' ? String(entitlement.limit) : 'Unlimited';
}

export function PlanPage() {
  const { api } = useSession();
  const billing = billingApi(api);

  const current = useAsync<Subscription | null>(async () => {
    try {
      return await billing.current();
    } catch (failure) {
      if (failure instanceof ProblemError && failure.status === 404) return null;
      throw failure;
    }
  }, []);
  const entitlements = useAsync<Entitlement[]>(() => Promise.all(FEATURES.map((feature) => billing.evaluate(feature.key))), []);
  const plans = useAsync(() => billing.plans('ACTIVE'), []);

  const subscription = current.data;

  return (
    <section className="page-plan">
      <h1>Plan</h1>
      <p className="muted">
        The edition this organisation is on and what it includes. Limits are decided by the billing service; this page only shows them.
      </p>

      <ProblemBanner error={current.error ?? entitlements.error ?? plans.error} />

      {current.loading ? <p className="muted">Loading...</p> : subscription ? <SubscriptionCard subscription={subscription} /> : (
        <div className="card">
          <p><strong>No subscription.</strong> Where a default plan is configured it applies; otherwise nothing is limited.</p>
        </div>
      )}

      <h2>What it includes</h2>
      {entitlements.data && (
        <table aria-label="Entitlements">
          <thead>
            <tr><th>Feature</th><th>Included</th><th>Limit</th><th>Decided by</th></tr>
          </thead>
          <tbody>
            {entitlements.data.map((entitlement, index) => (
              <tr key={entitlement.feature}>
                <td>{FEATURES[index].label}</td>
                <td>{entitlement.allowed ? 'Yes' : 'No'}</td>
                <td>{limitText(entitlement, FEATURES[index].quota)}</td>
                <td>{SOURCES[entitlement.source]}{entitlement.planCode ? <> <code>{entitlement.planCode}</code></> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Available plans</h2>
      {plans.data?.length === 0 && !plans.loading && <Empty>No plans are on sale.</Empty>}
      {(plans.data?.length ?? 0) > 0 && (
        <div className="plan-grid">
          {plans.data?.map((plan) => <PlanCard key={plan.id} plan={plan} current={plan.code === subscription?.planCode} />)}
        </div>
      )}
    </section>
  );
}

function SubscriptionCard({ subscription }: { subscription: Subscription }) {
  return (
    <div className="card" aria-label="Current subscription">
      <p>
        <StatusBadge status={subscription.status} /> on plan <strong>{subscription.planCode}</strong>
        <span className="muted"> since {new Date(subscription.createdAt).toLocaleDateString()}</span>
      </p>
      {subscription.status === 'SUSPENDED' && <p className="field-error">This subscription is suspended: nothing below is available until it is re-activated.</p>}
      {subscription.status === 'PAST_DUE' && <p className="muted">Payment is overdue. Everything still works for now.</p>}
    </div>
  );
}

function PlanCard({ plan, current }: { plan: Plan; current: boolean }) {
  return (
    <div className={current ? 'card plan-card plan-current' : 'card plan-card'} aria-label={`Plan ${plan.code}`}>
      <h3>{plan.name} <code>{plan.code}</code>{current && <span className="muted"> (yours)</span>}</h3>
      <ul>
        {Object.entries(plan.entitlements).map(([feature, limit]) => (
          <li key={feature}>
            {(FEATURES.find((f) => f.key === feature)?.label ?? feature)}: {limitText({ allowed: limit !== 0, limit: limit > 0 ? limit : undefined }, FEATURES.find((f) => f.key === feature)?.quota ?? true)}
          </li>
        ))}
      </ul>
    </div>
  );
}
