# Publishing and connecting references

The `Knowledge Articles` sheet is the source of article content. The builder emits the homepage, articles, sitemap and `references.json` together. Only Enabled + Published rows are emitted. The static homepage lists every published article automatically; adding a separate Knowledge Pages row is no longer necessary. Knowledge Copy/Pages remain legacy sheets and do not control the generated directory.

## Matching Finder items

Set optional `Entity IDs` to exact Model ID(s) from Models or GPU ID(s) from GPUs, separated by commas/newlines. Qwen2.5-Coder 14B uses `model-11`. IDs must be unique per reference type. Guides have no entity IDs. Do not change catalogue IDs merely to match article slugs. Finder fetches the deployed reference registry; a missing registry hides reference links without interrupting recommendations.

## Wiki links and relationships

Use `[[guides/q4-vs-q5|Q4 vs Q5]]` in Body Markdown. The type directory is required: models, hardware or guides. Links resolve only to published pages; unpublished targets render as plain text. Set optional `Related Articles` to comma/newline-separated type/slug paths. Explicit relations and inline wiki links produce related-reference lists and backlinks when their targets are published. Existing absolute Markdown links to Knowledge articles are recognised too.

Article heading contents navigation and category breadcrumbs are generated automatically. Categories on the homepage are Models, Hardware and Guides, with search across titles and summaries. Empty categories say no references are published yet. No placeholder pages are generated.

## Publishing

Populate the existing article/SEO fields, dates in YYYY-MM-DD, exact canonical URL, author and source URLs. Keep Status Draft until publication is authorised. Enabled TRUE + Status Published makes the row eligible for the twice-hourly sync (`17,47 * * * *`) or a manual workflow run. Dates must use YYYY-MM-DD. One invalid published row fails the build before existing generated files are replaced. Check Actions and the live article after publishing; sheet status alone is not deployment confirmation. The public workbook is not suitable for confidential drafts.

`models/`, `hardware/`, `guides/`, `index.html`, `references.json` and `sitemap.xml` are generated outputs. Edit the Sheet or builder, not generated HTML. CSS and scripts are hand-maintained. Run `node tests/wiki.test.mjs`. For offline builds set ARTICLES_CSV to a fixture CSV and SITE_ROOT to a disposable output folder.
