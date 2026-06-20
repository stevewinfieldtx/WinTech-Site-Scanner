require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
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
// API: SCAN A SITE
// ============================================================

// Step 1: Quick preview scan (no email required, returns gated overview)
app.post('/api/scan', async (req, res) => {
  const { url, force, forceKey } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // A public visitor must not be able to trigger expensive full re-scans. The `force`
  // flag is only honored when accompanied by the private FORCE_RESCAN_KEY (set in env).
  const allowForce = !!force && !!process.env.FORCE_RESCAN_KEY && safeEqual(forceKey || '', process.env.FORCE_RESCAN_KEY);

  try {
    const domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname;

    // Check if we have a recent scan (skip only when an authorized force is requested)
    if (!allowForce) {
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
  const { email, scanId, override, teamPassword } = req.body;
  if (!email || !scanId) return res.status(400).json({ error: 'Email and scanId required' });

  try {
    const scan = await db.getScanById(scanId);
    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    // Get the scanned domain
    const siteResult = await db.pool.query('SELECT domain FROM sites WHERE id = $1', [scan.site_id]);
    const scannedDomain = siteResult.rows[0]?.domain || '';

    const emailDomain = email.split('@')[1]?.toLowerCase() || '';

    // WinTech team bypass: wintechpartners.com emails get access to any report with team password
    if (emailDomain === 'wintechpartners.com') {
      if (!teamPassword) {
        return res.json({
          status: 'team_auth',
          message: 'WinTech team member detected. Enter your team password.',
        });
      }
      if (!process.env.TEAM_PASSWORD || !safeEqual(teamPassword, process.env.TEAM_PASSWORD)) {
        return res.json({
          status: 'team_auth_failed',
          message: 'Incorrect team password.',
        });
      }
      // Team auth passed — grant access
      await db.saveLead(email, scannedDomain, scan.site_id, false);
      return res.json({ status: 'unlocked', reportUrl: `/report/${scan.id}` });
    }

    // Normal flow: validate email domain matches scanned domain
    const freeEmailDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com'];
    const isFreeEmail = freeEmailDomains.includes(emailDomain);
    const domainMatch = emailDomain === scannedDomain || scannedDomain.endsWith('.' + emailDomain) || emailDomain.endsWith('.' + scannedDomain);

    if (!domainMatch && !override) {
      const reason = isFreeEmail
        ? `Please use a work email from ${scannedDomain} to access the full report.`
        : `Email domain "${emailDomain}" doesn't match the scanned site "${scannedDomain}".`;

      return res.json({
        status: 'domain_mismatch',
        message: reason,
        scannedDomain,
        canOverride: true,
      });
    }

    // Save lead
    await db.saveLead(email, scannedDomain, scan.site_id, !!override);

    res.json({
      status: 'unlocked',
      reportUrl: `/report/${scan.id}`,
    });

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
  const scanDate = new Date(scan.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

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
  window.SCAN_DATA = ${JSON.stringify({ site, scores, findings, data, scanDate })};
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
