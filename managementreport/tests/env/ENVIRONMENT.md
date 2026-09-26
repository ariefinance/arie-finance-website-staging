# Pinned Regression Environment

The regression suite must run under an environment whose only sources of visual variance
are ones we can attribute, measure and (where possible) eliminate.

Anything outside this specification invalidates a baseline.

## Runtime

| Component | Pinned value |
|---|---|
| Node.js | 22.x (matches production Vercel runtime family) |
| Chromium | Bundled with `playwright@1.55.x` — actual version recorded in `baseline/manifest.json` on capture |
| Playwright | `1.55.x` (pinned in this directory's `package.json`) |
| SheetJS (`xlsx`) | The exact vendored copy at `managementreport/vendor/xlsx.full.min.js` — do NOT install a divergent copy from npm |

## Rendering

| Setting | Value |
|---|---|
| Viewport | 1280 × 720 |
| Device Scale Factor | 1 |
| `deviceScaleFactor` inside Playwright | 1 |
| `html2canvas` `scale` (existing) | 2 (unchanged) |
| Slide dimensions captured | 1280 × 720 per slide |
| Number of slides | Exactly 11 |
| Colour management | sRGB, `--force-color-profile=srgb` Chromium flag |
| Font smoothing | Chromium default; do not alter |
| Reduce motion | `prefers-reduced-motion: reduce` forced via emulation |

## Fonts

The production build loads **Hanken Grotesk** and **Newsreader** from Google Fonts (a remote source).
For regression, remote font versioning is not acceptable.

**Regression uses locally hosted copies** installed via the OFL-licensed npm packages
`@fontsource/hanken-grotesk` and `@fontsource/newsreader`. The Playwright harness intercepts
`fonts.googleapis.com` and `fonts.gstatic.com` requests and serves the local WOFF2s.

Before capture, the harness always awaits `document.fonts.ready`.

If those npm packages cannot be installed in the sandbox at Gate 1 execution time, that is
recorded as a Gate 1 blocker. Under no circumstances may the harness fall back to
system/substitute fonts silently.

## Network

- All XHR/fetch to `fonts.googleapis.com` / `fonts.gstatic.com` intercepted and served locally.
- All other outbound requests blocked at the Playwright route level.

## Determinism check

`npm run regress` runs the render step **three times** back-to-back on the same commit.
The three renders must be pixel-identical, or all three must fall within the documented tolerance.
Non-determinism between the three runs invalidates the baseline until the source of noise is identified.

## Tolerance

The default acceptance criterion is **exact normalised-pixel equality** per slide.
If exact equality is not achievable after eliminating controllable sources of variance,
a numerical `pixelmatch`-based threshold may be adopted, but only:

1. after the sources of variance are documented in `baseline/manifest.json`; and
2. with the threshold chosen as the smallest value that separates true equivalence from
   real report changes on the synthetic pack (empirically measured, not invented).

The `>25% variance mandatory confirmation` rejected in the spec has NO analogue here.

## Baseline lifecycle

A baseline is captured for a specific commit SHA of the tool (recorded in
`baseline/manifest.json`) using this pinned environment. Changing the environment (e.g.
upgrading Playwright, changing viewport, altering the font pack) invalidates the baseline
and requires a deliberate re-capture with sign-off.

## What this environment does NOT reproduce

- Windows / Safari / real production browsers used by ARIE staff. Regression protects
  the report *engine*; it does not certify visual identity across every possible viewer.
- Google Fonts version drift in production. Production renders use whatever Google Fonts
  serves at that moment; regression pins to the OFL-licensed local pack. The two must
  remain close enough that visual review of an actual report render still passes.
