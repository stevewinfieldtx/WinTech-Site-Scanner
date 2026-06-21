const fetch = require('node-fetch');
const cheerio = require('cheerio');
const https = require('https');
const { URL } = require('url');

// ============================================================
// SCANNER ENGINE
// Runs all checks and returns structured audit data
// ============================================================

async function fullScan(targetUrl) {
  const start = Date.now();
  const url = normalizeUrl(targetUrl);
  const domain = new URL(url).hostname;

  // Parallel execution of independent checks
  const labels = ['html', 'ssl', 'headers', 'robots', 'sitemap', 'observatory', 'pagespeed', 'llmsTxt', 'securityTxt'];
  const [htmlResult, sslResult, headersResult, robotsResult, sitemapResult, observatoryResult, pagespeedResult, llmsTxtResult, securityTxtResult] = await Promise.allSettled([
    fetchAndParseHtml(url),
    checkSsl(domain),
    checkHeaders(url),
    checkRobotsTxt(url),
    checkSitemap(url),
    checkMozillaObservatory(domain),
    checkPageSpeed(url),
    checkLlmsTxt(url),
    checkSecurityTxt(url),
  ]);

  // Log which checks passed vs failed
  const results = [htmlResult, sslResult, headersResult, robotsResult, sitemapResult, observatoryResult, pagespeedResult, llmsTxtResult, securityTxtResult];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`[SCAN] ✅ ${labels[i]} completed`);
    } else {
      console.log(`[SCAN] ❌ ${labels[i]} FAILED: ${r.reason?.message || r.reason}`);
    }
  });

  const html = val(htmlResult, {});
  const ssl = val(sslResult, {});
  const headers = val(headersResult, {});
  const robots = val(robotsResult, {});
  const sitemap = val(sitemapResult, {});
  let observatory = val(observatoryResult, {});
  const pagespeed = val(pagespeedResult, {});
  const llmsTxt = val(llmsTxtResult, {});
  const securityTxt = val(securityTxtResult, {});

  // If the Mozilla Observatory API was unavailable (Pending / N/A / error), compute an
  // equivalent letter grade in-house from the response headers we already read. This removes
  // the third-party dependency and eliminates the "Pending / N/A" gap on every report.
  const OBS_GRADES = ['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'];
  if (!observatory || !OBS_GRADES.includes(observatory.grade)) {
    const g = computeHeaderGrade(headers.security || {}, ssl);
    observatory = { grade: g.grade, score: g.score, source: 'computed' };
  } else {
    observatory.source = 'mozilla';
  }

  // Calculate scores
  const scores = calculateScores({ html, ssl, headers, robots, sitemap, observatory, pagespeed, llmsTxt, securityTxt });
  const findings = generateFindings({ html, ssl, headers, robots, sitemap, observatory, pagespeed, llmsTxt, securityTxt });
  const contentHash = generateHash({ html, headers });

  console.log(`[SCAN] Completed ${domain} in ${Date.now() - start}ms`);

  return {
    domain,
    url,
    scanDate: new Date().toISOString(),
    scanDuration: Date.now() - start,
    contentHash,
    tech: {
      cms: html.cms || 'Unknown',
      theme: html.theme || 'Unknown',
      hosting: detectHosting(headers),
    },
    performance: {
      ttfb: html.ttfb || null,
      totalLoad: html.totalLoad || null,
      pageSize: html.pageSize || 0,
      cssFiles: html.cssFiles || 0,
      jsFiles: html.jsFiles || 0,
      renderBlockingJs: html.renderBlockingJs || 0,
      lazyLoadedImages: html.lazyLoadedImages || 0,
      totalImages: html.totalImages || 0,
      googleFonts: html.googleFonts || 0,
      pagespeed: pagespeed,
    },
    seo: html.seo || {},
    aeo: html.aeo || {},
    security: {
      ssl,
      headers: headers.security || {},
      observatory,
      securityTxt,
      wpExposure: html.wpExposure || {},
    },
    trust: html.trust || {},
    accessibility: html.accessibility || {},
    bestPractices: html.bestPractices || {},
    i18n: html.i18n || {},
    analytics: html.analytics || {},
    privacy: html.privacy || {},
    llmsTxt,
    scores,
    findings,
  };
}

// Quick scan - just fetch HTML and compare hash
async function quickScan(targetUrl, previousHash) {
  const url = normalizeUrl(targetUrl);
  try {
    const startTime = Date.now();
    const resp = await fetch(url, { timeout: 15000, headers: { 'User-Agent': 'WinTech-Site-Scanner/1.0' } });
    const body = await resp.text();
    const totalLoad = Date.now() - startTime;
    const newHash = simpleHash(body);
    return {
      changed: newHash !== previousHash,
      hash: newHash,
      totalLoad,
      pageSize: body.length,
    };
  } catch (err) {
    return { changed: true, hash: null, error: err.message };
  }
}

// Partial scan - only rescan specific categories
async function partialScan(targetUrl, categories) {
  const url = normalizeUrl(targetUrl);
  const domain = new URL(url).hostname;
  const results = {};

  const tasks = [];
  if (categories.includes('html')) tasks.push(fetchAndParseHtml(url).then(r => results.html = r));
  if (categories.includes('ssl')) tasks.push(checkSsl(domain).then(r => results.ssl = r));
  if (categories.includes('headers')) tasks.push(checkHeaders(url).then(r => results.headers = r));
  if (categories.includes('observatory')) tasks.push(checkMozillaObservatory(domain).then(r => results.observatory = r));
  if (categories.includes('pagespeed')) tasks.push(checkPageSpeed(url).then(r => results.pagespeed = r));

  await Promise.allSettled(tasks);
  return results;
}


// ============================================================
// HTML FETCH + PARSE
// ============================================================

async function fetchAndParseHtml(url) {
  const startTime = Date.now();
  const resp = await fetch(url, {
    timeout: 20000,
    headers: { 'User-Agent': 'WinTech-Site-Scanner/1.0' },
  });
  const ttfb = Date.now() - startTime;
  const body = await resp.text();
  const totalLoad = Date.now() - startTime;
  const $ = cheerio.load(body);

  // SEO
  const title = $('title').first().text().trim();
  const metaDesc = $('meta[name="description"]').attr('content') || null;
  const canonical = $('link[rel="canonical"]').attr('href') || null;
  const h1s = $('h1').map((_, el) => $(el).text().trim()).get();
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get();
  const h3s = $('h3').map((_, el) => $(el).text().trim()).get();
  const ogTitle = $('meta[property="og:title"]').attr('content') || null;
  const ogDesc = $('meta[property="og:description"]').attr('content') || null;
  const ogImage = $('meta[property="og:image"]').attr('content') || null;
  const twitterCard = $('meta[name="twitter:card"]').attr('content') || null;
  const viewport = $('meta[name="viewport"]').attr('content') || null;
  const htmlLang = $('html').attr('lang') || null;

  // Heading hierarchy check (must start at H1, then no skipped levels)
  const allHeadings = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    allHeadings.push(parseInt(el.tagName.replace('h', '').replace('H', '')));
  });
  const headingHierarchyValid = checkHeadingHierarchy(allHeadings, h1s.length);

  // Images
  const images = $('img').map((_, el) => ({
    src: $(el).attr('src') || '',
    alt: $(el).attr('alt'),
    loading: $(el).attr('loading'),
    width: $(el).attr('width'),
    height: $(el).attr('height'),
  })).get();
  const imagesWithAlt = images.filter(i => i.alt && i.alt.trim().length > 0).length;
  const lazyImages = images.filter(i => i.loading === 'lazy').length;

  // Links
  const domain = new URL(url).hostname;
  const allLinks = $('a[href]').map((_, el) => $(el).attr('href')).get();
  const internalLinks = allLinks.filter(h => h.startsWith('/') || h.includes(domain)).length;
  const externalLinks = allLinks.filter(h => h.startsWith('http') && !h.includes(domain)).length;

  // Content
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(/\s+/).filter(w => w.length > 1).length;

  // Schema / JSON-LD — extract @type across @graph containers and arrays
  const jsonLdScripts = $('script[type="application/ld+json"]').map((_, el) => {
    try { return JSON.parse($(el).html()); } catch { return null; }
  }).get().filter(Boolean);
  // Combine JSON-LD types with microdata (itemtype) and RDFa (typeof) so structured data
  // isn't undercounted just because it uses a different (but valid) format.
  const schemaTypes = [...new Set([...extractSchemaTypes(jsonLdScripts), ...extractMicrodataRdfaTypes($)])];
  const hasStructuredData = jsonLdScripts.length > 0 || schemaTypes.length > 0;

  // CMS detection
  let cms = null;
  let theme = null;
  const generator = $('meta[name="generator"]').first().attr('content') || '';
  if (generator.includes('WordPress') || body.includes('wp-content')) {
    cms = generator || 'WordPress';
    const themeMatch = body.match(/themes\/([^/]+)/);
    if (themeMatch) theme = themeMatch[1];
  } else if (body.includes('Shopify')) {
    cms = 'Shopify';
  } else if (body.includes('Squarespace')) {
    cms = 'Squarespace';
  } else if (body.includes('Wix')) {
    cms = 'Wix';
  }

  // Asset counts
  const cssFiles = $('link[rel="stylesheet"]').length;
  const jsFiles = $('script[src]').length;
  const renderBlockingJs = $('script[src]').filter((_, el) => {
    const s = $(el);
    return !s.attr('defer') && !s.attr('async');
  }).length;
  const googleFonts = (body.match(/fonts\.googleapis\.com/g) || []).length;

  // Trust signals
  const forms = $('form').length;
  const hasPhone = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(bodyText);
  const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(bodyText);
  const socialLinks = $('a[href*="linkedin"], a[href*="twitter"], a[href*="facebook"], a[href*="instagram"]').length;
  const hasPrivacyPolicy = $('a[href*="privacy"], a[href*="policy"]').length > 0;

  // WP exposure
  const wpExposure = {};
  if (cms && cms.includes('WordPress')) {
    wpExposure.versionExposed = generator.includes('WordPress');
    wpExposure.version = generator;
    // We'll check REST API separately if needed
  }

  // Hreflang
  const hreflang = $('link[hreflang]').length > 0;

  // Favicons
  const favicons = $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').length;

  // ── Accessibility signals ──
  const formFields = $('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea');
  let labeledFields = 0;
  formFields.each((_, el) => {
    const $el = $(el);
    const id = $el.attr('id');
    const labeled = (id && $('label[for="' + id + '"]').length > 0) || $el.attr('aria-label') || $el.attr('aria-labelledby') || $el.attr('title');
    if (labeled) labeledFields++;
  });
  const landmarks = $('main, nav, header, footer, aside, [role="main"], [role="navigation"], [role="banner"], [role="contentinfo"]').length;
  const genericLinkText = $('a[href]').filter((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
    return t === '' || ['click here', 'here', 'read more', 'learn more', 'link', 'this'].includes(t);
  }).length;

  // ── Internationalization signals ──
  const charset = $('meta[charset]').attr('charset')
    || (($('meta[http-equiv="Content-Type"]').attr('content') || '').match(/charset=([\w-]+)/i) || [])[1]
    || null;
  const hreflangCount = $('link[hreflang]').length;
  const htmlDir = $('html').attr('dir') || null;

  // ── Analytics / measurability signals ──
  const scriptText = ($('script[src]').map((_, el) => $(el).attr('src') || '').get().join(' ')
    + ' ' + $('script:not([src])').map((_, el) => $(el).html() || '').get().join(' ')).toLowerCase();
  const detectors = {
    ga4: /googletagmanager\.com\/gtag|google-analytics\.com|gtag\s*\(/.test(scriptText),
    gtm: /googletagmanager\.com\/gtm|datalayer|gtm-/.test(scriptText),
    metaPixel: /connect\.facebook\.net|fbq\s*\(/.test(scriptText),
    linkedin: /snap\.licdn\.com|_linkedin_partner_id/.test(scriptText),
    googleAds: /googleadservices|google_conversion|aw-\d/.test(scriptText),
    hotjar: /static\.hotjar|hotjar\.com/.test(scriptText),
    clarity: /clarity\.ms/.test(scriptText),
    mixpanel: /mixpanel/.test(scriptText),
    segment: /cdn\.segment\.com|segment\.io/.test(scriptText),
    plausible: /plausible\.io/.test(scriptText),
    fathom: /usefathom\.com/.test(scriptText),
  };
  const analyticsTools = Object.keys(detectors).filter(k => detectors[k]);
  const hasTagManager = detectors.gtm;
  const hasAdPixel = detectors.metaPixel || detectors.linkedin || detectors.googleAds;
  const hasHeatmap = detectors.hotjar || detectors.clarity || detectors.mixpanel || detectors.segment;

  // ── Privacy / compliance signals ──
  const cookieConsent = /cookiebot|onetrust|osano|cookieconsent|termly|iubenda|usercentrics|trustarc|cookieyes|complianz|quantcast|didomi/.test(scriptText)
    || $('[id*="cookie" i],[class*="cookie-consent" i],[class*="cookie-banner" i],[class*="cookiebanner" i],[aria-label*="cookie" i]').length > 0;
  const hasTerms = $('a[href*="terms" i], a[href*="/tos" i], a[href*="legal" i], a[href*="conditions" i]').length > 0;

  return {
    ttfb,
    totalLoad,
    pageSize: body.length,
    rawHtml: body,
    cms,
    theme,
    cssFiles,
    jsFiles,
    renderBlockingJs,
    googleFonts,
    totalImages: images.length,
    lazyLoadedImages: lazyImages,
    seo: {
      title: { value: title, length: title.length },
      metaDescription: { value: metaDesc, exists: !!metaDesc },
      h1: { values: h1s, count: h1s.length },
      h2: { values: h2s, count: h2s.length },
      canonical: { value: canonical, exists: !!canonical },
      openGraph: { title: ogTitle, description: ogDesc, image: ogImage, exists: !!(ogTitle || ogDesc || ogImage) },
      twitterCards: { card: twitterCard, exists: !!twitterCard },
      altText: { total: images.length, withAlt: imagesWithAlt, pct: images.length ? Math.round(imagesWithAlt / images.length * 100) : 0 },
      internalLinks,
      externalLinks,
      wordCount,
      hreflang,
      viewport: !!viewport,
      htmlLang,
      headingHierarchy: headingHierarchyValid,
      h3: { values: h3s, count: h3s.length },
      favicons,
    },
    aeo: {
      // count reflects distinct schema types so it always matches the list shown in the report
      jsonLd: { exists: hasStructuredData, count: schemaTypes.length, types: schemaTypes },
      faqSchema: schemaTypes.includes('FAQPage'),
      howToSchema: schemaTypes.includes('HowTo'),
      breadcrumbs: schemaTypes.includes('BreadcrumbList'),
      organizationSchema: schemaTypes.includes('Organization') || schemaTypes.includes('LocalBusiness'),
    },
    trust: {
      forms,
      hasPhone,
      hasEmail,
      socialLinks,
      hasPrivacyPolicy,
    },
    accessibility: {
      altPct: images.length ? Math.round(imagesWithAlt / images.length * 100) : null,
      htmlLang: !!htmlLang,
      headingHierarchy: headingHierarchyValid,
      formFields: formFields.length,
      labeledFields,
      landmarks,
      genericLinkText,
    },
    bestPractices: {
      https: url.startsWith('https'),
      charset: !!charset,
      viewport: !!viewport,
      doctype: /^\s*<!DOCTYPE/i.test(body),
      favicons,
    },
    i18n: {
      htmlLang: htmlLang || null,
      charset: charset || null,
      hreflang,
      hreflangCount,
      dir: htmlDir,
    },
    analytics: {
      tools: analyticsTools,
      count: analyticsTools.length,
      hasAny: analyticsTools.length > 0,
      hasTagManager,
      hasAdPixel,
      hasHeatmap,
    },
    privacy: {
      hasPrivacyPolicy,
      hasTerms,
      cookieConsent,
    },
    wpExposure,
    images,
  };
}


// ============================================================
// SSL LABS API (free)
// ============================================================

async function checkSsl(domain) {
  try {
    // Start analysis
    const startUrl = `https://api.ssllabs.com/api/v3/analyze?host=${domain}&publish=off&startNew=off&fromCache=on&maxAge=24`;
    const resp = await fetch(startUrl, { timeout: 10000 });
    const data = await resp.json();

    if (data.status === 'READY' && data.endpoints && data.endpoints.length > 0) {
      const ep = data.endpoints[0];
      return {
        grade: ep.grade || 'Unknown',
        hasWarnings: ep.hasWarnings || false,
        isExceptional: ep.isExceptional || false,
        valid: true,
        details: ep.statusMessage || '',
      };
    } else if (data.status === 'IN_PROGRESS' || data.status === 'DNS') {
      // Analysis in progress, return basic check
      return await basicSslCheck(domain);
    } else {
      return await basicSslCheck(domain);
    }
  } catch (err) {
    return await basicSslCheck(domain);
  }
}

async function basicSslCheck(domain) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: domain, port: 443, method: 'HEAD', rejectUnauthorized: true }, (res) => {
      const cert = res.socket.getPeerCertificate();
      resolve({
        valid: true,
        grade: null,
        issuer: cert.issuer ? cert.issuer.O : 'Unknown',
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        subject: cert.subject ? cert.subject.CN : domain,
      });
    });
    req.on('error', (err) => {
      resolve({ valid: false, error: err.message });
    });
    req.setTimeout(8000, () => { req.destroy(); resolve({ valid: false, error: 'Timeout' }); });
    req.end();
  });
}


// ============================================================
// MOZILLA OBSERVATORY API (free)
// ============================================================

async function checkMozillaObservatory(domain) {
  // The legacy v1 host (http-observatory.security.mozilla.org) was retired.
  // Observatory now lives on MDN: POST /api/v2/scan?host=<host> returns grade/score directly.
  try {
    const resp = await fetch(`https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${encodeURIComponent(domain)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    const data = await resp.json();

    if (data && data.grade) {
      return {
        grade: data.grade,
        score: typeof data.score === 'number' ? data.score : null,
        testsPassed: data.tests_passed || 0,
        testsFailed: data.tests_failed || 0,
        testsTotal: data.tests_quantity || ((data.tests_passed || 0) + (data.tests_failed || 0)),
        detailsUrl: data.details_url || null,
        scannedAt: data.scanned_at || null,
      };
    }

    // Rate-limited or still processing — surface a neutral "Pending" rather than a hard error
    if (data && (data.error || resp.status === 429)) {
      return { grade: 'Pending', score: null, note: data.error || 'Scan rate-limited, retry shortly' };
    }

    return { grade: 'N/A', score: null };
  } catch (err) {
    return { grade: 'N/A', score: null, error: err.message };
  }
}


// ============================================================
// GOOGLE PAGESPEED INSIGHTS (free)
// ============================================================

async function checkPageSpeed(url) {
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo`;
    const resp = await fetch(apiUrl, { timeout: 30000 });
    const data = await resp.json();

    if (data.error) {
      return { error: data.error.message };
    }

    const cats = data.lighthouseResult?.categories || {};
    const audits = data.lighthouseResult?.audits || {};

    const scores = {};
    for (const [key, cat] of Object.entries(cats)) {
      scores[key] = cat.score !== null ? Math.round(cat.score * 100) : null;
    }

    const metrics = {};
    const metricKeys = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index', 'interactive'];
    for (const key of metricKeys) {
      if (audits[key]) {
        metrics[key] = {
          value: audits[key].displayValue || null,
          score: audits[key].score !== null ? Math.round(audits[key].score * 100) : null,
        };
      }
    }

    // Collect failing audits
    const failures = [];
    for (const [key, audit] of Object.entries(audits)) {
      if (audit.score !== null && audit.score < 0.5 && audit.title) {
        failures.push({ id: key, title: audit.title, score: Math.round(audit.score * 100) });
      }
    }

    return { scores, metrics, failures };
  } catch (err) {
    return { error: err.message };
  }
}


// ============================================================
// HTTP HEADERS CHECK
// ============================================================

async function checkHeaders(url) {
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      timeout: 10000,
      redirect: 'follow',
      headers: { 'User-Agent': 'WinTech-Site-Scanner/1.0' },
    });

    const h = resp.headers;
    // The 6 security headers modern best practice recommends and that the report displays.
    // (X-XSS-Protection is intentionally excluded — it is deprecated and now recommended to be off.)
    const securityHeaders = {
      hsts: h.get('strict-transport-security') || null,
      csp: h.get('content-security-policy') || null,
      xFrame: h.get('x-frame-options') || null,
      xContentType: h.get('x-content-type-options') || null,
      referrerPolicy: h.get('referrer-policy') || null,
      permissionsPolicy: h.get('permissions-policy') || h.get('feature-policy') || null,
    };

    const headersSet = Object.values(securityHeaders).filter(Boolean).length;
    const headersTotal = Object.keys(securityHeaders).length;

    return {
      statusCode: resp.status,
      server: h.get('server') || null,
      poweredBy: h.get('x-powered-by') || null,
      contentType: h.get('content-type') || null,
      security: { ...securityHeaders, headersSet, headersTotal },
    };
  } catch (err) {
    return { error: err.message, security: { headersSet: 0, headersTotal: 6 } };
  }
}


// ============================================================
// ROBOTS.TXT + SITEMAP
// ============================================================

async function checkRobotsTxt(url) {
  try {
    const origin = new URL(url).origin;
    const resp = await fetch(`${origin}/robots.txt`, { timeout: 8000 });
    if (resp.status === 200) {
      const body = await resp.text();
      return { exists: true, content: body.substring(0, 2000), size: body.length };
    }
    return { exists: false };
  } catch { return { exists: false }; }
}

async function checkSitemap(url) {
  const origin = new URL(url).origin;
  const paths = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'];

  for (const path of paths) {
    try {
      const resp = await fetch(`${origin}${path}`, { timeout: 8000, redirect: 'follow' });
      if (resp.status === 200) {
        const body = await resp.text();
        const urlCount = (body.match(/<loc>/g) || []).length;
        return { exists: true, path, urlCount };
      }
    } catch { continue; }
  }
  return { exists: false };
}


// ============================================================
// LLMS.TXT CHECK (AEO)
// ============================================================

async function checkLlmsTxt(url) {
  const origin = new URL(url).origin;
  try {
    const resp = await fetch(`${origin}/llms.txt`, { timeout: 8000 });
    if (resp.status === 200) {
      const body = await resp.text();
      // Basic validation: should contain some text, not an HTML error page
      if (body.length > 10 && !body.includes('<!DOCTYPE') && !body.includes('<html')) {
        return { exists: true, size: body.length, preview: body.substring(0, 500) };
      }
    }
    return { exists: false };
  } catch { return { exists: false }; }
}


// ============================================================
// SECURITY.TXT CHECK
// ============================================================

async function checkSecurityTxt(url) {
  const origin = new URL(url).origin;
  const paths = ['/.well-known/security.txt', '/security.txt'];

  for (const path of paths) {
    try {
      const resp = await fetch(`${origin}${path}`, { timeout: 8000 });
      if (resp.status === 200) {
        const body = await resp.text();
        if (body.length > 10 && !body.includes('<!DOCTYPE') && !body.includes('<html')) {
          const hasContact = /contact:/i.test(body);
          const hasExpires = /expires:/i.test(body);
          return { exists: true, path, hasContact, hasExpires, size: body.length };
        }
      }
    } catch { continue; }
  }
  return { exists: false };
}


// ============================================================
// WP REST API EXPOSURE CHECK
// ============================================================

async function checkWpExposure(url) {
  const origin = new URL(url).origin;
  const exposure = { restApi: false, usersExposed: false, users: [] };

  try {
    const apiResp = await fetch(`${origin}/wp-json/`, { timeout: 8000 });
    if (apiResp.status === 200) {
      exposure.restApi = true;
      const data = await apiResp.json();
      exposure.siteName = data.name;
      exposure.siteDesc = data.description;
    }
  } catch {}

  try {
    const usersResp = await fetch(`${origin}/wp-json/wp/v2/users`, { timeout: 8000 });
    if (usersResp.status === 200) {
      const users = await usersResp.json();
      if (Array.isArray(users) && users.length > 0) {
        exposure.usersExposed = true;
        exposure.users = users.map(u => ({ name: u.name, slug: u.slug, id: u.id }));
      }
    }
  } catch {}

  return exposure;
}


// ============================================================
// SCORING ENGINE
// ============================================================

function calculateScores(data) {
  const { html, ssl, headers, robots, sitemap, observatory, pagespeed } = data;
  const seo = html.seo || {};
  const aeo = html.aeo || {};

  // SEO Score (0-100)
  let seoScore = 0;
  if (seo.title?.value && seo.title.length >= 10 && seo.title.length <= 60) seoScore += 15;
  else if (seo.title?.value) seoScore += 5;
  if (seo.metaDescription?.exists) seoScore += 15;
  if (seo.h1?.count === 1) seoScore += 15;
  else if (seo.h1?.count > 0) seoScore += 8;
  if (seo.canonical?.exists) seoScore += 10;
  if (seo.openGraph?.exists) seoScore += 10;
  if (seo.twitterCards?.exists) seoScore += 5;
  if (seo.altText?.pct >= 90) seoScore += 10;
  else if (seo.altText?.pct >= 50) seoScore += 5;
  if (sitemap?.exists) seoScore += 10;
  if (robots?.exists) seoScore += 5;
  if (seo.wordCount >= 800) seoScore += 5;
  else if (seo.wordCount >= 400) seoScore += 2;

  // AEO Score (0-100)
  let aeoScore = 0;
  if (aeo.jsonLd?.exists) aeoScore += 25;
  if (aeo.organizationSchema) aeoScore += 15;
  if (aeo.faqSchema) aeoScore += 15;
  if (aeo.howToSchema) aeoScore += 10;
  if (aeo.breadcrumbs) aeoScore += 5;
  if (seo.wordCount >= 800) aeoScore += 10;
  if (data.llmsTxt?.exists) aeoScore += 20;

  // Security Score (0-100) — pure security now that Privacy and Accessibility are their own dimensions
  let secScore = 0;
  if (ssl?.valid) secScore += 15;
  const secHeaders = headers?.security || {};
  if (secHeaders.hsts) secScore += 10;
  if (secHeaders.csp) secScore += 12;
  if (secHeaders.xFrame) secScore += 8;
  if (secHeaders.xContentType) secScore += 8;
  if (secHeaders.referrerPolicy) secScore += 7;
  if (secHeaders.permissionsPolicy) secScore += 7;
  if (data.securityTxt?.exists) secScore += 8;
  if (observatory?.grade && ['A+', 'A', 'B+', 'B'].includes(observatory.grade)) secScore += 25;
  else if (observatory?.grade && ['C+', 'C'].includes(observatory.grade)) secScore += 12;

  // Performance Score (0-100)
  let perfScore = pagespeed?.scores?.performance || 0;
  if (!perfScore) {
    perfScore = 50; // default if PageSpeed unavailable
    if (html.ttfb && html.ttfb < 200) perfScore += 15;
    if (html.ttfb && html.ttfb < 100) perfScore += 10;
    if (html.renderBlockingJs < 5) perfScore += 10;
    if (html.lazyLoadedImages > 0) perfScore += 5;
  }
  perfScore = Math.min(100, perfScore);

  // Trust Score (0-100)
  let trustScore = 0;
  const trust = html.trust || {};
  if (trust.forms > 0) trustScore += 25;
  if (trust.hasPhone) trustScore += 15;
  if (trust.hasEmail) trustScore += 10;
  if (trust.socialLinks > 0) trustScore += 15;
  if (trust.hasPrivacyPolicy) trustScore += 15;
  if (seo.viewport) trustScore += 10;
  if (seo.favicons > 0) trustScore += 10;

  // Content Score (0-100)
  let contentScore = 0;
  if (seo.wordCount >= 1200) contentScore += 40;
  else if (seo.wordCount >= 800) contentScore += 30;
  else if (seo.wordCount >= 400) contentScore += 15;
  else if (seo.wordCount >= 200) contentScore += 5;
  if (seo.h1?.count > 0) contentScore += 15;
  if (seo.h2?.count >= 3) contentScore += 15;
  else if (seo.h2?.count > 0) contentScore += 8;
  if (seo.altText?.pct >= 90) contentScore += 15;
  else if (seo.altText?.pct >= 50) contentScore += 8;
  if (seo.internalLinks >= 10) contentScore += 15;
  else if (seo.internalLinks >= 5) contentScore += 8;

  const lh = pagespeed?.scores || {};

  // Accessibility Score (0-100) — Lighthouse a11y when available, else HTML signals
  const acc = html.accessibility || {};
  let a11yScore;
  if (typeof lh.accessibility === 'number') {
    a11yScore = lh.accessibility;
  } else {
    a11yScore = 0;
    if (acc.altPct === null || acc.altPct >= 90) a11yScore += 25;
    else if (acc.altPct >= 50) a11yScore += 12;
    if (acc.htmlLang) a11yScore += 15;
    if (acc.headingHierarchy) a11yScore += 15;
    if (!acc.formFields) a11yScore += 20;
    else if (acc.labeledFields / acc.formFields >= 0.9) a11yScore += 20;
    else if (acc.labeledFields / acc.formFields >= 0.5) a11yScore += 10;
    if (acc.landmarks > 0) a11yScore += 15;
    if (!acc.genericLinkText) a11yScore += 10;
  }
  a11yScore = Math.max(0, Math.min(100, Math.round(a11yScore)));

  // Best Practices Score (0-100) — Lighthouse best-practices when available, else HTML signals
  const bp = html.bestPractices || {};
  let bpScore;
  if (typeof lh['best-practices'] === 'number') {
    bpScore = lh['best-practices'];
  } else {
    bpScore = 0;
    if (bp.https) bpScore += 35;
    if (bp.charset) bpScore += 15;
    if (bp.viewport) bpScore += 15;
    if (bp.doctype) bpScore += 20;
    if (bp.favicons > 0) bpScore += 15;
  }
  bpScore = Math.max(0, Math.min(100, Math.round(bpScore)));

  // Internationalization Score (0-100)
  const intl = html.i18n || {};
  let i18nScore = 0;
  if (intl.htmlLang) i18nScore += 35;
  if (intl.charset) i18nScore += 20;
  if (intl.hreflang) i18nScore += 30;
  if (intl.hreflangCount > 1) i18nScore += 15;

  // Analytics & Measurability Score (0-100)
  const an = html.analytics || {};
  let analyticsScore = 0;
  if (an.hasAny) analyticsScore += 50;
  if (an.hasTagManager) analyticsScore += 15;
  if (an.hasAdPixel) analyticsScore += 20;
  if (an.hasHeatmap) analyticsScore += 15;

  // Privacy & Compliance Score (0-100)
  const pv = html.privacy || {};
  let privacyScore = 0;
  if (pv.hasPrivacyPolicy) privacyScore += 40;
  if (pv.hasTerms) privacyScore += 20;
  if (pv.cookieConsent) privacyScore += 40;

  const categories = {
    seo:           { score: seoScore,       name: 'SEO Fundamentals', icon: '🔍' },
    aeo:           { score: aeoScore,       name: 'AEO / AI Readiness', icon: '🤖' },
    performance:   { score: perfScore,      name: 'Technical Performance', icon: '⚡' },
    security:      { score: secScore,       name: 'Security', icon: '🛡️' },
    accessibility: { score: a11yScore,      name: 'Accessibility', icon: '♿' },
    content:       { score: contentScore,   name: 'Content Quality', icon: '📝' },
    trust:         { score: trustScore,     name: 'Trust & Conversion', icon: '🤝' },
    bestPractices: { score: bpScore,        name: 'Best Practices', icon: '✅' },
    privacy:       { score: privacyScore,   name: 'Privacy & Compliance', icon: '🔏' },
    i18n:          { score: i18nScore,      name: 'Internationalization', icon: '🌐' },
    analytics:     { score: analyticsScore, name: 'Analytics & Measurability', icon: '📊' },
  };

  // Weighted overall (weights sum to 100)
  const weights = { seo: 16, aeo: 12, performance: 12, security: 12, accessibility: 10, content: 8, trust: 8, bestPractices: 6, privacy: 6, i18n: 5, analytics: 5 };
  let totalWeighted = 0, totalWeight = 0;
  for (const [key, w] of Object.entries(weights)) {
    totalWeighted += categories[key].score * w;
    totalWeight += w;
  }
  const overall = Math.round(totalWeighted / totalWeight);

  return { overall, categories };
}


// ============================================================
// FINDINGS GENERATOR
// ============================================================

function generateFindings(data) {
  const { html, ssl, headers, robots, sitemap, observatory, pagespeed } = data;
  const seo = html.seo || {};
  const aeo = html.aeo || {};
  const findings = [];

  // SEO findings
  if (!seo.h1?.count) findings.push({ cat: 'SEO', issue: 'No H1 tag on homepage', impact: 'Critical', desc: 'Search engines use H1 as the primary content signal. The page has zero H1 tags.' });
  if (!seo.metaDescription?.exists) findings.push({ cat: 'SEO', issue: 'No meta description', impact: 'Critical', desc: 'Google will auto-generate a snippet. You lose control of your search result appearance.' });
  if (!seo.title?.value || seo.title.length < 15) findings.push({ cat: 'SEO', issue: 'Poor or missing title tag', impact: 'High', desc: `Title tag is "${seo.title?.value || 'missing'}" — no keywords, no value proposition.` });
  if (!seo.openGraph?.exists) findings.push({ cat: 'SEO', issue: 'No Open Graph tags', impact: 'High', desc: 'LinkedIn/social shares will show a blank preview. For B2B this costs you visibility.' });
  if (!seo.twitterCards?.exists) findings.push({ cat: 'SEO', issue: 'No Twitter Card tags', impact: 'Medium', desc: 'Social shares on X/Twitter won\'t render properly.' });

  // AEO findings
  if (!aeo.jsonLd?.exists) findings.push({ cat: 'AEO', issue: 'Zero structured data (JSON-LD)', impact: 'Critical', desc: 'AI answer engines (ChatGPT, Perplexity, Gemini) cannot extract entity info. Invisible to AI search.' });
  if (!aeo.organizationSchema && !aeo.faqSchema) findings.push({ cat: 'AEO', issue: 'No Organization or FAQ schema', impact: 'Critical', desc: 'No machine-readable business identity. AI engines can\'t cite you in relevant answers.' });
  if (!data.llmsTxt?.exists) findings.push({ cat: 'AEO', issue: 'No llms.txt file', impact: 'Medium', desc: 'llms.txt is an emerging standard that tells AI engines what content to read and cite from your site. Without it, AI systems make their own decisions about what to index.' });

  // Security findings
  const secHeaders = headers?.security || {};
  if (secHeaders.headersSet === 0) findings.push({ cat: 'Security', issue: 'Zero security headers', impact: 'High', desc: `No HSTS, CSP, X-Frame-Options, or other security headers configured. ${secHeaders.headersTotal} headers missing.` });
  else if (secHeaders.headersSet < 4) findings.push({ cat: 'Security', issue: 'Insufficient security headers', impact: 'Medium', desc: `Only ${secHeaders.headersSet} of ${secHeaders.headersTotal} recommended security headers are set.` });

  if (!data.securityTxt?.exists) findings.push({ cat: 'Security', issue: 'No security.txt file', impact: 'Low', desc: 'security.txt (RFC 9116) is a standard for responsible disclosure. Its absence signals a less mature security posture to security-aware buyers.' });

  if (observatory?.grade && ['D', 'D-', 'F'].includes(observatory.grade)) {
    const src = observatory.source === 'mozilla' ? 'Mozilla Observatory rates this site' : 'The header-based security grade is';
    findings.push({ cat: 'Security', issue: `Low security grade: ${observatory.grade}`, impact: 'High', desc: `${src} ${observatory.grade} (score ${observatory.score}/100). Adding the missing security headers is the fastest way to raise it.` });
  }

  if (!ssl?.valid) findings.push({ cat: 'Security', issue: 'SSL certificate issue', impact: 'Critical', desc: 'SSL certificate is invalid or missing. Site may show browser warnings.' });

  // Content findings
  if (seo.wordCount < 300) findings.push({ cat: 'Content', issue: `Only ${seo.wordCount} words on homepage`, impact: 'High', desc: 'Thin content. Google targets 800+ words for a homepage. Not enough for search engines to understand your business.' });
  if (seo.altText?.pct < 50) findings.push({ cat: 'Content', issue: `Low alt text coverage (${seo.altText.pct}%)`, impact: 'Medium', desc: `${seo.altText.withAlt} of ${seo.altText.total} images have alt text. Hurts accessibility and image SEO.` });
  if (!seo.htmlLang) findings.push({ cat: 'SEO', issue: 'Missing HTML lang attribute', impact: 'Medium', desc: 'The <html> tag has no lang attribute. This hurts accessibility, internationalization, and helps search engines serve the right audience.' });
  // Only flag broken nesting when an H1 actually exists — a missing H1 is already its own
  // critical finding above, so we avoid reporting the same root cause twice.
  if (seo.h1?.count > 0 && !seo.headingHierarchy) findings.push({ cat: 'SEO', issue: 'Heading hierarchy broken', impact: 'Medium', desc: 'Headings skip levels (e.g. H1 jumps to H3). Proper H1→H2→H3 nesting helps search engines understand content structure.' });

  // Performance findings
  if (html.renderBlockingJs > 10) findings.push({ cat: 'Perf', issue: `${html.renderBlockingJs} render-blocking JS files`, impact: 'Medium', desc: `${html.jsFiles} script tags total, ${html.renderBlockingJs} without defer/async. Slows first paint.` });
  if (html.lazyLoadedImages === 0 && html.totalImages > 3) findings.push({ cat: 'Perf', issue: 'Zero lazy-loaded images', impact: 'Medium', desc: `All ${html.totalImages} images load eagerly. On mobile this wastes bandwidth.` });

  // Trust findings
  const trust = html.trust || {};
  if (trust.forms === 0) findings.push({ cat: 'Trust', issue: 'No lead capture forms', impact: 'High', desc: 'Homepage has no inline form, no newsletter signup, nothing to capture visitor interest.' });

  // Accessibility findings
  const acc = html.accessibility || {};
  if (acc.formFields > 0 && acc.labeledFields < acc.formFields) findings.push({ cat: 'Accessibility', issue: 'Form fields missing labels', impact: 'High', desc: `${acc.formFields - acc.labeledFields} of ${acc.formFields} form fields have no associated label, aria-label, or title. Screen readers cannot announce them — a common ADA-compliance gap.` });
  if (acc.landmarks === 0) findings.push({ cat: 'Accessibility', issue: 'No semantic landmarks', impact: 'Medium', desc: 'The page uses no <main>, <nav>, <header>, or <footer> regions (or ARIA roles). Assistive technology has no structural map to navigate by.' });
  if (acc.genericLinkText > 0) findings.push({ cat: 'Accessibility', issue: `${acc.genericLinkText} non-descriptive links`, impact: 'Low', desc: 'Links reading "click here" or "read more" give no context out of place. Screen-reader users browsing by link list cannot tell where they lead.' });
  const lhA11y = pagespeed?.scores?.accessibility;
  if (typeof lhA11y === 'number' && lhA11y < 70) findings.push({ cat: 'Accessibility', issue: `Low accessibility score (${lhA11y}/100)`, impact: 'High', desc: 'Google Lighthouse flags multiple accessibility issues. Beyond inclusion, these expose you to ADA-related legal risk and hurt usability for everyone.' });

  // Best-practices findings
  const bp = html.bestPractices || {};
  if (bp.https === false) findings.push({ cat: 'Best Practices', issue: 'Not served over HTTPS', impact: 'Critical', desc: 'The page is not loaded over HTTPS. Browsers mark it "Not secure" and search engines penalize it.' });
  if (!bp.charset) findings.push({ cat: 'Best Practices', issue: 'No character encoding declared', impact: 'Low', desc: 'No <meta charset> was found. Without it, browsers can render special characters incorrectly.' });
  const lhBp = pagespeed?.scores?.['best-practices'];
  if (typeof lhBp === 'number' && lhBp < 70) findings.push({ cat: 'Best Practices', issue: `Low best-practices score (${lhBp}/100)`, impact: 'Medium', desc: 'Lighthouse flags issues such as console errors, deprecated APIs, or known-vulnerable JavaScript libraries.' });

  // Internationalization findings
  const intl = html.i18n || {};
  if (!intl.hreflang) findings.push({ cat: 'Localization', issue: 'No hreflang / single-language only', impact: 'Low', desc: 'No hreflang annotations were found. If you serve — or plan to serve — audiences in more than one language or region, search engines cannot route users to the right version.' });

  // Analytics & measurability findings
  const an = html.analytics || {};
  if (!an.hasAny) findings.push({ cat: 'Analytics', issue: 'No analytics detected', impact: 'High', desc: 'No analytics or tag manager was found (GA4, GTM, Plausible, etc.). You cannot measure traffic, conversions, or the impact of any change — optimization is flying blind.' });
  else if (!an.hasAdPixel) findings.push({ cat: 'Analytics', issue: 'No conversion/ad pixel', impact: 'Low', desc: 'Analytics is present, but no advertising conversion pixel (Meta, LinkedIn, Google Ads) was detected. Paid campaigns cannot optimize toward conversions without one.' });

  // Privacy & compliance findings
  const pv = html.privacy || {};
  if (!pv.hasPrivacyPolicy) findings.push({ cat: 'Privacy', issue: 'No privacy policy', impact: 'High', desc: 'No link to a privacy policy was found. It is a baseline legal expectation and is required by GDPR, CCPA, and most advertising platforms.' });
  if (an.hasAny && !pv.cookieConsent) findings.push({ cat: 'Privacy', issue: 'Tracking without a consent banner', impact: 'Medium', desc: 'Analytics or advertising trackers are loading, but no cookie-consent mechanism was detected. In the EU/UK and California this can be a compliance violation.' });

  // Sort by impact
  const impactOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  findings.sort((a, b) => (impactOrder[a.impact] || 3) - (impactOrder[b.impact] || 3));

  return findings;
}


// ============================================================
// HELPERS
// ============================================================

function normalizeUrl(url) {
  if (!url.startsWith('http')) url = 'https://' + url;
  return url;
}

// A page has a valid heading hierarchy only if it starts at H1 and never skips a level.
// A page with no H1 (but lower-level headings) is NOT a valid hierarchy. A page with no
// headings at all is treated as neutral/valid so it doesn't generate a misleading finding.
function checkHeadingHierarchy(allHeadings, h1Count) {
  if (!allHeadings || allHeadings.length === 0) return true;
  if (!h1Count || h1Count < 1) return false;      // headings exist but none is an H1
  if (allHeadings[0] !== 1) return false;          // first heading on the page must be H1
  for (let i = 1; i < allHeadings.length; i++) {
    if (allHeadings[i] > allHeadings[i - 1] + 1) return false; // skipped a level
  }
  return true;
}

// Collect every JSON-LD @type, descending into arrays and @graph containers so that
// schema nested inside a graph (a very common pattern) is detected and counted.
function extractSchemaTypes(jsonLdScripts) {
  const types = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node === 'object') {
      if (node['@type']) {
        const t = node['@type'];
        if (Array.isArray(t)) types.push(...t);
        else types.push(t);
      }
      if (node['@graph']) visit(node['@graph']);
    }
  };
  jsonLdScripts.forEach(visit);
  return [...new Set(types)]; // de-duplicate so count matches the list shown in the report
}

// Detect schema types expressed as microdata (itemscope/itemtype) or RDFa (typeof),
// so structured data isn't missed just because it isn't JSON-LD.
function extractMicrodataRdfaTypes($) {
  const types = [];
  $('[itemscope][itemtype]').each((_, el) => {
    String($(el).attr('itemtype') || '').split(/\s+/).forEach((u) => {
      const t = u.replace(/\/$/, '').split('/').pop();
      if (t) types.push(t);
    });
  });
  $('[typeof]').each((_, el) => {
    String($(el).attr('typeof') || '').split(/\s+/).forEach((tok) => {
      const t = tok.split(/[:/]/).pop();
      if (t) types.push(t);
    });
  });
  return [...new Set(types)];
}

// Compute a Mozilla-Observatory-style letter grade from the security headers we already read.
// Mirrors Observatory's heaviest deductions (CSP, HSTS, X-Frame). Deterministic fallback used
// when the Observatory API is unavailable, so a hardened site is never penalized for a third-party outage.
function computeHeaderGrade(sec, ssl) {
  sec = sec || {};
  let score = 100;
  if (!ssl || !ssl.valid) score -= 30;
  if (!sec.csp) score -= 25;
  if (!sec.hsts) score -= 20;
  if (!sec.xFrame) score -= 20;
  if (!sec.xContentType) score -= 5;
  if (!sec.referrerPolicy) score -= 5;
  if (!sec.permissionsPolicy) score -= 5;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 95 ? 'A+' : score >= 90 ? 'A' : score >= 85 ? 'A-'
    : score >= 80 ? 'B+' : score >= 70 ? 'B' : score >= 65 ? 'B-'
    : score >= 60 ? 'C+' : score >= 50 ? 'C' : score >= 45 ? 'C-'
    : score >= 40 ? 'D+' : score >= 30 ? 'D' : score >= 25 ? 'D-' : 'F';
  return { grade, score };
}

function val(settled, fallback) {
  return settled.status === 'fulfilled' ? settled.value : fallback;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}

function generateHash(data) {
  const key = JSON.stringify({
    title: data.html?.seo?.title?.value,
    desc: data.html?.seo?.metaDescription?.value,
    h1: data.html?.seo?.h1?.count,
    wordCount: data.html?.seo?.wordCount,
    images: data.html?.totalImages,
    schema: data.html?.aeo?.jsonLd?.count,
    secHeaders: data.headers?.security?.headersSet,
  });
  return simpleHash(key);
}

function detectHosting(headers) {
  const server = headers?.server || '';
  if (server.includes('cloudflare')) return 'Cloudflare';
  if (server.includes('nginx')) return 'Nginx';
  if (server.includes('apache')) return 'Apache';
  if (server.includes('vercel')) return 'Vercel';
  if (server.includes('netlify')) return 'Netlify';
  return server || 'Unknown';
}

module.exports = {
  fullScan, quickScan, partialScan, checkWpExposure,
  // exported for unit testing
  calculateScores, generateFindings, checkHeadingHierarchy, extractSchemaTypes,
  extractMicrodataRdfaTypes, computeHeaderGrade,
};
// end of scanner.js
