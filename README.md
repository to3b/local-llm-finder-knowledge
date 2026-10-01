# Local LLM Finder Knowledge

Static Knowledge site for **https://knowledge.localllmfinder.com/**.

The Finder remains at **https://localllmfinder.com/**. This repository is intentionally separate so model, hardware and guide pages can grow without complicating the main Finder deployment.

## Google Sheets content workflow

The published `localllmfinder.com database` workbook is the content manager for the Knowledge site.

- **Knowledge Copy** controls homepage copy.
- **Knowledge Pages** controls the homepage topic cards and permanent paths.
- **Knowledge Articles** contains full article content and SEO metadata.

A Knowledge Articles row is generated as an available static page when:

1. `Enabled` is `TRUE`.
2. `Status` is `Draft` or `Published`.
3. Its required article fields are complete. Published rows also require `Date Published`.

Draft pages are publicly readable, labelled Draft, and use `noindex,follow`. They are excluded from the sitemap and Article structured data. Hold and disabled rows are not generated. Existing published pages remain indexable.

### Knowledge Articles fields

`Enabled`, `Type`, `Slug`, `Title`, `Summary`, `Body Markdown`, `Meta Title`, `Meta Description`, `Author`, `Date Published`, `Date Modified`, `Status`, `Canonical URL`, `Source URLs`, `Notes`, `Entity IDs`, `Related Articles`.

Types map to permanent paths:

- `Model` → `/models/<slug>/`
- `Hardware` → `/hardware/<slug>/`
- `Guide` → `/guides/<slug>/`

Article bodies use a deliberately small Markdown subset: paragraphs, `##` / `###` headings, bullet lists, inline code, bold text, and HTTPS Markdown links.

## Publishing

`.github/workflows/sync-knowledge.yml` checks the published Knowledge Articles tab twice an hour and can also be run manually. `scripts/build-articles.mjs` validates published rows and generates:

- static article HTML
- canonical and meta tags
- Article JSON-LD
- `sitemap.xml`
- homepage indexability state

When there are no published articles, the Knowledge homepage remains `noindex,follow`. Once at least one valid article is published, the build changes the homepage to `index,follow` and includes it in the sitemap.

Generated article directories are owned by the builder. Do not hand-edit files under `models/`, `hardware/`, or `guides/`; edit the Sheet instead.

## Draft privacy

The workbook is published to the web so the browser and GitHub Actions can read it without credentials. That means **enabled draft article cells and their generated pages are public and should not be treated as confidential**. Use a separate private document/workbook for genuinely private drafts.

## GitHub Pages

Deploy from the `main` branch, repository root. The `CNAME` file declares `knowledge.localllmfinder.com` as the custom domain.

DNS should contain:

```text
Type: CNAME
Name: knowledge
Value: to3b.github.io
```

## Search / GSC

`robots.txt` advertises `https://knowledge.localllmfinder.com/sitemap.xml`. Only published article URLs are placed in the sitemap. Drafts are linked from the directory and Finder for review, with a status filter in the directory.

After the first article is published and the generated URL is publicly reachable, submit the sitemap in Google Search Console. A Domain property for `localllmfinder.com` covers the Knowledge subdomain; otherwise add the Knowledge URL-prefix property separately.

## Review a public draft

1. Open Knowledge and choose **Drafts** in the Show filter, or use `?status=Draft`.
2. Open a page and use **Edit this draft** to jump to its exact Knowledge Articles row.
3. Edit Body Markdown, Summary and metadata; add primary source URLs and check the exact entity IDs.
4. Update Date Modified while editing. Leave Date Published blank until the reference is ready.
5. Fill Date Published in YYYY-MM-DD and choose Published to make the page indexable and include it in the sitemap. Hold or Enabled FALSE removes the generated page.

The scheduled sync rebuilds the site twice an hour. Check the deployed page after a sync. Drafts seeded from the catalogue contain provisional planning inputs and a review checklist; they are not reviewed model or hardware benchmarks.
