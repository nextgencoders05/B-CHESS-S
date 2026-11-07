(() => {
  const banner = document.getElementById('pwaInstallBanner');
  const installBtn = document.getElementById('pwaInstallBtn');
  const dismissBtn = document.getElementById('pwaInstallDismiss');

  if (!banner || !installBtn || !dismissBtn) return;

  let deferredPrompt = null;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;

  const isMobile =
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    window.matchMedia('(max-width: 700px)').matches;

  if (isStandalone) return;

  const dismissed = () => sessionStorage.getItem('bChessInstallDismissed') === '1';

  const showBanner = () => {
    if (!dismissed()) {
      banner.hidden = false;
      banner.classList.toggle('mobile-install-banner', isMobile);
    }
  };

  const hideBanner = () => {
    banner.hidden = true;
  };

  // Android/Chrome/Edge: capture the real native PWA install prompt.
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    showBanner();
  });

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (choice && choice.outcome === 'accepted') hideBanner();
      return;
    }

    // iPhone/iPad Safari does not expose beforeinstallprompt.
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      alert(
        'Install B Chess on iPhone/iPad:\\n\\n' +
        '1. Tap the Share button in Safari.\\n' +
        '2. Choose “Add to Home Screen”.\\n' +
        '3. Tap “Add”.'
      );
      return;
    }

    // Other browsers may expose installation only through their browser menu.
    alert(
      'To install B Chess:\\n\\n' +
      'Open your browser menu and choose “Install app” or “Add to Home screen”.'
    );
  });

  dismissBtn.addEventListener('click', () => {
    hideBanner();
    sessionStorage.setItem('bChessInstallDismissed', '1');
  });

  window.addEventListener('appinstalled', () => {
    hideBanner();
    deferredPrompt = null;
  });

  // iOS Safari has no native install event. Show the custom guide.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS) {
    setTimeout(showBanner, 900);
  }

  // On mobile, show the custom install card after a short delay even when
  // the browser has not fired beforeinstallprompt yet.
  if (isMobile && !isIOS) {
    setTimeout(() => {
      if (!deferredPrompt) showBanner();
    }, 1400);
  }

  // Register service worker so the installed app has an app-like shell/offline cache.
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
        .then(reg => {
          // Pick up a new service worker version quickly after deployment.
          if (reg.waiting) reg.waiting.postMessage({type: 'SKIP_WAITING'});
          reg.update().catch(() => {});
        })
        .catch(err => console.warn('Service worker registration failed:', err));
    });
  }
})();
