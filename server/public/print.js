// Loaded only on /print/:number?auto=1 – opens the print dialog once images are ready.
window.addEventListener('load', function () {
  setTimeout(function () { window.print(); }, 250);
});
