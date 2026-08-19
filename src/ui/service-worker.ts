/**
 * Registering the service worker (docs/design.md §7, D36).
 *
 * Production only. In development the worker would cache modules Vite is busy
 * replacing, and the resulting "why is my edit not showing" is the classic way
 * to lose an afternoon.
 *
 * Registration failing is not an error worth surfacing: the app works without
 * it, and every reason it can fail — a private window, a browser that does not
 * support it, an insecure origin — is one the user cannot act on.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js', { scope: '.' }).catch(() => {
      // Deliberately silent — see above.
    });
  });
}
