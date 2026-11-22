import { ProblemError } from '../api/client';
import { useI18n } from '../i18n';

export function ProblemBanner({ error }: { error: Error | undefined }) {
  if (!error) return null;
  if (!(error instanceof ProblemError)) {
    return <div className="banner banner-error" role="alert">{error.message}</div>;
  }
  return (
    <div className="banner banner-error" role="alert">
      <strong>{error.title}</strong>
      {error.errorCode && <code className="code">{error.errorCode}</code>}
      {error.detail && <p>{error.detail}</p>}
      {error.violations.length > 0 && (
        <ul>
          {error.violations.map((violation) => (
            <li key={violation}>{violation}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { status: label } = useI18n();
  return <span className={`badge badge-${status.toLowerCase()}`}>{label(status)}</span>;
}

export function Empty({ children }: { children: string }) {
  return <p className="empty">{children}</p>;
}
