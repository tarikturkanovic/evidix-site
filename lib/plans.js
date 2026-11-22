// Single source of truth for plans, credits and prices.
// Stripe price IDs: set below once created in Stripe (null = not purchasable yet).
export const COSTS = { plan: 40, fix: 15, improve: 40, scene: 15, renderPerSecond: 25 };

export const PLANS = {
  free: { name: 'Free', price: 0, credits: 80, detail: ['standard'], prices: { month: null, year: null } },
  creator: { name: 'Creator', price: 39, credits: 2000, detail: ['standard', 'detailed'],
    prices: { month: 'price_1Udj35HXLmWYiK45wdZk3dYe', year: null } },
  pro: { name: 'Pro', price: 79, credits: 4200, detail: ['standard', 'detailed', 'advanced'],
    prices: { month: 'price_1Udj3gHXLmWYiK454oSeR9qO', year: null } },
  studio: { name: 'Studio', price: 149, credits: 8000, detail: ['standard', 'detailed', 'advanced'],
    prices: { month: null, year: null } },
};
for (const p of Object.values(PLANS)) p.annualPrice = +(p.price * 12 * 0.8).toFixed(2); // 20% off, billed once a year

// One-time credit packs, for active subscribers only.
export const TOPUPS = {
  t600: { credits: 600, price: 15, stripePriceId: null },
  t1700: { credits: 1700, price: 39, stripePriceId: null },
  t3800: { credits: 3800, price: 79, stripePriceId: null },
};

export function planFromPriceId(priceId) {
  for (const [key, p] of Object.entries(PLANS)) if (priceId && (p.prices.month === priceId || p.prices.year === priceId)) return key;
  return null;
}
export function intervalFromPriceId(priceId) {
  for (const p of Object.values(PLANS)) { if (priceId && p.prices.month === priceId) return 'month'; if (priceId && p.prices.year === priceId) return 'year'; }
  return null;
}
export function topupFromPriceId(priceId) {
  for (const [id, t] of Object.entries(TOPUPS)) if (priceId && t.stripePriceId === priceId) return { id, ...t };
  return null;
}
