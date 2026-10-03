# Local LLM Finder Knowledge

Static, source-backed starting points for local model and hardware choices.
The main Finder handles personalised recommendations.

The publishing workflow reads Knowledge Articles plus the Models, GPUs and
Quant Calibrations catalogue. Enabled / Published rows are released; Draft and
Hold rows are excluded. Invalid source data fails before deleting published
pages. Existing model, hardware and guide URLs remain stable.

Run `npm test` for offline source and publishing checks. Run
`node scripts/build-articles.mjs` to build production pages. The workflow uses
current main Finder rules through `FINDER_SOURCE_ROOT`; the pinned copy supports
offline verification. CSV environment overrides support isolated testing.

`KNOWLEDGE_BUILD_MODE=sandbox` produces noindex pages and an empty sitemap.
`PREVIEW_PUBLISHED_ONLY=1` limits a sandbox build to published subjects.

See [recommendation-maintenance.md](recommendation-maintenance.md) for source
editing, evidence labels, assumptions, runtime requirements and subject review.
