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
  const labels = ['html', 'ssl', 'headers', 'robots', 'sitemap', 'observatory', 'pagespeed'];
  const [htmlResult, sslResult, headersResult, robotsResult, sitemapResult, observatoryResult, pagespeedResult] = await Promise.allSettled([
    fetchAndParseHtml(url),
    checkSsl(domain),
    checkHeaders(url),
    checkRobotsTxt(url),
    checkSitemap(url),
    checkMozillaObservatory(domain),
    checkPageSpeed(url),
  ]);

  // Log which checks passed vs failed
  const results = [htmlResult, sslResult, headersResult, robotsResult, sitemapResult, observatoryResult, pagespeedResult];
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
  const observatory = val(observatoryResult, {});
  const pagespeed = val(pagespeedResult, {});

  // Calculate scores
  const scores = calculateScores({ html, ssl, headers, robots, sitemap, observatory, pagespeed });
  const findings = generateFindings({ html, ssl, headers, robots, sitemap, observatory, pagespeed });
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
      wpExposure: html.wpExposure || {},
    },
    trust: html.trust || {},
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
  const ogTitle = $('meta[property="og:title"]').attr('content') || null;
  const ogDesc = $('meta[property="og:description"]').attr('content') || null;
  const ogImage = $('meta[property="og:image"]').attr('content') || null;
  const twitterCard = $('meta[name="twitter:card"]').attr('content') || null;
  const viewport = $('meta[name="viewport"]').attr('content') || null;

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

  // Schema / JSON-LD
  const jsonLdScripts = $('script[type="application/ld+json"]').map((_, el) => {
    try { return JSON.parse($(el).html()); } catch { return null; }
  }).get().filter(Boolean);
  const schemaTypes = jsonLdScripts.map(s => s['@type']).filter(Boolean);

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
      favicons,
    },
    aeo: {
      jsonLd: { exists: jsonLdScripts.length > 0, count: jsonLdScripts.length, types: schemaTypes },
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
  try {
    // Trigger scan
    const scanResp = await fetch(`https://http-observatory.security.mozilla.org/api/v1/analyze?host=${domain}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'hidden=true&rescan=false',
      timeout: 15000,
    });
    const scanData = await scanResp.json();

    if (scanData.state === 'FINISHED' || scanData.state === 'ABORTED') {
      // Get test results
      const testsResp = await fetch(`https://http-observatory.security.mozilla.org/api/v1/getScanResults?scan=${scanData.scan_id}`, { timeout: 10000 });
      const tests = await testsResp.json();

      return {
        grade: scanData.grade || 'Unknown',
        score: scanData.score || 0,
        testsPassed: scanData.tests_passed || 0,
        testsFailed: scanData.tests_failed || 0,
        testsTotal: (scanData.tests_passed || 0) + (scanData.tests_failed || 0),
        details: summarizeObservatoryTests(tests),
      };
    }

    return { grade: 'Pending', score: null, note: 'Scan in progress' };
  } catch (err) {
    return { grade: null, error: err.message };
  }
}

function summarizeObservatoryTests(tests) {
  const summary = {};
  for (const [key, test] of Object.entries(tests)) {
    summary[key] = {
      pass: test.pass,
      score: test.score_modifier,
      description: test.score_description,
    };
  }
  return summary;
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
    const securityHeaders = {
      hsts: h.get('strict-transport-security') || null,
      csp: h.get('content-security-policy') || null,
      xFrame: h.get('x-frame-options') || null,
      xContentType: h.get('x-content-type-options') || null,
      referrerPolicy: h.get('referrer-policy') || null,
      permissionsPolicy: h.get('permissions-policy') || h.get('feature-policy') || null,
      xXssProtection: h.get('x-xss-protection') || null,
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
    return { error: err.message, security: { headersSet: 0, headersTotal: 7 } };
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
  if (aeo.jsonLd?.exists) aeoScore += 30;
  if (aeo.organizationSchema) aeoScore += 20;
  if (aeo.faqSchema) aeoScore += 20;
  if (aeo.howToSchema) aeoScore += 10;
  if (aeo.breadcrumbs) aeoScore += 10;
  if (seo.wordCount >= 800) aeoScore += 10;

  // Security Score (0-100)
  let secScore = 0;
  if (ssl?.valid) secScore += 20;
  const secHeaders = headers?.security || {};
  if (secHeaders.hsts) secScore += 12;
  if (secHeaders.csp) secScore += 12;
  if (secHeaders.xFrame) secScore += 10;
  if (secHeaders.xContentType) secScore += 10;
  if (secHeaders.referrerPolicy) secScore += 8;
  if (secHeaders.permissionsPolicy) secScore += 8;
  if (observatory?.grade && ['A+', 'A', 'B+', 'B'].includes(observatory.grade)) secScore += 20;
  else if (observatory?.grade && ['C+', 'C'].includes(observatory.grade)) secScore += 10;

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

  const categories = {
    performance: { score: perfScore, name: 'Technical Performance', icon: '⚡' },
    seo: { score: seoScore, name: 'SEO Fundamentals', icon: '🔍' },
    aeo: { score: aeoScore, name: 'AEO / AI Readiness', icon: '🤖' },
    security: { score: secScore, name: 'Security & Privacy', icon: '🛡️' },
    trust: { score: trustScore, name: 'Trust & Conversion', icon: '🤝' },
    content: { score: contentScore, name: 'Content Quality', icon: '📝' },
  };

  // Weighted overall
  const weights = { performance: 20, seo: 25, aeo: 15, security: 20, trust: 10, content: 10 };
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

  // Security findings
  const secHeaders = headers?.security || {};
  if (secHeaders.headersSet === 0) findings.push({ cat: 'Security', issue: 'Zero security headers', impact: 'High', desc: `No HSTS, CSP, X-Frame-Options, or other security headers configured. ${secHeaders.headersTotal} headers missing.` });
  else if (secHeaders.headersSet < 4) findings.push({ cat: 'Security', issue: 'Insufficient security headers', impact: 'Medium', desc: `Only ${secHeaders.headersSet} of ${secHeaders.headersTotal} recommended security headers are set.` });

  if (observatory?.grade && ['D', 'D-', 'F'].includes(observatory.grade)) {
    findings.push({ cat: 'Security', issue: `Mozilla Observatory grade: ${observatory.grade}`, impact: 'High', desc: `Mozilla rates security at ${observatory.grade}. Score: ${observatory.score}/100.` });
  }

  if (!ssl?.valid) findings.push({ cat: 'Security', issue: 'SSL certificate issue', impact: 'Critical', desc: 'SSL certificate is invalid or missing. Site may show browser warnings.' });

  // Content findings
  if (seo.wordCount < 300) findings.push({ cat: 'Content', issue: `Only ${seo.wordCount} words on homepage`, impact: 'High', desc: 'Thin content. Google targets 800+ words for a homepage. Not enough for search engines to understand your business.' });
  if (seo.altText?.pct < 50) findings.push({ cat: 'Content', issue: `Low alt text coverage (${seo.altText.pct}%)`, impact: 'Medium', desc: `${seo.altText.withAlt} of ${seo.altText.total} images have alt text. Hurts accessibility and image SEO.` });

  // Performance findings
  if (html.renderBlockingJs > 10) findings.push({ cat: 'Perf', issue: `${html.renderBlockingJs} render-blocking JS files`, impact: 'Medium', desc: `${html.jsFiles} script tags total, ${html.renderBlockingJs} without defer/async. Slows first paint.` });
  if (html.lazyLoadedImages === 0 && html.totalImages > 3) findings.push({ cat: 'Perf', issue: 'Zero lazy-loaded images', impact: 'Medium', desc: `All ${html.totalImages} images load eagerly. On mobile this wastes bandwidth.` });

  // Trust findings
  const trust = html.trust || {};
  if (trust.forms === 0) findings.push({ cat: 'Trust', issue: 'No lead capture forms', impact: 'High', desc: 'Homepage has no inline form, no newsletter signup, nothing to capture visitor interest.' });

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

module.exports = { fullScan, quickScan, partialScan, checkWpExposure };
