The production source remains the Knowledge Articles sheet. Only Enabled rows
with Status Published are released. Draft rows remain outside production; Hold
rows are excluded. Invalid publication statuses stop the build before existing
pages are removed.

Models, GPUs and Quant Calibrations are read together through the main Finder’s
unchanged parsers. The same minimum catalogue coverage and calibration validation
apply. Recommendations call its `recommend` and `estimate` functions.
Hardware shortlists use task selection; model pages compare memory tiers using
the estimate. Neither establishes measured speed or output quality. Production
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

The owner approved the twelve-page review batch on 3 October 2026. `draft-batch.json`
records the selected slugs, source review and sandbox review descriptions;
`tests/fixtures/SandboxArticles.csv` contains a checked source snapshot of those
rows plus the twelve earlier published pages. This retains the pre-publication
states as an offline regression fixture; the live workbook controls publication.
`PREVIEW_DRAFT_SLUGS` limits the sandbox to this selected batch; it has no effect
in production. No other seeded drafts are released or advertised.

Published hardware shortlists continue to use published model subjects only.
Draft hardware pages can compare the selected draft models during review. A
production release automatically includes only model subjects whose source rows
are Published. The reviewed subject mappings and hardware runtime notes are
deployed together. Newly approved rows receive a publication date and Published
status only after the renderer passes release checks. The isolated publication test
uses a temporary CSV and never updates the live source statuses.

The approved hardware comparison selects its larger chat/coding alternatives
by page subject, not draft status. Its chosen model rows must be identical in
the checked sandbox and the published page. The regression test verifies this
across all six hardware pages; the main Finder still supplies fit and ordering.

Community/runtime GGUF conversions are labelled separately from publisher
downloads. The linked Q4 files can be smaller than conservative catalogue
weights. Q5 estimates do not imply a Q5 file exists in the linked repository.
The Gemma comparisons cover text only and exclude the vision projector. No
memory result asserts compatibility or measured speed for a particular backend.

Draft contribution links prefill the existing public form but omit `from`: the
live form must not offer a return to an unpublished production URL. Published
article invitations retain their normal Back to article behaviour.
