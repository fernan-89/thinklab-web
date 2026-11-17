import { useMemo, useState } from 'react';
import { Empty } from '../components/Feedback';
import { KIT_RULES, KNOWN_LIMITS, QUICK_INSTALL_REPO, QUICK_INSTALL_VERSION, SYSTEMS, type Family, type Lang, type Role } from '../quickinstall/kits';

const FAMILIES: Family[] = ['Windows', 'Linux', 'Recovery'];
const ROLES: Role[] = ['Workstation', 'Server', 'Tool'];

/** The Quick Install add-on: what its Ventoy stick can install. Reads bundled, sanitised data; it never contacts a service. */
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
      <h2>How it works</h2>
      <ul>{KIT_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      <h2>Known limits</h2>
      <ul>{KNOWN_LIMITS.map((r) => <li key={r}>{r}</li>)}</ul>
    </section>
  );
}
