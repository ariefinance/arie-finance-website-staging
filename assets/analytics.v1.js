/*
 * ARIE Finance — GA4 / GTM event layer (dataLayer only).
 * Loads only on the marketing single-page site (index.html); utility
 * routes (/salestracker, /managementreport, /internal/*, /logout) do not
 * include this file, so no analytics is pushed from those pages.
 *
 * Consent Mode: Advanced. Before explicit acceptance analytics_storage
 * is denied and Google may send cookieless pings; on cookie acceptance
 * the index.html accept handler flips analytics_storage to granted.
 * Advertising storage/consent is never granted.
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

  // ---------- section_view (single-page hash routes) ----------
  var SECTIONS = [
    'home', 'about', 'services', 'direct-clients', 'introducers',
    'team', 'careers', 'contact', 'compliance', 'home-services',
    'safeguarding', 'eligibility', 'policies',
    'compliance-facts', 'compliance-is-is-not'
  ];
  var seen = Object.create(null);

  function currentSection() {
    var raw = (location.hash || '#home').replace(/^#/, '');
    raw = raw.split('?')[0].split('&')[0];
    return raw || 'home';
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

  var START_APP_RE = /start\s+your\s+application/i;
  var SPEAK_RE = /^(speak to our team|speak to the team|contact arie finance)$/i;

  // ---------- click delegation ----------
  document.addEventListener('click', function (ev) {
    var link = ev.target && ev.target.closest ? ev.target.closest('a[href], button') : null;
    if (!link) return;

    var href = link.getAttribute ? link.getAttribute('href') : null;
    if (href) {
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
    // Matches "Start Your Application" and the mobile-cta-short "Apply"
    // which is the same button, per repo audit.
    if (START_APP_RE.test(t) || t === 'Apply') {
      push('start_application', { cta_text: t, cta_location: ctaLocation(link) });
      return;
    }

    // speak_to_team: general commercial contact CTAs.
    if (SPEAK_RE.test(t)) {
      push('speak_to_team', { cta_text: t, cta_location: ctaLocation(link) });
      return;
    }
  }, true);

  // ---------- introducer_enquiry (intent radio in contact form) ----------
  // The current site has no standalone "Discuss an Introducer Relationship"
  // CTA. The introducer signal that exists is the contact-form topic radio
  // (input[name="topic"][data-topic="introducer"], label "Introducer /
  // partnership"). Fire once per session on selection.
  var introducerFired = false;
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || t.name !== 'topic') return;
    if (t.getAttribute && t.getAttribute('data-topic') === 'introducer' && t.checked && !introducerFired) {
      introducerFired = true;
      push('introducer_enquiry', {
        cta_text: 'Introducer / partnership',
        cta_location: 'contact_form_intent'
      });
    }
  }, true);

  // ---------- form_start / form_submit ----------
  // form_start on first user interaction with each form, once.
  // form_submit when the site's existing success element gets .is-visible
  // (set by the confirmed-success branch in the contact/careers handler).
  document.querySelectorAll('form[data-form]').forEach(function (form) {
    var name = form.dataset.form; // "contact" | "careers"
    var started = false;
    function start() {
      if (started) return;
      started = true;
      push(name + '_form_start', { form_name: name });
    }
    form.addEventListener('input', start, true);
    form.addEventListener('change', start, true);
  });

  document.querySelectorAll('[data-success]').forEach(function (success) {
    var name = success.getAttribute('data-success'); // "contact" | "careers"
    if (!name) return;
    try {
      var mo = new MutationObserver(function () {
        if (success.classList.contains('is-visible')) {
          push(name + '_form_submit', { form_name: name });
          mo.disconnect();
        }
      });
      mo.observe(success, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { /* MutationObserver unavailable — form_submit will not fire */ }
  });
})();
