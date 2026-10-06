// Build Follow-up Email
// Mode: "Run Once for All Items". Runs after the CRM request: picks up the CRM
// record id from the API response and renders a personalised HTML + text email.

const ctx = $('Normalize & Validate Lead').first().json;
const { lead, config = {}, crmProvider } = ctx;
const res = ($input.first() && $input.first().json) || {};

// Each CRM returns the record id in a different place.
const crmRecordId =
  (res.results && res.results[0] && res.results[0].id) || // HubSpot batch upsert
  (res.contact && res.contact.id) ||                      // GoHighLevel upsert
  (res.records && res.records[0] && res.records[0].id) || // Airtable upsert
  res.id ||
  null;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const companyName = config.companyName || 'Our team';
const greetingName = lead.firstName || 'there';
const bookingUrl = config.bookingUrl || '';
const quoted = lead.message ? lead.message.slice(0, 500) : '';

const subject = `Thanks for reaching out, ${greetingName}!`;

const html = [
  `<p>Hi ${esc(greetingName)},</p>`,
  `<p>Thanks for contacting ${esc(companyName)}. We received your request and a member of our team will get back to you within one business day.</p>`,
  quoted ? `<p>Your message:</p><blockquote style="border-left:3px solid #ccc;padding-left:10px;color:#555">${esc(quoted)}</blockquote>` : '',
  bookingUrl ? `<p>Want to talk sooner? <a href="${esc(bookingUrl)}">Book a call here</a>.</p>` : '',
  `<p>Best regards,<br>${esc(companyName)}</p>`,
].filter(Boolean).join('\n');

const text = [
  `Hi ${greetingName},`,
  '',
  `Thanks for contacting ${companyName}. We received your request and a member of our team will get back to you within one business day.`,
  quoted ? `\nYour message:\n> ${quoted}` : null,
  bookingUrl ? `\nWant to talk sooner? Book a call: ${bookingUrl}` : null,
  '',
  `Best regards,\n${companyName}`,
].filter((l) => l !== null).join('\n');

return [{
  json: {
    to: lead.email,
    from: config.fromEmail || '',
    subject,
    html,
    text,
    crmProvider,
    crmRecordId,
  },
}];
