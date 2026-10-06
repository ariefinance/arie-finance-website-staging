# Publishing an ARIE Insights article

ARIE Insights is a **manual, static** blog. No CMS, no build step, no database.
Each article is a plain HTML folder served by Vercel, exactly like the other
standalone ARIE pages (Pricing, Onboarding Requirements, Management Report).

Target cadence: ~2 articles/month. The steps below take a few minutes.

> **Content gate:** only publish articles whose text has passed ARIE's factual
> and compliance review. The folder `_template/` and the file `_email-template.html`
> are infrastructure, not articles — they are `noindex` and excluded from the sitemap.

---

## Files in this section

```
insights/
  index.html            Public listing (/insights/). Edit to add article entries.
  insights.css          Shared styles for the listing AND every article. Edit once.
  assets/
    arie-logo.svg        Colour logo (header)
    arie-logo-white.svg  White logo (footer)
  _template/index.html  Copy this to make a new article. noindex.
  _email-template.html  Email reference for the future "Copy Formatted Email". noindex.
  PUBLISHING.md         This file.
```

---

## Step 1 — Create the article page

1. Copy `insights/_template/` to `insights/<slug>/` where `<slug>` is the URL,
   lowercase-with-dashes (e.g. `understanding-swift-payments`).
2. Open `insights/<slug>/index.html` and:
   - Replace every `{{TOKEN}}`:
     - `{{TITLE}}`, `{{SUMMARY}}`, `{{CATEGORY}}` (Guides | Updates | ARIE News)
     - `{{SLUG}}`
     - `{{PUBLISHED_ISO}}` (e.g. `2026-10-05`) and `{{PUBLISHED_HUMAN}}` (e.g. `5 October 2026`)
   - Change the robots meta from `noindex, follow` to
     `index, follow, max-image-preview:large`.
   - Delete the `<style>` block and the `<div class="tpl-banner">` line.
   - Write the article inside `<div class="article-body">` using plain
     `<h2> <h3> <p> <ul> <ol> <blockquote> <table> <strong> <em> <a>`.
     Wrap any table in `<div class="ins-article__tablewrap">…</div>`.
   - Fill the JSON-LD values at the bottom (`dateModified` = `datePublished`).

**Publication date** is whatever you type on first publish — assign it the day it
goes live. **Last Reviewed**: leave it out on first publish. Only for **Guides**,
after a genuine later review, follow the comment in the template to add the
`Last reviewed …` line (only when the review date is later than the published date).

**Optional image:** uncomment the `<figure>` block; `alt` text is required.

---

## Step 2 — Add it to the listing (`insights/index.html`)

The newest article is the **Latest Insight**; all older ones are **list items**.

- Remove the `<section class="ins-empty">…</section>` block the first time.
- Put the newest article in the Latest-Insight block; demote the previous newest
  to the top of the list. Copy-paste markup is in the comment inside `index.html`:

```html
<!-- newest -->
<section class="ins-latest">
  <div class="ins-latest__inner">
    <span class="ins-eyebrow">Latest Insight</span>
    <a class="ins-latest__card" href="/insights/<slug>/">
      <span class="ins-cat">Guides</span>
      <h2>Article title</h2>
      <p>Two-sentence summary.</p>
      <span class="ins-date">5 October 2026</span>
    </a>
  </div>
</section>

<!-- older, newest first -->
<section class="ins-list">
  <div class="ins-list__inner">
    <a class="ins-item" href="/insights/<slug>/">
      <span class="ins-cat">Updates</span>
      <h2>Article title</h2>
      <p>Two-sentence summary.</p>
      <span class="ins-date">28 September 2026</span>
    </a>
  </div>
</section>
```

---

## Step 3 — Update the homepage "Latest Insights" (three newest)

The homepage (`/index.html`) is the main marketing single-page site. Add/refresh a
self-contained **Latest Insights** block showing the three newest articles.

Insertion point: inside the home view only. Find it with
`grep -n 'data-page="home"' index.html`, then paste the block immediately before the
`</section>` that closes that `data-page="home"` section (so it shows on Home only).
This block is self-contained (its own inline styles) and does not depend on
`insights.css`:

```html
<!-- ===== LATEST INSIGHTS (home only) — keep to the 3 newest ===== -->
<section style="background:#F9F6EF;padding:56px 24px;">
  <div style="max-width:1080px;margin:0 auto;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px;">
      <h2 style="font-family:'Newsreader',Georgia,serif;font-size:28px;font-weight:400;color:#06113A;margin:0;">Latest Insights</h2>
      <a href="/insights/" style="font-size:14px;font-weight:600;color:#06113A;text-decoration:none;">View all insights &rarr;</a>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;">
      <!-- one card per article, newest first (max 3) -->
      <a href="/insights/<slug>/" style="display:block;text-decoration:none;background:#fff;border:1px solid #E8E4DA;border-radius:6px;padding:22px;">
        <span style="font-family:'Hanken Grotesk',sans-serif;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6B5D30;display:block;margin-bottom:8px;">Guides</span>
        <span style="font-family:'Newsreader',Georgia,serif;font-size:19px;font-weight:500;color:#06113A;line-height:1.3;display:block;margin-bottom:8px;">Article title</span>
        <span style="font-size:13px;color:#6B6456;">5 October 2026</span>
      </a>
    </div>
  </div>
</section>
```

> The homepage already links to `/insights/` from the header nav and footer. The
> block above is intentionally **not live yet** (there are no articles). Add it with
> the first published article.

---

## Step 4 — Sitemap

In `/sitemap.xml` add one `<url>` for the new article (template is in the file):

```xml
<url>
  <loc>https://www.ariefinance.com/insights/<slug>/</loc>
  <changefreq>monthly</changefreq>
  <priority>0.6</priority>
</url>
```

Never add `_template/` or any unpublished page.

---

## Step 5 — Commit, push, done

Commit the new folder and the edits to `insights/index.html`, `index.html`
(homepage) and `sitemap.xml`. Vercel deploys automatically. Verify the article URL
loads, is readable with JavaScript disabled, and appears on `/insights/`.

---

## Unpublishing

Delete the article folder (or set its robots meta back to `noindex`), remove its
entry from `insights/index.html`, the homepage block and `sitemap.xml`, then commit.

---

## Sharing by email (future "Copy Formatted Email")

`_email-template.html` is the approved email layout. For now a relationship manager
can open it, replace `{{TITLE}}`, `{{SUMMARY}}` and `{{ARTICLE_URL}}`, copy the
rendered email, paste into Outlook/Gmail, add a personal note and send. Subject line:
`ARIE Insights: <title>`. A one-click "Copy Formatted Email" button can be added
later; the template is already structured for it. No email platform is involved.
