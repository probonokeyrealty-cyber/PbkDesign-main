# Property photo quality

The cache contains small Realtor CDN renditions ending in `-m<photo-id>s.jpg`.
Source probes returned 120×80 pixels for thumbnails, while larger renditions of
the same photo returned 1013–1081×720 pixels across three sampled images.

The existing shared Analyzer/CRM gallery now requests the same photo identity at
`od-w1920_h1440.webp` for the main image. Existing small thumbnails remain the
navigation images. Saved photo references stay unchanged, so existing CRM deals
benefit without a migration, resave, new address lookup or provider job.

The gallery falls back to the saved source URL if the larger rendition fails;
only failure of both removes the photo. A failed thumbnail does not discard a
working main image. Full-size link wording follows actual loaded dimensions,
and low-resolution sources retain the existing honest preview label. Image keys
isolate late load/error events while switching photos. No PBK layout, CSS,
underwriting, CRM writes or approval behavior changed.

Verification: `npm run test:property-photo-quality`, existing CRM evidence
browser regressions, build, typecheck, focused lint, isolated hosted/runtime
smoke, lead route and Analyzer source checks. Browser cases cover desktop,
390px WebKit and 320px Chromium, larger-image failure, both-image failure,
thumbnail-only failure, rapid switching, full-size links and no business writes.
Independent review found no material issues; its thumbnail coverage suggestion
was added. Source resolution remains limited by the photographs available from
the existing listing provider; this is not generated or artificially upscaled
property imagery.
