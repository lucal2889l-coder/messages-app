// Service worker. Desktop notifications go through here so they integrate with
// the OS (Windows Action Center etc.) and clicking one brings the app forward on
// the right chat. It also receives Web Push, which is what makes notifications
// arrive after every tab is closed. It does not cache anything.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Messages', {
    body: d.body || '',
    icon: d.icon,
    tag: d.tag,
    renotify: !!d.tag,
    requireInteraction: !!d.sticky,
    data: { hash: d.hash || '' }
  }));
});

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
