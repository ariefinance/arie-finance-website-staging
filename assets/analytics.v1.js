/*
 * ARIE Finance — consent-aware GA4/GTM dataLayer and cookieless Vercel form events.
 *
 * Loads only on the marketing single-page site (index.html); utility
 * routes (/salestracker, /managementreport, /internal/*, /logout) do
 * not include this file, so no analytics is pushed from those pages.
 *
 * Consent Mode: Basic. Google Tag Manager loads only after analytics consent;
 * Vercel Web Analytics runs without cookies for aggregate website metrics.
 * Advertising storage/consent is never granted.
 *
 * PII policy: we never push name, email, phone, company, message body,
 * uploaded files, or free text from any form into the dataLayer. Only
 * non-personal intent slugs, CTA text, and URLs of tel:/mailto: links
 * (which are the site's public contact details) are captured.
 */
(function () {
  'use strict';

  var dl = (window.dataLayer = window.dataLayer || []);
  function push(evt, params) {
    try {
      var obj = { event: evt };
      if (params) {
        for (var k in params) {
          if (Object.prototype.hasOwnProperty.call(params, k)) obj[k] = params[k];
        }
      }
      dl.push(obj);
    } catch (e) { /* never break the site for analytics */ }
  }

  // Vercel is the primary aggregate source for conversions across all consent choices.
  // Only controlled, non-personal event names and category slugs are sent.
  function recordVercel(name, data) {
    try {
      if (typeof window.va === 'function') {
        window.va('event', data ? { name: name, data: data } : { name: name });
      }
    } catch (e) { /* analytics must never block customer actions */ }
  }

  // ---------- section_view (public paths and legacy hash routes) ----------
  var SECTIONS = [
    'home', 'about', 'services', 'direct-clients', 'introducers',
    'team', 'careers', 'contact', 'compliance', 'home-services',
    'safeguarding', 'eligibility', 'policies',
    'compliance-facts', 'compliance-is-is-not'
  ];
  var seen = Object.create(null);

  function currentSection() {
    var raw = (location.hash || '').replace(/^#/, '');
    raw = raw.split('?')[0].split('&')[0];
    if (raw) return raw;
    var route = (location.pathname || '/').replace(/^\/|\/$/g, '');
    return ['services', 'introducers', 'eligibility'].indexOf(route) !== -1 ? route : 'home';
  }
  function fireSection() {
    var s = currentSection();
    if (!s || seen[s]) return;
    if (SECTIONS.indexOf(s) === -1) return;
    seen[s] = true;
    push('section_view', {
      section_name: s,
      page_title: document.title,
      page_location: location.href
    });
  }
  window.addEventListener('hashchange', fireSection);
  window.addEventListener('arie:routechange', fireSection);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fireSection);
  } else {
    fireSection();
  }

  // ---------- helpers ----------
  function textOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  function ctaLocation(el) {
    var s = el.closest ? el.closest('section') : null;
    if (s && s.id) return s.id;
    if (s && s.className) return String(s.className).split(/\s+/)[0] || 'section';
    return 'unknown';
  }
  function currentContactTopic() {
    var checked = document.querySelector('input[name="topic"]:checked');
    if (!checked) return '';
    var t = checked.getAttribute('data-topic');
    return t || '';
  }

  var START_APP_RE = /start\s+your\s+application/i;
  // Since the eligibility journey: the application CTAs read "Check Your Eligibility"
  // (mobile short label "Eligibility") and open data-route="eligibility".
  var ELIGIBILITY_RE = /check\s+your\s+eligibility/i;
  var SPEAK_RE = /^(speak to our team|speak to the team|contact arie finance)$/i;

  // ---------- click delegation ----------
  document.addEventListener('click', function (ev) {
    var link = ev.target && ev.target.closest ? ev.target.closest('a[href], button') : null;
    if (!link) return;

    var href = link.getAttribute ? link.getAttribute('href') : null;
    if (href) {
      // Only ARIE's enquiries WhatsApp number; do not count generic wa.me
      // sharing links from the eligibility checker as contact enquiries.
      if (/^https:\/\/wa\.me\/23059194957(?:[/?#]|$)/i.test(href)) {
        push('whatsapp_enquiry_click', { channel: 'whatsapp' });
        recordVercel('whatsapp_enquiry_click', { channel: 'whatsapp' });
        return;
      }
      if (href.indexOf('mailto:') === 0) {
        push('email_click', { link_url: href, link_text: textOf(link) });
        return;
      }
      if (href.indexOf('tel:') === 0) {
        push('phone_click', { link_url: href, link_text: textOf(link) });
        return;
      }
    }

    var t = textOf(link);
    if (!t) return;

    // start_application: customer/client application CTA intent only.
    // Strict identity: the DOM element must be the site's contact-route
    // anchor (data-route="contact"). This rejects any unrelated future
    // button labelled "Apply" — for example a hypothetical careers
    // Apply control — from being classified as a commercial CTA.
    // Matched text: "Start Your Application" or the exact mobile short
    // label "Apply" that lives inside the same data-route="contact"
    // anchor as "Start Your Application" (verified in the repo).
    if (link.matches && link.matches('a[data-route="eligibility"]')) {
      if (ELIGIBILITY_RE.test(t) || t === 'Eligibility') {
        push('start_application', { cta_text: t, cta_location: ctaLocation(link) });
        return;
      }
    }
    if (link.matches && link.matches('a[data-route="contact"]')) {
      if (START_APP_RE.test(t) || t === 'Apply') {
        push('start_application', { cta_text: t, cta_location: ctaLocation(link) });
        return;
      }
    }

    // speak_to_team: general commercial contact CTAs.
    if (SPEAK_RE.test(t)) {
      push('speak_to_team', { cta_text: t, cta_location: ctaLocation(link) });
      return;
    }
  }, true);

  // ---------- contact_topic_selected (engagement) ----------
  // Fires whenever the contact-form intent radio changes. Parameter
  // contact_topic is the non-personal slug from the radio's data-topic
  // attribute (e.g. "account", "payments", "introducer", "referral",
  // "support", "other"). Selection is INTEREST, not a submitted lead;
  // the actual submitted lead is contact_form_submit with the same
  // contact_topic value.
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || t.name !== 'topic') return;
    if (!t.checked) return;
    var slug = t.getAttribute && t.getAttribute('data-topic');
    if (!slug) return;
    push('contact_topic_selected', { contact_topic: slug });
  }, true);

  // ---------- form_start / form_submit ----------
  // form_start on first user interaction with each form, once.
  // form_submit when the site's existing success element gets
  // .is-visible (set by the confirmed-success branch in the site's
  // contact/careers/feedback submit handler, after /api/website-form returns
  // {ok:true}. Honeypot-only fake confirmations are excluded.
  // For the contact form, contact_topic is attached from
  // whichever intent radio is checked at that moment.
  document.querySelectorAll('form[data-form]').forEach(function (form) {
    var name = form.dataset.form; // "contact" | "careers" | "feedback"
    var started = false;
    function start() {
      if (started) return;
      started = true;
      var params = { form_name: name };
      push(name + '_form_start', params);
      recordVercel(name + '_form_start', params);
    }
    form.addEventListener('input', start, true);
    form.addEventListener('change', start, true);
  });

  document.querySelectorAll('[data-success]').forEach(function (success) {
    var name = success.getAttribute('data-success'); // "contact" | "careers" | "feedback"
    if (!name) return;
    var recorded = false;
    try {
      var mo = new MutationObserver(function () {
        if (recorded) return;
        if (success.classList.contains('is-visible')) {
          // Genuine server-success branch sets tabindex=-1; the honeypot
          // shortcut shows the same success element but never sets tabindex.
          if (success.getAttribute('tabindex') !== '-1') { mo.disconnect(); return; }
          recorded = true;
          var params = { form_name: name };
          if (name === 'contact') {
            var topic = currentContactTopic();
            if (topic) params.contact_topic = topic;
          }
          push(name + '_form_submit', params);
          recordVercel(name + '_form_submit', params);
          mo.disconnect();
        }
      });
      mo.observe(success, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { /* MutationObserver unavailable — form_submit will not fire */ }
  });
})();
