import { useState, type FormEvent } from 'react';
import { stockApi, type StockMovement } from '../api/services';
import type { StockEntry, StockItem, StockStatus } from '../api/types';
import { useSession } from '../auth/session';
import { Empty, ProblemBanner, StatusBadge } from '../components/Feedback';
import { useAsync } from '../useAsync';
import { useI18n } from '../i18n';

export function StockPage() {
  const { t, status: statusLabel } = useI18n();
  const { api } = useSession();
  const stock = stockApi(api);
  const [status, setStatus] = useState<StockStatus | ''>('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);

  const list = useAsync(() => (onlyLow ? stock.lowStock() : stock.list(status || undefined)), [status, onlyLow]);
  const needle = query.trim().toLowerCase();
  const rows = (list.data ?? []).filter((item) => !needle || item.sku.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle));

  return (
    <section>
      <div className="page-head">
        <h1>{t('nav.stock')}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)} disabled={creating}>{t('stock.new')}</button>
      </div>
      <p className="muted">{t('stock.intro')}</p>
      {creating && (
        <NewStockItemForm
          onCancel={() => setCreating(false)}
          onCreated={(item) => {
            setCreating(false);
            setSelectedId(item.id);
            list.reload();
          }}
        />
      )}
      <div className="filters">
        <input type="search" aria-label={t('stock.searchLabel')} placeholder={t('stock.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label={t('common.status')} value={status} disabled={onlyLow} onChange={(e) => setStatus(e.target.value as StockStatus | '')}>
          <option value="">{t('common.allStatuses')}</option>
          <option value="ACTIVE">{statusLabel('ACTIVE')}</option>
          <option value="DISCONTINUED">{statusLabel('DISCONTINUED')}</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> {t('stock.onlyLow')}
        </label>
        <span className="muted">{list.loading ? t('common.loading') : t('common.shown', { count: rows.length })}</span>
      </div>

      <ProblemBanner error={list.error} />

      <div className="split">
        {rows.length === 0 && !list.loading ? (
          <Empty>{t('stock.empty')}</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>SKU</th><th>{t('common.name')}</th><th>{t('stock.onHand')}</th><th>{t('stock.reorderAt')}</th><th>{t('common.status')}</th></tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className={item.id === selectedId ? 'selected' : undefined}>
                  <td><button type="button" className="link" onClick={() => setSelectedId(item.id)}>{item.sku}</button></td>
                  <td>{item.name}</td>
                  <td>
                    {item.onHand} {item.unit}
                    {item.belowReorderLevel && item.status === 'ACTIVE' && <> <span className="badge badge-maintenance">{t('stock.low')}</span></>}
                  </td>
                  <td>{item.reorderLevel}</td>
                  <td><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedId && <StockDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(undefined)} onChanged={list.reload} />}
      </div>
    </section>
  );
}

function toError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

function NewStockItemForm({ onCreated, onCancel }: { onCreated: (item: StockItem) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('unit');
  const [reorderLevel, setReorderLevel] = useState('0');
  const [initialQuantity, setInitialQuantity] = useState('0');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const isCount = (value: string) => /^\d+$/.test(value.trim());
  const ready = sku.trim() !== '' && name.trim() !== '' && unit.trim() !== '' && isCount(reorderLevel) && isCount(initialQuantity);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await stockApi(api).create({
        sku: sku.trim(), name: name.trim(), unit: unit.trim(), reorderLevel: Number(reorderLevel), initialQuantity: Number(initialQuantity),
      }));
    } catch (failure) {
      setError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label={t('stock.newStockItem')} onSubmit={submit}>
      <h2>{t('stock.newStockItem')}</h2>
      <label>SKU<input value={sku} maxLength={64} onChange={(e) => setSku(e.target.value)} /></label>
      <label>{t('common.name')}<input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t('licences.unit')}<input value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} /></label>
      <label>{t('stock.reorderLevel')}<input inputMode="numeric" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} /></label>
      <label>{t('stock.openingQuantity')}<input inputMode="numeric" value={initialQuantity} onChange={(e) => setInitialQuantity(e.target.value)} /></label>
      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('assetForm.registering') : t('stock.register')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function StockDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { api } = useSession();
  const stock = stockApi(api);
  const detail = useAsync<{ item: StockItem; history: StockEntry[] }>(
    async () => ({ item: await stock.retrieve(id), history: await stock.history(id) }),
    [id],
  );
  const [kind, setKind] = useState<StockMovement>('receive');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const item = detail.data?.item;
  const amount = quantity.trim() === '' || !/^\d+$/.test(quantity.trim()) ? undefined : Number(quantity);
  const valid = amount !== undefined && (kind === 'adjust' ? reason.trim() !== '' : amount > 0);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      setQuantity('');
      setReason('');
      detail.reload();
      onChanged();
    } catch (failure) {
      setActionError(toError(failure));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || amount === undefined) return;
    const note = reason.trim() || undefined;
    void run(() => (kind === 'receive' ? stock.receive(id, amount, note) : kind === 'issue' ? stock.issue(id, amount, note) : stock.adjust(id, amount, reason.trim())));
  }

  return (
    <aside className="detail" aria-label={t('stock.detail')}>
      <div className="detail-head">
        <h2>{item?.name ?? t('stock.one')}</h2>
        <button type="button" className="link" onClick={onClose}>{t('common.close')}</button>
      </div>
      <ProblemBanner error={detail.error ?? actionError} />
      {item && (
        <>
          <dl>
            <dt>SKU</dt><dd><code>{item.sku}</code></dd>
            <dt>{t('stock.onHand')}</dt><dd>{item.onHand} {item.unit}{item.belowReorderLevel && item.status === 'ACTIVE' ? t('stock.atReorder') : ''}</dd>
            <dt>{t('stock.reorderAt')}</dt><dd>{item.reorderLevel}</dd>
            <dt>{t('common.status')}</dt><dd><StatusBadge status={item.status} /></dd>
          </dl>
          {item.status === 'ACTIVE' && (
            <>
              <form className="form" aria-label={t('stock.move')} onSubmit={submit}>
                <label>
                  {t('stock.movement')}
                  <select value={kind} onChange={(e) => setKind(e.target.value as StockMovement)}>
                    <option value="receive">{t('stock.receive')}</option>
                    <option value="issue">{t('stock.issue')}</option>
                    <option value="adjust">{t('stock.adjust')}</option>
                  </select>
                </label>
                <label>{kind === 'adjust' ? t('stock.counted') : t('procurement.quantity')}<input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
                <label>{kind === 'adjust' ? t('stock.reasonRequired') : t('stock.reasonOptional')}<input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></label>
                <div className="actions">
                  <button type="submit" className="primary" disabled={!valid || busy}>{t('itsm.apply')}</button>
                  <button type="button" disabled={busy} onClick={() => void run(() => stock.discontinue(id))}>{t('stock.discontinue')}</button>
                </div>
              </form>
            </>
          )}
          <h3>{t('itsm.history')}</h3>
          <ol className="audit">
            {detail.data?.history.map((entry) => (
              <li key={`${entry.occurredAt}-${entry.action}-${entry.balanceAfter}`}>
                <strong>{entry.action}</strong> by {entry.executor}
                {entry.quantity !== 0 && <> - {entry.quantity > 0 ? '+' : ''}{entry.quantity}</>} {t('stock.balance', { balance: entry.balanceAfter })}
                <div className="muted small">{new Date(entry.occurredAt).toLocaleString(locale)}{entry.reason ? ` - ${entry.reason}` : ''}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
