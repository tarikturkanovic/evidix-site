import { PLANS, TOPUPS, COSTS } from '../lib/plans.js';

// Public settings the browser needs. The anon key is designed to be public; row-level security protects data.
export default function handler(req, res) {
  const plans = Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, {
    name: p.name, price: p.price, annualPrice: p.annualPrice, credits: p.credits, detail: p.detail,
    purchasable: { month: !!p.prices.month, year: !!p.prices.year },
  }]));
  const topups = Object.fromEntries(Object.entries(TOPUPS).map(([k, t]) => [k, { credits: t.credits, price: t.price, purchasable: !!t.stripePriceId }]));
  res.status(200).json({ supabaseUrl: process.env.SUPABASE_URL || null, supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null, plans, topups, costs: COSTS });
}
