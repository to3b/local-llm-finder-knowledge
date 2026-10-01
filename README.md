# Local LLM Finder Knowledge

Static Knowledge site for **https://knowledge.localllmfinder.com/**.

The Finder remains at **https://localllmfinder.com/**. This repository is intentionally separate so model, hardware and guide pages can grow without complicating the main Finder deployment.

## Google Sheets content workflow

The published `localllmfinder.com database` workbook is the content manager for the Knowledge site.

- **Knowledge Copy** controls homepage copy.
- **Knowledge Pages** controls the homepage topic cards and permanent paths.
- **Knowledge Articles** contains full article content and SEO metadata.

A Knowledge Articles row is generated as a public static page only when:

1. `Enabled` is `TRUE`.
2. `Status` is `Published`.
3. The required article and SEO fields are complete.

Draft and Hold rows are not generated as site pages or included in the sitemap.

### Knowledge Articles fields

`Enabled`, `Type`, `Slug`, `Title`, `Summary`, `Body Markdown`, `Meta Title`, `Meta Description`, `Author`, `Date Published`, `Date Modified`, `Status`, `Canonical URL`, `Source URLs`, `Notes`.

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

The workbook is published to the web so the browser and GitHub Actions can read it without credentials. That means **draft article cells are not linked from the site, but their Sheet data should not be treated as confidential**. Use a separate private document/workbook for genuinely private drafts.

## GitHub Pages

Deploy from the `main` branch, repository root. The `CNAME` file declares `knowledge.localllmfinder.com` as the custom domain.

DNS should contain:

```text
Type: CNAME
Name: knowledge
Value: to3b.github.io
```

## Search / GSC

`robots.txt` advertises `https://knowledge.localllmfinder.com/sitemap.xml`. Only published article URLs are placed in the sitemap.

After the first article is published and the generated URL is publicly reachable, submit the sitemap in Google Search Console. A Domain property for `localllmfinder.com` covers the Knowledge subdomain; otherwise add the Knowledge URL-prefix property separately.
