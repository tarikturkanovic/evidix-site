import { PLANS } from '../lib/plans.js';

// Public settings the browser needs. The anon key is designed to be public; row-level security protects data.
export default function handler(req, res) {
  const plans = Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, { name: p.name, price: p.price, monthlyGenerations: p.monthlyGenerations, detail: p.detail, purchasable: !!p.stripePriceId }]));
  res.status(200).json({ supabaseUrl: process.env.SUPABASE_URL || null, supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null, plans });
}
