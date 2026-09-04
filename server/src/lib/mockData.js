/**
 * Fixture data served when LOOKUP_MOCK=true. Mirrors the upstream JSON shape:
 *   { status, results: [{ number, names: [], images: [] }] }
 */
export const MOCK_RESULTS = {
  '03320407479': {
    status: 'success',
    results: [
      {
        number: '03320407479',
        names: ['Fahad Jojo', 'Fahad Jojo Pgc', 'Fahad ☠️', 'Fahad colony'],
        images: [],
      },
    ],
  },
  '03001234567': {
    status: 'success',
    results: [
      {
        number: '03001234567',
        names: ['Ayesha Khan', 'Ayesha (Office)', 'Dr. Ayesha'],
        images: [
          'https://picsum.photos/seed/ayesha1/400/400',
          'https://picsum.photos/seed/ayesha2/400/400',
        ],
      },
    ],
  },
  '919876543210': {
    status: 'success',
    results: [
      {
        number: '919876543210',
        names: ['Rahul Sharma', 'Rahul Bhai', 'Rahul Delivery'],
        images: ['https://picsum.photos/seed/rahul/400/400'],
      },
    ],
  },
};
