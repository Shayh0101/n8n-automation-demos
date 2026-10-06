// Runs on the HTTP Request error output (after all retries failed).
// Converts the n8n error payload into a readable Slack message.
const cfg = $('Config').first().json;
const err = $input.first().json.error || $input.first().json;
const msg = typeof err === 'string'
  ? err
  : (err.message || err.description || JSON.stringify(err).slice(0, 300));
const code = err.httpCode || err.status || err.code || 'n/a';

return [{
  json: {
    severity: 'critical',
    message: `:rotating_light: *Scraper fetch failed* - ${cfg.source_name || 'source'}\n` +
      `URL: ${cfg.target_url}\nStatus: ${code}\nError: ${msg}`,
  },
}];
