// Integration-only shell added on top of the Document Builder runtime.
// Injects a discreet "Sign out" control into the top of the app's controls
// pane, posts {action:"logout"} to the API, and reloads — the middleware
// then sees no valid session and redirects the user back to the gate.
// Does not touch the Builder's document logic, storage, or exports.

(function () {
  'use strict';

  var API = '/api/internal/pricing';

  function styleFromCSSText(el, css) {
    // Avoid inline style="…" strings; assign properties one at a time so
    // this stays clear of style-src's inline-style path.
    var pairs = css.split(';');
    for (var i = 0; i < pairs.length; i++) {
      var seg = pairs[i].trim();
      if (!seg) continue;
      var idx = seg.indexOf(':');
      if (idx <= 0) continue;
      var prop = seg.slice(0, idx).trim();
      var value = seg.slice(idx + 1).trim();
      try { el.style.setProperty(prop, value); } catch (_) { /* ignore */ }
    }
  }

  function makeButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'arie-signout';
    btn.setAttribute('aria-label', 'Sign out of the ARIE Document Builder');
    btn.textContent = 'Sign out';
    styleFromCSSText(btn,
      'position:absolute;top:10px;right:14px;z-index:9999;' +
      'background:transparent;color:#454E66;border:1px solid #CAD7E6;' +
      'border-radius:6px;padding:4px 10px;font:600 12px "Hanken Grotesk",system-ui,sans-serif;' +
      'cursor:pointer'
    );
    btn.addEventListener('mouseover', function () { btn.style.setProperty('border-color', '#4940D6'); });
    btn.addEventListener('mouseout', function () { btn.style.setProperty('border-color', '#CAD7E6'); });
    btn.addEventListener('click', signOut);
    return btn;
  }

  function signOut() {
    var b = document.getElementById('arie-signout');
    if (b) { b.disabled = true; b.textContent = 'Signing out…'; }
    var done = function () { window.location.replace('/internal/pricing/'); };
    try {
      fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' })
      }).then(done, done);
    } catch (_) { done(); }
  }

  function mount() {
    if (document.getElementById('arie-signout')) return;
    var host = document.querySelector('.brandbar') || document.querySelector('.controls') || document.body;
    if (!host) return;
    try { host.style.setProperty('position', 'relative'); } catch (_) { /* ignore */ }
    host.appendChild(makeButton());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
