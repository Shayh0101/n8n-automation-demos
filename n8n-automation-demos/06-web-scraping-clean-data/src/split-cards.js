// Turns the array of product-card HTML snippets into one item per card.
// If the page had no cards (selector broken / layout changed) we still emit a
// single marker item so the downstream alert branch can fire.
const cards = $input.first().json.cards;
const list = Array.isArray(cards) ? cards : (cards ? [cards] : []);

if (list.length === 0) {
  return [{ json: { cards: '', empty_page: true } }];
}

return list.map((html) => ({ json: { cards: String(html) } }));
