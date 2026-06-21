// ============================================================
// REPORT TEMPLATE RENDERER
// Reads window.SCAN_DATA and builds the full tabbed report
// ============================================================

(function() {
  const { site, scores, findings, data, scanDate, savedAt } = window.SCAN_DATA;
  const domain = site.domain;

  // The browser's "Save as PDF" uses the page title as the default filename. Stamp it with the
  // save time so each download is a distinct file instead of overwriting the previous one.
  const reportFileStamp = (() => {
    const d = savedAt ? new Date(savedAt) : new Date();
    // e.g. 2026-06-20_144512 (Central time, filename-safe — no colons or spaces)
    return d.toLocaleString('sv-SE', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(' ', '_').replace(/:/g, '');
  })();
  document.title = `WinTech Audit - ${domain} - ${reportFileStamp}`;
  const overall = scores.overall;
  const cats = scores.categories;
  const seo = data.seo || {};
  const aeo = data.aeo || {};
  const perf = data.performance || {};
  const sec = data.security || {};
  const trust = data.trust || {};

  function sc(s) {
    if (s >= 80) return '#22c55e';
    if (s >= 60) return '#f59e0b';
    if (s >= 40) return '#f97316';
    return '#ef4444';
  }
  function gr(s) {
    if (s >= 90) return 'A'; if (s >= 80) return 'B'; if (s >= 60) return 'C'; if (s >= 40) return 'D'; return 'F';
  }
  function fmt(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
    return '$' + Math.round(n);
  }
  function chk(label, status, detail) {
    const icons = { pass: '✅', warn: '⚠️', fail: '❌' };
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #1e293b10">
      <span style="font-size:14px;flex-shrink:0;margin-top:1px">${icons[status]}</span>
      <div><div style="font-size:13px;font-weight:600;color:${status==='pass'?'#22c55e':status==='warn'?'#f59e0b':'#ef4444'}">${label}</div>
      ${detail ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${detail}</div>` : ''}</div></div>`;
  }
  function stat(label, value, color, sub) {
    return `<div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px 18px;flex:1 1 140px;min-width:140px">
      <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${label}</div>
      <div style="font-size:24px;font-weight:800;color:${color};font-family:'JetBrains Mono',monospace">${value}</div>
      ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:2px">${sub}</div>` : ''}</div>`;
  }
  function bar(items) {
    const max = Math.max(...items.map(i => i.value), 1);
    return items.map(i => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="width:120px;font-size:12px;color:#94a3b8;text-align:right;flex-shrink:0">${i.label}</span>
      <div style="flex:1;height:20px;background:#1e293b;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${(i.value/max)*100}%;background:linear-gradient(90deg,${i.color}aa,${i.color});border-radius:4px"></div>
      </div>
      <span style="width:40px;font-size:12px;font-weight:700;color:${i.color};font-family:'JetBrains Mono',monospace;text-align:right">${i.value}</span>
    </div>`).join('');
  }

  // Impact class
  function ic(impact) { return impact === 'Critical' ? '#ef4444' : impact === 'High' ? '#f97316' : '#f59e0b'; }

  // Insight box helper
  function insight(content) {
    return `<div style="margin-top:32px;background:linear-gradient(135deg,#1e1b4b,#0f172a);border:1px solid #4f46e5;border-radius:12px;padding:24px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:16px">💡</span>
        <span style="font-size:14px;font-weight:700;color:#a5b4fc;text-transform:uppercase;letter-spacing:1px">WinTech Insight</span>
      </div>
      <div style="font-size:14px;color:#cbd5e1;line-height:1.8">${content}</div>
    </div>`;
  }

  // Count findings
  const criticalCount = findings.filter(f => f.impact === 'Critical').length;
  const aiFix = findings.filter(f => f.cat === 'SEO' || f.cat === 'AEO' || f.cat === 'Content').length;
  const manualFix = findings.length - aiFix;

  // Variables needed by insights and later sections
  const sh = sec.headers || {};
  const obs = sec.observatory || {};
  const obsGrade = obs.grade || 'N/A';
  const ssl = sec.ssl || {};
  const ps = perf.pagespeed || {};
  const psScores = ps.scores || {};

  // Generate dynamic insights per tab
  const lowestCat = Object.values(cats).sort((a,b) => a.score - b.score)[0];
  const highestCat = Object.values(cats).sort((a,b) => b.score - a.score)[0];
  const seoFindings = findings.filter(f => f.cat === 'SEO').length;
  const aeoFindings = findings.filter(f => f.cat === 'AEO').length;
  const secFindings = findings.filter(f => f.cat === 'Security').length;

  // Accurate, complete category breakdown (e.g. "2 Security, 2 Content, 1 SEO, 1 AEO, 1 Trust")
  // so the numbers always add up to the total finding count shown above it.
  const catCounts = findings.reduce((m, f) => { m[f.cat] = (m[f.cat] || 0) + 1; return m; }, {});
  const breakdownStr = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${n} ${cat}`)
    .join(', ');

  const overviewInsight = insight(
    `<p style="margin-bottom:12px"><strong>Your biggest opportunity is ${lowestCat.name}.</strong> At ${lowestCat.score}%, this category is pulling your overall score down the most. ${highestCat.name} is your strongest area at ${highestCat.score}%, which means the foundation is there — you're not starting from scratch.</p>` +
    `<p>${overall < 40 ? 'Sites scoring below 40 are effectively invisible to both search engines and AI answer engines. The good news: the gap between "broken" and "average" is where the easiest wins live. Most of these fixes take hours, not weeks.' : overall < 70 ? 'You have a functional site with specific gaps. This is the best position to be in — you don\'t need a rebuild, you need targeted fixes that compound on each other.' : 'This is a strong score. Focus on the remaining gaps to move from good to elite. At this level, each improvement delivers outsized returns because the foundation is already solid.'}</p>`
  );

  const findingsInsight = insight(
    `<p style="margin-bottom:12px"><strong>${findings.length} findings break down to ${breakdownStr}.</strong> ${seoFindings + aeoFindings >= secFindings ? 'The concentration in SEO and AEO means your site\'s visibility problem is at least as big as its security problem. Fixing search presence should come first — you can\'t convert visitors you don\'t have.' : 'Security findings are prominent here. For B2B buyers who research vendors before making contact, visible security gaps erode trust before the first conversation happens.'}</p>` +
    `<p>${criticalCount > 0 ? `The ${criticalCount} critical issues should be addressed within the next 7 days. Each one is actively costing you discoverability or credibility right now. The non-critical findings are optimization opportunities that compound over time.` : 'No critical issues found — that\'s a strong position. The findings here are optimization opportunities. Prioritize by impact and work through them systematically.'}</p>`
  );

  const technicalInsight = insight(
    `<p style="margin-bottom:12px"><strong>${perf.ttfb && perf.ttfb < 200 ? 'Server response time is solid.' : 'Server response could be faster.'}</strong> ${perf.ttfb ? `Your ${perf.ttfb}ms TTFB ${perf.ttfb < 100 ? 'is excellent — in the top tier globally.' : perf.ttfb < 200 ? 'is good — visitors aren\'t waiting.' : perf.ttfb < 500 ? 'is acceptable but could be improved with CDN caching or server optimization.' : 'is slow enough to impact both user experience and search rankings. Google uses server response time as a ranking signal.'}` : 'TTFB data was not available for this scan.'}</p>` +
    `<p>${(perf.renderBlockingJs || 0) > 10 ? `${perf.renderBlockingJs} render-blocking scripts is high. Each one delays the first paint the visitor sees. Adding defer or async attributes is a zero-risk change that can measurably improve perceived speed.` : (perf.lazyLoadedImages || 0) === 0 && (perf.totalImages || 0) > 3 ? `None of your ${perf.totalImages} images use lazy loading. On mobile connections, every image loads upfront whether the visitor scrolls to it or not. Adding loading="lazy" to below-the-fold images is a one-line fix per image.` : 'The technical foundation is reasonably clean. Focus optimization efforts on the other categories where the score gaps are larger.'}</p>`
  );

  const seoInsight = insight(
    `<p style="margin-bottom:12px"><strong>${!seo.metaDescription?.exists || !seo.h1?.count ? 'Your site is missing basic search signals that Google has expected since 2010.' : 'Core SEO elements are in place.'}</strong> ${!seo.metaDescription?.exists ? 'Without a meta description, Google auto-generates your search snippet from random page content. You lose control of your first impression in search results.' : ''} ${!seo.h1?.count ? 'Without an H1 tag, search engines have no clear signal about what this page is about.' : ''}</p>` +
    `<p><strong>AEO is the 2026 frontier.</strong> ${!aeo.jsonLd?.exists ? 'You have zero structured data. This means AI answer engines like ChatGPT, Perplexity, and Google AI Overviews cannot extract your business identity, services, or expertise in a machine-readable way. 71% of pages cited by ChatGPT use schema markup — without it, you\'re excluded from AI-generated answers about your industry.' : `You have ${aeo.jsonLd.count} schema(s) implemented (${aeo.jsonLd.types?.join(', ')}). ${!aeo.faqSchema ? 'Adding FAQ schema would increase your chances of appearing in featured snippets and AI citations.' : 'FAQ schema is in place — this positions you well for AI answer engine citations.'}`}</p>`
  );

  const securityInsight = insight(
    `<p style="margin-bottom:12px"><strong>${(sh.headersSet || 0) === 0 ? 'Zero security headers is a credibility problem, not just a technical one.' : `${sh.headersSet} of ${sh.headersTotal} security headers are configured.`}</strong> ${(sh.headersSet || 0) < 3 ? 'B2B buyers increasingly run security evaluations on vendors before engaging. Security-conscious prospects — especially in enterprise, financial services, and healthcare — will notice missing headers in their due diligence. This can silently disqualify you before a conversation starts.' : 'Your header configuration is reasonable. Focus on adding any missing headers and ensuring your Observatory score reflects the full picture.'}</p>` +
    `<p>${ssl.valid ? 'SSL is active and valid, which is the baseline expectation.' : 'SSL issues are a critical fix — browsers will show warning pages that destroy visitor trust immediately.'} ${obsGrade && !['N/A', 'Pending'].includes(obsGrade) ? `${obs.source === 'computed' ? 'Based on the security headers present, this site grades' : 'Mozilla Observatory grades this site'} ${obsGrade}. ${/^[AB]/.test(obsGrade) ? 'This is a strong posture.' : /^C/.test(obsGrade) ? 'This is middling — enough to pass basic checks but room to improve.' : 'This grade will concern security-aware buyers. Adding the missing headers is the fastest way to raise it.'}` : 'A security grade was not available for this scan.'}</p>`
  );

  // Score ring SVG
  const ringR = 76, ringCirc = 2 * Math.PI * ringR;
  const ringOffset = ringCirc - (overall / 100) * ringCirc;
  const ringColor = sc(overall);

  const ringSvg = `<svg width="180" height="180">
    <circle cx="90" cy="90" r="${ringR}" fill="none" stroke="#1e293b" stroke-width="14"/>
    <circle cx="90" cy="90" r="${ringR}" fill="none" stroke="${ringColor}" stroke-width="14"
      stroke-dasharray="${ringCirc}" stroke-dashoffset="${ringOffset}"
      stroke-linecap="round" transform="rotate(-90 90 90)"/>
    <text x="90" y="78" text-anchor="middle" fill="${ringColor}" font-size="50" font-weight="800" font-family="Inter,sans-serif">${overall}</text>
    <text x="90" y="106" text-anchor="middle" fill="#94a3b8" font-size="14" font-weight="500" font-family="Inter,sans-serif">/ 100</text>
    <text x="90" y="128" text-anchor="middle" fill="${ringColor}" font-size="18" font-weight="700" font-family="Inter,sans-serif">${gr(overall)}</text>
  </svg>`;

  // Category bars HTML
  const catBars = Object.entries(cats).map(([key, c]) => {
    const color = sc(c.score);
    return `<div onclick="showDim('${key}')" title="Open the deep-dive + WinTech Insights" style="margin:0 -8px 6px;padding:8px;border-radius:8px;cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='#1e293b'" onmouseout="this.style.background='transparent'">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:13px;font-weight:600;color:#e2e8f0">${c.icon} ${c.name}</span>
        <span style="display:flex;align-items:center;gap:6px"><span style="font-size:13px;font-weight:700;color:${color};font-family:'JetBrains Mono',monospace">${c.score}%</span><span style="font-size:15px;color:#475569;font-weight:700">›</span></span>
      </div>
      <div style="height:8px;border-radius:4px;background:#1e293b;overflow:hidden">
        <div style="height:100%;width:${c.score}%;background:linear-gradient(90deg,${color}cc,${color});border-radius:4px"></div>
      </div>
    </div>`;
  }).join('');

  // Findings HTML
  const findingsHtml = findings.map((f, i) => `
    <div style="border-bottom:1px solid #1e293b">
      <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:700;color:#64748b;width:24px;font-family:'JetBrains Mono',monospace">${String(i+1).padStart(2,'0')}</span>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;text-transform:uppercase;background:${ic(f.impact)}22;color:${ic(f.impact)}">${f.impact}</span>
        <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:#1e293b;color:#94a3b8">${f.cat}</span>
        <span style="flex:1;font-size:13px;font-weight:600;color:#e2e8f0;min-width:150px">${f.issue}</span>
        <span style="font-size:16px;color:#64748b">▾</span>
      </div>
      <div style="display:none;padding:0 16px 14px 52px;font-size:13px;color:#94a3b8;line-height:1.6">${f.desc}</div>
    </div>
  `).join('');

  // Strengths ("what you're doing well") — the positive counterpart to findings.
  const wins = (data && data.wins) || [];
  const winsHtml = wins.length ? wins.map((w) => `
    <div style="border-bottom:1px solid #1e293b">
      <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;flex-wrap:wrap">
        <span style="font-size:14px;color:#22c55e;width:24px;text-align:center">✓</span>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;text-transform:uppercase;background:#22c55e22;color:#22c55e">Strength</span>
        <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:#1e293b;color:#94a3b8">${w.cat}</span>
        <span style="flex:1;font-size:13px;font-weight:600;color:#e2e8f0;min-width:150px">${w.headline}</span>
        <span style="font-size:16px;color:#64748b">▾</span>
      </div>
      <div style="display:none;padding:0 16px 14px 52px;font-size:13px;color:#94a3b8;line-height:1.6">${w.desc}</div>
    </div>
  `).join('') : '<div style="padding:16px;color:#64748b;font-size:13px">No standout strengths surfaced on this scan — the findings below are the place to start.</div>';

  // SEO checks
  const seoChecks = [
    chk('Title Tag',
      !seo.title?.value ? 'fail' : (seo.title.length >= 30 && seo.title.length <= 60) ? 'pass' : 'warn',
      `"${seo.title?.value || 'missing'}" — ${seo.title?.length || 0} chars${seo.title?.value && (seo.title.length < 30 || seo.title.length > 60) ? ' (aim for 30–60)' : ''}`),
    chk('Meta Description', seo.metaDescription?.exists ? 'pass' : 'fail', seo.metaDescription?.exists ? 'Present' : 'Missing entirely'),
    chk('H1 Tag', seo.h1?.count === 1 ? 'pass' : seo.h1?.count > 1 ? 'warn' : 'fail', `${seo.h1?.count || 0} H1 tag(s) found`),
    chk('Canonical URL', seo.canonical?.exists ? 'pass' : 'fail', seo.canonical?.value || 'Missing'),
    chk('Open Graph Tags', seo.openGraph?.exists ? 'pass' : 'fail', seo.openGraph?.exists ? 'Present' : 'No og:title, og:description, or og:image'),
    chk('Twitter Cards', seo.twitterCards?.exists ? 'pass' : 'fail', seo.twitterCards?.exists ? 'Present' : 'No Twitter Card tags'),
    chk('Image Alt Text', seo.altText?.pct >= 90 ? 'pass' : seo.altText?.pct >= 50 ? 'warn' : 'fail', `${seo.altText?.withAlt || 0} of ${seo.altText?.total || 0} images have alt text (${seo.altText?.pct || 0}%)`),
    chk('Word Count', seo.wordCount >= 800 ? 'pass' : seo.wordCount >= 400 ? 'warn' : 'fail', `${seo.wordCount || 0} words. Target: 800+`),
    chk('Viewport', seo.viewport ? 'pass' : 'fail', seo.viewport ? 'Mobile viewport set' : 'Missing viewport meta'),
    chk('HTML Lang', seo.htmlLang ? 'pass' : 'fail', seo.htmlLang ? `lang="${seo.htmlLang}"` : 'Missing. Hurts accessibility and internationalization.'),
    chk('Heading Hierarchy', seo.headingHierarchy ? 'pass' : 'fail', seo.headingHierarchy ? 'Proper H1→H2→H3 nesting' : (seo.h1?.count ? 'Headings skip levels. Fix nesting order.' : 'No H1 to anchor the heading hierarchy.')),
  ].join('');

  // AEO checks
  const aeoChecks = [
    chk('JSON-LD Structured Data', aeo.jsonLd?.exists ? 'pass' : 'fail', aeo.jsonLd?.exists ? `${aeo.jsonLd.count} schema(s): ${aeo.jsonLd.types?.join(', ')}` : 'None found'),
    chk('Organization Schema', aeo.organizationSchema ? 'pass' : 'fail', aeo.organizationSchema ? 'Present' : 'No Organization or LocalBusiness markup'),
    chk('FAQ Schema', aeo.faqSchema ? 'pass' : 'fail', aeo.faqSchema ? 'Present' : 'No FAQ markup'),
    chk('HowTo Schema', aeo.howToSchema ? 'pass' : 'fail', aeo.howToSchema ? 'Present' : 'No HowTo markup'),
    chk('Breadcrumb Schema', aeo.breadcrumbs ? 'pass' : 'fail', aeo.breadcrumbs ? 'Present' : 'No breadcrumbs'),
    chk('llms.txt', data.llmsTxt?.exists ? 'pass' : 'fail', data.llmsTxt?.exists ? `Present (${data.llmsTxt.size} bytes)` : 'Missing. AI engines have no guidance on what to read from your site.'),
  ].join('');

  // Security checks
  const secChecks = [
    chk('Strict-Transport-Security', sh.hsts ? 'pass' : 'fail', sh.hsts || 'Not set'),
    chk('Content-Security-Policy', sh.csp ? 'pass' : 'fail', sh.csp ? 'Set' : 'Not set'),
    chk('X-Frame-Options', sh.xFrame ? 'pass' : 'fail', sh.xFrame || 'Not set'),
    chk('X-Content-Type-Options', sh.xContentType ? 'pass' : 'fail', sh.xContentType || 'Not set'),
    chk('Referrer-Policy', sh.referrerPolicy ? 'pass' : 'fail', sh.referrerPolicy || 'Not set'),
    chk('Permissions-Policy', sh.permissionsPolicy ? 'pass' : 'fail', sh.permissionsPolicy ? 'Set' : 'Not set'),
    chk('security.txt', sec.securityTxt?.exists ? 'pass' : 'fail', sec.securityTxt?.exists ? `Present at ${sec.securityTxt.path}` : 'Missing. RFC 9116 standard for responsible disclosure.'),
  ].join('');

  // Best Practices checks
  const bpData = data.bestPractices || {};
  const bpChecks = [
    chk('HTTPS', bpData.https ? 'pass' : 'fail', bpData.https ? 'Served over a secure connection' : 'Not served over HTTPS — browsers show "Not secure"'),
    chk('Character Encoding', bpData.charset ? 'pass' : 'fail', bpData.charset ? 'Declared (<meta charset>)' : 'No character encoding declared'),
    chk('Standards Doctype', bpData.doctype ? 'pass' : 'warn', bpData.doctype ? 'HTML5 <!DOCTYPE html>' : 'No HTML5 doctype found'),
    chk('Mobile Viewport', seo.viewport ? 'pass' : 'fail', seo.viewport ? 'Set' : 'Missing'),
    chk('Favicon', bpData.favicons > 0 ? 'pass' : 'warn', bpData.favicons > 0 ? 'Present' : 'No favicon found'),
    chk('Lighthouse Best Practices', psScores['best-practices'] !== undefined ? (psScores['best-practices'] >= 90 ? 'pass' : psScores['best-practices'] >= 50 ? 'warn' : 'fail') : 'warn', psScores['best-practices'] !== undefined ? `Score: ${psScores['best-practices']}/100` : 'Not available this scan'),
  ].join('');

  // Accessibility checks
  const accData = data.accessibility || {};
  const labeledPct = accData.formFields ? Math.round((accData.labeledFields / accData.formFields) * 100) : null;
  const a11yChecks = [
    chk('Image Alt Text', accData.altPct === null || accData.altPct >= 90 ? 'pass' : accData.altPct >= 50 ? 'warn' : 'fail', accData.altPct === null ? 'No images to caption' : `${accData.altPct}% of images have alt text`),
    chk('Form Field Labels', !accData.formFields ? 'pass' : labeledPct >= 90 ? 'pass' : labeledPct >= 50 ? 'warn' : 'fail', !accData.formFields ? 'No form fields on page' : `${accData.labeledFields} of ${accData.formFields} fields labeled (${labeledPct}%)`),
    chk('Semantic Landmarks', accData.landmarks > 0 ? 'pass' : 'fail', accData.landmarks > 0 ? `${accData.landmarks} landmark region(s)` : 'No <main>, <nav>, <header>, <footer> or ARIA roles'),
    chk('HTML Lang', seo.htmlLang ? 'pass' : 'fail', seo.htmlLang ? `lang="${seo.htmlLang}"` : 'Missing'),
    chk('Heading Structure', seo.headingHierarchy ? 'pass' : 'fail', seo.headingHierarchy ? 'Logical heading order' : (seo.h1?.count ? 'Headings skip levels' : 'No H1 to anchor structure')),
    chk('Descriptive Links', !accData.genericLinkText ? 'pass' : 'warn', !accData.genericLinkText ? 'No vague "click here" links' : `${accData.genericLinkText} non-descriptive link(s)`),
    chk('Lighthouse Accessibility', psScores.accessibility !== undefined ? (psScores.accessibility >= 90 ? 'pass' : psScores.accessibility >= 50 ? 'warn' : 'fail') : 'warn', psScores.accessibility !== undefined ? `Score: ${psScores.accessibility}/100` : 'Not available this scan'),
  ].join('');

  // Internationalization checks
  const intlData = data.i18n || {};
  const i18nChecks = [
    chk('Language Declared', intlData.htmlLang ? 'pass' : 'fail', intlData.htmlLang ? `lang="${intlData.htmlLang}"` : 'No <html lang> attribute'),
    chk('Character Encoding', intlData.charset ? 'pass' : 'warn', intlData.charset ? String(intlData.charset).toUpperCase() : 'Not declared'),
    chk('hreflang Alternates', intlData.hreflang ? 'pass' : 'warn', intlData.hreflang ? `${intlData.hreflangCount} locale alternate(s)` : 'None — single-language only'),
    chk('Text Direction', 'pass', intlData.dir ? `dir="${intlData.dir}"` : 'Default (left-to-right)'),
  ].join('');

  // Analytics & Measurability checks
  const anData = data.analytics || {};
  const anChecks = [
    chk('Analytics Installed', anData.hasAny ? 'pass' : 'fail', anData.hasAny ? `${anData.count} tool(s): ${(anData.tools || []).join(', ')}` : 'No analytics detected — you cannot measure conversions'),
    chk('Tag Manager', anData.hasTagManager ? 'pass' : 'warn', anData.hasTagManager ? 'Google Tag Manager present' : 'No tag manager'),
    chk('Conversion / Ad Pixel', anData.hasAdPixel ? 'pass' : 'warn', anData.hasAdPixel ? 'Ad conversion pixel present' : 'No Meta/LinkedIn/Google Ads pixel'),
    chk('Behavior / Heatmaps', anData.hasHeatmap ? 'pass' : 'warn', anData.hasHeatmap ? 'Product analytics / heatmap present' : 'No heatmap or product analytics'),
  ].join('');

  // Privacy & Compliance checks
  const pvData = data.privacy || {};
  const pvChecks = [
    chk('Privacy Policy', pvData.hasPrivacyPolicy ? 'pass' : 'fail', pvData.hasPrivacyPolicy ? 'Linked' : 'No privacy policy link found'),
    chk('Terms of Service', pvData.hasTerms ? 'pass' : 'warn', pvData.hasTerms ? 'Linked' : 'No terms/legal link found'),
    chk('Cookie Consent', pvData.cookieConsent ? 'pass' : (anData.hasAny ? 'fail' : 'warn'), pvData.cookieConsent ? 'Consent mechanism detected' : (anData.hasAny ? 'Trackers load with no consent banner (GDPR/CCPA risk)' : 'No consent banner (no trackers detected)')),
  ].join('');

  // Trust & Conversion checks
  const trustChecks = [
    chk('Lead Capture Form', trust.forms > 0 ? 'pass' : 'fail', trust.forms > 0 ? `${trust.forms} form(s)` : 'Nothing to capture visitor interest'),
    chk('Phone Number', trust.hasPhone ? 'pass' : 'warn', trust.hasPhone ? 'Visible' : 'No phone number found'),
    chk('Email Address', trust.hasEmail ? 'pass' : 'warn', trust.hasEmail ? 'Visible' : 'No email found'),
    chk('Social Profiles', trust.socialLinks > 0 ? 'pass' : 'warn', trust.socialLinks > 0 ? `${trust.socialLinks} link(s)` : 'No social profile links'),
    chk('Privacy Policy', trust.hasPrivacyPolicy ? 'pass' : 'warn', trust.hasPrivacyPolicy ? 'Linked' : 'Missing'),
  ].join('');

  // ============================================================
  // WINTECH INSIGHTS — per-dimension drill-down (click any scorecard line)
  // ============================================================
  // Content has no standalone checklist — build one from the page's content signals.
  const contentChecks = [
    chk('Homepage Word Count', seo.wordCount >= 800 ? 'pass' : seo.wordCount >= 400 ? 'warn' : 'fail', `${seo.wordCount || 0} words. Target: 800+`),
    chk('Image Alt Text', (seo.altText?.pct || 0) >= 90 ? 'pass' : (seo.altText?.pct || 0) >= 50 ? 'warn' : 'fail', `${seo.altText?.withAlt || 0} of ${seo.altText?.total || 0} images have alt text (${seo.altText?.pct || 0}%)`),
    chk('Heading Hierarchy', seo.headingHierarchy ? 'pass' : 'fail', seo.headingHierarchy ? 'Proper H1→H2→H3 nesting' : 'Headings skip levels or no H1'),
    chk('Title Tag', !seo.title?.value ? 'fail' : (seo.title.length >= 30 && seo.title.length <= 60) ? 'pass' : 'warn', `"${seo.title?.value || 'missing'}" — ${seo.title?.length || 0} chars`),
  ].join('');

  // Performance has no checklist — relocate the old Technical tab's stats + asset bars here.
  const perfWhy = `
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      ${stat('TTFB', (perf.ttfb || '?') + 'ms', perf.ttfb && perf.ttfb < 200 ? '#22c55e' : '#f59e0b', 'Time to first byte')}
      ${stat('Load Time', (perf.totalLoad || '?') + 'ms', perf.totalLoad && perf.totalLoad < 500 ? '#22c55e' : '#f59e0b', 'Total load')}
      ${stat('Page Size', perf.pageSize ? Math.round(perf.pageSize / 1024) + 'KB' : '?', '#94a3b8', 'HTML only')}
      ${stat('PageSpeed', psScores.performance !== undefined ? psScores.performance + '' : 'N/A', psScores.performance >= 80 ? '#22c55e' : psScores.performance >= 50 ? '#f59e0b' : '#ef4444', 'Mobile score')}
    </div>
    <h3 style="font-size:15px;font-weight:700;margin:18px 0 10px">Asset Inventory</h3>
    ${bar([
      { label: 'Stylesheets', value: perf.cssFiles || 0, color: '#6366f1' },
      { label: 'Script Tags', value: perf.jsFiles || 0, color: '#f59e0b' },
      { label: 'Blocking JS', value: perf.renderBlockingJs || 0, color: '#ef4444' },
      { label: 'Images', value: perf.totalImages || 0, color: '#22c55e' },
      { label: 'Lazy Loaded', value: perf.lazyLoadedImages || 0, color: perf.lazyLoadedImages > 0 ? '#22c55e' : '#ef4444' },
    ])}
    ${psScores.performance !== undefined ? `<h3 style="font-size:15px;font-weight:700;margin:18px 0 10px">Google PageSpeed Scores</h3>${bar([
      { label: 'Performance', value: psScores.performance || 0, color: sc(psScores.performance || 0) },
      { label: 'Accessibility', value: psScores.accessibility || 0, color: sc(psScores.accessibility || 0) },
      { label: 'Best Practices', value: psScores['best-practices'] || 0, color: sc(psScores['best-practices'] || 0) },
      { label: 'SEO', value: psScores.seo || 0, color: sc(psScores.seo || 0) },
    ])}` : ''}`;

  const secWhy = `
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      ${stat(obs.source === 'computed' ? 'Security Grade' : 'Observatory', obsGrade, /^A/.test(obsGrade) ? '#22c55e' : /^B/.test(obsGrade) ? '#84cc16' : /^C/.test(obsGrade) ? '#f59e0b' : '#ef4444', (obs.score !== undefined && obs.score !== null) ? `${obs.score}/100` : '')}
      ${stat('Headers Set', `${sh.headersSet || 0} / ${sh.headersTotal || 7}`, (sh.headersSet || 0) >= 5 ? '#22c55e' : '#ef4444', '')}
      ${stat('SSL', ssl.valid ? (ssl.grade || 'Valid') : 'Invalid', ssl.valid ? '#22c55e' : '#ef4444', ssl.valid ? 'Certificate active' : (ssl.error || ''))}
    </div>
    <div class="cl">${secChecks}</div>`;

  const accWhy = `
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      ${stat('Score', (cats.accessibility?.score ?? '?') + '/100', sc(cats.accessibility?.score || 0), 'Weighted into overall')}
      ${stat('Fields Labeled', accData.formFields ? `${accData.labeledFields}/${accData.formFields}` : 'n/a', (!accData.formFields || accData.labeledFields === accData.formFields) ? '#22c55e' : '#ef4444', 'Screen-reader critical')}
      ${stat('Landmarks', accData.landmarks ?? 0, accData.landmarks > 0 ? '#22c55e' : '#ef4444', 'Navigation structure')}
    </div>
    <div class="cl">${a11yChecks}</div>`;

  // dimension key -> finding/strength category label, and -> "why this score" detail HTML
  const dimCat = { seo: 'SEO', aeo: 'AEO', performance: 'Performance', security: 'Security', accessibility: 'Accessibility', content: 'Content', trust: 'Trust', bestPractices: 'Best Practices', privacy: 'Privacy', i18n: 'Localization', analytics: 'Analytics' };
  const dimWhy = {
    seo: `<div class="cl">${seoChecks}</div>`,
    aeo: `<div class="cl">${aeoChecks}</div>`,
    performance: perfWhy,
    security: secWhy,
    accessibility: accWhy,
    content: `<div class="cl">${contentChecks}</div>`,
    trust: `<div class="cl">${trustChecks}</div>`,
    bestPractices: `<div class="cl">${bpChecks}</div>`,
    privacy: `<div class="cl">${pvChecks}</div>`,
    i18n: `<div class="cl">${i18nChecks}</div>`,
    analytics: `<div class="cl">${anChecks}</div>`,
  };

  function fallbackInsight(key, c, dFind, dWins) {
    const top = dFind[0];
    if (c.score >= 80) return `<strong>${c.name} is a strength at ${c.score}/100.</strong> ${dWins[0] ? dWins[0].headline + '. ' : ''}Keep it maintained and put your energy into lower-scoring areas where the gains are bigger.`;
    if (top) return `<strong>${c.name} scored ${c.score}/100</strong>, held back mainly by <em>${top.issue}</em>. ${top.desc} Working through the items below is the fastest way to raise this score.`;
    return `<strong>${c.name} scored ${c.score}/100.</strong> Review the signals below for exactly what drove this score.`;
  }
  const impColor = (imp) => ({ Critical: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#22c55e' }[imp] || '#64748b');
  function dimFindingRow(f) {
    const col = impColor(f.impact);
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #1e293b">
      <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;text-transform:uppercase;background:${col}22;color:${col};white-space:nowrap;flex-shrink:0">${f.impact}</span>
      <div><div style="font-size:13px;font-weight:600;color:#e2e8f0">${f.issue}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px;line-height:1.5">${f.desc}</div></div>
    </div>`;
  }
  function dimWinRow(w) {
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #1e293b">
      <span style="font-size:13px;color:#22c55e;flex-shrink:0">✓</span>
      <div><div style="font-size:13px;font-weight:600;color:#e2e8f0">${w.headline}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px;line-height:1.5">${w.desc}</div></div>
    </div>`;
  }

  const dimPanelsHtml = Object.keys(cats).map((key) => {
    const c = cats[key];
    const label = dimCat[key] || c.name;
    const dFind = findings.filter((f) => f.cat === label);
    const dWins = wins.filter((w) => w.cat === label);
    const color = sc(c.score);
    const aiText = (data.insights && data.insights.byDimension && data.insights.byDimension[key]) || '';
    const aiHtml = insight(aiText ? `<p>${aiText}</p>` : `<p>${fallbackInsight(key, c, dFind, dWins)}</p>`);
    const findHtml = dFind.length ? dFind.map(dimFindingRow).join('') : `<div style="padding:12px 0;color:#22c55e;font-size:13px">No issues found in this area. ✓</div>`;
    const winHtml = dWins.length ? `<div class="sec" style="margin-top:28px"><h2 style="font-size:18px">What's working</h2></div><div class="fl" style="border-left:3px solid #22c55e;padding:0 16px">${dWins.map(dimWinRow).join('')}</div>` : '';
    return `
    <div class="pnl" id="p-dim-${key}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:24px;flex-wrap:wrap">
        <a href="#" onclick="showTab('overview');return false" style="font-size:13px;font-weight:600;color:#94a3b8">← Back to scorecard</a>
        <button onclick="window.print()" style="font-size:12px;font-weight:700;border:1px solid #6366f1;background:#6366f111;color:#a5b4fc;border-radius:8px;padding:6px 14px;cursor:pointer;font-family:Inter,sans-serif">📄 Print this page</button>
      </div>
      <div style="display:flex;align-items:center;gap:16px;margin-top:20px;flex-wrap:wrap">
        <div style="font-size:40px">${c.icon}</div>
        <div style="flex:1;min-width:200px">
          <div style="font-size:24px;font-weight:900;letter-spacing:-0.5px">${c.name}</div>
          <div style="font-size:13px;color:#64748b">Dimension score • weighted into your overall grade</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:40px;font-weight:900;color:${color};font-family:'JetBrains Mono',monospace;line-height:1">${c.score}<span style="font-size:18px;color:#475569">/100</span></div>
          <div style="font-size:12px;font-weight:700;color:${color}">${gr(c.score)}</div>
        </div>
      </div>
      ${aiHtml}
      <div class="sec"><h2 style="font-size:18px">Why this score</h2><p>The exact signals behind the ${c.score}/100</p></div>
      ${dimWhy[key] || '<div class="panel">The detail for this dimension is in the issues below.</div>'}
      <div class="sec"><h2 style="font-size:18px">Issues to fix${dFind.length ? ` (${dFind.length})` : ''}</h2></div>
      <div class="fl" style="padding:0 16px">${findHtml}</div>
      ${winHtml}
      <div style="margin-top:28px"><a href="#" onclick="showTab('overview');return false" style="font-size:13px;font-weight:600;color:#94a3b8">← Back to scorecard</a></div>
    </div>`;
  }).join('');

  // Build full page
  document.body.innerHTML = `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#020617; color:#e2e8f0; font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
    .hdr { background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%); border-bottom:1px solid #1e293b; padding:32px 24px 24px; }
    .hdr-in { max-width:960px; margin:0 auto; }
    .tabs { border-bottom:1px solid #1e293b; background:#0f172a; position:sticky; top:0; z-index:10; }
    .tabs-in { max-width:960px; margin:0 auto; display:flex; overflow-x:auto; }
    .tab { padding:12px 20px; font-size:13px; font-weight:600; color:#64748b; background:none; border:none; border-bottom:2px solid transparent; cursor:pointer; font-family:Inter,sans-serif; white-space:nowrap; }
    .tab.active { color:#6366f1; border-bottom-color:#6366f1; }
    .tab:hover { color:#a5b4fc; }
    .cnt { max-width:960px; margin:0 auto; padding:0 24px 60px; }
    .pnl { display:none; } .pnl.active { display:block; }
    .sec { margin-top:48px; margin-bottom:20px; }
    .sec h2 { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
    .sec p { font-size:13px; color:#64748b; margin-top:4px; }
    .panel { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:24px; line-height:1.8; font-size:14px; color:#cbd5e1; }
    .panel p { margin-bottom:12px; } .panel p:last-child { margin-bottom:0; }
    .cl { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:8px 16px; margin-bottom:24px; }
    .fl { background:#0f172a; border:1px solid #1e293b; border-radius:12px; overflow:hidden; }
    .foot { margin-top:48px; padding-top:24px; border-top:1px solid #1e293b; text-align:center; }
    .foot p { font-size:11px; color:#475569; font-family:'JetBrains Mono',monospace; }
    .dl-btn { position:fixed; bottom:24px; right:24px; padding:14px 24px; font-size:14px; font-weight:700; border-radius:12px; border:none; background:#6366f1; color:#fff; cursor:pointer; font-family:Inter,sans-serif; box-shadow:0 4px 20px #6366f144; z-index:20; transition:background 0.2s; }
    .dl-btn:hover { background:#4f46e5; }
    @media print {
      .dl-btn { display:none !important; }
      .tabs { display:none !important; }
      .pnl { display:none !important; }
      .pnl.active { display:block !important; page-break-inside:avoid; }
      body { background:#020617; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>

  <div class="hdr"><div class="hdr-in">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span style="font-size:10px;font-weight:700;letter-spacing:2px;color:#6366f1;text-transform:uppercase;font-family:'JetBrains Mono',monospace">Website Audit Report</span>
      <span style="font-size:10px;color:#475569">•</span>
      <span style="font-size:10px;color:#475569;font-family:'JetBrains Mono',monospace">${scanDate}</span>
    </div>
    <h1 style="font-size:36px;font-weight:900;margin:8px 0 4px;letter-spacing:-1.5px;background:linear-gradient(135deg,#e2e8f0,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent">${domain}</h1>
    <p style="font-size:13px;color:#64748b">${data.tech?.cms && data.tech.cms !== 'Unknown' ? data.tech.cms : 'No CMS detected'} • ${data.tech?.hosting || 'Unknown hosting'}</p>
  </div></div>

  <div class="tabs"><div class="tabs-in" id="tabBar">
    <button class="tab active" data-tab="overview">Overview</button>
    <button class="tab" data-tab="findings">Findings &amp; Strengths</button>
    <button class="tab" data-tab="revenue">💰 Revenue Impact</button>
  </div></div>

  <div class="cnt">
    <!-- OVERVIEW -->
    <div class="pnl active" id="p-overview">
      <div style="display:flex;flex-wrap:wrap;gap:32px;margin-top:32px;align-items:flex-start">
        <div style="text-align:center">${ringSvg}<div style="font-size:12px;color:#64748b;margin-top:8px">Overall Health Score</div></div>
        <div style="flex:1 1 300px;min-width:280px">${catBars}
          <div style="font-size:12px;color:#6366f1;margin-top:8px;font-weight:600">👆 Click any dimension for the deep-dive + WinTech Insights</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:32px">
        ${stat('Critical Issues', criticalCount, '#ef4444', 'Require immediate action')}
        ${stat('Strengths', wins.length, '#22c55e', 'Things done right')}
        ${stat('Total Findings', findings.length, '#f59e0b', 'Across all categories')}
        ${stat('TTFB', (perf.ttfb || '?') + 'ms', perf.ttfb && perf.ttfb < 200 ? '#22c55e' : '#f59e0b', 'Time to first byte')}
        ${stat('Page Words', seo.wordCount || '?', seo.wordCount >= 800 ? '#22c55e' : '#ef4444', 'Target: 800+')}
      </div>
      <div class="sec"><h2>Executive Summary</h2></div>
      <div class="panel">
        <p>This audit analyzed <strong>${domain}</strong> across ${Object.keys(cats).length} dimensions: ${Object.values(cats).map(c => c.name).join(', ')}.</p>
        <p>The site scored <strong style="color:${ringColor}">${overall}/100 (${gr(overall)})</strong>. ${overall < 40 ? 'This score indicates significant issues that are likely costing the business organic traffic, AI visibility, and lead generation.' : overall < 70 ? 'This score indicates room for improvement across multiple categories.' : 'This is a solid foundation with targeted improvements available.'}</p>
        <p>We identified <strong style="color:#22c55e">${wins.length} thing${wins.length === 1 ? '' : 's'} this site already does well</strong> alongside <strong>${findings.length} finding${findings.length === 1 ? '' : 's'}</strong> to address${criticalCount > 0 ? `, ${criticalCount} of them critical` : ''}.</p>
      </div>
      ${overviewInsight}
    </div>

    <!-- FINDINGS -->
    <div class="pnl" id="p-findings">
      <div class="sec"><h2>What You're Doing Well</h2><p>${wins.length} strength${wins.length === 1 ? '' : 's'} detected — credit where it's due</p></div>
      <div class="fl" style="border-left:3px solid #22c55e">${winsHtml}</div>
      <div class="sec" style="margin-top:28px"><h2>All Findings</h2><p>${findings.length} issue${findings.length === 1 ? '' : 's'} found — click to expand</p></div>
      <div class="fl">${findingsHtml}</div>
      ${findingsInsight}
    </div>

    <!-- PER-DIMENSION DRILL-DOWNS (WinTech Insights) — replaces the old per-dimension tabs -->
    ${dimPanelsHtml}

    <!-- REVENUE IMPACT -->
    <div class="pnl" id="p-revenue">
      <div class="sec" style="margin-top:24px"><h2>Revenue Impact Calculator</h2><p>Estimated pipeline opportunity from fixing audit findings — adjust sliders to match your business</p></div>
      <div id="revSummary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:6px"></div>
      <div style="font-size:12px;color:#6366f1;font-weight:600;margin-bottom:8px">👆 Click any number for what it means &amp; why it matters</div>
      <div id="revDetail" style="display:none;margin-bottom:8px;background:linear-gradient(135deg,#1e1b4b,#0f172a);border:1px solid #4f46e5;border-radius:12px;padding:18px 20px;font-size:13px;color:#cbd5e1;line-height:1.7"></div>
      <div class="sec"><h2>Cumulative Revenue Waterfall</h2><p>Monthly pipeline growth as fixes are applied — click a step to learn what it is</p></div>
      <div id="waterfall" style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:24px"></div>
      <div id="wfDetail" style="display:none;margin-top:12px;background:linear-gradient(135deg,#1e1b4b,#0f172a);border:1px solid #4f46e5;border-radius:12px;padding:18px 20px;font-size:13px;color:#cbd5e1;line-height:1.7"></div>
      <div class="sec"><h2>Impact by Fix Tier</h2><p>Each tier builds on the previous</p></div>
      <div id="tierGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px"></div>
      <div class="sec"><h2>Your Business Assumptions</h2><p>Drag to adjust — all calculations update instantly</p></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px">
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Monthly Visitors</div>
          <input type="range" id="sl-vis" min="100" max="50000" step="100" value="500" style="width:100%" oninput="calcRev()">
          <input type="text" id="v-vis" value="500" onchange="syncSl('vis')" style="background:transparent;border:1px solid transparent;border-radius:6px;color:#e2e8f0;font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;text-align:center;width:100%;padding:4px;outline:none;margin-top:8px" onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='transparent'" onkeydown="if(event.key==='Enter')this.blur()">
        </div>
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Deal Size (ARR)</div>
          <input type="range" id="sl-deal" min="5000" max="1000000" step="5000" value="75000" style="width:100%" oninput="calcRev()">
          <input type="text" id="v-deal" value="$75,000" onchange="syncSl('deal')" style="background:transparent;border:1px solid transparent;border-radius:6px;color:#e2e8f0;font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;text-align:center;width:100%;padding:4px;outline:none;margin-top:8px" onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='transparent'" onkeydown="if(event.key==='Enter')this.blur()">
        </div>
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Close Rate</div>
          <input type="range" id="sl-close" min="5" max="60" step="1" value="25" style="width:100%" oninput="calcRev()">
          <input type="text" id="v-close" value="25%" onchange="syncSl('close')" style="background:transparent;border:1px solid transparent;border-radius:6px;color:#e2e8f0;font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;text-align:center;width:100%;padding:4px;outline:none;margin-top:8px" onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='transparent'" onkeydown="if(event.key==='Enter')this.blur()">
        </div>
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Conversion Rate</div>
          <input type="range" id="sl-conv" min="0" max="15" step="0.1" value="0.3" style="width:100%" oninput="calcRev()">
          <input type="text" id="v-conv" value="0.3%" onchange="syncSl('conv')" style="background:transparent;border:1px solid transparent;border-radius:6px;color:#e2e8f0;font-size:20px;font-weight:800;font-family:'JetBrains Mono',monospace;text-align:center;width:100%;padding:4px;outline:none;margin-top:8px" onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='transparent'" onkeydown="if(event.key==='Enter')this.blur()">
        </div>
      </div>
      <div class="sec"><h2>Benchmark Sources</h2><p>Published data behind these estimates</p></div>
      <div class="panel" style="font-size:13px;line-height:1.8">
        <p><strong style="color:#6366f1">Organic Search Revenue Share:</strong> Organic search generates 44.6% of all B2B revenue, making it the largest single revenue channel. SEO drives roughly 62% of B2B website traffic. <span style="color:#64748b">— SalesHive, Oliver Munro (2025-2026)</span></p>
        <p><strong style="color:#6366f1">Conversion Benchmarks:</strong> Typical B2B SaaS visitor-to-lead conversion is 1.5%. Elite websites convert at 8-15%. A 1-point conversion lift cuts customer acquisition cost by 15-25%. <span style="color:#64748b">— First Page Sage, Klickflow, ConversionXperts (2026)</span></p>
        <p><strong style="color:#6366f1">Schema / Structured Data Impact:</strong> Websites using structured data see CTR improvements of 20-30%. 71% of pages cited by ChatGPT use schema markup. Pages with rich snippets see up to 82% higher CTR. <span style="color:#64748b">— Outpace SEO, Digital Applied, GW Content (2025-2026)</span></p>
        <p><strong style="color:#6366f1">Meta Tag Optimization:</strong> Pages with custom meta descriptions get ~5.8% more clicks. Well-optimized title tags and descriptions can boost CTR by 10-30%. Organic leads close at 14.6% vs 1.7% for outbound. <span style="color:#64748b">— SEMrush, Straight North, SalesHive (2025-2026)</span></p>
        <p><strong style="color:#6366f1">Pipeline Velocity:</strong> A 10% increase in win rate can boost pipeline velocity by 33%. MQL-to-SQL conversion typically offers the highest optimization leverage. <span style="color:#64748b">— The Digital Bloom (2025)</span></p>
        <p style="margin-top:16px;padding-top:16px;border-top:1px solid #1e293b;color:#64748b;font-size:12px"><strong>Disclaimer:</strong> These projections use published industry benchmarks applied to your current website audit data. Actual results will vary based on market conditions, competition, sales execution, and implementation quality. These are directional estimates, not guarantees.</p>
      </div>
    </div>

    <div class="foot">
      <p>Generated by WinTech Partners Website Intelligence Scanner • ${scanDate}</p>
    </div>
    <button class="dl-btn" onclick="window.print()">📄 Download PDF</button>
  </div>`;

  // ===== TAB SWITCHING + DIMENSION DRILL-DOWN =====
  function setActive(panelId, tabName) {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.pnl').forEach(p => p.classList.remove('active'));
    const p = document.getElementById(panelId);
    if (p) p.classList.add('active');
    if (tabName) { const t = document.querySelector('.tab[data-tab="' + tabName + '"]'); if (t) t.classList.add('active'); }
    window.scrollTo(0, 0);
  }
  // Open a dimension drill-down (deep-linkable via #dim-<key> so it can be shared/printed as its own page).
  window.showDim = function(key) {
    if (!document.getElementById('p-dim-' + key)) return;
    setActive('p-dim-' + key, null);
    if (history.replaceState) history.replaceState(null, '', '#dim-' + key); else location.hash = 'dim-' + key;
  };
  window.showTab = function(tab) {
    setActive('p-' + tab, tab);
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search); else location.hash = '';
  };
  document.getElementById('tabBar').addEventListener('click', function(e) {
    if (!e.target.classList.contains('tab')) return;
    window.showTab(e.target.dataset.tab);
  });
  // Honor a #dim-<key> deep link on load.
  (function() {
    const h = (location.hash || '').replace('#', '');
    if (h.indexOf('dim-') === 0) window.showDim(h.slice(4));
  })();

  // ===== REVENUE CALCULATOR =====
  // cLift is now a RELATIVE conversion uplift (e.g. 0.15 = +15% better conversion), not an
  // absolute percentage-point add. Stacking absolute points onto a tiny 0.3% base produced
  // implausible 8x conversion jumps; relative uplifts compound to a defensible improvement.
  // Each tier's upside is scaled by the gap THIS site actually has, measured from its own scan.
  // A site that already nails a tier gets ~0 lift there, so two different sites never produce
  // the same projection — and we only ever credit fixing things that are genuinely broken.
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const miss = (cond) => (cond ? 1 : 0); // 1 = missing / needs fixing

  // Tier 1 — SEO quick wins: title, meta description, single H1, Open Graph
  const gap1 = (miss(!seo.title?.value || seo.title.length < 15)
    + miss(!seo.metaDescription?.exists)
    + miss((seo.h1?.count || 0) !== 1)
    + miss(!seo.openGraph?.exists)) / 4;
  // Tier 2 — Schema & AEO: JSON-LD, Organization schema, FAQ schema
  const gap2 = (miss(!aeo.jsonLd?.exists)
    + miss(!aeo.organizationSchema)
    + miss(!aeo.faqSchema)) / 3;
  // Tier 3 — Content depth: homepage toward an 800-word target
  const gap3 = clamp01((800 - (seo.wordCount || 0)) / 800);
  // Tier 4 — Trust & conversion: a lead-capture form + security headers
  const headersSet = (sec.headers && sec.headers.headersSet) || 0;
  const gap4 = clamp01((miss(!(trust.forms > 0)) + clamp01((4 - headersSet) / 4)) / 2);

  const TIERS = [
    { num:'Tier 1', title:'SEO Quick Wins', desc:'Title, meta description, H1, Open Graph tags', tLift:0.20*gap1, cLift:0.15*gap1, gap:gap1, color:'#22c55e', bg:'#22c55e11', bc:'#22c55e33' },
    { num:'Tier 2', title:'Schema & AEO', desc:'JSON-LD, Organization schema, FAQ markup', tLift:0.25*gap2, cLift:0.10*gap2, gap:gap2, color:'#6366f1', bg:'#6366f111', bc:'#6366f133' },
    { num:'Tier 3', title:'Content Expansion', desc:'Homepage copy 800+ words, blog articles, case studies', tLift:0.50*gap3, cLift:0.15*gap3, gap:gap3, color:'#f59e0b', bg:'#f59e0b11', bc:'#f59e0b33' },
    { num:'Tier 4', title:'Trust & Conversion', desc:'Lead capture forms, security headers, testimonials', tLift:0.0, cLift:0.30*gap4, gap:gap4, color:'#60a5fa', bg:'#60a5fa11', bc:'#60a5fa33' },
  ];
  const CONV_CEILING = 0.05; // hard cap at 5% — keeps results below the 8–15% "elite" benchmark

  function syncSl(which) {
    const input = document.getElementById('v-' + which);
    const slider = document.getElementById('sl-' + which);
    const raw = input.value.replace(/[^0-9.]/g, '');
    let num = parseFloat(raw);
    if (isNaN(num)) { calcRev(); return; }
    num = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), num));
    num = Math.round(num / parseFloat(slider.step)) * parseFloat(slider.step);
    slider.value = num;
    calcRev();
  }

  window.syncSl = syncSl;

  // ===== "What is this?" explanations for the revenue metrics & waterfall steps =====
  const METRIC_INFO = {
    pipeline: ['Additional Monthly Pipeline', 'The extra sales pipeline this site could generate <em>each month</em> after the fixes in this report — over and above what it produces today.', 'Pipeline is the dollar value of new opportunities entering your funnel. It is the earliest sign that marketing is working, and it compounds month over month.', '(improved monthly leads − today&rsquo;s monthly leads) × your deal size.'],
    annual: ['Annual Pipeline Impact', 'The monthly pipeline gain projected across a full year.', 'A modest-looking monthly number becomes the real yearly opportunity — the figure you would weigh budget and ROI against.', 'Additional Monthly Pipeline × 12.'],
    revenue: ['Est. Annual Revenue Gain', 'The share of that new annual pipeline you would actually <em>win</em>, based on your close rate.', 'Pipeline is potential; revenue is money in the bank. This is the bottom-line number to compare against the cost of doing the work.', 'Annual Pipeline Impact × your close rate (set under &ldquo;Your Business Assumptions&rdquo;).'],
    leads: ['New Leads / Month', 'The additional inquiries or form-fills per month the improvements could produce.', 'Leads are the raw input to everything downstream — at the same close rate, more qualified leads means more deals, and it is the metric your team feels first.', '(improved conversion rate × monthly visitors) − today&rsquo;s leads.'],
  };
  const WF_INFO = [
    ['Current State', 'Where your pipeline sits <em>today</em>, before any fixes.', 'This is the baseline every bar to the right builds on: current monthly visitors × current conversion rate × deal size.'],
    ['Tier 1 — SEO Quick Wins', 'Adds the lift from fixing on-page SEO basics: title tag, meta description, H1, and Open Graph tags.', 'These are the first signals Google reads to rank and display you — the cheapest, fastest wins, usually hours of work rather than weeks. (If this site already has them, this step stays flat.)'],
    ['Tier 2 — Schema &amp; AEO', 'Adds structured data / schema so AI answer engines (ChatGPT, Perplexity, Google AI Overviews) can read and cite your business.', 'A growing share of buyers now start in AI tools instead of Google. Being machine-readable keeps you visible where they are actually looking.'],
    ['Tier 3 — Content', 'Adds the lift from deeper content: an 800+ word homepage, articles, and case studies.', 'Content is what ranks for more search terms and answers buyer questions — it drives both traffic and trust at once.'],
    ['Tier 4 — Trust &amp; Conversion', 'Adds conversion lift from trust signals and lead capture: forms, security headers, testimonials.', 'This is what turns the extra traffic from the earlier tiers into actual leads. Without it, you attract visitors but have no way to capture them.'],
  ];
  function renderRevDetail(elId, title, parts) {
    const labels = ['What it is:', 'Why it matters:', 'The math:'];
    const el = document.getElementById(elId);
    el.innerHTML = `<div style="font-size:14px;font-weight:800;color:#a5b4fc;margin-bottom:10px">💡 ${title}</div>` +
      parts.map((p, i) => `<p style="margin:0 0 8px"><strong style="color:#e2e8f0">${labels[i] || ''}</strong> ${p}</p>`).join('');
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  window.explainMetric = function(key) { const m = METRIC_INFO[key]; if (m) renderRevDetail('revDetail', m[0], m.slice(1)); };
  window.explainWaterfall = function(i) { const w = WF_INFO[i]; if (w) renderRevDetail('wfDetail', w[0], w.slice(1)); };

  function calcRev() {
    const visitors = parseInt(document.getElementById('sl-vis').value);
    const deal = parseInt(document.getElementById('sl-deal').value);
    const closeRate = parseInt(document.getElementById('sl-close').value) / 100;
    const currentConv = parseFloat(document.getElementById('sl-conv').value) / 100;

    document.getElementById('v-vis').value = visitors.toLocaleString();
    document.getElementById('v-deal').value = '$' + deal.toLocaleString();
    document.getElementById('v-close').value = document.getElementById('sl-close').value + '%';
    document.getElementById('v-conv').value = document.getElementById('sl-conv').value + '%';

    const currentLeads = visitors * currentConv;
    const currentPipeline = currentLeads * deal;

    let cumV = visitors, cumC = currentConv;
    const tierR = TIERS.map(t => {
      const pV = cumV, pC = cumC;
      cumV = Math.round(cumV * (1 + t.tLift));
      cumC = Math.min(CONV_CEILING, cumC * (1 + t.cLift)); // relative uplift, capped at the ceiling
      const nL = cumV * cumC, aL = Math.max(0, nL - pV * pC);
      return { ...t, addedLeads: aL, addedPipeline: aL * deal, cumPipeline: nL * deal };
    });

    // Tier cards
    document.getElementById('tierGrid').innerHTML = tierR.map(t => `
      <div style="background:#0f172a;border:1px solid ${t.bc};border-radius:12px;padding:20px">
        <div style="font-size:10px;font-weight:700;color:#475569;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;font-family:'JetBrains Mono',monospace">${t.num}</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:4px">${t.title}</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:14px;line-height:1.5">${t.desc}</div>
        ${t.gap <= 0.01 ? '<div style="display:inline-block;font-size:11px;font-weight:700;color:#22c55e;background:#22c55e15;border:1px solid #22c55e33;border-radius:6px;padding:3px 8px;margin-bottom:10px">✓ Already in place — no action needed</div>' : ''}
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #1e293b"><span style="font-size:11px;color:#94a3b8">Traffic lift</span><span style="font-size:14px;font-weight:700;color:${t.tLift>0?t.color:'#475569'};font-family:'JetBrains Mono',monospace">+${Math.round(t.tLift*100)}%</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #1e293b"><span style="font-size:11px;color:#94a3b8">Conv. uplift</span><span style="font-size:14px;font-weight:700;color:${t.color};font-family:'JetBrains Mono',monospace">+${Math.round(t.cLift*100)}%</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #1e293b"><span style="font-size:11px;color:#94a3b8">New leads/mo</span><span style="font-size:14px;font-weight:700;color:${t.color};font-family:'JetBrains Mono',monospace">+${t.addedLeads.toFixed(1)}</span></div>
        <div style="margin-top:14px;padding:12px;border-radius:8px;text-align:center;background:${t.bg}">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:${t.color};margin-bottom:2px">Added Pipeline / Month</div>
          <div style="font-size:22px;font-weight:800;color:${t.color};font-family:'JetBrains Mono',monospace">${fmt(t.addedPipeline)}</div>
        </div>
      </div>`).join('');

    // Waterfall
    const wfData = [
      { label:'Current State', value:currentPipeline, color:'#475569' },
      { label:'+ Tier 1: SEO', value:tierR[0].cumPipeline, color:'#22c55e' },
      { label:'+ Tier 2: AEO', value:tierR[1].cumPipeline, color:'#6366f1' },
      { label:'+ Tier 3: Content', value:tierR[2].cumPipeline, color:'#f59e0b' },
      { label:'+ Tier 4: Trust', value:tierR[3].cumPipeline, color:'#60a5fa' },
    ];
    const wfMax = Math.max(...wfData.map(w=>w.value),1);
    document.getElementById('waterfall').innerHTML = wfData.map((w, i) => {
      const pct = Math.max((w.value/wfMax)*100, 5);
      return `<div onclick="explainWaterfall(${i})" title="Click to learn what this step is" style="display:flex;align-items:center;gap:12px;margin-bottom:12px;cursor:pointer;border-radius:6px;padding:2px;transition:background 0.15s" onmouseover="this.style.background='#1e293b66'" onmouseout="this.style.background='transparent'">
        <span style="width:140px;font-size:12px;color:#94a3b8;text-align:right;flex-shrink:0">${w.label}</span>
        <div style="flex:1;height:36px;background:#1e293b;border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${w.color}88,${w.color});border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;font-size:12px;font-weight:700;color:#fff;font-family:'JetBrains Mono',monospace;min-width:60px">${fmt(w.value)}</div>
        </div></div>`;
    }).join('');

    // Summary
    const totalAdded = tierR[3].cumPipeline - currentPipeline;
    const totalLeads = cumV * cumC - currentLeads;
    const totalRev = totalAdded * closeRate;
    const metricCard = (key, label, value, color) => `
      <div onclick="explainMetric('${key}')" title="Click for what this means &amp; why it matters" style="border-radius:12px;padding:24px 24px 18px;text-align:center;border:1px solid ${color}33;background:${color}08;cursor:pointer;transition:border-color 0.15s" onmouseover="this.style.borderColor='${color}'" onmouseout="this.style.borderColor='${color}33'">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:${color};margin-bottom:6px">${label}</div>
        <div style="font-size:32px;font-weight:900;color:${color};font-family:'JetBrains Mono',monospace">${value}</div>
        <div style="font-size:10px;color:#64748b;margin-top:8px;font-weight:600">ⓘ what is this?</div>
      </div>`;
    document.getElementById('revSummary').innerHTML =
      metricCard('pipeline', 'Additional Monthly Pipeline', fmt(totalAdded), '#22c55e') +
      metricCard('annual', 'Annual Pipeline Impact', fmt(totalAdded * 12), '#6366f1') +
      metricCard('revenue', 'Est. Annual Revenue Gain', fmt(totalRev * 12), '#f59e0b') +
      metricCard('leads', 'New Leads / Month', '+' + totalLeads.toFixed(1), '#ef4444');
  }
  window.calcRev = calcRev;
  calcRev();

})();
