import { ProblemError } from '../api/client';
import { billingApi } from '../api/services';
import type { Entitlement, EntitlementSource, Plan, Subscription } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useI18n, type Translate } from '../i18n';
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

export const SOURCES: Record<EntitlementSource, string> = {
  SUBSCRIPTION: 'Your subscription',
  DEFAULT_PLAN: 'Default plan (no subscription)',
  SUSPENDED: 'Subscription suspended',
  UNMANAGED: 'No plans configured: everything is allowed',
};

export function limitText(entitlement: { allowed: boolean; limit?: number }, quota = true, t?: Translate): string {
  if (!entitlement.allowed) return t ? t('plan.notIncluded') : 'Not included';
  if (!quota) return t ? t('plan.includedText') : 'Included';
  return typeof entitlement.limit === 'number' ? String(entitlement.limit) : (t ? t('plan.unlimited') : 'Unlimited');
}

export function PlanPage() {
  const { t, label: optionLabel } = useI18n();
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
      <h1>{t('nav.plan')}</h1>
      <p className="muted">
        {t('plan.intro')}
      </p>

      <ProblemBanner error={current.error ?? entitlements.error ?? plans.error} />

      {current.loading ? <p className="muted">{t('common.loading')}</p> : subscription ? <SubscriptionCard subscription={subscription} /> : (
        <div className="card">
          <p><strong>{t('plan.noSubscription')}</strong> {t('plan.noSubscriptionNote')}</p>
        </div>
      )}

      <h2>{t('plan.includes')}</h2>
      {entitlements.data && (
        <table aria-label={t('plan.entitlements')}>
          <thead>
            <tr><th>{t('plan.feature')}</th><th>{t('plan.included')}</th><th>{t('plan.limit')}</th><th>{t('plan.decidedBy')}</th></tr>
          </thead>
          <tbody>
            {entitlements.data.map((entitlement, index) => (
              <tr key={entitlement.feature}>
                <td>{optionLabel(FEATURES[index].label)}</td>
                <td>{entitlement.allowed ? t('plan.yes') : t('plan.no')}</td>
                <td>{limitText(entitlement, FEATURES[index].quota, t)}</td>
                <td>{optionLabel(SOURCES[entitlement.source])}{entitlement.planCode ? <> <code>{entitlement.planCode}</code></> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>{t('plan.available')}</h2>
      {plans.data?.length === 0 && !plans.loading && <Empty>{t('plan.noPlans')}</Empty>}
      {(plans.data?.length ?? 0) > 0 && (
        <div className="plan-grid">
          {plans.data?.map((plan) => <PlanCard key={plan.id} plan={plan} current={plan.code === subscription?.planCode} />)}
        </div>
      )}
    </section>
  );
}

function SubscriptionCard({ subscription }: { subscription: Subscription }) {
  const { t, locale } = useI18n();
  return (
    <div className="card" aria-label={t('plan.current')}>
      <p>
        <StatusBadge status={subscription.status} /> {t('plan.onPlan')} <strong>{subscription.planCode}</strong>
        <span className="muted">{t('plan.since', { date: new Date(subscription.createdAt).toLocaleDateString(locale) })}</span>
      </p>
      {subscription.status === 'SUSPENDED' && <p className="field-error">{t('plan.suspended')}</p>}
      {subscription.status === 'PAST_DUE' && <p className="muted">{t('plan.pastDue')}</p>}
    </div>
  );
}

function PlanCard({ plan, current }: { plan: Plan; current: boolean }) {
  const { t, label: optionLabel } = useI18n();
  return (
    <div className={current ? 'card plan-card plan-current' : 'card plan-card'} aria-label={t('plan.planAria', { code: plan.code })}>
      <h3>{plan.name} <code>{plan.code}</code>{current && <span className="muted">{t('plan.yours')}</span>}</h3>
      <ul>
        {Object.entries(plan.entitlements).map(([feature, limit]) => (
          <li key={feature}>
            {optionLabel(FEATURES.find((f) => f.key === feature)?.label ?? feature)}: {limitText({ allowed: limit !== 0, limit: limit > 0 ? limit : undefined }, FEATURES.find((f) => f.key === feature)?.quota ?? true, t)}
          </li>
        ))}
      </ul>
    </div>
  );
}
