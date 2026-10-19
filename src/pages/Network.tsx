import { useState, type FormEvent } from 'react';
import { ipamApi } from '../api/services';
import { SUBNET_LEVELS, SUBNET_STATUSES, type AuditEntry, type IpAllocation, type Subnet, type SubnetLevel, type SubnetStatus } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

export function NetworkPage() {
  const { api } = useSession();
  const ipam = ipamApi(api);
  const [levelFilter, setLevelFilter] = useState<SubnetLevel | ''>('');
  const [statusFilter, setStatusFilter] = useState<SubnetStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const everything = useAsync(() => ipam.subnets({}), []);
  const list = useAsync(() => ipam.subnets({ level: levelFilter || undefined, status: statusFilter || undefined }), [levelFilter, statusFilter]);
  const reloadAll = () => { list.reload(); everything.reload(); };
  const count = (level: SubnetLevel) => everything.data?.filter((subnet) => subnet.level === level).length;

  return (
    <section>
      <div className="page-head">
        <h1>Network</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New subnet</button>
      </div>
      <p className="muted">The IPv4 subnets addresses are handed out of, and who holds each address. Two active subnets never overlap and an address is never held twice; how full a subnet is is worked out when you look.</p>
      <div className="tiles" aria-label="Summary">
        {([['Full', count('FULL')], ['Nearly full', count('NEAR_FULL')], ['OK', count('OK')], ['Retired', count('RETIRED')], ['Total', everything.data?.length]] as const).map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewSubnetForm onCancel={() => setCreating(false)} onCreated={(subnet) => { setCreating(false); setSelectedId(subnet.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label="Level" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as SubnetLevel | '')}>
          <option value="">Any level</option>
          {SUBNET_LEVELS.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
        </select>
        <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as SubnetStatus | '')}>
          <option value="">Active and retired</option>
          {SUBNET_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No subnets match.</Empty> : (
          <table aria-label="Subnets">
            <thead><tr><th>Subnet</th><th>Range</th><th>VLAN</th><th>Level</th><th>Used</th><th>Free</th></tr></thead>
            <tbody>
              {list.data?.map((subnet) => (
                <tr key={subnet.id} className={subnet.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(subnet.id)}>{subnet.name}</button></td>
                  <td><code>{subnet.cidr}</code></td>
                  <td>{subnet.vlan ?? <span className="muted">-</span>}</td>
                  <td><StatusBadge status={subnet.level} /></td>
                  <td>{subnet.used} of {subnet.usable}</td>
                  <td>{subnet.free}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <SubnetDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={reloadAll} />}
      </div>
    </section>
  );
}

function NewSubnetForm({ onCreated, onCancel }: { onCreated: (subnet: Subnet) => void; onCancel: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState('');
  const [cidr, setCidr] = useState('');
  const [vlan, setVlan] = useState('');
  const [warn, setWarn] = useState('80');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== '' && cidr.trim() !== '' && warn.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await ipamApi(api).createSubnet({ name: name.trim(), cidr: cidr.trim(), vlan: vlan.trim() ? Number(vlan) : undefined, warnPercent: Number(warn) }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New subnet" onSubmit={submit}>
      <h2>New subnet</h2>
      <label>Name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Range (CIDR, its network address)<input value={cidr} placeholder="10.20.0.0/24" maxLength={18} onChange={(e) => setCidr(e.target.value)} /></label>
      <label>VLAN (optional)<input inputMode="numeric" value={vlan} onChange={(e) => setVlan(e.target.value)} /></label>
      <label>Nearly full at (percent used)<input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create subnet'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function SubnetDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const ipam = ipamApi(api);
  const detail = useAsync<{ subnet: Subnet; allocations: IpAllocation[]; trail: AuditEntry[] }>(async () => {
    const [subnet, allocations, trail] = await Promise.all([ipam.subnet(id), ipam.allocations({ subnetId: id }), ipam.subnetAuditLog(id)]);
    return { subnet, allocations, trail };
  }, [id]);
  const [ip, setIp] = useState('');
  const [hostname, setHostname] = useState('');
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const subnet = detail.data?.subnet;

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
    <aside className="detail" aria-label="Subnet detail">
      <div className="detail-head">
        <h2>{subnet?.name ?? 'Subnet'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {subnet && (
        <>
          <p><StatusBadge status={subnet.level} /> <StatusBadge status={subnet.status} /></p>
          <dl>
            <dt>Range</dt><dd><code>{subnet.cidr}</code> ({subnet.network} to {subnet.broadcast}{subnet.vlan ? `, VLAN ${subnet.vlan}` : ''})</dd>
            <dt>Use</dt><dd>{subnet.used} of {subnet.usable} addresses used, {subnet.free} free{subnet.usedPercent !== undefined ? ` (${subnet.usedPercent.toFixed(1)}%)` : ''}; nearly full at {subnet.warnPercent}%</dd>
          </dl>
          <div className="actions" aria-label="Actions">
            {subnet.status === 'ACTIVE'
              ? <button type="button" disabled={busy} onClick={() => void run(() => ipam.controlSubnet(id, 'retire'))}>Retire</button>
              : <button type="button" disabled={busy} onClick={() => void run(() => ipam.controlSubnet(id, 'reactivate'))}>Reactivate</button>}
          </div>
          {subnet.status === 'ACTIVE' && (
            <form className="form" aria-label="Allocate" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await ipam.allocate({ subnetId: id, ip: ip.trim() || undefined, hostname: hostname.trim() || undefined });
                setIp('');
                setHostname('');
              });
            }}>
              <label>Address (empty: the lowest free one)<input value={ip} maxLength={15} onChange={(e) => setIp(e.target.value)} /></label>
              <label>Host name (optional)<input value={hostname} maxLength={253} onChange={(e) => setHostname(e.target.value)} /></label>
              <button type="submit" disabled={busy}>Allocate</button>
            </form>
          )}
          <h3>Addresses</h3>
          {detail.data?.allocations.length === 0 ? <Empty>No address handed out yet.</Empty> : (
            <table aria-label="Addresses">
              <thead><tr><th>Address</th><th>Host</th><th>Status</th><th /></tr></thead>
              <tbody>
                {detail.data?.allocations.map((allocation) => (
                  <tr key={allocation.id}>
                    <td><code>{allocation.ip}</code></td>
                    <td>{allocation.hostname ?? <span className="muted">-</span>}</td>
                    <td><StatusBadge status={allocation.status} /></td>
                    <td>{allocation.status === 'ALLOCATED' && <button type="button" disabled={busy} onClick={() => void run(() => ipam.release(allocation.id))}>Release</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
