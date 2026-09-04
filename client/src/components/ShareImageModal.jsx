import { useEffect, useState } from 'react';
import { Spinner } from '../App.jsx';
import { formatPhone } from '../lib/phone.js';

export default function ShareImageModal({ number, onClose }) {
  const imageUrl = `/image/${number}`;
  const shareUrl = `/share/${number}`;
  const absoluteShareUrl = `${window.location.origin}${shareUrl}`;
  const absoluteImageUrl = `${window.location.origin}${imageUrl}`;
  const [state, setState] = useState('loading'); // loading | ready | error
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      window.prompt('Copy this link', text);
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: `Lookup result for ${formatPhone(number)}`, url: absoluteShareUrl });
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
    >
      <div
        className="animate-fade-up w-full max-w-2xl rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id="share-title" className="text-base font-semibold text-slate-900">
            Share card for {formatPhone(number)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-200"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="relative aspect-[1200/630] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
            {state === 'loading' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-300">
                <Spinner className="h-6 w-6 text-white" />
                Generating image…
              </div>
            )}
            {state === 'error' && (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-rose-200">
                The image could not be generated right now. Please try again later.
              </div>
            )}
            <img
              src={imageUrl}
              alt={`Social card for ${formatPhone(number)}`}
              width="1200"
              height="630"
              className={`h-full w-full object-cover transition-opacity ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setState('ready')}
              onError={() => setState('error')}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <a
              href={`${imageUrl}?download=1`}
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Download
            </a>
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              Open image
            </a>
            <button
              type="button"
              onClick={() => copy(absoluteImageUrl, 'image')}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              {copied === 'image' ? 'Copied!' : 'Copy image URL'}
            </button>
            {typeof navigator !== 'undefined' && navigator.share ? (
              <button
                type="button"
                onClick={nativeShare}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              >
                Share…
              </button>
            ) : (
              <button
                type="button"
                onClick={() => copy(absoluteShareUrl, 'share')}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              >
                {copied === 'share' ? 'Copied!' : 'Copy share link'}
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            The share link{' '}
            <a href={shareUrl} target="_blank" rel="noopener" className="font-mono text-sky-700 underline underline-offset-2">
              {shareUrl}
            </a>{' '}
            includes Open Graph tags, so this image appears as a preview on WhatsApp, Facebook, X and other apps.
          </p>
        </div>
      </div>
    </div>
  );
}
