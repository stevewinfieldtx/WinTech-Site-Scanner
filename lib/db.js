const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ============================================================
// SCHEMA INIT
// ============================================================

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      domain TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      first_scanned TIMESTAMPTZ DEFAULT NOW(),
      last_scanned TIMESTAMPTZ DEFAULT NOW(),
      last_full_scan TIMESTAMPTZ DEFAULT NOW(),
      content_hash TEXT,
      latest_scan_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
      scan_type TEXT DEFAULT 'full',  -- full, partial, quick
      scan_data JSONB NOT NULL,
      content_hash TEXT,
      scores JSONB,
      findings JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      email_domain TEXT NOT NULL,
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      scanned_domain TEXT,
      override_used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
    CREATE INDEX IF NOT EXISTS idx_scans_site_id ON scans(site_id);
    CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
    CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at DESC);
  `);
  console.log('[DB] Schema initialized');
}


// ============================================================
// SITES
// ============================================================

async function upsertSite(domain, url, contentHash) {
  const result = await pool.query(`
    INSERT INTO sites (domain, url, content_hash)
    VALUES ($1, $2, $3)
    ON CONFLICT (domain) DO UPDATE SET
      last_scanned = NOW(),
      content_hash = $3,
      url = $2
    RETURNING *
  `, [domain, url, contentHash]);
  return result.rows[0];
}

async function getSiteByDomain(domain) {
  const result = await pool.query('SELECT * FROM sites WHERE domain = $1', [domain]);
  return result.rows[0] || null;
}

async function updateSiteLatestScan(siteId, scanId, fullScan = false) {
  const extra = fullScan ? ', last_full_scan = NOW()' : '';
  await pool.query(`UPDATE sites SET latest_scan_id = $2, last_scanned = NOW()${extra} WHERE id = $1`, [siteId, scanId]);
}


// ============================================================
// SCANS
// ============================================================

async function saveScan(siteId, scanType, scanData, contentHash, scores, findings) {
  const result = await pool.query(`
    INSERT INTO scans (site_id, scan_type, scan_data, content_hash, scores, findings)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [siteId, scanType, JSON.stringify(scanData), contentHash, JSON.stringify(scores), JSON.stringify(findings)]);
  return result.rows[0];
}

async function getLatestScan(siteId) {
  const result = await pool.query(`
    SELECT * FROM scans WHERE site_id = $1 ORDER BY created_at DESC LIMIT 1
  `, [siteId]);
  return result.rows[0] || null;
}

async function getScanById(scanId) {
  const result = await pool.query('SELECT * FROM scans WHERE id = $1', [scanId]);
  return result.rows[0] || null;
}

async function getRecentPublicScans(limit = 3) {
  const result = await pool.query(`
    SELECT s.id, s.created_at, s.scores, si.domain, si.url
    FROM scans s
    JOIN sites si ON s.site_id = si.id
    WHERE s.scan_type = 'full'
    ORDER BY s.created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

async function getAllScans(limit = 50, offset = 0) {
  const result = await pool.query(`
    SELECT s.id, s.scan_type, s.created_at, s.scores, si.domain, si.url
    FROM scans s
    JOIN sites si ON s.site_id = si.id
    ORDER BY s.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return result.rows;
}

async function shouldFullRescan(siteId) {
  const site = await pool.query('SELECT last_full_scan FROM sites WHERE id = $1', [siteId]);
  if (!site.rows[0]) return true;
  const lastFull = new Date(site.rows[0].last_full_scan);
  const daysSince = (Date.now() - lastFull.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= 90;
}


// ============================================================
// LEADS
// ============================================================

async function saveLead(email, scannedDomain, siteId, overrideUsed = false) {
  const emailDomain = email.split('@')[1]?.toLowerCase() || '';
  const result = await pool.query(`
    INSERT INTO leads (email, email_domain, site_id, scanned_domain, override_used)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [email.toLowerCase(), emailDomain, siteId, scannedDomain, overrideUsed]);
  return result.rows[0];
}

async function getLeadByEmail(email) {
  const result = await pool.query('SELECT * FROM leads WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email.toLowerCase()]);
  return result.rows[0] || null;
}

async function getAllLeads(limit = 100, offset = 0) {
  const result = await pool.query(`
    SELECT l.*, s.domain as site_domain
    FROM leads l
    LEFT JOIN sites s ON l.site_id = s.id
    ORDER BY l.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return result.rows;
}


// ============================================================
// ADMIN
// ============================================================

async function getAdminByEmail(email) {
  const result = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email.toLowerCase()]);
  return result.rows[0] || null;
}

async function createAdmin(email, passwordHash) {
  await pool.query(`
    INSERT INTO admin_users (email, password_hash)
    VALUES ($1, $2)
    ON CONFLICT (email) DO NOTHING
  `, [email.toLowerCase(), passwordHash]);
}


module.exports = {
  pool,
  initDb,
  upsertSite,
  getSiteByDomain,
  updateSiteLatestScan,
  saveScan,
  getLatestScan,
  getScanById,
  getRecentPublicScans,
  getAllScans,
  shouldFullRescan,
  saveLead,
  getLeadByEmail,
  getAllLeads,
  getAdminByEmail,
  createAdmin,
};
