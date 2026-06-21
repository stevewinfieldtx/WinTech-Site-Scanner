require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { fullScan, quickScan, checkWpExposure } = require('./lib/scanner');
const db = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Secret used to sign admin session tokens. Set SESSION_SECRET in production so tokens
// survive restarts; otherwise a random per-process secret is used (tokens invalidate on restart).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers — the scanner flags sites with "zero security headers", so its own
// site should not be one of them. Applied to every response.
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // 'unsafe-inline' is required because the report and landing page use inline styles,
  // inline <script> blocks, and inline event handlers. Tighten with nonces if those are removed.
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "base-uri 'self'; frame-ancestors 'none'");
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- Signed admin session tokens (HMAC) ----
// Replaces the previous base64("id:timestamp") scheme, which any visitor could forge.
function signToken(adminId) {
  const payload = `${adminId}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const lastColon = decoded.lastIndexOf(':');
    if (lastColon === -1) return null;
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null; // tampered/forged
    const [id, ts] = payload.split(':');
    if (!id || Date.now() - parseInt(ts) > 24 * 60 * 60 * 1000) return null;  // missing id or expired
    return parseInt(id);
  } catch {
    return null;
  }
}

// Constant-time string comparison for secrets (avoids timing leaks on the team password).
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ============================================================
// ACCESS GATING — strict email/domain match + allowlist + monthly cap
// ============================================================
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SUPPORT_EMAIL = 'support@wintechpartners.com';
const FREE_SCANS_PER_MONTH = parseInt(process.env.FREE_SCANS_PER_MONTH || '10', 10);
// Emails that may deep-scan ANY domain and are exempt from the monthly cap.
const ALLOWED_EMAILS = new Set(
  String(process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
);

function emailDomainOf(email) { return String(email || '').split('@')[1]?.toLowerCase() || ''; }
function isAllowedEmail(email) { return ALLOWED_EMAILS.has(String(email || '').trim().toLowerCase()); }
function domainMatches(emailDomain, scannedDomain) {
  if (!emailDomain || !scannedDomain) return false;
  const d = String(scannedDomain).toLowerCase().replace(/^www\./, '');
  return emailDomain === d || d.endsWith('.' + emailDomain); // exact, or site is a subdomain of the email's domain
}

// Shared gate for any deep unlock (website report or audience "why").
// Returns { ok:true, allowed } or { ok:false, status, message }.
async function gateAccess(email, scannedDomain) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, status: 'invalid_email', message: 'Please enter a valid email address.' };
  const allowed = isAllowedEmail(email);
  if (!allowed && !domainMatches(emailDomainOf(email), scannedDomain)) {
    return { ok: false, status: 'domain_mismatch',
      message: `To unlock the full report, use an email at ${String(scannedDomain).replace(/^www\./, '')}. Need help? Email ${SUPPORT_EMAIL}.` };
  }
  if (!allowed) {
    const used = await db.scanCountThisMonth(email);
    if (used >= FREE_SCANS_PER_MONTH) {
      return { ok: false, status: 'limit_reached',
        message: `You've reached the free limit of ${FREE_SCANS_PER_MONTH} scans this month. Email ${SUPPORT_EMAIL} to lift it.` };
    }
  }
  return { ok: true, allowed };
}

// ============================================================
// AUDIENCE INTEL — 3-model ensemble via OpenRouter (cheap GPT + Gemini + Claude)
// ============================================================
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
// Three independently-configurable models (set each on Railway). Model 1 also powers the free
// single-model "short" read. Defaults to a cheap GPT + Gemini + Claude.
const AUDIENCE_MODELS = [
  process.env.AUDIENCE_MODEL_1 || 'openai/gpt-4o-mini',
  process.env.AUDIENCE_MODEL_2 || 'google/gemini-2.0-flash-001',
  process.env.AUDIENCE_MODEL_3 || 'anthropic/claude-3.5-haiku',
].map((s) => String(s).trim()).filter(Boolean);

function audSimpleHash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return h.toString(36); }

async function fetchPageText(url) {
  const u = url.startsWith('http') ? url : 'https://' + url;
  const resp = await fetch(u, { timeout: 15000, redirect: 'follow', headers: { 'User-Agent': 'WinTech-Audience-Intel/1.0' } });
  const body = await resp.text();
  const $ = cheerio.load(body);
  $('script,style,noscript,svg').remove();
  const title = $('title').first().text().trim();
  const desc = $('meta[name="description"]').attr('content') || '';
  const h1 = $('h1').map((_, e) => $(e).text().trim()).get().join(' | ');
  const ctas = $('a,button').map((_, e) => $(e).text().replace(/\s+/g, ' ').trim()).get()
    .filter(t => t && t.length <= 40).slice(0, 30).join(' · ');
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);
  const domain = new URL(u).hostname.toLowerCase();
  return { domain, url: u, title, desc, h1, ctas, text, contentHash: audSimpleHash(title + desc + text) };
}

const AUDIENCE_PROMPT =
  'You analyze a website homepage to judge whether its target audience and its goal are clear and in sync. ' +
  'Reply with ONLY a JSON object: {"audience": string (1-2 sentences: who this site is for), ' +
  '"goal": string (the single primary action the site wants a visitor to take), ' +
  '"cta": string (the main call-to-action wording you actually see, or "none found"), ' +
  '"alignment": "aligned" | "partial" | "mismatch", ' +
  '"why": string (2-3 sentences of evidence from the page)}. Be concrete and cite evidence. If audience or goal is unclear, say so.';

function audienceUserContent(p) {
  return `URL: ${p.url}\nTitle: ${p.title}\nMeta description: ${p.desc}\nH1: ${p.h1}\nButtons/links: ${p.ctas}\n\nPage text:\n${p.text}`;
}

async function callModel(model, content) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', timeout: 30000,
    headers: { 'Authorization': 'Bearer ' + OPENROUTER_API_KEY, 'Content-Type': 'application/json',
               'HTTP-Referer': 'https://wintechpartners.com', 'X-Title': 'WinTech Audience Intel' },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: AUDIENCE_PROMPT }, { role: 'user', content }] }),
  });
  const j = await resp.json();
  const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
  let parsed; try { parsed = JSON.parse(txt); } catch { const m = String(txt).match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; }
  return { model, ...parsed };
}

async function audienceShort(p) {
  const r = await callModel(AUDIENCE_MODELS[0], audienceUserContent(p));
  return { audience: r.audience || '', goal: r.goal || '', cta: r.cta || '', alignment: r.alignment || '' };
}

async function audienceDeep(p) {
  const content = audienceUserContent(p);
  const results = await Promise.allSettled(AUDIENCE_MODELS.map((m) => callModel(m, content)));
  const models = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
    .map((m) => ({ model: m.model, audience: m.audience || '', goal: m.goal || '', cta: m.cta || '', alignment: m.alignment || '', why: m.why || '' }));
  return reconcileAudience(models);
}

// Pure: turn N model reads into a headline + an agreement ("positioning clarity") signal.
function reconcileAudience(models) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3);
  const overlap = (a, b) => { const A = new Set(norm(a)); const B = norm(b); if (!A.size || !B.length) return 0; return B.filter((w) => A.has(w)).length / Math.max(A.size, B.length); };
  let agree = 0, pairs = 0;
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) { agree += overlap(models[i].audience, models[j].audience); pairs++; }
  const agreement = pairs ? agree / pairs : 1;
  const clarity = agreement >= 0.45 ? 'clear' : agreement >= 0.2 ? 'mixed' : 'ambiguous';
  const headline = models[0] || {};
  const counts = {};
  models.forEach((m) => { if (m.alignment) counts[m.alignment] = (counts[m.alignment] || 0) + 1; });
  const alignment = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || headline.alignment || '';
  return { headline: { audience: headline.audience, goal: headline.goal, cta: headline.cta, alignment }, clarity, agreement: Math.round(agreement * 100), models };
}

// ============================================================
// EMAIL DELIVERY — Resend HTTP API (no SDK dependency). Set RESEND_API_KEY.
// ============================================================
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'WinTech Site Scanner <noreply@wintechpartners.com>';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    if (!r.ok) { console.error('[EMAIL] Resend failed', r.status, await r.text().catch(() => '')); return false; }
    return true;
  } catch (e) { console.error('[EMAIL] error', e.message); return false; }
}
function absBase(req) {
  return (req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')) + '://' + req.headers.host;
}
function emailShell(inner) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
    <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:20px 24px"><span style="color:#a5b4fc;font-weight:700;letter-spacing:1px;font-size:13px">WINTECH SITE SCANNER</span></div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px">${inner}
    <p style="margin-top:20px;color:#94a3b8;font-size:12px">Questions? Reply to this email or contact ${SUPPORT_EMAIL}.</p></div></div>`;
}
function websiteEmailHtml(domain, link) {
  return emailShell(`<h2 style="margin:0 0 8px">Your website audit is ready</h2>
    <p style="color:#475569">Here's the full Website Intelligence report for <strong>${esc(domain)}</strong> — 11 dimensions, prioritized findings, security, and revenue impact.</p>
    <p style="margin:18px 0"><a href="${esc(link)}" style="background:#6366f1;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;display:inline-block">Open your report</a></p>
    <p style="color:#94a3b8;font-size:13px">Tip: use the "Download PDF" button on the report to save or send a copy.</p>`);
}
function audienceEmailHtml(domain, d) {
  const models = (d.models || []).map((m) => `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px">
    <div style="font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase">${esc((m.model || '').split('/').pop())}</div>
    <div style="font-size:13px"><strong>For:</strong> ${esc(m.audience)}</div>
    <div style="font-size:13px"><strong>Goal:</strong> ${esc(m.goal)}</div>
    <div style="font-size:13px;color:#475569"><strong>Why:</strong> ${esc(m.why)}</div></div>`).join('');
  return emailShell(`<h2 style="margin:0 0 8px">Audience analysis — ${esc(domain)}</h2>
    <p style="color:#475569"><strong>Who it's for:</strong> ${esc(d.headline && d.headline.audience)}</p>
    <p style="color:#475569"><strong>What it wants them to do:</strong> ${esc(d.headline && d.headline.goal)}</p>
    <p style="color:#475569"><strong>Positioning clarity:</strong> ${esc(d.clarity)} · ${d.agreement}% model agreement</p>
    <p style="margin:16px 0 8px;font-weight:700">How GPT, Gemini, and Claude each read it:</p>${models}`);
}


// ============================================================
// API: SCAN A SITE
// ============================================================

// Step 1: Quick preview scan (no email required, returns gated overview)
app.post('/api/scan', async (req, res) => {
  const { url, force, forceKey } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // A public visitor must not be able to trigger expensive full re-scans. The `force`
  // flag is only honored when accompanied by the private FORCE_RESCAN_KEY (set in env).
  const allowForce = !!force && !!process.env.FORCE_RESCAN_KEY && safeEqual(forceKey || '', process.env.FORCE_RESCAN_KEY);

  // Result caching is OFF by default for now — every scan runs fresh so the latest scanner
  // logic always shows. Re-enable later by setting SCAN_CACHE_ENABLED=true in the environment.
  const cacheEnabled = process.env.SCAN_CACHE_ENABLED === 'true';

  try {
    const domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname;

    // Serve a recent cached scan only when caching is enabled and this isn't an authorized force.
    if (!allowForce && cacheEnabled) {
      const existingSite = await db.getSiteByDomain(domain);
    if (existingSite) {
      const latestScan = await db.getLatestScan(existingSite.id);
      if (latestScan) {
        const hoursSince = (Date.now() - new Date(latestScan.created_at).getTime()) / (1000 * 60 * 60);

        // If scanned in last 24h, check for changes
        if (hoursSince < 24) {
          const quick = await quickScan(url, existingSite.content_hash);
          if (!quick.changed) {
            return res.json({
              status: 'cached',
              scanId: latestScan.id,
              domain,
              scores: latestScan.scores,
              findings: latestScan.findings,
              scanDate: latestScan.created_at,
            });
          }
        }

        // Check if full rescan needed (90 day rule)
        const needsFull = await db.shouldFullRescan(existingSite.id);
        if (!needsFull && hoursSince < 24) {
          // Partial scan only
          return res.json({
            status: 'cached',
            scanId: latestScan.id,
            domain,
            scores: latestScan.scores,
            findings: latestScan.findings,
            scanDate: latestScan.created_at,
          });
        }
      }
    }
    } // end force check

    // Full scan
    console.log(`[SCAN] Starting full scan for ${domain}`);
    const scanData = await fullScan(url);

    // Check WP exposure if WordPress detected
    if (scanData.tech.cms && scanData.tech.cms.includes('WordPress')) {
      const wpExp = await checkWpExposure(url);
      scanData.security.wpExposure = wpExp;
    }

    // Save to database
    const site = await db.upsertSite(domain, scanData.url, scanData.contentHash);
    const scan = await db.saveScan(site.id, 'full', scanData, scanData.contentHash, scanData.scores, scanData.findings);
    await db.updateSiteLatestScan(site.id, scan.id, true);

    res.json({
      status: 'complete',
      scanId: scan.id,
      domain,
      scores: scanData.scores,
      findings: scanData.findings,
      scanDate: scan.created_at,
    });

  } catch (err) {
    console.error('[SCAN ERROR]', err);
    res.status(500).json({ error: 'Scan failed: ' + err.message });
  }
});


// ============================================================
// API: EMAIL GATE - UNLOCK FULL REPORT
// ============================================================

app.post('/api/unlock', async (req, res) => {
  const { email, scanId } = req.body || {};
  if (!email || !scanId) return res.status(400).json({ error: 'Email and scanId required' });

  try {
    const scan = await db.getScanById(scanId);
    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    const siteResult = await db.pool.query('SELECT domain FROM sites WHERE id = $1', [scan.site_id]);
    const scannedDomain = (siteResult.rows[0]?.domain || '').toLowerCase();

    // Strict: email must match the scanned domain, unless it's an allowlisted address.
    const gate = await gateAccess(email, scannedDomain);
    if (!gate.ok) return res.status(403).json(gate);

    await db.recordScanHistory({ email, domain: scannedDomain, kind: 'website', scanId: scan.id });
    const reportUrl = `/report/${scan.id}`;
    const emailed = await sendEmail(email, `Your website audit — ${scannedDomain}`, websiteEmailHtml(scannedDomain, absBase(req) + reportUrl));
    return res.json({ status: 'unlocked', reportUrl, emailed });

  } catch (err) {
    console.error('[UNLOCK ERROR]', err);
    res.status(500).json({ error: 'Failed to process: ' + err.message });
  }
});


// ============================================================
// REPORT PAGE
// ============================================================

app.get('/report/:scanId', async (req, res) => {
  try {
    const scan = await db.getScanById(parseInt(req.params.scanId));
    if (!scan) return res.status(404).send('Report not found');

    const siteResult = await db.pool.query('SELECT * FROM sites WHERE id = $1', [scan.site_id]);
    const site = siteResult.rows[0];

    // Serve the report HTML with injected data
    res.send(generateReportHtml(site, scan));
  } catch (err) {
    res.status(500).send('Error loading report');
  }
});


// ============================================================
// API: RECENT PUBLIC SCANS
// ============================================================

app.get('/api/recent', async (req, res) => {
  try {
    const scans = await db.getRecentPublicScans(3);
    res.json(scans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// API: COMPETITOR COMPARISON  (private — force key required)
// ============================================================

app.post('/api/compare', async (req, res) => {
  const { urls, forceKey } = req.body;
  if (!process.env.FORCE_RESCAN_KEY || !safeEqual(forceKey || '', process.env.FORCE_RESCAN_KEY)) {
    return res.status(403).json({ error: 'Comparison is a private feature. Open it as /compare?fk=YOUR_KEY.' });
  }
  const list = (Array.isArray(urls) ? urls : []).map(u => (u || '').trim()).filter(Boolean).slice(0, 4);
  if (list.length < 2) return res.status(400).json({ error: 'Enter your site plus at least one competitor.' });

  // Scan every site in parallel; each fullScan is internally parallel and degrades gracefully.
  const results = await Promise.allSettled(list.map(async (u) => {
    const scanData = await fullScan(u);
    try {
      const site = await db.upsertSite(scanData.domain, scanData.url, scanData.contentHash);
      const scan = await db.saveScan(site.id, 'full', scanData, scanData.contentHash, scanData.scores, scanData.findings);
      await db.updateSiteLatestScan(site.id, scan.id, true);
    } catch (e) { console.error('[COMPARE] persist failed for', u, e.message); }
    return { url: u, domain: scanData.domain, scores: scanData.scores, findings: scanData.findings.length };
  }));

  const sites = results.map((r, i) => r.status === 'fulfilled'
    ? { ok: true, ...r.value }
    : { ok: false, url: list[i], error: r.reason?.message || 'Scan failed' });
  res.json({ sites, scanDate: new Date().toISOString() });
});

// Serve the comparison page at a clean URL
app.get('/compare', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'compare.html'));
});


// ============================================================
// API: AUDIENCE INTEL  (free short read; deep "why" gated by matching email)
// ============================================================
app.post('/api/audience', async (req, res) => {
  const { url, deep, email } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL is required' });
  if (!OPENROUTER_API_KEY) return res.status(503).json({ error: 'Audience Intel is not configured yet. Set OPENROUTER_API_KEY.' });

  try {
    const p = await fetchPageText(url);

    if (!deep) {
      // Free single-model read. Cache by domain+content so repeat views are free.
      const cached = await db.getLatestAudience(p.domain);
      let short;
      if (cached && cached.content_hash === p.contentHash && cached.result && cached.result.short) {
        short = cached.result.short;
      } else {
        short = await audienceShort(p);
        await db.saveAudienceReport({ domain: p.domain, url: p.url, contentHash: p.contentHash, result: { short } });
      }
      return res.json({ status: 'short', domain: p.domain, audience: short.audience, goal: short.goal, cta: short.cta });
    }

    // Deep "why" — gated by the same strict email rules as the website report.
    const gate = await gateAccess(email, p.domain);
    if (!gate.ok) return res.status(403).json(gate);

    const deepResult = await audienceDeep(p);
    const rec = await db.saveAudienceReport({ domain: p.domain, url: p.url, contentHash: p.contentHash, result: { short: deepResult.headline, deep: deepResult } });
    await db.recordScanHistory({ email, domain: p.domain, kind: 'audience', audienceId: rec.id });
    const emailed = await sendEmail(email, `Your audience analysis — ${p.domain}`, audienceEmailHtml(p.domain, deepResult));
    return res.json({ status: 'deep', domain: p.domain, emailed, ...deepResult });

  } catch (err) {
    console.error('[AUDIENCE ERROR]', err);
    return res.status(500).json({ error: 'Audience analysis failed: ' + err.message });
  }
});


// ============================================================
// API: SCAN HISTORY  (open-by-email, v1)
// ============================================================
app.get('/api/history', async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
  try {
    const history = await db.getHistoryByEmail(email, 100);
    const used = await db.scanCountThisMonth(email);
    res.json({ email, used, limit: isAllowedEmail(email) ? null : FREE_SCANS_PER_MONTH, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// ADMIN ROUTES
// ============================================================

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const admin = await db.getAdminByEmail(email);
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // HMAC-signed token — cannot be forged without SESSION_SECRET
    const token = signToken(admin.id);
    res.json({ status: 'ok', token, email: admin.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/scans', adminAuth, async (req, res) => {
  try {
    const scans = await db.getAllScans(100, 0);
    res.json(scans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/leads', adminAuth, async (req, res) => {
  try {
    const leads = await db.getAllLeads(200, 0);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const adminId = verifyToken(token);
  if (!adminId) return res.status(401).json({ error: 'Invalid or expired token' });
  req.adminId = adminId;
  next();
}


// ============================================================
// REPORT HTML GENERATOR
// ============================================================

function generateReportHtml(site, scan) {
  const data = typeof scan.scan_data === 'string' ? JSON.parse(scan.scan_data) : scan.scan_data;
  const scores = typeof scan.scores === 'string' ? JSON.parse(scan.scores) : scan.scores;
  const findings = typeof scan.findings === 'string' ? JSON.parse(scan.findings) : scan.findings;
  // Full save timestamp (date + time) so each generated report is distinguishable and carries an "as of" time.
  // Rendered in Central Time with the zone labeled; change timeZone if your team is elsewhere.
  const scanDate = new Date(scan.created_at).toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Chicago', timeZoneName: 'short'
  });

  // Inject scan data into the report template
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Website Audit Report — ${site.domain}</title>
<meta name="robots" content="noindex, nofollow">
</head>
<body>
<script>
  window.SCAN_DATA = ${JSON.stringify({ site, scores, findings, data, scanDate, savedAt: scan.created_at })};
</script>
<div id="loading" style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#020617;color:#e2e8f0;font-family:Inter,sans-serif">
  <div style="text-align:center">
    <div style="font-size:24px;font-weight:800;margin-bottom:8px">Loading report...</div>
    <div style="color:#64748b">${site.domain}</div>
  </div>
</div>
<script src="/report-template.js"></script>
</body>
</html>`;
}


// ============================================================
// STARTUP
// ============================================================

async function start() {
  await db.initDb();

  // Create default admin if ADMIN_EMAIL + ADMIN_PASSWORD set
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
    await db.createAdmin(process.env.ADMIN_EMAIL, hash);
    console.log(`[ADMIN] Admin user ensured: ${process.env.ADMIN_EMAIL}`);
  }

  app.listen(PORT, () => {
    console.log(`[SERVER] WinTech Site Scanner running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('[STARTUP ERROR]', err);
  process.exit(1);
});
