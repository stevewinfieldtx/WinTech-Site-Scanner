const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TabStopType,
  HeadingLevel, BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber
} = require('docx');

const ACCENT="4F46E5", DARK="1E1B4B", H2COL="3730A3", INK="111827", MUTE="6B7280";
const CW = 9360;

const P = (text, opts={}) => new Paragraph({
  spacing: { after: opts.after ?? 150, line: 276, ...(opts.before?{before:opts.before}:{}) },
  children: [ new TextRun({ text, size: opts.size ?? 22, italics: opts.italics, bold: opts.bold, color: opts.color ?? INK }) ],
});
const LEAD = (label, text) => new Paragraph({ spacing:{after:150,line:276},
  children:[ new TextRun({text:label+" ",bold:true,color:DARK,size:22}), new TextRun({text,size:22,color:INK}) ] });
const H1=(t)=>new Paragraph({heading:HeadingLevel.HEADING_1,children:[new TextRun(t)]});
const H2=(t)=>new Paragraph({heading:HeadingLevel.HEADING_2,children:[new TextRun(t)]});
const H3=(t)=>new Paragraph({heading:HeadingLevel.HEADING_3,children:[new TextRun(t)]});
const bullet=(t)=>new Paragraph({numbering:{reference:"b",level:0},spacing:{after:80,line:264},children:[new TextRun({text:t,size:22,color:INK})]});
const border={style:BorderStyle.SINGLE,size:1,color:"D1D5DB"};
const borders={top:border,bottom:border,left:border,right:border};
function cell(text,w,{head=false}={}){ return new TableCell({ borders, width:{size:w,type:WidthType.DXA},
  shading:{fill:head?DARK:"FFFFFF",type:ShadingType.CLEAR}, margins:{top:70,bottom:70,left:120,right:120}, verticalAlign:VerticalAlign.CENTER,
  children:[new Paragraph({children:[new TextRun({text,bold:head,color:head?"FFFFFF":INK,size:20})]})] }); }
function table(headers,rows,widths){ const hr=new TableRow({tableHeader:true,children:headers.map((h,i)=>cell(h,widths[i],{head:true}))});
  const br=rows.map(r=>new TableRow({children:r.map((c,i)=>cell(String(c),widths[i]))}));
  return new Table({width:{size:CW,type:WidthType.DXA},columnWidths:widths,rows:[hr,...br]}); }
const spacer=(h=80)=>new Paragraph({spacing:{after:h},children:[]});
const callout=(label,text)=>new Paragraph({ shading:{type:ShadingType.CLEAR,fill:"EEF2FF"}, spacing:{before:180,after:180,line:276}, border:{ left:{style:BorderStyle.SINGLE,size:18,color:ACCENT,space:14}, top:{style:BorderStyle.SINGLE,size:2,color:"C7D2FE",space:8}, bottom:{style:BorderStyle.SINGLE,size:2,color:"C7D2FE",space:8}, right:{style:BorderStyle.SINGLE,size:2,color:"C7D2FE",space:8} }, children:[ new TextRun({text:label?(label+"  "):"",bold:true,color:ACCENT,size:22}), new TextRun({text,italics:true,bold:true,color:DARK,size:23}) ] });

const cover=[
  new Paragraph({spacing:{before:600,after:60},children:[new TextRun({text:"TECHNICAL WHITE PAPER",bold:true,color:ACCENT,size:20})]}),
  new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:6,color:ACCENT,space:6}},spacing:{after:260},children:[]}),
  new Paragraph({spacing:{after:120},children:[new TextRun({text:"Website Intelligence",bold:true,color:DARK,size:60})]}),
  new Paragraph({spacing:{after:260},children:[new TextRun({text:"A Methodology for Measuring Website Health, Discoverability, Revenue Risk — and Audience Alignment",color:H2COL,size:30,bold:true})]}),
  P("How the WinTech scanner measures a website across eleven dimensions, calculates every score in the open, benchmarks a site against its competitors, and now explains each result in plain language — plus Audience Intel, a companion analysis that judges whether a site’s intended customer and its actual goal are in sync. With the honest limits of both.",{size:24,color:MUTE}),
  spacer(240),
  new Paragraph({spacing:{after:40},children:[new TextRun({text:"WinTech Partners",bold:true,color:INK,size:24})]}),
  new Paragraph({children:[new TextRun({text:"WinTech Website Intelligence + Audience Intel  ·  Version 2.3  ·  June 2026",color:MUTE,size:20})]}),
  new Paragraph({pageBreakBefore:true,children:[]}),
];

const toc=[ H1("Contents"),
  ...["1.  Executive Summary","2.  The Problem: Your Website Is Revenue Infrastructure","3.  The Eleven-Dimension Framework","4.  What We Measure, and Why","5.  Scoring Methodology","6.  Data Sources and Signals","7.  Findings and Prioritization","8.  Competitive Benchmarking","9.  Revenue Impact Modeling","10. Audience Intel: Is the Website Aimed at the Right Customer?","11. The Scanner's Own Security Posture","12. Honest Limitations and How to Interpret Results","13. Turning Your Report Into a Plan","14. Conclusion","Appendix A — Scoring Reference Tables","Appendix B — Benchmark Sources"]
    .map(t=>new Paragraph({spacing:{after:90},children:[new TextRun({text:t,size:22,color:INK})]})),
  new Paragraph({pageBreakBefore:true,children:[]}),
];

const body=[]; const add=(...x)=>x.forEach(e=>body.push(e));

add(H1("1.  Executive Summary"));
add(P("For fifteen years, website quality meant SEO: title tags, meta descriptions, and links aimed at Google’s ten blue results. That model just broke. Buyers now begin their research by asking an AI — ChatGPT, Perplexity, Gemini. These engines do not rank pages; they read them, extract facts, and synthesize an answer that may never produce a click. If your site is not machine-readable, you are no longer merely ranked lower — you can be invisible. Meanwhile most websites are still judged subjectively, by opinion and aesthetics, rather than measured against the signals that now decide whether a business is found, trusted, and chosen."));
add(P("The WinTech Website Intelligence Scanner replaces opinion with measurement. It evaluates a site across eleven weighted dimensions — SEO Fundamentals, AEO / AI Readiness, Technical Performance, Security, Accessibility, Content Quality, Trust & Conversion, Best Practices, Privacy & Compliance, Internationalization, and Analytics & Measurability — using real signals pulled directly from the live site and from independent third-party authorities. It returns a transparent 0–100 health score, a prioritized list of findings, a head-to-head comparison against named competitors, and a benchmark-based estimate of the revenue at stake."));
add(P("Two recent additions make the audit more useful and more balanced. Alongside its findings, every report now surfaces strengths — the dimensions a site already handles well — so the assessment reads as balanced rather than a list of complaints. And every dimension’s score can be opened to a plain-language WinTech Insight, written for that specific site, that explains why it scored what it did and the single most valuable next step."));
add(P("The platform also runs a second, complementary analysis. Where the audit asks whether a website is built well, Audience Intel asks a different question — is it aimed at the right customer, and is what it is trying to do clear? Section 10 documents how that works."));
add(P("This paper documents exactly what we measure, how each dimension is scored, where the data comes from, how the competitive comparison and the revenue model are constructed, and — just as importantly — the limits of what an automated audit can and cannot tell you. We believe methodology should be inspectable. A score you cannot interrogate is a score you cannot trust."));
add(callout("Core principle —","A score you cannot interrogate is a score you cannot trust."));

add(H1("2.  The Problem: Your Website Is Revenue Infrastructure"));
add(P("Look closely at that break, because it is the most disruptive shift to hit websites in fifteen years. For most of that time, “website quality” was largely synonymous with SEO — title tags, meta descriptions, and links aimed at Google's ten blue results — and that model is now fracturing fast. Buyers increasingly begin research not with a search box but with a question posed to an AI assistant — ChatGPT, Perplexity, Google's AI Overviews, Gemini. These systems do not rank pages; they read them, extract entities and facts, and synthesize an answer that may never produce a click. If a site is not machine-readable — if it lacks structured data stating, unambiguously, who the company is, what it sells, and what it knows — it can be invisible to the very tools shaping the buyer's shortlist."));
add(P("We call this Answer Engine Optimization (AEO), and we treat it as a first-class dimension alongside traditional SEO. The shift does not retire the fundamentals; an H1 tag and a meta description still matter. It adds a new layer: schema markup, the emerging llms.txt standard (a file that tells AI crawlers which content to prioritize), and content an AI can confidently cite."));
add(P("Two older pressures have intensified in parallel. Security and privacy have become procurement gates: B2B buyers, especially in regulated industries, run lightweight checks on vendors before the first call, and a site with zero security headers — or trackers firing with no consent banner — can be silently disqualified. And conversion, supported by accessibility and the ability to measure, remains the difference between a website that merely informs and one that earns. Our framework measures all of these pressures together, because a prospect experiences them together."));

add(H1("3.  The Eleven-Dimension Framework"));
add(P("The overall health score is a weighted average of eleven dimensions, each scored independently from 0 to 100. The weights reflect commercial impact rather than equal billing: search and AI discoverability together (SEO + AEO = 28%), the security and privacy baseline (18%), and accessibility (10%) carry the most weight, because they most directly gate whether a prospect finds you, trusts you, and can use what they find."));
add(spacer(60));
add(table(["Dimension","Weight","What it answers"],[
  ["SEO Fundamentals","16%","Can traditional search engines find and understand it?"],
  ["AEO / AI Readiness","12%","Can AI answer engines read and cite it?"],
  ["Technical Performance","12%","Does it load fast and cleanly?"],
  ["Security","12%","Does it meet the baseline a cautious buyer expects?"],
  ["Accessibility","10%","Can everyone — and assistive technology — use it?"],
  ["Content Quality","8%","Is there enough substance to rank and to persuade?"],
  ["Trust & Conversion","8%","Does it capture interest and signal legitimacy?"],
  ["Best Practices","6%","Is the site technically well-maintained?"],
  ["Privacy & Compliance","6%","Are privacy and consent handled lawfully?"],
  ["Internationalization","5%","Can it serve a global, multilingual audience?"],
  ["Analytics & Measurability","5%","Can the business measure any of this?"],
  ["Overall","100%","A single, weighted measure of website health."],
],[3400,1200,4760]));
add(P("A note on weighting. SEO Fundamentals (16%) carries slightly more weight than AEO / AI Readiness (12%), even though AEO is the higher-growth risk — and the reason is deliberate. SEO is the prerequisite gating factor: AI answer engines reach your content through the same crawlable foundation that search engines use, so if the baseline is broken (an unreachable page, a blocked crawler, malformed HTML), no amount of schema markup makes you citable. AEO is weighted as the fastest-rising risk on top of a foundation that has to exist first."));

add(H1("4.  What We Measure, and Why"));
add(H3("SEO Fundamentals (16%)"));
add(LEAD("What we check:","the title tag and its length, the meta description, exactly one H1, the canonical URL, Open Graph and Twitter Card tags, image alt-text coverage, viewport and language declarations, heading hierarchy, internal linking, robots.txt, and an XML sitemap."));
add(LEAD("Why it matters:","these are the signals search engines have expected for over a decade. A missing H1 leaves a crawler with no clear statement of what the page is about; absent Open Graph tags, every LinkedIn share renders blank. It is table stakes a competitor has likely already met."));
add(H3("AEO / AI Readiness (12%)"));
add(LEAD("What we check:","structured data — JSON-LD, microdata, and RDFa — and the specific schema types present (Organization, FAQ, HowTo, Breadcrumb), and the presence of an llms.txt file that tells AI systems which content is authoritative and citable."));
add(LEAD("Why it matters:","structured data is how a machine reads your business. Without it, an AI answering a question about your category has no machine-readable reason to mention you — even when you are the best answer."));
add(LEAD("AI crawler access:","we also read robots.txt for the AI crawlers themselves — GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, CCBot. A site can be perfectly structured for AI and still be invisible because it is quietly telling those crawlers to stay out; we surface that as a high-value finding."));
add(LEAD("Rendered vs. raw:","for JavaScript-built sites, an optional headless pass compares the server HTML against the fully rendered page. When key signals — an H1, the body copy, schema — appear only after JavaScript runs, we flag it: Google renders JavaScript and sees them, but most AI crawlers do not, so that content is invisible to AI answers."));
add(H3("Technical Performance (12%)"));
add(LEAD("What we check:","server response time (time to first byte), total load time, page weight, stylesheet and script counts, render-blocking JavaScript, image lazy-loading, the Lighthouse mobile performance score when available, and Chrome’s real-user (CrUX) field data — actual Largest Contentful Paint, Interaction to Next Paint, and Cumulative Layout Shift from real visitors — when Google returns it."));
add(LEAD("Why it matters:","speed is both a ranking signal and a conversion tax; each additional second of load measurably increases bounce. These are also among the cheapest fixes — usually configuration, not redesign."));
add(H3("Security (12%)"));
add(LEAD("What we check:","a valid SSL certificate, the six recommended security headers (HSTS, Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), a security.txt disclosure file (RFC 9116), an independent Mozilla HTTP Observatory grade when reachable, and a check for mixed content — insecure http resources loaded by an https page."));
add(LEAD("Why it matters:","security headers are inexpensive to add and conspicuous when missing. A security-conscious prospect can read them in seconds, and in enterprise, financial-services, and healthcare procurement, zero configured headers can end a conversation before it begins."));
add(H3("Accessibility (10%)"));
add(LEAD("What we check:","image alt-text coverage, form-field labels, semantic landmarks (<main>, <nav>, <header>, <footer> or ARIA roles), heading structure, descriptive link text, the declared page language, and the Lighthouse accessibility score when available."));
add(LEAD("Why it matters:","accessibility is simultaneously an inclusion obligation and a legal exposure. ADA-related web lawsuits have risen sharply and overwhelmingly target these exact gaps. The same fixes also improve usability and SEO for every visitor."));
add(H3("Content Quality (8%)"));
add(LEAD("What we check:","word count against an 800-word reference for a substantive homepage, heading structure, alt-text coverage, and internal-linking depth."));
add(LEAD("Why it matters:","thin content gives neither search engines nor AI systems enough to understand and rank you, and gives human visitors too little to build confidence. Content is the compounding asset whose returns grow over time."));
add(H3("Trust & Conversion (8%)"));
add(LEAD("What we check:","lead-capture forms, visible contact details (phone and email), social-profile links, a privacy-policy link, a mobile viewport, and a favicon."));
add(LEAD("Why it matters:","traffic without capture is a leak. A homepage with nothing to fill in and no legitimacy signals turns curiosity into a closed tab."));
add(H3("Best Practices & Tech Hygiene (6%)"));
add(LEAD("What we check:","HTTPS, a declared character encoding, a standards-mode doctype, a mobile viewport, a favicon, the Lighthouse best-practices score — which surfaces console errors, deprecated APIs, and known-vulnerable libraries — and a sample check for broken internal links."));
add(LEAD("Why it matters:","these are the quiet hygiene signals that separate a maintained site from a neglected one. None is glamorous; collectively they shape how browsers, crawlers, and careful buyers judge whether the site is looked after."));
add(H3("Privacy & Compliance (6%)"));
add(LEAD("What we check:","a linked privacy policy, terms of service, and a cookie-consent mechanism — cross-checked against whether trackers are actually loading."));
add(LEAD("Why it matters:","a privacy policy is a baseline legal expectation and an ad-platform requirement. Loading trackers without a consent mechanism is a live compliance risk under GDPR and CCPA, and is increasingly part of the same vendor due-diligence that scrutinizes security."));
add(H3("Internationalization & Localization (5%)"));
add(LEAD("What we check:","a declared page language, character encoding, hreflang annotations and how many locale alternates exist, and text-direction support."));
add(LEAD("Why it matters:","this is the measurable core of whether you can serve a global, multicultural audience. If you sell — or intend to sell — across languages or regions, these signals decide whether search engines route each visitor to the right version. We deliberately measure readiness here, not a subjective sense of culture, which a machine cannot grade credibly."));
add(H3("Analytics & Measurability (5%)"));
add(LEAD("What we check:","whether any analytics or tag manager is installed (GA4, GTM, Plausible and others), whether a conversion or advertising pixel is present, and whether behavioral or heatmap tooling is in place."));
add(LEAD("Why it matters:","a site that cannot measure cannot improve. Without analytics, every change in this report is a guess with no scoreboard. It is the one dimension that gates the value of all the others — which is why most audits' silence on it is a real omission."));

add(H1("5.  Scoring Methodology"));
add(P("Each dimension is scored independently from 0 to 100 by awarding points for the presence and quality of specific signals; the eleven are then combined into a single weighted score. We publish the point allocations (Appendix A) on principle: a score you cannot inspect is a score you cannot trust."));
add(P("Two ideas govern the scoring. First, partial credit: a signal that exists but is imperfect earns some points, not zero — the goal is to guide improvement, not to punish. Second, thresholds reflect best practice rather than perfection. Where Google's Lighthouse provides an independent, audited score — for performance, accessibility, and best practices — the scanner uses it directly and falls back to its own HTML-level signals only when Lighthouse is unavailable."));
add(P("The overall score maps to a letter grade. The bands are deliberately demanding in the middle: most functional-but-unoptimized sites land in the C–D range, which is precisely where the highest-leverage, lowest-effort fixes live."));
add(spacer(60));
add(table(["Grade","Score range","Typical meaning"],[
  ["A","90–100","Elite. Optimized across nearly every dimension — protect the lead."],
  ["B","80–89","Strong. Minor, targeted gaps are all that separate you from elite."],
  ["C","60–79","Leaving money on the table. Functional, but clear, high-leverage gaps are suppressing discoverability and trust."],
  ["D","40–59","Commercially vulnerable. Competitors are winning the prospects you should be capturing."],
  ["F","0–39","Largely invisible to search and AI. Foundational fixes are needed before anything else compounds."],
],[1200,1800,6360]));

add(H1("6.  Data Sources and Signals"));
add(P("The scanner measures; it does not guess. Signals are gathered in parallel, directly from the live site and from independent authorities:"));
add(bullet("The page's own HTML, fetched and parsed to read tags, headings, schema (JSON-LD, microdata, and RDFa), links, content, form labels, landmarks, analytics tags, and consent mechanisms."));
add(bullet("HTTP response headers, read straight from the server, for security configuration."));
add(bullet("The TLS certificate, validated for the SSL check."));
add(bullet("Google PageSpeed Insights (Lighthouse) for mobile performance, accessibility, and best-practice scores — plus Chrome’s real-user CrUX field data — when the API responds."));
add(bullet("Mozilla's HTTP Observatory (MDN) for an independent security grade when reachable, with an Observatory-style grade computed in-house from the response headers as a deterministic fallback."));
add(bullet("robots.txt — including the directives aimed at AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) — the XML sitemap, llms.txt, and security.txt, each fetched and validated."));
add(bullet("Optionally, a headless-browser rendered view of the page, used to re-read JavaScript-built content and flag what is visible to Google but hidden from non-JavaScript AI crawlers."));
add(P("Using independent third parties for the security, performance, and accessibility grades is deliberate: those numbers are not WinTech's opinion. They are externally verifiable, and a prospect can reproduce them."));

add(H1("7.  Findings and Prioritization"));
add(P("Beyond the score, the scanner produces a prioritized findings list spanning every dimension. Each finding carries a severity — Critical, High, Medium, or Low — and findings are sorted so the most consequential appear first. Critical findings (for example, a missing H1, absent business schema, or a site not served over HTTPS) are issues actively suppressing discoverability or credibility today. High findings include gaps such as no analytics at all (you cannot measure), unlabeled form fields (an accessibility and ADA exposure), or no privacy policy. The severity model is intentionally conservative: we reserve “Critical” for issues that are both high-impact and unambiguous, so the label keeps its meaning."));
add(P("A report that only ever lists problems reads like a complaint, so the scanner also surfaces strengths: for every dimension a site already handles well, it states what is working and why it matters. The same audit therefore shows both the gaps to close and the foundations to build on — every one of the eleven dimensions appears as either a finding or a strength, so none is silently dropped."));
add(P("Each dimension can also be opened to a WinTech Insight — a short, plain-language explanation, generated for that specific site, of why the dimension scored what it did, what it means for getting found and winning customers, and the single highest-value next step. These insights are written at scan time so drilling into any score is instant, and they fall back to a rule-based explanation when the AI service is unavailable, so a reader is never left without context."));
add(P("Every finding also carries an effort-to-fix tag — Config (a setting, minutes), Content (copy, hours), or Dev (code, days) — so the report can be worked as a to-do list rather than read as a verdict: clear the minutes-level fixes today, schedule the rest. Section 13 lays out how to sequence them."));
add(P("And because every scan is stored, a re-scan shows the score trend — the change in the overall score and each dimension since the last run — turning a one-time audit into a measurable before-and-after."));

add(H1("8.  Competitive Benchmarking"));
add(P("A score in isolation answers “how good is this site?” A buyer's real question is usually sharper: “how good is this site compared to the competition?” The scanner answers it directly. Pointed at the subject site alongside up to three named competitors, it scores every site on the same eleven dimensions and renders them head-to-head: an overall ranking, a per-dimension comparison showing exactly where the site leads and trails, and a best-in-class target line marking the score an elite site would post."));
add(P("This reframes the conversation from an abstract grade into a concrete, competitive gap — “you trail your closest rival by N points, and the single dimension that explains most of it is X.” Because every scan is recorded, these comparisons also seed a longer-term capability: as the corpus of scored sites grows, head-to-head comparison extends naturally into industry benchmarking — how a site ranks against the average or top quartile of its peers."));

add(H1("9.  Revenue Impact Modeling"));
add(P("A score is diagnostic; a dollar figure is motivating. The scanner translates findings into an estimate of the pipeline at stake, built transparently from your own business inputs: monthly visitors, average deal size (ARR), close rate, and current visitor-to-lead conversion rate. From these it computes your current monthly pipeline (visitors × conversion × deal value) as a baseline, then models improvement in four tiers — SEO quick wins, schema & AEO, content expansion, and trust & conversion — each contributing an estimated traffic lift and a conversion uplift. Crucially, each tier is scaled to the gaps the audit actually found on that site. Three design choices keep the output honest:"));
add(bullet("Conversion uplifts are relative, not absolute. A tier that improves conversion by “15%” raises a 0.3% rate to roughly 0.35%, not to 15.3%. Stacking absolute percentage points onto a low base produces absurd results; relative uplifts compound realistically."));
add(bullet("Conversion is capped. The model will not project a blended conversion rate above 5% — comfortably below the 8–15% that published benchmarks reserve for elite sites — preventing the math from drifting into figures a sophisticated buyer would dismiss."));
add(bullet("Every projection is specific to the site. A tier’s uplift is credited only for the items the audit found missing; a site that already passes a tier earns little or nothing from it. Two different sites therefore produce two different projections, and the model never takes credit for fixing something that is not broken."));
add(callout("The honest revenue pledge —","Conversion uplifts are relative, not absolute. We cap projected conversion at 5% (below the 8–15% elite benchmark), and we never take credit for fixing something that isn’t broken."));
add(P("The result is a set of directional figures: additional monthly pipeline, annualized pipeline, estimated annual revenue gain, and additional leads per month. Every input is adjustable. These are estimates, not guarantees: they apply published benchmarks (Appendix B) to your current audit data, and actual results depend on market, competition, and execution. The model is designed to be credible and conservative — not to maximize a headline number."));

add(H1("10.  Audience Intel: Is the Website Aimed at the Right Customer?"));
add(P("The audit asks whether a website is built well. Audience Intel asks something the audit deliberately does not: is the site pointed at the right person, and is the job it wants done clear? A site can score well on all eleven technical dimensions and still quietly fail — because the audience it appears to address and the action it actually wants are out of sync, or because a first-time visitor cannot tell within seconds who the site is for and what to do next."));
add(P("The analysis reads the homepage the way a new visitor would — the headline, sub-headline, calls to action, and visible copy — and asks three plain questions: who is this site for, what single action is it trying to get a visitor to take, and are those two things aligned? To keep the read from being one model’s idiosyncratic opinion, the same page is evaluated independently by three different language models — a GPT, a Gemini, and a Claude model — and their answers are then compared."));
add(LEAD("Positioning clarity:","agreement between the models becomes a signal in its own right. When three independent readers describe the same audience and the same goal, the site’s message is clear; when they diverge, the message itself is ambiguous — a conclusion no single model could reach alone. The output reports the consensus audience and goal, an alignment verdict (aligned, partial, or mismatch), and a clarity rating derived from how much the readers agreed."));
add(P("A short read — audience, goal, and the call-to-action actually visible on the page — is returned immediately and free. The deeper analysis, which adds each model’s reasoning and the specific evidence it drew from the page, is the gated tier. Because this analysis is lightweight, it is designed to run on a monthly schedule as part of an ongoing report rather than as a one-off."));
add(LEAD("What it is not:","Audience Intel interprets public homepage copy; it is not a substitute for a company’s own knowledge of its customers. It is most valuable as a mirror — a fast, outside read of the message a stranger actually receives — and as an early warning when that message and the business’s intent have drifted apart."));
add(LEAD("Output:","both the audit and Audience Intel produce a clean, downloadable report with a one-click PDF. When a prospect runs both together, the two are merged into a single combined report — one document, one Download PDF — covering website health and audience alignment side by side."));
add(H1("11.  The Scanner's Own Security Posture"));
add(P("We hold our own infrastructure to the standard we audit. The scanner application sends the same security headers it checks for, signs its administrative sessions with HMAC rather than forgeable tokens, compares secrets in constant time, and gates expensive operations behind authenticated controls. A tool that flags “zero security headers” while running with none of its own would not deserve the finding. Practicing the methodology is part of the methodology."));

add(H1("12.  Honest Limitations and How to Interpret Results"));
add(P("An automated audit is a high-signal starting point, not the final word. Its limits are worth stating plainly:"));
add(bullet("It evaluates a single page (typically the homepage), not a full-site crawl. Deep issues on interior pages are out of scope for a quick scan."));
add(bullet("For JavaScript-built sites, an optional rendered-view pass loads the page in a headless browser and re-reads it, so the scores reflect what a visitor actually sees. When that pass is off, the scanner reads server HTML only and marks the affected scores low-confidence rather than failing them — it never silently mis-scores a client-rendered site."));
add(bullet("Accessibility and best-practices scoring is signal-based (and uses Lighthouse where available); it is not a substitute for a manual WCAG audit or assistive-technology testing."));
add(bullet("Some enrichment still depends on third-party availability — Google PageSpeed is rate-limited and occasionally unreachable, in which case that score reads N/A. Where Mozilla’s Observatory is unavailable, the scanner now computes an equivalent grade in-house from the response headers, so a security grade is always present."));
add(bullet("The result is a point-in-time snapshot; a score is accurate as of its timestamp, which is why every report is timestamped."));
add(bullet("Revenue figures are directional estimates built on published benchmarks, not commitments."));
add(bullet("Audience Intel reflects how language models read your public homepage copy. It is a fast outside interpretation — strongest as a mirror and an early warning — not a replacement for what you know about your own customers."));
add(P("Read correctly, the audit answers one question well: where is the highest-leverage work? It is a map, not the territory — and the fastest way we know to turn a vague sense that “the website could be better” into a specific, prioritized, measurable plan."));

add(H1("13.  Turning Your Report Into a Plan"));
add(P("A score is a diagnosis; the value is in what you do next. We recommend reading the report in this order:"));
add(bullet("Start with the Critical findings (Section 7) — these are actively costing you discoverability or credibility right now."));
add(bullet("Filter by effort. Every finding is tagged Config (a setting, minutes), Content (copy, hours), or Dev (code, days). Clear the Config-level Criticals first — missing security headers, an AI-crawler block in robots.txt, absent Open Graph tags, a missing canonical. These take minutes and immediately stop the bleeding on trust and AI visibility."));
add(bullet("Add the highest-value Content fixes next — a real meta description, an 800-word homepage, alt text — which compound in search and AI over the following weeks."));
add(bullet("Schedule the Dev work — structured data, lead-capture forms, performance — into your next sprint, sequenced by the revenue model’s four tiers (Section 9)."));
add(bullet("Re-scan. Because every scan is stored, your next report shows the score trend — proof the work moved the number."));
add(P("If your overall grade is a C or D, resist the urge to fix everything at once. Two or three Config-level Criticals usually move both the score and the conversation more than a month of redesign."));
add(H1("14.  Conclusion"));
add(P("Websites are measured too often by taste and too rarely by evidence. The WinTech Website Intelligence methodology exists to close that gap: to evaluate the eleven dimensions that actually govern whether a business is found, trusted, used, and chosen — across search engines, AI answer engines, security and privacy reviewers, assistive technology, and human visitors — to show how a site stacks up against its competition, and to do it transparently enough that anyone can check the work. The score begins the conversation. The findings are the plan. And the methodology documented here is the reason to believe both."));

add(new Paragraph({pageBreakBefore:true,children:[]}));
add(H1("Appendix A — Scoring Reference Tables"));
add(P("Each dimension is scored out of 100 by summing the points below. Where a signal lists two values, the higher is awarded for full compliance and the lower for partial. For Performance, Accessibility, and Best Practices, Google Lighthouse's audited score is used directly when available; the HTML-signal allocations below are the fallback. The overall score is the weighted average using the framework weights in Section 3."));
add(H3("Effort to fix"));
add(P("In the live report, every finding is also tagged with the effort it takes to resolve, so the list can be triaged by cost as well as by severity:"));
add(table(["Effort","Typical time","Examples"],[
  ["Config","Minutes","Security headers, robots.txt / AI-crawler rules, Open Graph tags, a canonical URL, character encoding, hreflang, a broken link or mixed-content URL."],
  ["Content","Hours","A meta description, an 800-word homepage, image alt text, heading structure, a privacy policy, llms.txt."],
  ["Dev","Days","Structured data / schema, lead-capture forms, accessibility code (form labels, landmarks), installing analytics, performance work, server-side rendering."],
],[1500,1700,6160]));
add(H3("SEO Fundamentals"));
add(table(["Signal","Points"],[["Title tag (well-sized / present only)","15 / 5"],["Meta description","15"],["Exactly one H1 (single / multiple)","15 / 8"],["Canonical URL","10"],["Open Graph tags","10"],["Image alt-text (≥90% / ≥50%)","10 / 5"],["XML sitemap","10"],["Twitter Card tags","5"],["robots.txt","5"],["Word count (≥800 / ≥400)","5 / 2"]],[6360,3000]));
add(H3("AEO / AI Readiness"));
add(table(["Signal","Points"],[["JSON-LD structured data present","25"],["Organization / LocalBusiness schema","15"],["FAQ schema","15"],["llms.txt present","20"],["HowTo schema","10"],["Breadcrumb schema","5"],["Word count ≥ 800","10"]],[6360,3000]));
add(H3("Security"));
add(table(["Signal","Points"],[["Security grade (Observatory or in-house)","25 / 12"],["Valid SSL certificate","15"],["Content-Security-Policy","12"],["Strict-Transport-Security","10"],["X-Frame-Options","8"],["X-Content-Type-Options","8"],["security.txt (RFC 9116)","8"],["Referrer-Policy","7"],["Permissions-Policy","7"]],[6360,3000]));
add(H3("Accessibility (HTML-signal fallback)"));
add(table(["Signal","Points"],[["Image alt-text (≥90% / ≥50%)","25 / 12"],["Form fields labeled (≥90% / ≥50%)","20 / 10"],["Declared page language","15"],["Valid heading structure","15"],["Semantic landmarks present","15"],["Descriptive link text","10"]],[6360,3000]));
add(H3("Content Quality"));
add(table(["Signal","Points"],[["Word count (≥1200 / ≥800 / ≥400 / ≥200)","40 / 30 / 15 / 5"],["H1 present","15"],["H2 sections (≥3 / ≥1)","15 / 8"],["Image alt-text (≥90% / ≥50%)","15 / 8"],["Internal links (≥10 / ≥5)","15 / 8"]],[6360,3000]));
add(H3("Trust & Conversion"));
add(table(["Signal","Points"],[["Lead-capture form","25"],["Visible phone number","15"],["Social-profile links","15"],["Privacy-policy link","15"],["Visible email address","10"],["Mobile viewport","10"],["Favicon","10"]],[6360,3000]));
add(H3("Best Practices (HTML-signal fallback)"));
add(table(["Signal","Points"],[["Served over HTTPS","35"],["Standards-mode doctype","20"],["Character encoding declared","15"],["Mobile viewport","15"],["Favicon present","15"]],[6360,3000]));
add(H3("Privacy & Compliance"));
add(table(["Signal","Points"],[["Privacy policy linked","40"],["Cookie-consent mechanism","40"],["Terms of service linked","20"]],[6360,3000]));
add(H3("Internationalization"));
add(table(["Signal","Points"],[["Page language declared","35"],["hreflang alternates present","30"],["Character encoding declared","20"],["Multiple locale alternates","15"]],[6360,3000]));
add(H3("Analytics & Measurability"));
add(table(["Signal","Points"],[["Any analytics installed","50"],["Conversion / advertising pixel","20"],["Tag manager","15"],["Behavioral / heatmap tooling","15"]],[6360,3000]));

add(new Paragraph({pageBreakBefore:true,children:[]}));
add(H1("Appendix B — Benchmark Sources"));
add(P("The revenue model and several findings draw on published, third-party industry benchmarks. These are external figures used as model inputs and illustrative context — not WinTech measurements or guarantees of outcome."));
add(LEAD("Organic search revenue share:","organic search generates roughly 44.6% of all B2B revenue, the largest single channel; SEO drives about 62% of B2B website traffic. (SalesHive; Oliver Munro, 2025–2026)"));
add(LEAD("Conversion benchmarks:","typical B2B SaaS visitor-to-lead conversion is about 1.5%; elite sites convert at 8–15%; a one-point conversion lift cuts customer-acquisition cost by 15–25%. (First Page Sage; Klickflow; ConversionXperts, 2026)"));
add(LEAD("Structured-data impact:","sites using structured data see 20–30% click-through improvements; about 71% of pages cited by ChatGPT use schema markup; rich snippets can lift CTR by up to 82%. (Outpace SEO; Digital Applied; GW Content, 2025–2026)"));
add(LEAD("Meta-tag optimization:","pages with custom meta descriptions earn about 5.8% more clicks; well-optimized titles and descriptions can lift CTR 10–30%; organic leads close at roughly 14.6% versus 1.7% for outbound. (SEMrush; Straight North; SalesHive, 2025–2026)"));
add(LEAD("Pipeline velocity:","a 10% increase in win rate can raise pipeline velocity by about 33%. (The Digital Bloom, 2025)"));
add(spacer(120));
add(new Paragraph({border:{top:{style:BorderStyle.SINGLE,size:4,color:"D1D5DB",space:6}},spacing:{before:120},children:[new TextRun({text:"© 2026 WinTech Partners. This document describes the methodology of the WinTech Website Intelligence Scanner and its Audience Intel analysis and is provided for informational purposes. Projections are directional estimates, not guarantees.",italics:true,color:MUTE,size:18})]}));

const doc = new Document({
  styles:{ default:{document:{run:{font:"Arial",size:22,color:INK}}},
    paragraphStyles:[
      {id:"Heading1",name:"Heading 1",basedOn:"Normal",next:"Normal",quickFormat:true,run:{size:30,bold:true,font:"Arial",color:DARK},paragraph:{spacing:{before:340,after:160},outlineLevel:0,border:{bottom:{style:BorderStyle.SINGLE,size:6,color:ACCENT,space:4}}}},
      {id:"Heading2",name:"Heading 2",basedOn:"Normal",next:"Normal",quickFormat:true,run:{size:25,bold:true,font:"Arial",color:H2COL},paragraph:{spacing:{before:240,after:120},outlineLevel:1}},
      {id:"Heading3",name:"Heading 3",basedOn:"Normal",next:"Normal",quickFormat:true,run:{size:23,bold:true,font:"Arial",color:INK},paragraph:{spacing:{before:200,after:80},outlineLevel:2}},
    ] },
  numbering:{config:[{reference:"b",levels:[{level:0,format:LevelFormat.BULLET,text:"•",alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:560,hanging:280}}}}]}]},
  sections:[{
    properties:{ titlePage:true, page:{size:{width:12240,height:15840},margin:{top:1440,right:1440,bottom:1440,left:1440}} },
    headers:{ first:new Header({children:[new Paragraph({})]}),
      default:new Header({children:[new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:4,color:"E5E7EB",space:6}},children:[new TextRun({text:"WinTech Partners  ·  Website Intelligence Methodology",color:MUTE,size:16})]})]}) },
    footers:{ first:new Footer({children:[new Paragraph({})]}),
      default:new Footer({children:[new Paragraph({tabStops:[{type:TabStopType.RIGHT,position:9360}],border:{top:{style:BorderStyle.SINGLE,size:4,color:"E5E7EB",space:6}},children:[new TextRun({text:"Technical White Paper  ·  v2.3",color:MUTE,size:16}),new TextRun({text:"\tPage ",color:MUTE,size:16}),new TextRun({children:[PageNumber.CURRENT],color:MUTE,size:16})]})]}) },
    children:[...cover,...toc,...body],
  }],
});
Packer.toBuffer(doc).then(buf=>{ const out="/sessions/kind-fervent-bell/mnt/outputs/whitepaper/WinTech-Website-Intelligence-Whitepaper-v2.3.docx"; fs.writeFileSync(out,buf); console.log("written:",out,"("+buf.length+" bytes)"); });
