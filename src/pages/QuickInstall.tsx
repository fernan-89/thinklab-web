import { useMemo, useState } from 'react';
import { installKitApi } from '../api/services';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { KIT_RULES, KNOWN_LIMITS, QUICK_INSTALL_REPO, QUICK_INSTALL_VERSION, SYSTEMS, type Family, type Lang, type Role } from '../quickinstall/kits';
import { useAsync } from '../useAsync';

const FAMILIES: Family[] = ['Windows', 'Linux', 'Recovery'];
const ROLES: Role[] = ['Workstation', 'Server', 'Tool'];

const when = (value?: string) => (value ? new Date(value).toLocaleString() : '-');

/** What this organisation has registered with the it-install-kit service: its kits, the stick they make up, and the latest install reports. */
function Organisation() {
  const { api } = useSession();
  const service = installKitApi(api);
  const kits = useAsync(() => service.kits(), []);
  const definition = useAsync(() => service.stickDefinition(), []);
  const reports = useAsync(() => service.reports(), []);
  const names = new Map((kits.data ?? []).map((kit) => [kit.id, kit.name]));
  const error = kits.error ?? definition.error ?? reports.error;

  return (
    <section aria-label="Your organisation">
      <h2>Your organisation</h2>
      <p className="muted">The kits registered with the platform, the install stick they make up, and the latest reports of kits that ran. No machine names or keys are kept here.</p>
      <ProblemBanner error={error} />
      {kits.loading ? <p className="muted">Loading...</p> : (kits.data ?? []).length === 0 ? <Empty>No kit is registered yet.</Empty> : (
        <>
          <p>{definition.data ? `${definition.data.kitCount} active kit(s) in the stick definition, across ${definition.data.systems.length} system(s).` : ''}</p>
          <table aria-label="Registered kits">
            <thead><tr><th>Kit</th><th>System</th><th>Language</th><th>Machine class</th><th>Revision</th><th>Status</th></tr></thead>
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
          <h3>Latest install reports</h3>
          <table aria-label="Install reports">
            <thead><tr><th>When</th><th>Kit</th><th>Revision run</th><th>Add-on</th><th>Outcome</th><th>Warnings</th></tr></thead>
            <tbody>
              {(reports.data ?? []).slice(0, 10).map((report) => (
                <tr key={report.id}>
                  <td>{when(report.occurredAt)}</td><td>{names.get(report.kitId) ?? report.kitId}</td><td>{report.kitRevision}</td><td>{report.addOnVersion}</td>
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
        <h1>Quick Install</h1>
        <a href={QUICK_INSTALL_REPO} target="_blank" rel="noreferrer">Add-on v{QUICK_INSTALL_VERSION}</a>
      </div>
      <p className="muted">
        A Ventoy stick that installs Windows, Linux and recovery tools unattended, one kit per machine class. This page lists what it can install;
        the stick itself is built and tested offline.
      </p>
      <div className="tiles" aria-label="Summary">
        {FAMILIES.map((f) => (
          <div key={f} className="tile"><span className="n">{count(f)}</span><span className="l">{f}</span></div>
        ))}
      </div>
      <div className="filters">
        <select aria-label="Family" value={family} onChange={(e) => setFamily(e.target.value as Family | '')}>
          <option value="">Any family</option>
          {FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
          <option value="">Any role</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang | '')}>
          <option value="">Any language</option>
          <option value="EN">English (EN-US)</option>
          <option value="PT">Portuguese (PT-BR)</option>
        </select>
      </div>
      {shown.length === 0 ? <Empty>No system matches these filters.</Empty> : (
        <table>
          <thead><tr><th>System</th><th>Family</th><th>Role</th><th>Languages</th><th>Editions</th><th>Includes</th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong>{s.note && <div className="muted">{s.note}</div>}</td>
                <td>{s.family}</td>
                <td>{s.role}</td>
                <td>{s.languages.join(' / ')}</td>
                <td>{s.editions?.join(', ') ?? '-'}</td>
                <td>{s.includes.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Organisation />
      <h2>How it works</h2>
      <ul>{KIT_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      <h2>Known limits</h2>
      <ul>{KNOWN_LIMITS.map((r) => <li key={r}>{r}</li>)}</ul>
    </section>
  );
}
