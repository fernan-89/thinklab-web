import { useMemo, useState } from 'react';
import { installKitApi } from '../api/services';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { KIT_RULES, KNOWN_LIMITS, QUICK_INSTALL_REPO, QUICK_INSTALL_VERSION, SYSTEMS, type Family, type Lang, type Role } from '../quickinstall/kits';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

const FAMILIES: Family[] = ['Windows', 'Linux', 'Recovery'];
const ROLES: Role[] = ['Workstation', 'Server', 'Tool'];

const when = (value: string | undefined, locale: string) => (value ? new Date(value).toLocaleString(locale) : '-');

/** What this organisation has registered with the it-install-kit service: its kits, the stick they make up, and the latest install reports. */
function Organisation() {
  const { t, locale } = useI18n();
  const { api } = useSession();
  const service = installKitApi(api);
  const kits = useAsync(() => service.kits(), []);
  const definition = useAsync(() => service.stickDefinition(), []);
  const reports = useAsync(() => service.reports(), []);
  const names = new Map((kits.data ?? []).map((kit) => [kit.id, kit.name]));
  const error = kits.error ?? definition.error ?? reports.error;

  return (
    <section aria-label={t('quickinstall.yourOrg')}>
      <h2>{t('quickinstall.yourOrg')}</h2>
      <p className="muted">{t('quickinstall.orgIntro')}</p>
      <ProblemBanner error={error} />
      {kits.loading ? <p className="muted">{t('common.loading')}</p> : (kits.data ?? []).length === 0 ? <Empty>{t('quickinstall.noKit')}</Empty> : (
        <>
          <p>{definition.data ? t('quickinstall.definition', { kits: definition.data.kitCount, systems: definition.data.systems.length }) : ''}</p>
          <table aria-label={t('quickinstall.registered')}>
            <thead><tr><th>{t('quickinstall.kit')}</th><th>{t('quickinstall.system')}</th><th>{t('quickinstall.language')}</th><th>{t('quickinstall.machineClass')}</th><th>{t('quickinstall.revision')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {(kits.data ?? []).map((kit) => (
                <tr key={kit.id}>
                  <td>{kit.name}</td><td>{kit.systemId}</td><td>{kit.language}</td><td>{kit.machineClass}</td><td>{kit.revision}</td><td><StatusBadge status={kit.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {(reports.data ?? []).length > 0 && (
        <>
          <h3>{t('quickinstall.latestReports')}</h3>
          <table aria-label={t('quickinstall.reports')}>
            <thead><tr><th>{t('audit.col.when')}</th><th>{t('quickinstall.kit')}</th><th>{t('quickinstall.revisionRun')}</th><th>{t('quickinstall.addOnColumn')}</th><th>{t('quickinstall.outcome')}</th><th>{t('quickinstall.warnings')}</th></tr></thead>
            <tbody>
              {(reports.data ?? []).slice(0, 10).map((report) => (
                <tr key={report.id}>
                  <td>{when(report.occurredAt, locale)}</td><td>{names.get(report.kitId) ?? report.kitId}</td><td>{report.kitRevision}</td><td>{report.addOnVersion}</td>
                  <td><StatusBadge status={report.outcome} /></td><td>{report.warnings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** The Quick Install module: what the add-on's Ventoy stick can install (bundled, sanitised data) and what this organisation has registered (the it-install-kit service). */
export function QuickInstallPage() {
  const { t, label: optionLabel } = useI18n();
  const [family, setFamily] = useState<Family | ''>('');
  const [role, setRole] = useState<Role | ''>('');
  const [lang, setLang] = useState<Lang | ''>('');

  const shown = useMemo(
    () => SYSTEMS.filter((s) => (!family || s.family === family) && (!role || s.role === role) && (!lang || s.languages.includes(lang))),
    [family, role, lang],
  );
  const count = (f: Family) => SYSTEMS.filter((s) => s.family === f).length;

  return (
    <section className="page-quickinstall">
      <div className="page-head">
        <h1>{t('nav.quickInstall')}</h1>
        <a href={QUICK_INSTALL_REPO} target="_blank" rel="noreferrer">{t('quickinstall.addOn', { version: QUICK_INSTALL_VERSION })}</a>
      </div>
      <p className="muted">
        {t('quickinstall.intro')}
      </p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {FAMILIES.map((f) => (
          <div key={f} className="tile"><span className="n">{count(f)}</span><span className="l">{optionLabel(f)}</span></div>
        ))}
      </div>
      <div className="filters">
        <select aria-label={t('quickinstall.family')} value={family} onChange={(e) => setFamily(e.target.value as Family | '')}>
          <option value="">{t('quickinstall.anyFamily')}</option>
          {FAMILIES.map((f) => <option key={f} value={f}>{optionLabel(f)}</option>)}
        </select>
        <select aria-label={t('quickinstall.role')} value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
          <option value="">{t('quickinstall.anyRole')}</option>
          {ROLES.map((r) => <option key={r} value={r}>{optionLabel(r)}</option>)}
        </select>
        <select aria-label={t('quickinstall.language')} value={lang} onChange={(e) => setLang(e.target.value as Lang | '')}>
          <option value="">{t('quickinstall.anyLanguage')}</option>
          <option value="EN">{optionLabel('English (EN-US)')}</option>
          <option value="PT">{optionLabel('Portuguese (PT-BR)')}</option>
        </select>
      </div>
      {shown.length === 0 ? <Empty>{t('quickinstall.noSystem')}</Empty> : (
        <table>
          <thead><tr><th>{t('quickinstall.system')}</th><th>{t('quickinstall.family')}</th><th>{t('quickinstall.role')}</th><th>{t('quickinstall.languages')}</th><th>{t('quickinstall.editions')}</th><th>{t('quickinstall.includes')}</th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong>{s.note && <div className="muted">{optionLabel(s.note)}</div>}</td>
                <td>{optionLabel(s.family)}</td>
                <td>{optionLabel(s.role)}</td>
                <td>{s.languages.join(' / ')}</td>
                <td>{s.editions?.join(', ') ?? '-'}</td>
                <td>{s.includes.map((item) => optionLabel(item)).join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Organisation />
      <h2>{t('quickinstall.howItWorks')}</h2>
      <ul>{KIT_RULES.map((r) => <li key={r}>{optionLabel(r)}</li>)}</ul>
      <h2>{t('quickinstall.knownLimits')}</h2>
      <ul>{KNOWN_LIMITS.map((r) => <li key={r}>{optionLabel(r)}</li>)}</ul>
    </section>
  );
}
