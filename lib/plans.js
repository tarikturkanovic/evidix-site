// Single source of truth for plans. Edit prices/limits here (or via env for Stripe price IDs).
export const PLANS = {
  free:    { name: 'Free',    price: 0,  monthlyGenerations: 2,   detail: ['standard'],                       stripePriceId: null },
  creator: { name: 'Creator', price: 19, monthlyGenerations: 30,  detail: ['standard', 'detailed'],           stripePriceId: process.env.STRIPE_PRICE_CREATOR || null },
  pro:     { name: 'Pro',     price: 39, monthlyGenerations: 100, detail: ['standard', 'detailed', 'advanced'], stripePriceId: process.env.STRIPE_PRICE_PRO || null },
};

export function planFromPriceId(priceId) {
  for (const [key, p] of Object.entries(PLANS)) if (p.stripePriceId && p.stripePriceId === priceId) return key;
  return null;
}
