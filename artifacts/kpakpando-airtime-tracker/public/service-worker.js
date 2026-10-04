const SHELL_CACHE = 'kpakpando-shell-v1';
const API_CACHE = 'kpakpando-api-v1';
const PUSH_SETTINGS_CACHE = 'kpakpando-push-settings-v1';
const PUSH_SETTINGS_KEY = new URL('__push-settings__', self.registration.scope).href;
const PUSH_API_URL = (new URL(self.location.href).searchParams.get('api') || '').replace(/\/+$/, '');

self.addEventListener('install', event => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith('kpakpando-shell-') && name !== SHELL_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SAVE_PUSH_SETTINGS') {
    event.waitUntil(savePushSettings(event.data));
    return;
  }
  if (event.data?.type !== 'CACHE_READ_API' || !Array.isArray(event.data.paths)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(API_CACHE);
    await Promise.allSettled(event.data.paths
      .filter(path => typeof path === 'string')
      .map(async path => {
        const request = new Request(path, { method: 'GET', credentials: 'same-origin' });
        const response = await fetch(request);
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          await cache.put(request, response.clone());
        }
      }));
  })());
});

async function getPushSettings() {
  const cache = await caches.open(PUSH_SETTINGS_CACHE);
  const response = await cache.match(PUSH_SETTINGS_KEY);
  return response ? response.json() : null;
}

async function savePushSettings(update) {
  const previous = await getPushSettings() || {};
  const settings = {
    ...previous,
    enabled: update.enabled !== false,
    ...(typeof update.publicKey === 'string' && update.publicKey ? { publicKey: update.publicKey } : {}),
  };
  const cache = await caches.open(PUSH_SETTINGS_CACHE);
  await cache.put(PUSH_SETTINGS_KEY, new Response(JSON.stringify(settings), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

function base64UrlToArrayBuffer(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

async function fetchPushPublicKey() {
  const response = await fetch(`${PUSH_API_URL}/api/push/key`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Could not fetch the push public key.');
  const result = await response.json();
  if (typeof result?.publicKey !== 'string' || !result.publicKey) throw new Error('Invalid push public key response.');
  return result.publicKey;
}

async function postPushSubscription(subscription) {
  const response = await fetch(`${PUSH_API_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) throw new Error('Could not refresh the server push subscription.');
}

function pushNotificationOptions(body, tag) {
  const logo = new URL('kpakpando-station-logo.png', self.registration.scope).href;
  return {
    body,
    tag,
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 150, 300, 150, 300],
    icon: logo,
    badge: logo,
  };
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let alerts = [];
    try {
      if (!PUSH_API_URL) throw new Error('No live push API is configured.');
      const response = await fetch(`${PUSH_API_URL}/api/push/latest`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Could not load the latest airtime alert.');
      const result = await response.json();
      if (Array.isArray(result)) alerts = result;
      if (!alerts.length) throw new Error('No alert details were returned.');
    } catch {
      await self.registration.showNotification('Airtime alert - open Kpakpando Airtime Tracker', pushNotificationOptions(
        'Open the tracker to check the current airtime schedule.',
        'kpakpando-airtime-generic-alert',
      ));
      return;
    }

    await Promise.all(alerts.map(alert => self.registration.showNotification(
      String(alert?.title || 'Kpakpando airtime alert'),
      pushNotificationOptions(String(alert?.body || ''), String(alert?.slot_key || `kpakpando-${Date.now()}`)),
    )));
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (typeof client.focus === 'function') return client.focus();
    }
    return self.clients.openWindow(self.registration.scope);
  })());
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    if (!PUSH_API_URL) return;
    const settings = await getPushSettings();
    if (settings?.enabled === false) {
      await event.newSubscription?.unsubscribe();
      return;
    }

    let publicKey = settings?.publicKey || '';
    let subscription = event.newSubscription;
    if (!subscription) {
      if (!publicKey) publicKey = await fetchPushPublicKey();
      subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToArrayBuffer(publicKey),
      });
    }
    if (!subscription) return;
    if (!publicKey) publicKey = await fetchPushPublicKey();
    await postPushSubscription(subscription);
    await savePushSettings({ enabled: true, publicKey });
  })().catch(() => {}));
});

async function cacheAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  const scope = self.registration.scope;
  const indexUrl = new URL('index.html', scope).href;
  const response = await fetch(new Request(indexUrl, { cache: 'reload' }));
  if (!response.ok) throw new Error('Could not cache the Kpakpando app shell.');
  await cache.put(indexUrl, response.clone());

  const html = await response.text();
  const bundledAssets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)]
    .map(match => new URL(match[1], scope).href);
  const supportingAssets = [
    new URL('manifest.webmanifest', scope).href,
    new URL('kpakpando-station-logo.png', scope).href,
    new URL('pwa-icon-192.png', scope).href,
    new URL('pwa-icon-512.png', scope).href,
  ];
  await Promise.allSettled([...new Set([...bundledAssets, ...supportingAssets])].map(async url => {
    const asset = await fetch(new Request(url, { cache: 'reload' }));
    if (asset.ok) await cache.put(url, asset);
  }));
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request.clone());
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      await cache.put(request, response.clone()).catch(() => {});
      return response;
    }
    const cached = await cache.match(request, { ignoreVary: true });
    return cached || response;
  } catch {
    const cached = await cache.match(request, { ignoreVary: true });
    return cached || new Response(JSON.stringify({ message: 'Offline and no saved response is available.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'X-Kpakpando-Offline': '1', 'Cache-Control': 'no-store' },
    });
  }
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const scope = self.registration.scope;
  try {
    const response = await fetch(request);
    if (response.ok) {
      if (request.mode === 'navigate') {
        await cache.put(new URL('index.html', scope).href, response.clone());
      } else if (new URL(request.url).pathname.includes('/assets/')) {
        await cache.put(request, response.clone());
      }
      return response;
    }
  } catch {
    // The cached app shell and immutable build assets are used below while offline.
  }

  if (request.mode === 'navigate') {
    return (await cache.match(new URL('index.html', scope).href)) || Response.error();
  }
  return (await cache.match(request, { ignoreVary: true })) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }
  if (url.origin === self.location.origin && (request.mode === 'navigate' || url.pathname.includes('/assets/'))) {
    event.respondWith(networkFirstShell(request));
  }
});