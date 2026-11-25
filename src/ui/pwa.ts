/** Installable-app support: service worker registration, install prompt and update notice. */
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
let snapshot = { canInstall: false, updateReady: false };
const subs = new Set<() => void>();
const emit = () => {
  snapshot = { canInstall: !!deferred, updateReady: !!waiting };
  subs.forEach((f) => f());
};

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const watch = (w: ServiceWorker | null) => {
        if (!w) return;
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          waiting = w;
          emit();
        }
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = w;
            emit();
          }
        });
      };
      watch(reg.waiting);
      reg.addEventListener('updatefound', () => watch(reg.installing));
    })
    .catch(() => undefined);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return;
    reloading = true;
    location.reload();
  });
}

export function usePwa() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => snapshot,
  );
  return {
    ...s,
    async install() {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      emit();
    },
    applyUpdate() {
      waiting?.postMessage('skipWaiting');
    },
  };
}
