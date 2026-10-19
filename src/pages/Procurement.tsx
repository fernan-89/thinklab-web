import { useState, type FormEvent } from 'react';
import { procurementApi } from '../api/services';
import {
  COST_CURRENCIES, LINE_CATEGORIES, ORDER_FULFILMENTS, ORDER_STATUSES,
  type AuditEntry, type CostCurrency, type LineCategory, type OrderFulfilment, type OrderReceipt, type OrderStatus, type PurchaseOrder,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value?: string) => (value ? new Date(value).toLocaleString() : undefined);
const money = (value: number, currency: string) => `${value.toFixed(2)} ${currency}`;

export function ProcurementPage() {
  const { api } = useSession();
  const orders = procurementApi(api);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [currencyFilter, setCurrencyFilter] = useState<CostCurrency | ''>('');
  const [fulfilmentFilter, setFulfilmentFilter] = useState<OrderFulfilment | ''>('');
  const [lateOnly, setLateOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const everything = useAsync(() => orders.list({}), []);
  const list = useAsync(
    () => orders.list({ status: statusFilter || undefined, currency: currencyFilter || undefined, fulfilment: fulfilmentFilter || undefined, late: lateOnly }),
    [statusFilter, currencyFilter, fulfilmentFilter, lateOnly],
  );
  const reloadAll = () => { list.reload(); everything.reload(); };
  const all = everything.data;
  const tiles: [string, number | undefined][] = [
    ['Late', all?.filter((order) => order.late).length],
    ['Waiting for approval', all?.filter((order) => order.status === 'PENDING_APPROVAL').length],
    ['Approved, not placed', all?.filter((order) => order.status === 'APPROVED').length],
    ['Placed', all?.filter((order) => order.status === 'ORDERED').length],
    ['Total', all?.length],
  ];

  return (
    <section>
      <div className="page-head">
        <h1>Procurement</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>New order</button>
      </div>
      <p className="muted">Purchase orders for a vendor, in one currency. An order is sent for approval to the approval service, placed with the vendor once approved, and received in part or in whole by the people who state what arrived. What has arrived and whether the delivery is late are worked out when you look.</p>
      <div className="tiles" aria-label="Summary">
        {tiles.map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      {creating && <NewOrderForm onCancel={() => setCreating(false)} onCreated={(order) => { setCreating(false); setSelectedId(order.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OrderStatus | '')}>
          <option value="">Any status</option>
          {ORDER_STATUSES.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </select>
        <select aria-label="Currency" value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value as CostCurrency | '')}>
          <option value="">Any currency</option>
          {COST_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Received" value={fulfilmentFilter} onChange={(e) => setFulfilmentFilter(e.target.value as OrderFulfilment | '')}>
          <option value="">Any receiving state</option>
          {ORDER_FULFILMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <label className="inline"><input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} /> Late only</label>
        <span className="muted">{list.loading ? 'Loading...' : `${list.data?.length ?? 0} shown`}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>No purchase orders match.</Empty> : (
          <table aria-label="Purchase orders">
            <thead><tr><th>Reference</th><th>Status</th><th>Total</th><th>Received</th><th>Expected</th></tr></thead>
            <tbody>
              {list.data?.map((order) => (
                <tr key={order.id} className={order.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(order.id)}>{order.reference}</button></td>
                  <td><StatusBadge status={order.status} /></td>
                  <td>{money(order.total, order.currency)}</td>
                  <td>{order.fulfilment === 'NOT_ORDERED' ? <span className="muted">-</span> : <StatusBadge status={order.fulfilment} />}{order.late && <> <StatusBadge status="LATE" /></>}</td>
                  <td>{order.expectedOn ?? <span className="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <OrderDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={reloadAll} />}
      </div>
    </section>
  );
}

interface LineDraft { category: LineCategory; item: string; quantity: string; unitPrice: string }
const emptyLine = (): LineDraft => ({ category: 'HARDWARE', item: '', quantity: '1', unitPrice: '' });

function NewOrderForm({ onCreated, onCancel }: { onCreated: (order: PurchaseOrder) => void; onCancel: () => void }) {
  const { api, session } = useSession();
  const [reference, setReference] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [requesterId, setRequesterId] = useState(session?.executor ?? '');
  const [currency, setCurrency] = useState<CostCurrency>('BRL');
  const [expectedOn, setExpectedOn] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = reference.trim() !== '' && vendorId.trim() !== '' && requesterId.trim() !== '' && lines.every((line) => line.item.trim() !== '' && line.quantity.trim() !== '' && line.unitPrice.trim() !== '');
  const setLine = (index: number, change: Partial<LineDraft>) => setLines(lines.map((line, i) => (i === index ? { ...line, ...change } : line)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await procurementApi(api).create({
        reference: reference.trim(), vendorId: vendorId.trim(), requesterId: requesterId.trim(), currency, expectedOn: expectedOn || undefined,
        lines: lines.map((line) => ({ category: line.category, item: line.item.trim(), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) })),
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label="New order" onSubmit={submit}>
      <h2>New purchase order</h2>
      <label>Reference<input value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} /></label>
      <label>Vendor (id)<input value={vendorId} onChange={(e) => setVendorId(e.target.value)} /></label>
      <label>Requester (id)<input value={requesterId} onChange={(e) => setRequesterId(e.target.value)} /></label>
      <label>Currency
        <select value={currency} onChange={(e) => setCurrency(e.target.value as CostCurrency)}>{COST_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <label>Expected on (optional)<input type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></label>
      <h3>Lines</h3>
      {lines.map((line, index) => (
        <fieldset key={index} className="line" aria-label={`Line ${index + 1}`}>
          <select aria-label={`Category ${index + 1}`} value={line.category} onChange={(e) => setLine(index, { category: e.target.value as LineCategory })}>
            {LINE_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <input aria-label={`Item ${index + 1}`} placeholder="Item (part number or SKU)" value={line.item} maxLength={64} onChange={(e) => setLine(index, { item: e.target.value })} />
          <input aria-label={`Quantity ${index + 1}`} inputMode="numeric" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} />
          <input aria-label={`Unit price ${index + 1}`} inputMode="decimal" placeholder="Unit price" value={line.unitPrice} onChange={(e) => setLine(index, { unitPrice: e.target.value })} />
          {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}>Remove line {index + 1}</button>}
        </fieldset>
      ))}
      <button type="button" onClick={() => setLines([...lines, emptyLine()])} disabled={lines.length >= 50}>Add a line</button>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? 'Saving...' : 'Create order'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function OrderDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useSession();
  const orders = procurementApi(api);
  const detail = useAsync<{ order: PurchaseOrder; receipts: OrderReceipt[]; trail: AuditEntry[] }>(async () => {
    const [order, receipts, trail] = await Promise.all([orders.retrieve(id), orders.receipts(id), orders.auditLog(id)]);
    return { order, receipts, trail };
  }, [id]);
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [approverId, setApproverId] = useState('');
  const [lineNo, setLineNo] = useState('1');
  const [deliveryRef, setDeliveryRef] = useState('');
  const [quantity, setQuantity] = useState('');
  const order = detail.data?.order;

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
    <aside className="detail" aria-label="Order detail">
      <div className="detail-head">
        <h2>{order?.reference ?? 'Purchase order'}</h2>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {order && (
        <>
          <p><StatusBadge status={order.status} />{order.status === 'ORDERED' && <> <StatusBadge status={order.fulfilment} /></>}{order.late && <> <StatusBadge status="LATE" /></>}</p>
          <dl>
            <dt>Total</dt><dd>{money(order.total, order.currency)}</dd>
            <dt>Vendor</dt><dd className="code">{order.vendorId}</dd>
            <dt>Requester</dt><dd className="code">{order.requesterId}</dd>
            {order.expectedOn && <><dt>Expected on</dt><dd>{order.expectedOn}</dd></>}
            {order.orderedAt && <><dt>Placed</dt><dd>{when(order.orderedAt)}</dd></>}
          </dl>
          <h3>Lines</h3>
          <table aria-label="Lines">
            <thead><tr><th>#</th><th>Category</th><th>Item</th><th>Unit price</th><th>Ordered</th><th>Received</th><th>Left</th></tr></thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.lineNo}>
                  <td>{line.lineNo}</td><td>{line.category}</td><td className="code">{line.item}</td><td>{line.unitPrice.toFixed(2)}</td><td>{line.quantity}</td><td>{line.received}</td><td>{line.remaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions" aria-label="Actions">
            {order.status === 'DRAFT' && <button type="button" disabled={busy || order.lines.length === 0} onClick={() => void run(() => orders.submit(id))}>Send for approval</button>}
            {order.status === 'APPROVED' && <button type="button" disabled={busy} onClick={() => void run(() => orders.place(id))}>Place with the vendor</button>}
            {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED'].includes(order.status) && !(order.status === 'ORDERED' && detail.data!.receipts.length > 0)
              && <button type="button" disabled={busy} onClick={() => void run(() => orders.cancel(id))}>Cancel order</button>}
          </div>
          {order.status === 'PENDING_APPROVAL' && (
            <form className="form" aria-label="Decision" onSubmit={(e) => e.preventDefault()}>
              <label>Approver (id)<input value={approverId} onChange={(e) => setApproverId(e.target.value)} /></label>
              <div className="actions">
                <button type="button" disabled={busy || approverId.trim() === ''} onClick={() => void run(() => orders.decide(id, approverId.trim(), 'APPROVE'))}>Approve</button>
                <button type="button" disabled={busy || approverId.trim() === ''} onClick={() => void run(() => orders.decide(id, approverId.trim(), 'REJECT'))}>Reject</button>
              </div>
            </form>
          )}
          {order.status === 'ORDERED' && (
            <form className="form" aria-label="Receive goods" onSubmit={(e) => { e.preventDefault(); void run(() => orders.receive(id, { lineNo: Number(lineNo), deliveryRef: deliveryRef.trim(), quantity: Number(quantity) }).then(() => { setDeliveryRef(''); setQuantity(''); })); }}>
              <label>Line
                <select value={lineNo} onChange={(e) => setLineNo(e.target.value)}>{order.lines.map((line) => <option key={line.lineNo} value={line.lineNo}>{`${line.lineNo}: ${line.item}`}</option>)}</select>
              </label>
              <label>Delivery reference<input value={deliveryRef} maxLength={40} onChange={(e) => setDeliveryRef(e.target.value)} /></label>
              <label>Quantity received<input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
              <button type="submit" className="primary" disabled={busy || deliveryRef.trim() === '' || quantity.trim() === ''}>Record receipt</button>
            </form>
          )}
          <h3>Receipts</h3>
          {detail.data?.receipts.length === 0 ? <Empty>Nothing received yet.</Empty> : (
            <table aria-label="Receipts">
              <thead><tr><th>Line</th><th>Delivery</th><th>Quantity</th><th>When</th><th>By</th></tr></thead>
              <tbody>
                {detail.data?.receipts.map((receipt) => (
                  <tr key={`${receipt.lineNo}-${receipt.deliveryRef}`}>
                    <td>{receipt.lineNo}</td><td className="code">{receipt.deliveryRef}</td><td>{receipt.quantity}</td><td>{when(receipt.receivedAt)}</td><td>{receipt.reportedBy}</td>
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
