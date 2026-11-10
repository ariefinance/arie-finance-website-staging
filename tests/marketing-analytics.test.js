'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'assets', 'analytics.v1.js'), 'utf8');
const siteHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('marketing analytics script uses a versioned URL to avoid stale immutable caching', () => {
  assert.match(siteHtml, /src="\/assets\/analytics\.v1\.js\?v=20261110"/);
});

function createHarness() {
  const vercel = [];
  const dataLayer = [];
  const listeners = {};
  const forms = {};
  const successes = {};
  for (const name of ['contact', 'careers', 'feedback']) {
    forms[name] = {
      dataset: { form: name },
      listeners: {},
      addEventListener(event, callback) { this.listeners[event] = callback; }
    };
    successes[name] = {
      visible: false,
      verified: false,
      observer: null,
      getAttribute(attr) {
        if (attr === 'data-success') return name;
        if (attr === 'tabindex') return this.verified ? '-1' : null;
        return null;
      },
      classList: { contains: cls => cls === 'is-visible' && successes[name].visible }
    };
  }
  class FakeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; }
    observe(el) { el.observer = this; }
    disconnect() { this.disconnected = true; }
  }
  const document = {
    title: 'ARIE Finance',
    readyState: 'complete',
    addEventListener(type, callback) { listeners[type] = callback; },
    querySelectorAll(selector) {
      if (selector === 'form[data-form]') return Object.values(forms);
      if (selector === '[data-success]') return Object.values(successes);
      return [];
    },
    querySelector(selector) {
      if (selector === 'input[name="topic"]:checked') {
        return { getAttribute: key => key === 'data-topic' ? 'account' : null };
      }
      return null;
    }
  };
  const window = {
    dataLayer,
    va(event, payload) { vercel.push({ event, payload }); },
    addEventListener() {}
  };
  const location = { hash: '#feedback', href: 'https://www.ariefinance.com/#feedback' };
  vm.runInNewContext(script, { window, document, location, MutationObserver: FakeObserver });
  return { vercel, dataLayer, forms, successes, listeners };
}

function recorded(h, name) { return h.vercel.filter(e => e.payload.name === name); }

test('marketing forms count a first interaction once and confirmed submissions once', () => {
  const h = createHarness();
  for (const name of ['contact', 'careers', 'feedback']) {
    h.forms[name].listeners.input();
    h.forms[name].listeners.change();
    assert.equal(recorded(h, name + '_form_start').length, 1);
    h.successes[name].visible = true;
    h.successes[name].verified = true;
    h.successes[name].observer.callback();
    h.successes[name].observer.callback();
    assert.equal(recorded(h, name + '_form_submit').length, 1);
    assert.equal(h.dataLayer.filter(e => e.event === name + '_form_submit').length, 1);
  }
  assert.equal(recorded(h, 'contact_form_submit')[0].payload.data.contact_topic, 'account');
});

test('honeypot fake success does not count as a verified lead', () => {
  const h = createHarness();
  h.successes.feedback.visible = true;
  h.successes.feedback.verified = false;
  h.successes.feedback.observer.callback();
  assert.equal(recorded(h, 'feedback_form_submit').length, 0);
  assert.equal(h.dataLayer.filter(e => e.event === 'feedback_form_submit').length, 0);
});

test('official WhatsApp enquiry click is counted, generic WhatsApp sharing is not', () => {
  const h = createHarness();
  function click(href) {
    const link = {
      getAttribute: key => key === 'href' ? href : null,
      textContent: 'WhatsApp',
      matches: () => false,
      closest: () => null
    };
    h.listeners.click({ target: { closest: () => link } });
  }
  click('https://wa.me/23059194957');
  click('https://wa.me/?text=Sharing%20eligibility');
  assert.equal(recorded(h, 'whatsapp_enquiry_click').length, 1);
  assert.equal(h.dataLayer.filter(e => e.event === 'whatsapp_enquiry_click').length, 1);
  assert.deepEqual(Object.keys(recorded(h, 'whatsapp_enquiry_click')[0].payload.data), ['channel']);
});

test('Vercel event payloads contain no form content or personal information', () => {
  const h = createHarness();
  h.forms.feedback.listeners.input();
  h.successes.feedback.visible = true;
  h.successes.feedback.verified = true;
  h.successes.feedback.observer.callback();
  for (const event of h.vercel) {
    assert.equal(event.event, 'event');
    assert.match(event.payload.name, /^[a-z_]+$/);
    assert.ok(event.payload.data === undefined ||
      Object.keys(event.payload.data).every(key => ['form_name', 'contact_topic', 'channel'].includes(key)));
  }
});
