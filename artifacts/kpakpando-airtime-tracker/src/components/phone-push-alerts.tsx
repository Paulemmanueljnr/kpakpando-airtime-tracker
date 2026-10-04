import { useEffect, useState } from 'react';
import { Bell, BellRing, Smartphone } from 'lucide-react';
import { API_URL } from '@/lib/airtime-api';

type PushStatus = 'checking' | 'off' | 'on' | 'blocked' | 'unsupported' | 'demo';
const PUSH_ENABLED_KEY = 'kpakpando-phone-push-enabled-v1';
const PUSH_PUBLIC_KEY = 'kpakpando-phone-push-public-key-v1';

function supportsPush() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof PushManager !== 'undefined'
    && typeof Notification !== 'undefined';
}

function readPreference() {
  try {
    return window.localStorage.getItem(PUSH_ENABLED_KEY);
  } catch {
    return null;
  }
}

function writePreference(enabled: boolean) {
  try {
    window.localStorage.setItem(PUSH_ENABLED_KEY, String(enabled));
  } catch {
    // The current page still reflects the user's choice if storage is blocked.
  }
}

function readSavedPublicKey() {
  try {
    return window.localStorage.getItem(PUSH_PUBLIC_KEY) ?? '';
  } catch {
    return '';
  }
}

function savePublicKey(key: string) {
  try {
    window.localStorage.setItem(PUSH_PUBLIC_KEY, key);
  } catch {
    // The key is also sent to the active service worker for subscription recovery.
  }
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = window.atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

async function registerPushWorker() {
  const scope = import.meta.env.BASE_URL;
  const scriptUrl = new URL(`${scope}service-worker.js`, window.location.href);
  scriptUrl.searchParams.set('api', API_URL);
  const registration = await navigator.serviceWorker.register(scriptUrl.href, { scope });
  const hasCurrentApiUrl = (worker: ServiceWorker | null) => {
    if (!worker) return false;
    return new URL(worker.scriptURL).searchParams.get('api') === API_URL;
  };
  if (hasCurrentApiUrl(registration.active)) return registration;

  const installingWorker = registration.installing ?? registration.waiting;
  if (installingWorker) {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        installingWorker.removeEventListener('statechange', handleStateChange);
        reject(new Error('The updated phone alert service worker did not activate.'));
      }, 20_000);
      const handleStateChange = () => {
        if (hasCurrentApiUrl(registration.active)) {
          window.clearTimeout(timeout);
          installingWorker.removeEventListener('statechange', handleStateChange);
          resolve();
        } else if (installingWorker.state === 'redundant') {
          window.clearTimeout(timeout);
          installingWorker.removeEventListener('statechange', handleStateChange);
          reject(new Error('The updated phone alert service worker could not be installed.'));
        }
      };
      installingWorker.addEventListener('statechange', handleStateChange);
      handleStateChange();
    });
    return registration;
  }

  const readyRegistration = await navigator.serviceWorker.ready;
  return registration.active ? registration : readyRegistration;
}

async function fetchPublicKey() {
  const response = await fetch(`${API_URL}/api/push/key`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Could not retrieve the phone alert key.');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('publicKey' in result) || typeof result.publicKey !== 'string' || !result.publicKey) {
    throw new Error('The phone alert key response was invalid.');
  }
  savePublicKey(result.publicKey);
  return result.publicKey;
}

async function postSubscription(subscription: PushSubscription) {
  const response = await fetch(`${API_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) throw new Error('The server could not save this phone subscription.');
}

async function syncPushSubscription() {
  const registration = await registerPushWorker();
  let subscription = await registration.pushManager.getSubscription();
  let publicKey = readSavedPublicKey();

  if (!publicKey || !subscription) publicKey = await fetchPublicKey();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToArrayBuffer(publicKey),
    });
  }

  await postSubscription(subscription);
  savePublicKey(publicKey);
  registration.active?.postMessage({ type: 'SAVE_PUSH_SETTINGS', enabled: true, publicKey });
  writePreference(true);
  return registration;
}

export function PhonePushAlerts() {
  const [status, setStatus] = useState<PushStatus>(() => {
    if (!API_URL) return 'demo';
    if (!supportsPush()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return readPreference() === 'false' ? 'off' : 'checking';
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!API_URL) {
      setStatus('demo');
      return;
    }
    if (!supportsPush()) {
      setStatus('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('blocked');
      return;
    }
    if (readPreference() === 'false') {
      setStatus('off');
      return;
    }
    if (Notification.permission !== 'granted') {
      setStatus('off');
      return;
    }

    let cancelled = false;
    setStatus('checking');
    void syncPushSubscription()
      .then(() => {
        if (!cancelled) {
          setStatus('on');
          setMessage('');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus(Notification.permission === 'denied' ? 'blocked' : 'off');
      });
    return () => { cancelled = true; };
  }, []);

  const enable = async () => {
    if (!API_URL || !supportsPush()) return;
    setBusy(true);
    setMessage('');
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      writePreference(true);
      await syncPushSubscription();
      setStatus('on');
      setMessage('Phone alerts enabled.');
    } catch {
      setStatus(Notification.permission === 'denied' ? 'blocked' : 'off');
      setMessage('Could not enable phone alerts. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!API_URL || !supportsPush()) return;
    setBusy(true);
    setMessage('');
    try {
      const registration = await registerPushWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch(`${API_URL}/api/push/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error('The server could not remove this phone subscription.');
        await subscription.unsubscribe();
      }
      writePreference(false);
      registration.active?.postMessage({ type: 'SAVE_PUSH_SETTINGS', enabled: false });
      setStatus('off');
      setMessage('Phone alerts turned off.');
    } catch {
      setMessage('Could not turn off phone alerts. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const testNotification = async () => {
    if (!API_URL || !supportsPush()) return;
    setBusy(true);
    setMessage('');
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : status);
        setMessage(permission === 'denied' ? 'Allow notifications in your browser settings to run this test.' : '');
        return;
      }
      const registration = await registerPushWorker();
      await registration.showNotification('Kpakpando test notification', {
        body: 'Phone notifications are working on this device.',
        tag: 'kpakpando-phone-alert-test',
        requireInteraction: true,
        icon: new URL('kpakpando-station-logo.png', registration.scope).href,
        badge: new URL('kpakpando-station-logo.png', registration.scope).href,
      });
      setMessage('Test notification sent to this device.');
    } catch {
      setMessage('The test notification could not be shown. Check browser notification settings.');
    } finally {
      setBusy(false);
    }
  };

  let statusLabel = 'Enable phone alerts';
  if (status === 'on') statusLabel = 'Phone alerts: ON';
  else if (status === 'blocked') statusLabel = 'Blocked - allow notifications for this site in browser settings';
  else if (status === 'unsupported') statusLabel = 'Not supported on this browser';
  else if (status === 'demo') statusLabel = 'Phone alerts require a live server; unavailable in browser demo mode';
  else if (status === 'checking') statusLabel = 'Checking phone alerts…';

  const enableDisabled = busy || status === 'checking' || status === 'blocked' || status === 'unsupported' || status === 'demo';

  return <section className="phone-alerts" aria-label="Phone push alerts" data-testid="phone-alerts-control">
    <div className="phone-alert-identity">
      <span className="phone-alert-icon"><Smartphone size={16} /></span>
      <div className="phone-alert-copy">
        <strong>Phone alerts</strong>
        <span className={`phone-alert-status ${status === 'on' ? 'enabled' : status === 'blocked' ? 'blocked' : ''}`}>{statusLabel}</span>
      </div>
    </div>
    <div className="phone-alert-actions">
      {status === 'on'
        ? <button className="phone-alert-text-btn" type="button" onClick={() => void turnOff()} disabled={busy}>{busy ? 'Turning off…' : 'Turn off'}</button>
        : status === 'off' || status === 'checking'
          ? <button className="phone-alert-enable" type="button" onClick={() => void enable()} disabled={enableDisabled}><Bell size={14} />{busy ? 'Enabling…' : 'Enable phone alerts'}</button>
          : null}
      {status !== 'demo' && status !== 'unsupported' && <button className="phone-alert-test" type="button" onClick={() => void testNotification()} disabled={busy || status === 'blocked'}><BellRing size={13} /> Test notification</button>}
    </div>
    {message && <div className="phone-alert-message" role="status">{message}</div>}
  </section>;
}