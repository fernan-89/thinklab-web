import { useState, type FormEvent } from 'react';
import { procurementApi } from '../api/services';
import {
  COST_CURRENCIES, LINE_CATEGORIES, ORDER_FULFILMENTS, ORDER_STATUSES,
  type ApprovalBand, type AuditEntry, type CostCurrency, type LineCategory, type OrderFulfilment, type OrderReceipt, type OrderStatus, type PurchaseOrder,
} from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const when = (value: string | undefined, locale: string) => (value ? new Date(value).toLocaleString(locale) : undefined);
const money = (value: number, currency: string) => `${value.toFixed(2)} ${currency}`;

export function ProcurementPage() {
  const { t, enumValue, status: statusLabel } = useI18n();
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
    [t('procurement.waiting'), all?.filter((order) => order.status === 'PENDING_APPROVAL').length],
    [t('procurement.approvedNotPlaced'), all?.filter((order) => order.status === 'APPROVED').length],
    [t('procurement.placed'), all?.filter((order) => order.status === 'ORDERED').length],
    [t('procurement.total'), all?.length],
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('nav.procurement')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('procurement.new')}</button>
      </div>
      <p className="muted">{t('procurement.intro')}</p>
      <div className="tiles" aria-label={t('ops.summary')}>
        {tiles.map(([label, value]) => (
          <div key={label} className="tile"><span className="n">{value ?? '-'}</span><span className="l">{label}</span></div>
        ))}
      </div>
      <ProblemBanner error={everything.error} />
      <ApprovalBands />
      {creating && <NewOrderForm onCancel={() => setCreating(false)} onCreated={(order) => { setCreating(false); setSelectedId(order.id); reloadAll(); }} />}
      <div className="filters">
        <select aria-label={t('common.status')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OrderStatus | '')}>
          <option value="">{t('patches.anyStatus')}</option>
          {ORDER_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
        <select aria-label={t('procurement.currency')} value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value as CostCurrency | '')}>
          <option value="">{t('procurement.anyCurrency')}</option>
          {COST_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label={t('procurement.received')} value={fulfilmentFilter} onChange={(e) => setFulfilmentFilter(e.target.value as OrderFulfilment | '')}>
          <option value="">{t('procurement.anyReceiving')}</option>
          {ORDER_FULFILMENTS.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
        </select>
        <label className="inline"><input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} /> {t('procurement.lateOnly')}</label>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: list.data?.length ?? 0 })}</span>
      </div>
      <ProblemBanner error={list.error} />
      <div className="split">
        {list.data?.length === 0 && !list.loading ? <Empty>{t('procurement.noOrders')}</Empty> : (
          <table aria-label={t('procurement.orders')}>
            <thead><tr><th>{t('vendors.reference')}</th><th>{t('common.status')}</th><th>{t('procurement.total')}</th><th>{t('procurement.received')}</th><th>{t('procurement.expected')}</th></tr></thead>
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

/**
 * The approval bands (procurement ADR-036): in a currency, from an amount up, an order is sent for approval against a policy. The band of an order is the one with
 * the greatest lower bound not above its total; with none, an order cannot be sent for approval.
 */
function ApprovalBands() {
  const { t } = useI18n();
  const { api } = useSession();
  const bands = useAsync(() => procurementApi(api).bands(), []);
  const [currency, setCurrency] = useState<CostCurrency>('BRL');
  const [fromAmount, setFromAmount] = useState('0');
  const [policyId, setPolicyId] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const ready = fromAmount.trim() !== '' && policyId.trim() !== '';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
      bands.reload();
    }
  }

  return (
    <section className="card" aria-label={t('procurement.bands')}>
      <h2>{t('procurement.bands')}</h2>
      <p className="muted">{t('procurement.bandsIntro')}</p>
      <ProblemBanner error={bands.error} />
      {bands.data?.length === 0 && !bands.loading && (
        <div className="banner" role="status">{t('procurement.noBand')}</div>
      )}
      {bands.data && bands.data.length > 0 && (
        <table aria-label={t('procurement.bandsAria')}>
          <thead><tr><th>{t('procurement.currency')}</th><th>{t('alerts.from')}</th><th>{t('ops.policy')}</th><th>{t('procurement.madeBy')}</th><th /></tr></thead>
          <tbody>
            {bands.data.map((band: ApprovalBand) => (
              <tr key={band.id}>
                <td>{band.currency}</td>
                <td>{money(band.fromAmount, band.currency)}</td>
                <td className="code">{band.policyId}</td>
                <td>{band.createdBy}</td>
                <td><button type="button" disabled={busy} onClick={() => void run(() => procurementApi(api).retireBand(band.id))}>{t('procurement.retireBand', { currency: band.currency, amount: band.fromAmount.toFixed(2) })}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="form" aria-label={t('procurement.newBand')} onSubmit={(e) => { e.preventDefault(); if (ready) void run(() => procurementApi(api).createBand({ currency, fromAmount: Number(fromAmount), policyId: policyId.trim() })); }}>
        <label>{t('procurement.bandCurrency')}
          <select value={currency} onChange={(e) => setCurrency(e.target.value as CostCurrency)}>{COST_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        </label>
        <label>{t('procurement.fromAmount')}<input inputMode="decimal" value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} /></label>
        <label>{t('procurement.policyId')}<input value={policyId} onChange={(e) => setPolicyId(e.target.value)} /></label>
        <ProblemBanner error={error} />
        <div className="actions"><button type="submit" className="primary" disabled={!ready || busy}>{t('procurement.makeBand')}</button></div>
      </form>
    </section>
  );
}

interface LineDraft { category: LineCategory; item: string; quantity: string; unitPrice: string }
const emptyLine = (): LineDraft => ({ category: 'HARDWARE', item: '', quantity: '1', unitPrice: '' });

function NewOrderForm({ onCreated, onCancel }: { onCreated: (order: PurchaseOrder) => void; onCancel: () => void }) {
  const { t, enumValue } = useI18n();
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
    <form className="card form" aria-label={t('procurement.new')} onSubmit={submit}>
      <h2>{t('procurement.newOrder')}</h2>
      <label>{t('vendors.reference')}<input value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} /></label>
      <label>{t('procurement.vendorId')}<input value={vendorId} onChange={(e) => setVendorId(e.target.value)} /></label>
      <label>{t('procurement.requesterId')}<input value={requesterId} onChange={(e) => setRequesterId(e.target.value)} /></label>
      <label>{t('procurement.currency')}
        <select value={currency} onChange={(e) => setCurrency(e.target.value as CostCurrency)}>{COST_CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </label>
      <label>{t('procurement.expectedOn')}<input type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></label>
      <h3>{t('procurement.lines')}</h3>
      {lines.map((line, index) => (
        <fieldset key={index} className="line" aria-label={t('procurement.lineN', { n: index + 1 })}>
          <select aria-label={t('procurement.categoryN', { n: index + 1 })} value={line.category} onChange={(e) => setLine(index, { category: e.target.value as LineCategory })}>
            {LINE_CATEGORIES.map((value) => <option key={value} value={value}>{enumValue(value)}</option>)}
          </select>
          <input aria-label={t('procurement.itemN', { n: index + 1 })} placeholder={t('procurement.itemPlaceholder')} value={line.item} maxLength={64} onChange={(e) => setLine(index, { item: e.target.value })} />
          <input aria-label={t('procurement.quantityN', { n: index + 1 })} inputMode="numeric" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} />
          <input aria-label={t('procurement.unitPriceN', { n: index + 1 })} inputMode="decimal" placeholder={t('procurement.unitPrice')} value={line.unitPrice} onChange={(e) => setLine(index, { unitPrice: e.target.value })} />
          {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}>{t('procurement.removeLine', { n: index + 1 })}</button>}
        </fieldset>
      ))}
      <button type="button" onClick={() => setLines([...lines, emptyLine()])} disabled={lines.length >= 50}>{t('procurement.addLine')}</button>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('common.saving') : t('procurement.createOrder')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function OrderDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
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
    <aside className="detail" aria-label={t('procurement.detail')}>
      <div className="detail-head">
        <h2>{order?.reference ?? t('procurement.one')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={actionError ?? detail.error} />
      {order && (
        <>
          <p><StatusBadge status={order.status} />{order.status === 'ORDERED' && <> <StatusBadge status={order.fulfilment} /></>}{order.late && <> <StatusBadge status="LATE" /></>}</p>
          <dl>
            <dt>{t('procurement.total')}</dt><dd>{money(order.total, order.currency)}</dd>
            <dt>{t('vendors.vendor')}</dt><dd className="code">{order.vendorId}</dd>
            <dt>{t('procurement.requester')}</dt><dd className="code">{order.requesterId}</dd>
            {order.expectedOn && <><dt>{t('procurement.expectedOnDetail')}</dt><dd>{order.expectedOn}</dd></>}
            {order.orderedAt && <><dt>{t('procurement.placed')}</dt><dd>{when(order.orderedAt, locale)}</dd></>}
          </dl>
          <h3>{t('procurement.lines')}</h3>
          <table aria-label={t('procurement.lines')}>
            <thead><tr><th>#</th><th>{t('common.category')}</th><th>{t('integrations.item')}</th><th>{t('procurement.unitPrice')}</th><th>{t('procurement.ordered')}</th><th>{t('procurement.received')}</th><th>{t('procurement.left')}</th></tr></thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.lineNo}>
                  <td>{line.lineNo}</td><td>{line.category}</td><td className="code">{line.item}</td><td>{line.unitPrice.toFixed(2)}</td><td>{line.quantity}</td><td>{line.received}</td><td>{line.remaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions" aria-label={t('itsm.actions')}>
            {order.status === 'DRAFT' && <button type="button" disabled={busy || order.lines.length === 0} onClick={() => void run(() => orders.submit(id))}>{t('procurement.sendApproval')}</button>}
            {order.status === 'APPROVED' && <button type="button" disabled={busy} onClick={() => void run(() => orders.place(id))}>{t('procurement.place')}</button>}
            {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED'].includes(order.status) && !(order.status === 'ORDERED' && detail.data!.receipts.length > 0)
              && <button type="button" disabled={busy} onClick={() => void run(() => orders.cancel(id))}>{t('procurement.cancelOrder')}</button>}
          </div>
          {order.status === 'PENDING_APPROVAL' && (
            <form className="form" aria-label={t('procurement.decision')} onSubmit={(e) => e.preventDefault()}>
              <label>{t('procurement.approverId')}<input value={approverId} onChange={(e) => setApproverId(e.target.value)} /></label>
              <div className="actions">
                <button type="button" disabled={busy || approverId.trim() === ''} onClick={() => void run(() => orders.decide(id, approverId.trim(), 'APPROVE'))}>{t('requests.approve')}</button>
                <button type="button" disabled={busy || approverId.trim() === ''} onClick={() => void run(() => orders.decide(id, approverId.trim(), 'REJECT'))}>{t('requests.reject')}</button>
              </div>
            </form>
          )}
          {order.status === 'ORDERED' && (
            <form className="form" aria-label={t('procurement.receiveGoods')} onSubmit={(e) => { e.preventDefault(); void run(() => orders.receive(id, { lineNo: Number(lineNo), deliveryRef: deliveryRef.trim(), quantity: Number(quantity) }).then(() => { setDeliveryRef(''); setQuantity(''); })); }}>
              <label>{t('procurement.line')}
                <select value={lineNo} onChange={(e) => setLineNo(e.target.value)}>{order.lines.map((line) => <option key={line.lineNo} value={line.lineNo}>{`${line.lineNo}: ${line.item}`}</option>)}</select>
              </label>
              <label>{t('procurement.deliveryRef')}<input value={deliveryRef} maxLength={40} onChange={(e) => setDeliveryRef(e.target.value)} /></label>
              <label>{t('procurement.quantityReceived')}<input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
              <button type="submit" className="primary" disabled={busy || deliveryRef.trim() === '' || quantity.trim() === ''}>{t('procurement.recordReceipt')}</button>
            </form>
          )}
          <h3>{t('procurement.receipts')}</h3>
          {detail.data?.receipts.length === 0 ? <Empty>{t('procurement.nothingReceived')}</Empty> : (
            <table aria-label={t('procurement.receipts')}>
              <thead><tr><th>{t('procurement.line')}</th><th>{t('procurement.delivery')}</th><th>{t('procurement.quantity')}</th><th>{t('audit.col.when')}</th><th>{t('ops.by')}</th></tr></thead>
              <tbody>
                {detail.data?.receipts.map((receipt) => (
                  <tr key={`${receipt.lineNo}-${receipt.deliveryRef}`}>
                    <td>{receipt.lineNo}</td><td className="code">{receipt.deliveryRef}</td><td>{receipt.quantity}</td><td>{when(receipt.receivedAt, locale)}</td><td>{receipt.reportedBy}</td>
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
