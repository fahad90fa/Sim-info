import { useCallback, useEffect, useRef, useState } from 'react';
import SearchForm from './components/SearchForm.jsx';
import ResultCard from './components/ResultCard.jsx';
import ErrorBanner from './components/ErrorBanner.jsx';
import ShareImageModal from './components/ShareImageModal.jsx';
import Lightbox from './components/Lightbox.jsx';
import { lookupNumber, ApiError } from './lib/api.js';
import { validatePhone } from './lib/phone.js';

const EXAMPLE_NUMBER = '03320407479';

function readNumberFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('number') ?? '';
  } catch {
    return '';
  }
}

function writeNumberToUrl(number) {
  try {
    const url = new URL(window.location.href);
    if (number) url.searchParams.set('number', number);
    else url.searchParams.delete('number');
    window.history.replaceState(null, '', url);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [query, setQuery] = useState(() => readNumberFromUrl());
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [shareNumber, setShareNumber] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const abortRef = useRef(null);

  const search = useCallback(async (rawInput) => {
    const validation = validatePhone(rawInput);
    if (!validation.ok) {
      setStatus('error');
      setResult(null);
      setError({ code: 'invalid_number', message: validation.message });
      return;
    }
    const { number } = validation;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setError(null);
    writeNumberToUrl(number);

    try {
      const data = await lookupNumber(number, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult(data);
      setStatus('success');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setResult(null);
      setStatus('error');
      setError(
        err instanceof ApiError
          ? { code: err.code, message: err.message, retryAfter: err.retryAfter }
          : { code: 'unknown', message: 'Something went wrong. Please try again.' },
      );
    }
  }, []);

  // Auto-search when the page is opened with ?number=...
  useEffect(() => {
    const initial = readNumberFromUrl();
    if (initial) search(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (value) => {
    setQuery(value);
    search(value);
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setQuery('');
    setResult(null);
    setError(null);
    setStatus('idle');
    writeNumberToUrl('');
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="/" onClick={(e) => { e.preventDefault(); handleReset(); }} className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-lg font-extrabold text-white shadow-sm">
              S
            </span>
            <span className="text-base font-semibold tracking-tight text-slate-900">SIM Info</span>
          </a>
          <span className="hidden text-xs font-medium uppercase tracking-widest text-slate-400 sm:block">
            Pakistan &amp; India
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <section className="text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Phone number lookup
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">
            Enter a Pakistani or Indian mobile number to see the names and photos linked to it.
            Print a clean report or share a card image in one click.
          </p>
        </section>

        <div className="mt-8">
          <SearchForm
            initialValue={query}
            loading={status === 'loading'}
            onSubmit={handleSubmit}
            exampleNumber={EXAMPLE_NUMBER}
          />
        </div>

        <div className="mt-6 space-y-6" aria-live="polite">
          {status === 'error' && error && (
            <ErrorBanner error={error} onRetry={error.code !== 'invalid_number' ? () => search(query) : undefined} />
          )}

          {status === 'loading' && <LoadingCard />}

          {status === 'success' && result && (
            <ResultCard
              result={result}
              onShare={() => setShareNumber(result.number)}
              onOpenImage={(src) => setLightboxSrc(src)}
            />
          )}

          {status === 'idle' && <EmptyState onExample={() => handleSubmit(EXAMPLE_NUMBER)} />}
        </div>
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        Results are cached for a limited time. Use responsibly and respect people&apos;s privacy.
      </footer>

      {shareNumber && <ShareImageModal number={shareNumber} onClose={() => setShareNumber(null)} />}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}

function LoadingCard() {
  return (
    <div
      role="status"
      className="animate-fade-up rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <Spinner />
        <p className="text-sm font-medium text-slate-600">Looking up number…</p>
      </div>
      <div className="mt-5 space-y-3">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-100" />
        <div className="flex flex-wrap gap-2">
          <div className="h-7 w-24 animate-pulse rounded-full bg-slate-100" />
          <div className="h-7 w-32 animate-pulse rounded-full bg-slate-100" />
          <div className="h-7 w-20 animate-pulse rounded-full bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

export function Spinner({ className = 'h-5 w-5 text-sky-600' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function EmptyState({ onExample }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center">
      <p className="text-sm text-slate-500">
        Try an example:{' '}
        <button
          type="button"
          onClick={onExample}
          className="font-mono font-semibold text-sky-700 underline decoration-sky-300 underline-offset-4 hover:text-sky-900"
        >
          {EXAMPLE_NUMBER}
        </button>
      </p>
    </div>
  );
}
