import { useEffect, useState } from 'react';
import { Spinner } from '../App.jsx';

export default function SearchForm({ initialValue = '', loading, onSubmit, exampleNumber }) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (loading) return;
    onSubmit(value.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row" role="search">
      <label htmlFor="phone" className="sr-only">
        Phone number
      </label>
      <input
        id="phone"
        name="number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus
        enterKeyHint="search"
        placeholder={`Enter phone number, e.g., ${exampleNumber}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={24}
        className="h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
      />
      <button
        type="submit"
        disabled={loading || !value.trim()}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 text-base font-semibold text-white shadow-sm transition hover:bg-slate-700 focus:outline-none focus:ring-4 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <Spinner className="h-5 w-5 text-white" />
            Searching…
          </>
        ) : (
          <>
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            Search
          </>
        )}
      </button>
    </form>
  );
}
