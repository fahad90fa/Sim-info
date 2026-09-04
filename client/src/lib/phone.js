// Client-side mirror of the server's phone helpers (kept dependency-free).
export const MIN_DIGITS = 7;
export const MAX_DIGITS = 15;

export function normalizePhone(input) {
  return String(input ?? '').replace(/\D+/g, '');
}

export function validatePhone(input) {
  const number = normalizePhone(input);
  if (!number) return { ok: false, message: 'Please enter a phone number.' };
  if (number.length < MIN_DIGITS) return { ok: false, message: `Phone number is too short (minimum ${MIN_DIGITS} digits).` };
  if (number.length > MAX_DIGITS) return { ok: false, message: `Phone number is too long (maximum ${MAX_DIGITS} digits).` };
  return { ok: true, number };
}

export function formatPhone(number) {
  const digits = normalizePhone(number);
  if (digits.length === 11 && digits.startsWith('0')) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  if (digits.length === 12 && digits.startsWith('92')) return `+92 ${digits.slice(2, 5)} ${digits.slice(5)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return digits;
}

export function guessCountry(number) {
  const digits = normalizePhone(number);
  if (digits.startsWith('92') || (digits.startsWith('03') && digits.length === 11)) return 'Pakistan';
  if (digits.startsWith('91') || (/^[6-9]/.test(digits) && digits.length === 10)) return 'India';
  return '';
}
