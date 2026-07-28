// GRIDIO install helper
// Powers the "GET APP" button on the sign in page.
//
// There is no cross platform install API, so this branches:
//   Chromium (Android + desktop) -> capture beforeinstallprompt, fire it on tap.
//                                   This is a real one tap install.
//   iOS Safari/Chrome            -> no API exists. Show the Share > Add to Home
//                                   Screen steps instead.
//   Firefox / Samsung / other    -> show the browser menu steps.
//   In app browsers (Discord,    -> install is impossible in a webview. Tell them
//   Instagram, Facebook)            to open in a real browser, offer a copy link.
// The button hides itself when we are already running as an installed app.
(function () {
  const btn = document.getElementById('get-app');
  if (!btn) return;

  const ua = navigator.userAgent || '';
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://');

  // Already an app on this device. Nothing to sell.
  if (installed) {
    const row = btn.closest('.install-row') || btn;
    row.hidden = true;
    return;
  }

  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);
  // Webview signatures. Not exhaustive: Discord on iOS uses Safari's view
  // controller and is indistinguishable, which is why the iOS steps still work
  // as a fallback there.
  const inAppBrowser =
    /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|Discord|Snapchat|Pinterest|LinkedInApp|MicroMessenger/i.test(ua);

  let deferred = null;

  // Chromium fires this when the app passes the install criteria. Holding on to
  // the event is what lets us open the native dialog from our own button later.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.classList.add('ready');
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    closeSheet();
    const row = btn.closest('.install-row') || btn;
    row.hidden = true;
  });

  // ---------- the fallback sheet ----------

  let sheet = null;

  function closeSheet() {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') closeSheet();
  }

  function steps() {
    if (inAppBrowser) {
      return {
        title: 'OPEN iN YOUR BROWSER',
        lead: 'Apps cannot be installed from inside this chat window. Open GRIDIO in Chrome or Safari first, then tap GET APP again.',
        list: [
          'Tap the menu in the top corner of this window.',
          'Choose "Open in browser" or "Open in Safari".',
          'Tap GET APP once GRIDIO loads there.'
        ],
        copy: true
      };
    }
    if (isIOS) {
      return {
        title: 'ADD TO HOME SCREEN',
        lead: 'iPhone and iPad do not let a website install itself, so this part is manual. It takes about five seconds.',
        list: [
          'Tap the Share button at the bottom of the screen. It is the square with an arrow pointing up.',
          'Scroll down and tap "Add to Home Screen".',
          'Tap Add. GRIDIO lands on your home screen with its own icon.'
        ]
      };
    }
    if (isAndroid) {
      return {
        title: 'iNSTALL GRiDiO',
        lead: 'Your browser handles this from its own menu.',
        list: [
          'Tap the three dot menu in the top corner.',
          'Choose "Install app" or "Add to Home screen".',
          'Confirm. GRIDIO gets its own icon and opens without the browser bars.'
        ]
      };
    }
    return {
      title: 'iNSTALL GRiDiO',
      lead: 'Your browser handles this from the address bar or its own menu.',
      list: [
        'Look for the install icon at the right end of the address bar.',
        'If there is none, open the browser menu and look for "Install" or "Add to Home screen".',
        'Confirm. GRIDIO opens in its own window from then on.'
      ]
    };
  }

  function openSheet() {
    if (sheet) return;
    const s = steps();

    sheet = document.createElement('div');
    sheet.className = 'install-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', s.title);

    const card = document.createElement('div');
    card.className = 'install-card';

    const h = document.createElement('h2');
    h.textContent = s.title;
    card.appendChild(h);

    const p = document.createElement('p');
    p.className = 'install-lead';
    p.textContent = s.lead;
    card.appendChild(p);

    const ol = document.createElement('ol');
    ol.className = 'install-steps';
    for (const line of s.list) {
      const li = document.createElement('li');
      li.textContent = line;
      ol.appendChild(li);
    }
    card.appendChild(ol);

    if (s.copy) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'install-copy';
      copyBtn.type = 'button';
      copyBtn.textContent = 'COPY LiNK';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(location.origin);
          copyBtn.textContent = 'COPiED';
        } catch (_) {
          copyBtn.textContent = location.host;
        }
      });
      card.appendChild(copyBtn);
    }

    const close = document.createElement('button');
    close.className = 'install-close';
    close.type = 'button';
    close.textContent = 'GOT iT';
    close.addEventListener('click', closeSheet);
    card.appendChild(close);

    sheet.appendChild(card);
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) closeSheet();
    });

    document.body.appendChild(sheet);
    document.addEventListener('keydown', onKey);
    close.focus();
  }

  // ---------- the button ----------

  btn.addEventListener('click', async () => {
    if (!deferred) {
      openSheet();
      return;
    }
    btn.disabled = true;
    try {
      deferred.prompt();
      await deferred.userChoice;
    } catch (_) {
      openSheet();
    } finally {
      // The event is single use. If they dismissed it, Chromium will hand us a
      // fresh one on a later visit and the button keeps working meanwhile.
      deferred = null;
      btn.disabled = false;
    }
  });
})();
