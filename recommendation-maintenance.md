The production source remains the Knowledge Articles sheet. Only Enabled rows
with Status Published are released. Draft rows remain outside production; Hold
rows are excluded. Invalid publication statuses stop the build before existing
pages are removed.

Models, GPUs and Quant Calibrations are read together through the main Finder’s
unchanged parsers. The same minimum catalogue coverage and calibration validation
apply. Recommendations call its `recommend` and `estimate` functions. Production
CI checks out `to3b/local-llm-finder` at main for each build. The byte-pinned copy
in `scripts/finder` supports offline checks and records its original commit.

The model-to-hardware and hardware-to-model renderers use source-backed subjects
that already have published guides. `subjects` in recommendation-pages.mjs maps
these reviewed article slugs to existing Model IDs and brief task descriptions.
When a new subject is reviewed, add its mapping and primary download source.
Hardware IDs come directly from Knowledge Articles. No new scoring algorithm or
hardware compatibility list is maintained here.

Article text, titles, sources, dates and related links remain editable in the
same sheet. On model and hardware pages, Body Markdown is supporting information:
each level-two heading becomes a separately expandable topic. Keep each topic
focused on one setup decision, runtime requirement or troubleshooting question.
The opening answer and comparison tables already cover memory fit; do not repeat
their catalogue figures in these notes. Keep longer explanations in the guides.
Catalogue edits update the tables on the scheduled build. Update the article’s
Date Modified and source review when a material specification changes; builds
must not claim fresh source verification merely because they ran again.

Q4_K_M at 4,000 tokens, 32 GB host RAM, one active request and full GPU residency
are the common starting assumptions. Memory tiers are estimates. The more
comfortable tier leaves at least 2 GB after the Finder’s estimate and reserve.
The gpt-oss native MXFP4 planning profile uses the existing Q4 calculation slot;
generic Q5 and Q8 extrapolations are not presented as verified native artifacts.

No performance measurements are eligible for publication yet. Pending, synthetic,
rejected or private reports are not inputs to the public pages. The existing form
and submission service are unchanged; test the UI without posting live reports.

The sandbox build is separate: every HTML page is noindex, and its sitemap is
empty. Production sitemaps contain only published canonical article URLs, with
no finder filters or preview addresses. Legal page copy is not changed.
