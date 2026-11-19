import { createClient } from '@supabase/supabase-js';

export const admin = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Verifies the Supabase access token sent by the browser. Returns the user or null.
export async function authUser(req, db) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user || null;
}

export const send = (res, status, body) => res.status(status).json(body);
