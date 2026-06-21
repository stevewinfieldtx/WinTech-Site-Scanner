# Plan: Headless Rendering (Rendered-View Pass) — future release

## Why
The scanner reads **server HTML** and does not execute JavaScript. On client-rendered sites
(React/Next/Vue/Angular) the server often returns an almost-empty shell, so Content, SEO, AEO,
and Accessibility signals can be badly understated. We ship the **SPA-shell confidence guard**
today (detect the shell, mark those dimensions low-confidence, never confidently fail them). The
rendered pass is the real fix and **supersedes** that guard.

## The product angle (this is the selling point, not just a bug fix)
Most **AI crawlers do not run JavaScript** (GPTBot, ClaudeBot, PerplexityBot, etc.). So a site
whose H1/copy/schema only appear *after* JS is genuinely invisible to AI answers even though it
looks fine to a human and to Google (which does render). The deliverable is a **raw-vs-rendered
diff**:
> "Your H1 and product copy are present after JavaScript runs, but absent from the server HTML —
> so Google sees them, but ChatGPT and Perplexity do not."
That is a concrete, defensible AEO finding no competitor audit surfaces.

## Approach
- Add a **rendered pass** using Playwright (preferred) or Puppeteer with headless Chromium.
- Fetch the page twice: (1) current raw HTML fetch, (2) rendered DOM after `networkidle`.
- Re-run the existing signal extractors on the rendered DOM.
- Compute a **diff**: for each signal that is missing in raw but present in rendered (H1, meta,
  word count, schema, alt text, analytics), emit a finding tagged "visible to Google, hidden from
  non-JS AI crawlers."
- Scores use the rendered values; the raw-vs-rendered gap becomes its own finding.

## Cost / infra (why it's a deliberate release, not a quick win)
- Chromium adds ~300 MB to the image and real memory per render; Railway dynos must be sized up.
- A render is seconds slower than a fetch and can fail/timeout — needs a strict timeout + fallback
  to the raw-only path (degrade gracefully, never block a scan).
- Per-scan cost rises, so the rendered pass belongs in the **deep / paid tier** (and the scheduled
  monthly report), not the free instant scan.

## Rollout
1. **Phase 0 (done):** SPA-shell confidence guard + "content rendered by JavaScript" finding.
2. **Phase 1:** Add Playwright as an optional rendered pass behind a flag; raw-vs-rendered diff
   findings; size the dyno; hard timeout + fallback.
3. **Phase 2:** Gate it to the deep tier / monthly report; retire the low-confidence guard for
   rendered scans (keep it for the free raw-only tier).
4. **Phase 3 (optional):** viewport-based "above-the-fold" checks for Audience Intel (cognitive
   load), which only become possible once we render.

## Decisions to confirm before building
- Playwright vs Puppeteer (Playwright handles modern frameworks more reliably).
- Run in-process on Railway vs a separate small render microservice (isolates memory/cost).
- Which tier gets it, and whether free scans keep raw-only with the confidence guard.
