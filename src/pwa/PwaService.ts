const SERVICE_WORKER_URL = '/sw.js';

type SwRegistrationState = Pick<ServiceWorkerRegistration, 'active' | 'waiting'> & {
  installed?: ServiceWorker | null;
  controller?: ServiceWorker | null;
};

export class PwaService {
  static register(): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => undefined);
  }

  static getOfflineStatus(): boolean {
    if (typeof navigator === 'undefined') {
      return true;
    }
    return !navigator.onLine;
  }

  static requestUpdate(): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) {
        return;
      }
      const state = registration as SwRegistrationState;
      const active = state.active;
      const waiting = state.waiting;
      const installed = state.installed;
      if (waiting && waiting !== active) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => window.location.reload(),
          { once: true },
        );
        return;
      }
      if (installed && installed !== active && installed !== state.controller) {
        window.location.reload();
      }
    }).catch(() => undefined);
  }
}
