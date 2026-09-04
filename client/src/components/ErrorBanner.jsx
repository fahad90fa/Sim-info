const TITLES = {
  invalid_number: 'Invalid number',
  rate_limited: 'Slow down',
  timeout: 'Lookup timed out',
  network: 'Connection problem',
  upstream_rate_limited: 'Service busy',
};

export default function ErrorBanner({ error, onRetry }) {
  const title = TITLES[error.code] ?? 'Lookup failed';
  const isInvalid = error.code === 'invalid_number';
  return (
    <div
      role="alert"
      className={`animate-fade-up flex items-start gap-3 rounded-2xl border p-4 ${
        isInvalid ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-900'
      }`}
    >
      <svg className="mt-0.5 h-5 w-5 flex-none" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm">{error.message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-sm font-semibold underline underline-offset-4 hover:opacity-80"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
