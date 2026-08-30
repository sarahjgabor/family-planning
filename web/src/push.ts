// Client-side web push: register the service worker, subscribe/unsubscribe,
// and report state. A future React Native app would replace this file with
// native push registration; the server API stays the same.
import { api } from './api';

export type PushState = 'unsupported' | 'needs-ios-install' | 'denied' | 'enabled' | 'disabled';

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iOS only allows web push when the app is installed to the Home Screen.
function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js');
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'needs-ios-install' : 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-ios-install';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'enabled' : 'disabled';
  } catch {
    return 'disabled';
  }
}

/** Ask permission and subscribe this device. Returns the resulting state. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'needs-ios-install' : 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-ios-install';

  const cfg = await api.get<{ enabled: boolean; publicKey: string | null }>('/push/config');
  if (!cfg.enabled || !cfg.publicKey) throw new Error('Push notifications aren’t set up on the server yet.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'disabled';

  const reg = await registration();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) as BufferSource,
  });
  const json = sub.toJSON();
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return 'enabled';
}

export async function disablePush(): Promise<void> {
  if (!supported()) return;
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

export async function sendTestPush(): Promise<number> {
  const res = await api.post<{ sent: number }>('/push/test');
  return res.sent;
}
