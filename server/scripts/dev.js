// `npm run dev`: force development mode (templates and print.css reload on
// every request) regardless of the NODE_ENV in .env, then start the server.
process.env.NODE_ENV = 'development';
await import('../src/index.js');
