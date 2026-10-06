// Meta webhook verification handshake (GET request).
// Meta calls: GET <webhook>?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// We must echo hub.challenge with HTTP 200 if the token matches, otherwise 403.
return $input.all().map((item) => {
  const query = item.json.query || {};
  const expected = String((item.json.config || {}).verifyToken || '');
  const received = String(query['hub.verify_token'] || '');

  const ok =
    query['hub.mode'] === 'subscribe' &&
    expected.length > 0 &&
    received === expected;

  return {
    json: ok
      ? { statusCode: 200, body: String(query['hub.challenge'] ?? '') }
      : { statusCode: 403, body: 'Verification failed' },
  };
});
