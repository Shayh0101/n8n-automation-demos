// Normalize & Validate Lead
// Mode: "Run Once for All Items". Accepts the Webhook payload (fields under `body`)
// or a flat object, cleans it up, validates it and prepares the request body
// for the CRM selected in the "Config" node (config.crmProvider).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SUPPORTED_CRMS = ['hubspot', 'gohighlevel', 'airtable'];
const MAX_MESSAGE_LENGTH = 5000;

// Return the first non-empty value among several possible field names
// (forms from Webflow, Typeform, Elementor, etc. all name fields differently).
const pick = (obj, keys) => {
  for (const key of keys) {
    const value = obj ? obj[key] : undefined;
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

const normalizePhone = (raw) => {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return (raw.startsWith('+') ? '+' : '') + digits;
};

const toTitle = (s) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

return $input.all().map((item) => {
  const json = item.json || {};
  const config = json.config || {};
  const src = json.body && typeof json.body === 'object' ? json.body : json;
  const query = json.query || {};
  const errors = [];

  // --- Name -----------------------------------------------------------------
  let firstName = pick(src, ['firstName', 'first_name', 'firstname', 'fname']);
  let lastName = pick(src, ['lastName', 'last_name', 'lastname', 'lname']);
  const fullName = pick(src, ['name', 'Name', 'fullName', 'full_name', 'your-name']);
  if (!firstName && fullName) {
    const parts = fullName.split(/\s+/);
    firstName = parts.shift();
    lastName = lastName || parts.join(' ');
  }
  firstName = toTitle(firstName);
  lastName = toTitle(lastName);

  // --- Contact fields -------------------------------------------------------
  const email = pick(src, ['email', 'Email', 'email_address', 'your-email']).toLowerCase();
  const phone = normalizePhone(pick(src, ['phone', 'Phone', 'phone_number', 'tel']));
  const company = pick(src, ['company', 'Company', 'companyName', 'organization']);
  const message = pick(src, ['message', 'Message', 'comments', 'your-message']);
  const source = pick(src, ['source', 'form_name', 'formName']) || 'Website form';
  const utm = {
    source: pick(src, ['utm_source']) || pick(query, ['utm_source']),
    medium: pick(src, ['utm_medium']) || pick(query, ['utm_medium']),
    campaign: pick(src, ['utm_campaign']) || pick(query, ['utm_campaign']),
  };

  // --- Validation -----------------------------------------------------------
  if (!email) errors.push('email is required');
  else if (!EMAIL_RE.test(email)) errors.push('email is invalid');
  if (phone && phone.replace('+', '').length < 7) errors.push('phone is invalid');
  if (message.length > MAX_MESSAGE_LENGTH) errors.push('message is too long');
  // Honeypot: hidden form field that humans leave empty and bots fill in.
  if (pick(src, ['website_url', '_gotcha', 'hp_field'])) errors.push('spam detected');

  const crmProvider = String(config.crmProvider || 'hubspot').trim().toLowerCase();
  if (!SUPPORTED_CRMS.includes(crmProvider)) {
    errors.push(`unsupported crmProvider "${crmProvider}" (use: ${SUPPORTED_CRMS.join(', ')})`);
  }

  const lead = {
    firstName, lastName, email, phone, company, message, source, utm,
    submittedAt: new Date().toISOString(),
  };

  // --- CRM request bodies (upsert by email, so re-submits don't duplicate) ---
  let crmBody = null;
  if (errors.length === 0) {
    if (crmProvider === 'hubspot') {
      // POST /crm/v3/objects/contacts/batch/upsert
      const properties = { email, firstname: firstName, lastname: lastName, phone, company, message, lifecyclestage: 'lead' };
      Object.keys(properties).forEach((k) => properties[k] === '' && delete properties[k]);
      crmBody = { inputs: [{ idProperty: 'email', id: email, properties }] };
    } else if (crmProvider === 'gohighlevel') {
      // POST /contacts/upsert (LeadConnector API v2)
      crmBody = {
        locationId: config.ghlLocationId || '',
        firstName, lastName, email, phone, companyName: company, source,
        tags: ['n8n-lead', utm.source && `utm:${utm.source}`].filter(Boolean),
      };
      Object.keys(crmBody).forEach((k) => crmBody[k] === '' && delete crmBody[k]);
    } else if (crmProvider === 'airtable') {
      // PATCH /v0/{baseId}/{table} with performUpsert
      crmBody = {
        performUpsert: { fieldsToMergeOn: ['Email'] },
        typecast: true,
        records: [{
          fields: {
            Email: email, 'First Name': firstName, 'Last Name': lastName, Phone: phone,
            Company: company, Message: message, Source: source,
            'UTM Source': utm.source, 'UTM Medium': utm.medium, 'UTM Campaign': utm.campaign,
            'Submitted At': lead.submittedAt,
          },
        }],
      };
    }
  }

  return { json: { valid: errors.length === 0, errors, crmProvider, lead, crmBody, config } };
});
