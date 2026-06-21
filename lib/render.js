// ============================================================
// HEADLESS RENDERED-VIEW PASS
// Optional and lazy: Puppeteer is only require()'d when ENABLE_RENDER=true, and every failure
// degrades to null so the scanner always falls back to the raw fetch. A single browser instance
// is kept warm and reused across scans; each render runs in its own page with a hard timeout.
// ============================================================

let _puppeteer = null;
let _puppeteerTried = false;
let _browserPromise = null;

function renderEnabled() {
  return String(process.env.ENABLE_RENDER || '').toLowerCase() === 'true';
}

function loadPuppeteer() {
  if (_puppeteerTried) return _puppeteer;
  _puppeteerTried = true;
  try {
    _puppeteer = require('puppeteer');
  } catch (e) {
    console.error('[RENDER] puppeteer not available:', e.message);
    _puppeteer = null;
  }
  return _puppeteer;
}

async function getBrowser() {
  const pptr = loadPuppeteer();
  if (!pptr) return null;
  if (!_browserPromise) {
    _browserPromise = pptr.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
    }).catch((e) => {
      console.error('[RENDER] browser launch failed:', e.message);
      _browserPromise = null; // allow a later retry
      return null;
    });
  }
  return _browserPromise;
}

// Render a URL and return { html, status, rendered:true }, or null if disabled/unavailable/failed.
async function renderPage(url, opts = {}) {
  if (!renderEnabled()) return null;
  const timeoutMs = opts.timeoutMs || parseInt(process.env.RENDER_TIMEOUT_MS || '15000', 10);
  const browser = await getBrowser();
  if (!browser) return null;
  let page = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent('WinTech-Site-Scanner/1.0 (+rendered)');
    await page.setViewport({ width: 1366, height: 900 });
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    await new Promise((r) => setTimeout(r, 400)); // brief settle for late hydration
    const html = await page.content();
    return { html, status: resp ? resp.status() : null, rendered: true };
  } catch (e) {
    console.error('[RENDER] render failed for', url, '-', e.message);
    return null;
  } finally {
    if (page) { try { await page.close(); } catch (_) { /* ignore */ } }
  }
}

async function closeBrowser() {
  if (_browserPromise) {
    try { const b = await _browserPromise; if (b) await b.close(); } catch (_) { /* ignore */ }
    _browserPromise = null;
  }
}

module.exports = { renderEnabled, renderPage, closeBrowser };
