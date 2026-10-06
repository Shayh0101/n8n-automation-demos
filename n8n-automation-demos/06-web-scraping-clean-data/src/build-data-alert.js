// Decides whether this run needs a human to look at it.
// Emits ONE alert item when the page was empty or the invalid-row ratio is above
// the threshold; emits NOTHING when the run is healthy (so Slack is not called).
const cfg = $('Config').first().json;
const threshold = Number(cfg.max_invalid_ratio ?? 0.2);
const rows = $input.all().map((i) => i.json);

const empty = rows.some((r) => r.status === 'empty');
const data = rows.filter((r) => r.status === 'ok' || r.status === 'invalid');
const invalid = data.filter((r) => r.status === 'invalid');
const ratio = data.length ? invalid.length / data.length : 1;

if (!empty && ratio <= threshold) {
  return [];
}

const header = `:warning: *Scraper alert* - ${cfg.source_name || 'source'} (${cfg.target_url})`;
let body;
if (empty) {
  body = 'No listings were extracted. The page layout or CSS selectors probably changed.';
} else {
  const examples = invalid
    .slice(0, 5)
    .map((r) => `- ${r.title || r.url || '(no title)'}: ${r.issues}`)
    .join('\n');
  body = `${invalid.length}/${data.length} rows failed validation ` +
    `(${Math.round(ratio * 100)}% > ${Math.round(threshold * 100)}% threshold). ` +
    `Valid rows were still saved.\n${examples}`;
}

return [{
  json: {
    severity: empty ? 'critical' : 'warning',
    total_rows: data.length,
    invalid_rows: invalid.length,
    message: `${header}\n${body}`,
  },
}];
