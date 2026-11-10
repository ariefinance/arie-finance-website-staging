// Run: npm test
// Synthetic tests for the "feedback" form type in /api/website-form.
// nodemailer is replaced with a capturing fake: no network, no real email.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const sent = []; let failNext = false;
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'nodemailer') return { createTransport: () => ({ async sendMail(m) { if (failNext) { failNext = false; const e = new Error('down'); e.code = 'ECONNECTION'; throw e; } sent.push(m); return {}; } }) };
  return realLoad.call(this, req, ...rest);
};
const handler = require('../api/website-form.js');

Object.assign(process.env, {
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'u', SMTP_PASS: 'p',
  FORM_FROM_EMAIL: 'no-reply@example.test', FORM_TO_EMAIL: 'customercare@example.test', ALLOWED_ORIGIN: 'https://www.example.test',
});

let ipN = 1;
function post(fields, { origin = 'https://www.example.test', form = 'feedback' } = {}) {
  const req = { method: 'POST', headers: { origin, 'x-forwarded-for': '198.51.100.' + (ipN++) }, body: { form, url: 'https://www.example.test/#feedback', fields } };
  return new Promise((resolve) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j }); } };
    handler(req, res);
  });
}
const valid = { name: 'Test Person', email: 'test.person@example.test', type: 'Service experience', message: 'Fictional test: the onboarding call was rescheduled twice.' };

test('valid feedback is emailed to the existing inbox, then confirmed', async () => {
  sent.length = 0;
  const r = await post(valid);
  assert.equal(r.code, 200); assert.equal(r.body.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'customercare@example.test');
  assert.equal(sent[0].subject, 'ARIE Finance Feedback (Service experience) — Test Person');
  assert.equal(sent[0].replyTo, 'test.person@example.test');
  assert.match(sent[0].text, /Assess any expression of dissatisfaction against the ARIE Complaints Procedure/);
});

test('testimonial consent: unticked (field absent) is recorded as No and still submits', async () => {
  sent.length = 0;
  const r = await post({ ...valid, message: 'Fictional test: consent not given, distinct message one.' });
  assert.equal(r.body.ok, true);
  assert.match(sent[0].text, /Testimonial consent: No — do not use as a testimonial\./);
  assert.match(sent[0].html, /Testimonial consent/);
});
test('testimonial consent: ticked is recorded as Yes for this submission only', async () => {
  sent.length = 0;
  const r = await post({ ...valid, type: 'Compliment', message: 'Fictional test: consent given, distinct message two.', testimonial_consent: 'yes' });
  assert.equal(r.body.ok, true);
  assert.match(sent[0].text, /Testimonial consent: Yes — may be published on the website as a testimonial/);
  assert.match(sent[0].text, /Applies to this submission only\./);
});
test('testimonial consent: any other value is treated as No', async () => {
  sent.length = 0;
  await post({ ...valid, message: 'Fictional test: odd consent value, distinct message three.', testimonial_consent: 'maybe' });
  assert.match(sent[0].text, /Testimonial consent: No/);
});
test('no confirmation when delivery fails (retryable)', async () => {
  sent.length = 0; failNext = true;
  const r = await post({ ...valid, message: 'Fictional test: delivery failure path for feedback.' });
  assert.equal(r.code, 500); assert.equal(r.body.ok, false); assert.equal(sent.length, 0);
});

test('validation: name, email, type and message', async () => {
  assert.equal((await post({ ...valid, name: '' })).body.error, 'invalid_name');
  assert.equal((await post({ ...valid, email: 'nope' })).body.error, 'invalid_email');
  assert.equal((await post({ ...valid, type: 'Complaint' })).body.error, 'invalid_feedback_type');
  assert.equal((await post({ ...valid, message: 'short' })).body.error, 'invalid_message');
});

test('existing protections apply: honeypot, origin', async () => {
  sent.length = 0;
  const h = await post({ ...valid, hp_url: 'http://spam' });
  assert.equal(h.code, 200); assert.equal(sent.length, 0);
  assert.equal((await post(valid, { origin: 'https://evil.test' })).code, 403);
});

test('header injection in name is neutralised; HTML is escaped', async () => {
  sent.length = 0;
  await post({ ...valid, name: 'Eve\r\nBcc: x@evil.test', message: '<img src=x onerror=alert(1)> fictional test message' });
  assert.ok(!/[\r\n]/.test(sent[0].subject));
  assert.ok(!sent[0].html.includes('<img src=x'));
});

test('contact form unchanged: still accepted and routed', async () => {
  sent.length = 0;
  const r = await post({ fullname: 'Test Person', email: 'test.person@example.test', requirement: 'Fictional contact enquiry for regression.', topic: 'Open an account', tcs: 'on' }, { form: 'contact' });
  assert.equal(r.code, 200); assert.match(sent[0].subject, /^ARIE Finance Enquiry \(Open an account\)/);
});
