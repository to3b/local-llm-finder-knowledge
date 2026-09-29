# Local LLM Finder Knowledge

Static Knowledge site for **https://knowledge.localllmfinder.com/**.

The Finder remains at **https://localllmfinder.com/**. This repository is intentionally separate so model, hardware and guide pages can grow without complicating the main Finder deployment.

## Current state

The root page is a `noindex,follow` development preview. It should remain out of search until substantive Knowledge pages are ready.

## GitHub Pages

Deploy from the `main` branch, repository root. The `CNAME` file declares `knowledge.localllmfinder.com` as the custom domain.

DNS should contain:

```text
Type: CNAME
Name: knowledge
Value: to3b.github.io
```

Once the subdomain is serving correctly, update the main Finder repository to link directly to `https://knowledge.localllmfinder.com/` and retire the old `/knowledge.html` preview.

## Search

Do not add the preview root to a sitemap while it is `noindex`. Add a Knowledge sitemap when the first substantive model/hardware/guide pages are published and indexable.
