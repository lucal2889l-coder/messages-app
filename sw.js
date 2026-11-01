// Service worker: only used so desktop notifications integrate properly with
// the OS (Windows Action Center etc.) and clicking one brings the app forward
// on the right chat. It does not cache anything.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = (event.notification.data && event.notification.data.hash) || '';
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(scope)) {
        try { await client.focus(); } catch (e) {}
        client.postMessage({ type: 'open', hash });
        return;
      }
    }
    await self.clients.openWindow(scope + hash);
  })());
});
