// /eligibility — shareable entry to the Check Your Eligibility experience.
//
// Serves the normal site (index.html) with eligibility-specific title and
// social-preview metadata, so WhatsApp, LinkedIn, email clients etc. show
// "ARIE Finance — Check Your Eligibility" instead of the homepage preview
// (crawlers never see the "#eligibility" part of a URL). A one-line script
// then adds "#eligibility" so the existing single-page router opens the
// checker directly. No redirect: the visitor's referrer and any UTM
// parameters are preserved for analytics. No second application.
const fs = require('fs');
const path = require('path');

const URL_ = 'https://www.ariefinance.com/eligibility';
const TITLE = 'ARIE Finance — Check Your Eligibility';
const DESC = 'Complete a preliminary business eligibility check, explore indicative pricing and understand the next steps.';
const IMAGE = 'https://www.ariefinance.com/assets/og-eligibility.jpg';

let cached = null;
function attr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

function build(html) {
  const swaps = [
    [/<title>[^<]*<\/title>/, '<title>' + TITLE + '</title>'],
    [/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + attr(DESC) + '">'],
    [/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + URL_ + '">'],
    [/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + URL_ + '">'],
    [/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + attr(TITLE) + '">'],
    [/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + attr(DESC) + '">'],
    [/<meta property="og:image" content="[^"]*">/, '<meta property="og:image" content="' + IMAGE + '">'],
    [/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + attr(TITLE) + '">'],
    [/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + attr(DESC) + '">'],
    [/<meta name="twitter:image" content="[^"]*">/, '<meta name="twitter:image" content="' + IMAGE + '">'],
  ];
  let out = html;
  for (const [re, val] of swaps) {
    if (!re.test(out)) throw new Error('eligibility-page: tag not found ' + re);
    out = out.replace(re, val);
  }
  // Open the checker: add the route hash before the router runs (keeps path, query and referrer).
  out = out.replace('<head>', '<head>\n<script>if(!location.hash){history.replaceState(null,"",location.pathname+location.search+"#eligibility");}</script>');
  return out;
}

module.exports = (req, res) => {
  try {
    if (!cached) cached = build(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Edge-cached per deployment; a new deployment always serves fresh HTML.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
    res.status(200).send(cached);
  } catch (e) {
    // Never strand a visitor: fall back to the homepage route.
    res.setHeader('Cache-Control', 'no-store');
    const q = String(req.url || '').split('?')[1];
    res.writeHead(302, { Location: '/' + (q ? '?' + q : '') + '#eligibility' });
    res.end();
  }
};
module.exports.__build = build;
