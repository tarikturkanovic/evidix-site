// Single source of truth for plans. Edit prices/limits here (or via env for Stripe price IDs).
export const PLANS = {
  free:    { name: 'Free',    price: 0,  monthlyGenerations: 2,   detail: ['standard'],                       stripePriceId: null },
  creator: { name: 'Creator', price: 39, monthlyGenerations: 30,  detail: ['standard', 'detailed'],           stripePriceId: 'price_1Udj35HXLmWYiK45wdZk3dYe', },
  pro:     { name: 'Pro',     price: 79, monthlyGenerations: 100, detail: ['standard', 'detailed', 'advanced'], stripePriceId: 'price_1Udj3gHXLmWYiK454oSeR9qO', },
};

export function planFromPriceId(priceId) {
  for (const [key, p] of Object.entries(PLANS)) if (p.stripePriceId && p.stripePriceId === priceId) return key;
  return null;
}
