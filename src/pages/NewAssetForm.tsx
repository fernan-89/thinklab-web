import { useState, type FormEvent } from 'react';
import { assetApi } from '../api/services';
import { ASSET_CATEGORIES, type Asset, type AssetCategory } from '../api/types';
import { useSession } from '../auth/session';
import { ProblemBanner } from '../components/Feedback';
import { useI18n } from '../i18n';

interface Row {
  id: number;
  key: string;
  value: string;
}

/**
 * Registers an asset. The form only does the checks the API would reject trivially (required fields, duplicate specification
 * keys); everything else - the tenant's JSON Schema for the category, duplicate serial numbers - is the API's call, and its answer
 * (including the list of schema violations) is shown as it comes back.
 */
export function NewAssetForm({ onCreated, onCancel }: { onCreated: (asset: Asset) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AssetCategory | ''>('');
  const [serialNumber, setSerialNumber] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [nextId, setNextId] = useState(1);
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);

  const keys = rows.map((row) => row.key.trim());
  const duplicateKey = keys.some((key, index) => key !== '' && keys.indexOf(key) !== index);
  const emptyKey = rows.some((row) => row.key.trim() === '' && row.value.trim() !== '');
  const ready = name.trim() !== '' && category !== '' && serialNumber.trim() !== '' && !duplicateKey && !emptyKey;

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      const specifications = Object.fromEntries(rows.filter((row) => row.key.trim() !== '').map((row) => [row.key.trim(), row.value]));
      const created = await assetApi(api).create({ name: name.trim(), category, serialNumber: serialNumber.trim(), specifications });
      onCreated(created);
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" aria-label={t('assetForm.title')} onSubmit={submit}>
      <h2>{t('assetForm.title')}</h2>
      <label>
        {t('common.name')}
        <input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t('common.category')}
        <select value={category} onChange={(e) => setCategory(e.target.value as AssetCategory | '')}>
          <option value="">{t('common.choose')}</option>
          {ASSET_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        {t('assetForm.serialNumber')}
        <input value={serialNumber} maxLength={120} onChange={(e) => setSerialNumber(e.target.value)} />
      </label>

      <fieldset>
        <legend>{t('assets.specifications')}</legend>
        {rows.map((row) => (
          <div className="spec-row" key={row.id}>
            <input aria-label={t('assetForm.specName')} placeholder={t('assetForm.specNamePlaceholder')} value={row.key} onChange={(e) => updateRow(row.id, { key: e.target.value })} />
            <input aria-label={t('assetForm.specValue')} placeholder={t('assetForm.specValuePlaceholder')} value={row.value} onChange={(e) => updateRow(row.id, { value: e.target.value })} />
            <button type="button" className="link" onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}>{t('common.remove')}</button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setRows((current) => [...current, { id: nextId, key: '', value: '' }]);
            setNextId((id) => id + 1);
          }}
        >
          {t('assetForm.addSpec')}
        </button>
        {duplicateKey && <p className="field-error">{t('assetForm.duplicateSpec')}</p>}
        {emptyKey && <p className="field-error">{t('assetForm.emptySpecName')}</p>}
      </fieldset>

      <ProblemBanner error={error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!ready || busy}>{busy ? t('assetForm.registering') : t('assetForm.register')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}
