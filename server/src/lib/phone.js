/**
 * Phone number helpers.
 *
 * The upstream API takes the number verbatim, so we only *clean* user input:
 * strip everything that is not a digit (spaces, dashes, plus signs, brackets).
 * We deliberately do not convert between +92 / 0 prefixes; the digits the user
 * typed are what gets looked up (and cached).
 */

export const MIN_DIGITS = 7;
export const MAX_DIGITS = 15;

/** Remove every non-digit character. Returns '' for non-string input. */
export function normalizePhone(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return '';
  return String(input).replace(/\D+/g, '');
}

/**
 * Normalise and validate. Returns { ok: true, number } or { ok: false, message }.
 */
export function parsePhone(input) {
  const number = normalizePhone(input);
  if (!number) {
    return { ok: false, message: 'Please enter a phone number.' };
  }
  if (number.length < MIN_DIGITS) {
    return { ok: false, message: `Phone number is too short (minimum ${MIN_DIGITS} digits).` };
  }
  if (number.length > MAX_DIGITS) {
    return { ok: false, message: `Phone number is too long (maximum ${MAX_DIGITS} digits).` };
  }
  return { ok: true, number };
}

/** Group digits for display, e.g. 03320407479 -> 0332 0407479. */
export function formatPhone(number) {
  const digits = normalizePhone(number);
  if (digits.length === 11 && digits.startsWith('0')) {
    return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  }
  if (digits.length === 12 && digits.startsWith('92')) {
    return `+92 ${digits.slice(2, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return digits;
}

/** Best-effort country label from the leading digits. */
export function guessCountry(number) {
  const digits = normalizePhone(number);
  if (digits.startsWith('92') || (digits.startsWith('03') && digits.length === 11)) return 'Pakistan';
  if (digits.startsWith('91') || (/^[6-9]/.test(digits) && digits.length === 10)) return 'India';
  return '';
}
