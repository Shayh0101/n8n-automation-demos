// Cleans raw scraped fields into a stable, typed row schema:
//   id, title, price, currency, url, availability, source, scraped_at, status, issues
// - collapses whitespace, strips junk characters
// - parses prices in US ("1,299.00") and EU ("1.299,00") formats
// - resolves relative links against the target URL
// - de-duplicates by id (canonical URL) within the run
// - flags rows that fail validation (status = "invalid") instead of dropping them
const cfg = $('Config').first().json;
const baseUrl = cfg.target_url;
const scrapedAt = new Date().toISOString();

const CURRENCY_SYMBOLS = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR' };

const clean = (v) => String(v ?? '').replace(/[\u0000-\u001F \s]+/g, ' ').trim();

function parsePrice(raw) {
  const text = clean(raw);
  if (!text) return { price: null, currency: null };

  let currency = null;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(sym)) { currency = code; break; }
  }
  const iso = text.match(/\b(USD|EUR|GBP|JPY|INR|CAD|AUD)\b/i);
  if (!currency && iso) currency = iso[1].toUpperCase();

  let n = text.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(n)) return { price: null, currency };

  const lastComma = n.lastIndexOf(',');
  const lastDot = n.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal separator.
    n = lastComma > lastDot ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  } else if (lastComma > -1) {
    n = /,\d{1,2}$/.test(n) ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(n)) {
    n = n.replace(/\./g, ''); // "1.299" -> thousands separator
  }

  const price = Number.parseFloat(n);
  return { price: Number.isFinite(price) ? Math.round(price * 100) / 100 : null, currency };
}

function absoluteUrl(href) {
  const h = clean(href);
  if (!h) return '';
  try {
    const u = new URL(h, baseUrl);
    u.hash = '';
    return u.href;
  } catch (e) {
    return '';
  }
}

const seen = new Set();
const rows = [];

for (const item of $input.all()) {
  const j = item.json || {};
  const title = clean(j.title_attr) || clean(j.title_text);
  const url = absoluteUrl(j.url);
  const { price, currency } = parsePrice(j.price);
  const availability = clean(j.availability);

  // Completely blank card (e.g. empty-page marker or ad slot) -> skip.
  if (!title && !url && price === null) continue;

  const id = url || title.toLowerCase();
  if (seen.has(id)) continue;
  seen.add(id);

  const issues = [];
  if (!title) issues.push('missing title');
  if (!url) issues.push('missing/invalid url');
  if (price === null) issues.push('unparseable price');
  else if (price <= 0) issues.push('non-positive price');

  rows.push({
    json: {
      id,
      title,
      price,
      currency: currency || cfg.default_currency || '',
      url,
      availability,
      source: cfg.source_name || '',
      scraped_at: scrapedAt,
      status: issues.length ? 'invalid' : 'ok',
      issues: issues.join('; '),
    },
  });
}

if (rows.length === 0) {
  return [{ json: { status: 'empty', issues: 'No listings extracted - check CSS selectors / target page', scraped_at: scrapedAt } }];
}

return rows;
