import { formatPhone, guessCountry } from '../lib/phone.js';

export default function ResultCard({ result, onShare, onOpenImage }) {
  const { number, names = [], images = [], cached } = result;
  const country = guessCountry(number);
  const printUrl = `/print/${number}`;

  return (
    <article className="animate-fade-up overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-6 text-white">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Phone number</p>
        <h2 className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">{formatPhone(number)}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300">
          {country && <span>{country}</span>}
          <span className="font-mono text-slate-400">{number}</span>
          {cached && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-slate-200" title="Served from cache">
              cached
            </span>
          )}
        </p>
      </header>

      <div className="space-y-6 px-6 py-6">
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            Names
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{names.length}</span>
          </h3>
          {names.length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {names.map((name) => (
                <li
                  key={name}
                  className="rounded-full border border-sky-200 bg-sky-50 px-3.5 py-1.5 text-sm font-medium text-sky-900"
                >
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No names were found for this number.</p>
          )}
        </section>

        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            Images
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{images.length}</span>
          </h3>
          {images.length ? (
            <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {images.map((src, index) => (
                <li key={src}>
                  <button
                    type="button"
                    onClick={() => onOpenImage(src)}
                    className="group block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 focus:outline-none focus:ring-4 focus:ring-sky-100"
                    aria-label={`Open image ${index + 1} full size`}
                  >
                    <img
                      src={src}
                      alt={`Result ${index + 1} for ${formatPhone(number)}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="aspect-square w-full object-cover transition group-hover:scale-105"
                      onError={(e) => {
                        e.currentTarget.replaceWith(brokenImagePlaceholder());
                      }}
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No images were found for this number.</p>
          )}
        </section>
      </div>

      <footer className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row">
        <a
          href={printUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-200"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5 2.75C5 1.784 5.784 1 6.75 1h6.5c.966 0 1.75.784 1.75 1.75v3.552c.377.046.752.097 1.126.153A2.212 2.212 0 0118 8.653v4.097A2.25 2.25 0 0115.75 15h-.241l.305 1.984A1.75 1.75 0 0114.084 19H5.915a1.75 1.75 0 01-1.73-2.016L4.492 15H4.25A2.25 2.25 0 012 12.75V8.653c0-1.082.775-2.034 1.874-2.198.374-.056.75-.107 1.127-.153L5 6.25v-3.5zm8.5 3.397a41.533 41.533 0 00-7 0V2.75a.25.25 0 01.25-.25h6.5a.25.25 0 01.25.25v3.397zM6.608 12.5a.25.25 0 00-.247.212l-.63 4.107a.25.25 0 00.247.288h8.044a.25.25 0 00.247-.288l-.63-4.107a.25.25 0 00-.247-.212H6.608z" clipRule="evenodd" />
          </svg>
          Print
        </a>
        <button
          type="button"
          onClick={onShare}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 focus:outline-none focus:ring-4 focus:ring-sky-200"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.733 3.367a2.5 2.5 0 11-.671 1.341l-6.733-3.367a2.5 2.5 0 110-3.475l6.733-3.366A2.52 2.52 0 0113 4.5z" />
          </svg>
          Share Image
        </button>
      </footer>
    </article>
  );
}

function brokenImagePlaceholder() {
  const el = document.createElement('div');
  el.className = 'grid aspect-square w-full place-items-center text-xs text-slate-400';
  el.textContent = 'Unavailable';
  return el;
}
