(function () {
  'use strict';
  var API = '/api/internal/pricing';
  var form = document.getElementById('gateForm');
  var pass = document.getElementById('pass');
  var err = document.getElementById('err');
  var submit = document.getElementById('submit');
  if (!form || !pass || !err || !submit) return;

  function setError(msg) { err.textContent = msg || ''; }
  function setBusy(busy) {
    submit.disabled = !!busy;
    pass.disabled = !!busy;
    submit.textContent = busy ? 'Signing in…' : 'Sign in';
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setError('');
    var value = pass.value || '';
    if (!value) { setError('Enter the passcode.'); return; }
    setBusy(true);
    fetch(API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', passcode: value })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
    }).then(function (out) {
      if (out.status === 200 && out.body && out.body.ok) {
        window.location.replace('/internal/pricing/');
        return;
      }
      setBusy(false);
      var code = out.body && out.body.code;
      if (out.status === 429 || code === 'throttled') { setError('Too many attempts. Try again shortly.'); return; }
      if (code === 'invalid_passcode') { setError('Incorrect passcode.'); return; }
      if (code === 'not_configured' || code === 'storage_unconfigured') { setError('Not configured yet — contact the administrator.'); return; }
      setError('Sign-in failed. Please try again.');
    }).catch(function () {
      setBusy(false);
      setError('Connection error. Please try again.');
    });
  });
})();
